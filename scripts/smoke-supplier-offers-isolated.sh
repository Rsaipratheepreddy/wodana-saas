#!/usr/bin/env bash

set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"
for command_name in createdb dropdb curl; do command -v "$command_name" >/dev/null 2>&1 || { echo "Supplier-offer smoke requires $command_name." >&2; exit 1; }; done
test_port="${SUPPLIER_OFFER_TEST_PORT:-8168}"
if ! [[ "$test_port" =~ ^[0-9]+$ ]] || (( test_port < 1024 || test_port > 65535 )); then echo "Invalid SUPPLIER_OFFER_TEST_PORT." >&2; exit 1; fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$test_port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $test_port is already in use." >&2; exit 1; fi
database_name="wodana_supplier_offer_test_$$_${RANDOM}"
[[ "$database_name" =~ ^wodana_supplier_offer_test_[0-9]+_[0-9]+$ ]] || { echo "Unexpected database name." >&2; exit 1; }
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/wodana-supplier-offer.XXXXXX")"
server_pid=""
cleanup() {
  exit_status=$?
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi
  if [[ "$exit_status" -ne 0 && -f "$temporary_root/business-core.log" ]]; then tail -140 "$temporary_root/business-core.log" >&2 || true; fi
  dropdb --force --if-exists "$database_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
  return "$exit_status"
}
trap cleanup EXIT INT TERM
createdb "$database_name"
database_url="postgresql://127.0.0.1/${database_name}"
DATABASE_URL="$database_url" MIGRATION_DATABASE_URL="$database_url" npm run db:migrate --workspace @wodana/business-core >/dev/null
DATABASE_URL="$database_url" npm run test:smoke:tenant-isolation --workspace @wodana/business-core >/dev/null
npm run build --workspace @wodana/business-core >/dev/null
(
  cd services/business-core
  DATABASE_URL="$database_url" PORT="$test_port" AUTH_MODE="local" NODE_ENV="test" \
  LOCAL_AUTH_JWT_SECRET="supplier-offer-smoke-secret-2026-at-least-32-bytes" DEMO_TENANT_ENABLED="true" \
  REDIS_URL="" OBJECT_STORAGE_BUCKET="" BRAND_ASSET_STORAGE_DIR="$temporary_root/storage" \
  MAILGUN_API_KEY="" MAILGUN_DOMAIN="" DEPENDENCY_CHECKS_ENABLED="false" node dist/main.js
) >"$temporary_root/business-core.log" 2>&1 &
server_pid=$!
ready="false"
for _attempt in {1..100}; do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${test_port}/api/v1/health"; then ready="true"; break; fi
  kill -0 "$server_pid" >/dev/null 2>&1 || break
  sleep 0.2
done
[[ "$ready" == "true" ]] || { echo "Business Core did not start for supplier-offer smoke." >&2; exit 1; }
BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" node services/business-core/scripts/smoke-supplier-offers.mjs
