#!/bin/bash
# Builds a release on the AWS host (arm64) and rolls production onto it. Run as root:
#   deploy.sh <release>   with /opt/wodana/prod/src/<release>.tgz (a `git archive` of the repository).
# Log: /opt/wodana/prod/logs/<release>.log
set -euo pipefail
R="$1"; P=/opt/wodana/prod; S="$P/src/$R"
mkdir -p "$P/logs" "$S" /var/www/certbot
exec > >(tee -a "$P/logs/$R.log") 2>&1
echo "== $(date -u +%FT%TZ) deploy $R"

tar -xzf "$P/src/$R.tgz" -C "$S"
cd "$S"
docker image prune -f >/dev/null || true
docker builder prune -f --filter until=72h >/dev/null || true
docker build -f services/business-core/Dockerfile --target migrator -t "wodana-core-migrator:$R" .
docker build -f services/business-core/Dockerfile --target runner -t "wodana-core:$R" .
docker build -f services/intelligence-automation/Dockerfile -t "wodana-intelligence:$R" services/intelligence-automation
docker build -f apps/web/Dockerfile -t "wodana-web:$R" .

install -m 600 infra/aws/compose.yaml "$P/compose.yaml"
install -m 755 infra/postgres/001-create-app-role.sh "$P/001-create-app-role.sh"
bash infra/aws/bootstrap-env.sh
printf 'RELEASE=%s\n' "$R" > "$P/.env"

cd "$P"
docker compose up -d --remove-orphans --wait --wait-timeout 300

# nginx: HTTPS once the certificate exists, plain HTTP before that.
install -m 644 "$S"/infra/aws/nginx/wodana-{routes,proxy,http-include,http-redirect}.conf /etc/nginx/snippets/
printf 'map "" $wodana_release { default "%s"; }\n' "$R" > /etc/nginx/conf.d/wodana-release.conf
if [ -f /etc/letsencrypt/live/wodana-prod/fullchain.pem ]; then
  sed 's/__HTTP_MODE__/redirect/' "$S/infra/aws/nginx/wodana.conf" > /etc/nginx/sites-available/wodana
else
  sed -e 's/__HTTP_MODE__/include/' -e '/# __TLS_BEGIN__/,/# __TLS_END__/d' "$S/infra/aws/nginx/wodana.conf" > /etc/nginx/sites-available/wodana
fi
ln -sf /etc/nginx/sites-available/wodana /etc/nginx/sites-enabled/wodana
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

curl -fsS -o /dev/null -w "web %{http_code}\n" -H "Host: admin.wodana.ai" http://127.0.0.1/login
curl -fsS -o /dev/null -w "core %{http_code}\n" -H "Host: admin.wodana.ai" http://127.0.0.1/api/v1/health/ready
# Keep the three newest source trees.
ls -dt "$P"/src/*/ | tail -n +4 | xargs -r rm -rf
echo "== $(date -u +%FT%TZ) deployed $R"
