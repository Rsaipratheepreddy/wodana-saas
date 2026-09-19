#!/usr/bin/env bash
set -euo pipefail

# Native-host certificate sync. Tenant hostnames come from the workspace login
# records, not from the unrelated customer-organization model.
PROJECT_DIR="${PROJECT_DIR:-/var/opt/Igolo-Management}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"
CERT_NAME="${CERT_NAME:-wodana.ai}"
LOCK_FILE="${LOCK_FILE:-/run/lock/wodana-tenant-certificates.lock}"

exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

read_env() {
  local value
  value="$(sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

base_domain="$(read_env BASE_DOMAIN)"
base_domain="${base_domain:-wodana.ai}"
release_database="${RELEASE_DATABASE:-wodana_release}"

[[ "${base_domain}" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid BASE_DOMAIN" >&2; exit 1; }

tenant_slugs="$(sudo -u postgres psql -d "${release_database}" -Atc "SELECT branding.login_slug
  FROM tenant_login_branding branding
  JOIN workspaces workspace ON workspace.id = branding.workspace_id
  WHERE workspace.status = 'active'
  ORDER BY branding.login_slug")"

domains=(
  "${base_domain}"
  "www.${base_domain}"
  "admin.${base_domain}"
  "api.${base_domain}"
  "client.${base_domain}"
)
while IFS= read -r slug; do
  [[ "${slug}" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || continue
  domains+=("${slug}.${base_domain}")
done <<<"${tenant_slugs}"

mapfile -t domains < <(printf '%s\n' "${domains[@]}" | sort -u)
certificate="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
if [[ -s "${certificate}" ]]; then
  current_names="$(openssl x509 -in "${certificate}" -noout -ext subjectAltName 2>/dev/null || true)"
  missing=0
  for domain in "${domains[@]}"; do
    if ! grep -Fq "DNS:${domain}" <<<"${current_names}"; then missing=1; break; fi
  done
  (( missing == 1 )) || exit 0
fi

domain_args=()
for domain in "${domains[@]}"; do domain_args+=("-d" "${domain}"); done
certbot --nginx --non-interactive --agree-tos --cert-name "${CERT_NAME}" --expand "${domain_args[@]}"
nginx -t
systemctl reload nginx
