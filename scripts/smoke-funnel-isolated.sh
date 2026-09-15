#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

for command_name in createdb dropdb curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "The isolated funnel smoke requires $command_name." >&2
    exit 1
  fi
done

test_port="${FUNNEL_TEST_PORT:-8164}"
if ! [[ "$test_port" =~ ^[0-9]+$ ]] || (( test_port < 1024 || test_port > 65535 )); then
  echo "FUNNEL_TEST_PORT must be an available port between 1024 and 65535." >&2
  exit 1
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$test_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $test_port is already in use. Set FUNNEL_TEST_PORT to another local port." >&2
  exit 1
fi

database_name="wodana_funnel_test_$$_${RANDOM}"
if ! [[ "$database_name" =~ ^wodana_funnel_test_[0-9]+_[0-9]+$ ]]; then
  echo "Refusing to use an unexpected database name." >&2
  exit 1
fi
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/wodana-funnel.XXXXXX")"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  dropdb --force --if-exists "$database_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

createdb "$database_name"
database_url="postgresql://127.0.0.1/${database_name}"

DATABASE_URL="$database_url" \
MIGRATION_DATABASE_URL="$database_url" \
  npm run db:migrate --workspace @wodana/business-core >/dev/null
npm run build --workspace @wodana/business-core >/dev/null

(
  cd services/business-core
  DATABASE_URL="$database_url" \
  PORT="$test_port" \
  AUTH_MODE="development" \
  NODE_ENV="test" \
  PORTAL_DEMO_OTP="true" \
  REDIS_URL="" \
  OBJECT_STORAGE_BUCKET="" \
  BRAND_ASSET_STORAGE_DIR="$temporary_root/storage" \
  MAILGUN_API_KEY="" \
  MAILGUN_DOMAIN="" \
  DEPENDENCY_CHECKS_ENABLED="false" \
    node dist/main.js
) >"$temporary_root/business-core.log" 2>&1 &
server_pid=$!

ready="false"
for _attempt in {1..100}; do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${test_port}/api/v1/health"; then
    ready="true"
    break
  fi
  if ! kill -0 "$server_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
if [[ "$ready" != "true" ]]; then
  echo "Business Core did not start for the isolated funnel smoke." >&2
  tail -80 "$temporary_root/business-core.log" >&2 || true
  exit 1
fi

BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" \
  npm run test:smoke:funnel --workspace @wodana/business-core
