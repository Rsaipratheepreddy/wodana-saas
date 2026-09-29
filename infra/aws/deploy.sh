#!/bin/bash
# Builds a release on the AWS host (arm64) and rolls production onto it. Run as root:
#   deploy.sh <release>   with /opt/wodana/prod/src/<release>.tgz (a `git archive` of the repository).
# Log: /opt/wodana/prod/logs/<release>.log
set -euo pipefail
R="$1"; P=/opt/wodana/prod; S="$P/src/$R"
mkdir -p "$P/logs" "$S" /var/www/certbot
exec > >(tee -a "$P/logs/$R.log") 2>&1
echo "== $(date -u +%FT%TZ) deploy $R"

[ "$(df --output=avail -BG / | tail -1 | tr -dc 0-9)" -ge 8 ] || { echo "less than 8 GB free; not building" >&2; exit 1; }
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

# Host scripts, nginx (HTTPS once the certificate exists), certificate and backup timers.
install -m 755 "$S"/infra/aws/{deploy,render-nginx,sync-tenant-certificates,backup}.sh "$P/"
mkdir -p "$P/nginx" && install -m 644 "$S"/infra/aws/nginx/*.conf "$P/nginx/"
install -m 644 "$S"/infra/aws/systemd/wodana-{certificates,backup}.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wodana-certificates.timer wodana-backup.timer
"$P/render-nginx.sh"

# The web can take a few seconds after the reload; retry for up to a minute before calling it a failure.
check() { for _ in $(seq 1 12); do curl -fsS -o /dev/null -w "$1 %{http_code}\n" -H "Host: admin.wodana.ai" "http://127.0.0.1$2" && return 0; sleep 5; done; return 1; }
check web /
check core /api/v1/health/ready
# Keep the disk small: the three newest source trees and packages, and no image another release left behind.
ls -dt "$P"/src/*/ | tail -n +4 | xargs -r rm -rf
ls -t "$P"/src/*.tgz 2>/dev/null | tail -n +4 | xargs -r rm -f
used=$(docker ps -a --format '{{.Image}}' | sort -u)
for img in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^wodana-(core|core-migrator|web|intelligence):' | grep -v ":$R\$"); do
  echo "$used" | grep -qx "$img" || docker rmi "$img" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null 2>&1 || true
df -h / | tail -1
echo "== $(date -u +%FT%TZ) deployed $R"
