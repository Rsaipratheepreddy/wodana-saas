#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.production}"
COMPOSE_FILE="${ROOT_DIR}/infra/hostinger/compose.production.yaml"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
WODANA_RELEASE_ID="${WODANA_RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)-full}"
export WODANA_RELEASE_ID

"${ROOT_DIR}/infra/hostinger/validate.sh" "${ENV_FILE}"
# This is an update of the new stack, never an implicit takeover of legacy Nginx.
if [[ -z "$("${COMPOSE[@]}" ps --status running -q nginx)" ]]; then
  echo "First migration: use stage.sh, verify migrated users/data/integrations, then configure the existing public proxy. This script cannot take over the legacy site's ports." >&2
  exit 1
fi
"${COMPOSE[@]}" build --pull --parallel
ENV_FILE="${ENV_FILE}" "${ROOT_DIR}/infra/hostinger/backup.sh"
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
"${COMPOSE[@]}" ps

base_domain="$(sed -n 's/^BASE_DOMAIN=//p' "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://api.${base_domain}/api/v1/health/ready" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://api.${base_domain}/api/v1/health/ready" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${base_domain}/" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 "https://${base_domain}/login" >/dev/null
echo "Wodana services are healthy."
