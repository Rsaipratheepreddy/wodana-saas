#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.production}"
COMPOSE_FILE="${ROOT_DIR}/infra/hostinger/compose.production.yaml"

certbot renew --quiet --deploy-hook "docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec -T nginx nginx -s reload"
