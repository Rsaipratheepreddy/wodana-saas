#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

manifest_path="${PALM_CORE_MANIFEST:-}"
if [[ -z "$manifest_path" || ! -f "$manifest_path" ]]; then
  echo "Set PALM_CORE_MANIFEST to a reviewed prepared Palm collection manifest." >&2
  exit 1
fi
manifest_path="$(cd "$(dirname "$manifest_path")" && pwd)/$(basename "$manifest_path")"

for command_name in createdb dropdb curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "The Palm configuration smoke requires $command_name." >&2; exit 1; }
done

test_port="${PALM_CONFIG_TEST_PORT:-8168}"
if ! [[ "$test_port" =~ ^[0-9]+$ ]] || (( test_port < 1024 || test_port > 65535 )); then
  echo "PALM_CONFIG_TEST_PORT must be an available port between 1024 and 65535." >&2
  exit 1
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$test_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $test_port is already in use." >&2
  exit 1
fi

database_name="wodana_palm_config_test_$$_${RANDOM}"
if ! [[ "$database_name" =~ ^wodana_palm_config_test_[0-9]+_[0-9]+$ ]]; then
  echo "Refusing to use an unexpected database name." >&2
  exit 1
fi
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/wodana-palm-config.XXXXXX")"
server_pid=""
cleanup() {
  exit_status=$?
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    pkill -TERM -P "$server_pid" >/dev/null 2>&1 || true
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$exit_status" -ne 0 && -f "$temporary_root/business-core.log" ]]; then
    tail -160 "$temporary_root/business-core.log" >&2 || true
  fi
  dropdb --force --if-exists "$database_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
  return "$exit_status"
}
trap cleanup EXIT INT TERM

createdb "$database_name"
database_url="postgresql://127.0.0.1/${database_name}"
DATABASE_URL="$database_url" MIGRATION_DATABASE_URL="$database_url" \
  npm run db:migrate --workspace @wodana/business-core >/dev/null
npm run build --workspace @wodana/business-core >/dev/null

(
  cd services/business-core
  DATABASE_URL="$database_url" PORT="$test_port" AUTH_MODE="development" NODE_ENV="test" \
  LOCAL_AUTH_JWT_SECRET="isolated-palm-config-secret-at-least-32-characters" \
  MFA_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
  BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" REDIS_URL="" OBJECT_STORAGE_BUCKET="" \
  BRAND_ASSET_STORAGE_DIR="$temporary_root/storage" MAILGUN_API_KEY="" MAILGUN_DOMAIN="" \
  DEPENDENCY_CHECKS_ENABLED="false" exec node dist/main.js
) >"$temporary_root/business-core.log" 2>&1 &
server_pid=$!

ready=false
for _attempt in {1..300}; do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${test_port}/api/v1/health" 2>/dev/null; then ready=true; break; fi
  kill -0 "$server_pid" >/dev/null 2>&1 || break
  sleep 0.2
done
if [[ "$ready" != true ]]; then
  echo "Business Core did not start for the Palm configuration smoke." >&2
  exit 1
fi

export BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1"
npm run seed:palm:local --workspace @wodana/business-core >/dev/null

first_profile="$(node services/business-core/scripts/apply-palm-tenant-profile.mjs --commit)"
second_profile="$(node services/business-core/scripts/apply-palm-tenant-profile.mjs --commit)"
if [[ "$(jq '.changed | length' <<<"$second_profile")" != 0 ]]; then
  echo "Palm tenant configuration is not idempotent." >&2
  jq . <<<"$second_profile" >&2
  exit 1
fi

first_collection="$(node services/business-core/scripts/apply-palm-core-collection.mjs "$manifest_path" --commit)"
second_collection="$(node services/business-core/scripts/apply-palm-core-collection.mjs "$manifest_path" --commit)"
expected_records="$(jq '.records | length' "$manifest_path")"
expected_assets="$(jq '.assets | length' "$manifest_path")"
jq -e --argjson records "$expected_records" --argjson assets "$expected_assets" \
  '.preparedPresent == $records and .assets.prepared == $assets and .assets.reused == $assets and .assets.uploaded == 0' \
  <<<"$second_collection" >/dev/null

jq -n \
  --argjson firstProfile "$first_profile" --argjson secondProfile "$second_profile" \
  --argjson firstCollection "$first_collection" --argjson secondCollection "$second_collection" \
  '{ok:true,profile:{first:$firstProfile,second:$secondProfile},collection:{first:$firstCollection,second:$secondCollection}}'
