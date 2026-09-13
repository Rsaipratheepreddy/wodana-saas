#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.production}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/infra/hostinger/compose.production.yaml" -f "${ROOT_DIR}/infra/hostinger/compose.preview.yaml")
"${ROOT_DIR}/infra/hostinger/validate.sh" "${ENV_FILE}"
# Staging is for the first parallel installation, not an unannounced in-place update.
if [[ -n "$("${COMPOSE[@]}" ps --status running -q business-core web nginx intelligence-worker)" ]]; then
  echo "The new stack already has running application services. Use the backed-up release procedure for updates." >&2
  exit 1
fi
"${COMPOSE[@]}" build business-core-migrate business-core intelligence-api web
# Explicit service list deliberately excludes nginx and all outbound workers.
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 business-core intelligence-api web
curl --fail --silent --show-error http://127.0.0.1:18000/api/v1/health/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18001/api/v1/health/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:13000/login >/dev/null
echo "New stack is available privately on 127.0.0.1:13000. Existing public proxy and workers are unchanged."
