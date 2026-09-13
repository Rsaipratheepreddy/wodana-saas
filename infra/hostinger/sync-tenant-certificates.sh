#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.production}"
COMPOSE_FILE="${ROOT_DIR}/infra/hostinger/compose.production.yaml"
LOCK_FILE="${LOCK_FILE:-/run/lock/wodana-tenant-certificates.lock}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

read_env() {
  sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r'
}

base_domain="$(read_env BASE_DOMAIN)"
cert_name="$(read_env CERT_NAME)"
cert_name="${cert_name:-${base_domain}}"
certbot_email="$(read_env CERTBOT_EMAIL)"
webroot="$(read_env CERTBOT_WWW_DIR)"
webroot="${webroot:-/opt/wodana/certbot/www}"

[[ "${base_domain}" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid BASE_DOMAIN" >&2; exit 1; }

domains=("${base_domain}" "www.${base_domain}" "admin.${base_domain}" "client.${base_domain}" "api.${base_domain}" "integrations.${base_domain}")
while IFS= read -r slug; do
  [[ "${slug}" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || continue
  domains+=("${slug}.${base_domain}")
done < <("${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select slug from workspaces where status = '\''active'\'' order by slug"')

mapfile -t domains < <(printf '%s\n' "${domains[@]}" | sort -u)
domain_args=()
for domain in "${domains[@]}"; do domain_args+=(-d "${domain}"); done

certbot certonly --webroot -w "${webroot}" --non-interactive --agree-tos --email "${certbot_email}" --cert-name "${cert_name}" --expand "${domain_args[@]}"
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload
