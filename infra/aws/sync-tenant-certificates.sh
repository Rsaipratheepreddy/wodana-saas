#!/bin/bash
# Keeps one certificate (wodana-prod) covering the platform hosts and every active tenant's
# <slug>.<base domain>, so a tenant created in the internal portal gets HTTPS within minutes.
# Only names whose DNS already points at this server are requested (HTTP-01 would fail otherwise).
set -euo pipefail
exec 9>/run/lock/wodana-certificates.lock
flock -n 9 || exit 0
BASE_DOMAIN="${BASE_DOMAIN:-wodana.ai}"
EMAIL="${CERT_EMAIL:-wodanatechnology@gmail.com}"
TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token)
SELF=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)

slugs=$(docker compose -f /opt/wodana/prod/compose.yaml exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT b.login_slug FROM tenant_login_branding b JOIN workspaces w ON w.id = b.workspace_id WHERE w.status = '"'"'active'"'"' ORDER BY 1"' 2>/dev/null || true)

candidates=("$BASE_DOMAIN" "www.$BASE_DOMAIN" "internal.$BASE_DOMAIN" "admin.$BASE_DOMAIN" "api.$BASE_DOMAIN")
while IFS= read -r slug; do
  [[ "$slug" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] && candidates+=("$slug.$BASE_DOMAIN")
done <<<"$slugs"

domains=()
for d in $(printf '%s\n' "${candidates[@]}" | sort -u); do
  getent ahostsv4 "$d" | awk '{print $1}' | grep -qx "$SELF" && domains+=("$d")
done
[ ${#domains[@]} -gt 0 ] || { echo "no host points at $SELF yet"; exit 0; }

cert=/etc/letsencrypt/live/wodana-prod/fullchain.pem
if [ -s "$cert" ]; then
  names=$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null || true)
  missing=0
  for d in "${domains[@]}"; do grep -Fq "DNS:$d" <<<"$names" || { missing=1; break; }; done
  [ $missing -eq 1 ] || exit 0
fi

args=(); for d in "${domains[@]}"; do args+=(-d "$d"); done
certbot certonly --webroot -w /var/www/certbot --non-interactive --agree-tos -m "$EMAIL" \
  --cert-name wodana-prod --expand "${args[@]}"
/opt/wodana/prod/render-nginx.sh
echo "certificate covers: ${domains[*]}"
