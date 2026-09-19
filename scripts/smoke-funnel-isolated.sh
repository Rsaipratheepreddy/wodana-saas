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
smoke_command="${SMOKE_COMMAND:-test:smoke:funnel}"
web_test_port="${FUNNEL_WEB_PORT:-3165}"
if ! [[ "$test_port" =~ ^[0-9]+$ ]] || (( test_port < 1024 || test_port > 65535 )); then
  echo "FUNNEL_TEST_PORT must be an available port between 1024 and 65535." >&2
  exit 1
fi
case "$smoke_command" in
  test:smoke|test:smoke:funnel|test:smoke:palm-clone|test:smoke:auth|test:smoke:operator|test:smoke:crm|test:smoke:seats|test:smoke:app-effects|test:smoke:auth-web|test:smoke:operator-web) ;;
  *)
    echo "SMOKE_COMMAND must be one of: test:smoke, test:smoke:funnel, test:smoke:palm-clone, test:smoke:auth, test:smoke:operator, test:smoke:crm, test:smoke:seats, test:smoke:app-effects, test:smoke:auth-web, test:smoke:operator-web." >&2
    exit 1
    ;;
esac
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$test_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $test_port is already in use. Set FUNNEL_TEST_PORT to another local port." >&2
  exit 1
fi
if [[ "$smoke_command" == "test:smoke:auth-web" || "$smoke_command" == "test:smoke:operator-web" ]]; then
  if ! [[ "$web_test_port" =~ ^[0-9]+$ ]] || (( web_test_port < 1024 || web_test_port > 65535 )); then
    echo "FUNNEL_WEB_PORT must be an available port between 1024 and 65535." >&2
    exit 1
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$web_test_port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $web_test_port is already in use. Set FUNNEL_WEB_PORT to another local port." >&2
    exit 1
  fi
fi

database_name="wodana_funnel_test_$$_${RANDOM}"
if ! [[ "$database_name" =~ ^wodana_funnel_test_[0-9]+_[0-9]+$ ]]; then
  echo "Refusing to use an unexpected database name." >&2
  exit 1
fi
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/wodana-funnel.XXXXXX")"
server_pid=""
web_pid=""
web_dist_dir=""

cleanup() {
  exit_status=$?
  if [[ -n "$web_pid" ]] && kill -0 "$web_pid" >/dev/null 2>&1; then
    pkill -TERM -P "$web_pid" >/dev/null 2>&1 || true
    kill "$web_pid" >/dev/null 2>&1 || true
    wait "$web_pid" 2>/dev/null || true
  fi
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    pkill -TERM -P "$server_pid" >/dev/null 2>&1 || true
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$exit_status" -ne 0 && -f "$temporary_root/business-core.log" ]]; then
    echo "Business Core log from failed funnel smoke:" >&2
    tail -120 "$temporary_root/business-core.log" >&2 || true
  fi
  if [[ "$exit_status" -ne 0 && -f "$temporary_root/web.log" ]]; then
    echo "Web log from failed funnel smoke:" >&2
    tail -80 "$temporary_root/web.log" >&2 || true
  fi
  if [[ -n "$web_dist_dir" && -d "$web_dist_dir" ]]; then
    rm -rf "$web_dist_dir"
  fi
  dropdb --force --if-exists "$database_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
  return "$exit_status"
}
trap cleanup EXIT INT TERM

createdb "$database_name"
database_url="postgresql://127.0.0.1/${database_name}"

DATABASE_URL="$database_url" \
MIGRATION_DATABASE_URL="$database_url" \
  npm run db:migrate --workspace @wodana/business-core >/dev/null
DATABASE_URL="$database_url" \
  npm run test:smoke:tenant-isolation --workspace @wodana/business-core >/dev/null
npm run build --workspace @wodana/business-core >/dev/null

auth_mode="development"
if [[ "$smoke_command" == "test:smoke:auth" || "$smoke_command" == "test:smoke:operator" || "$smoke_command" == "test:smoke:app-effects" || "$smoke_command" == "test:smoke:auth-web" || "$smoke_command" == "test:smoke:operator-web" ]]; then
  auth_mode="local"
fi

(
  cd services/business-core
  DATABASE_URL="$database_url" \
  PORT="$test_port" \
  AUTH_MODE="$auth_mode" \
  NODE_ENV="test" \
  LOCAL_AUTH_JWT_SECRET="isolated-smoke-jwt-secret-at-least-32-characters" \
  MFA_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
  BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" \
  PORTAL_DEMO_OTP="true" \
  REDIS_URL="" \
  OBJECT_STORAGE_BUCKET="" \
  BRAND_ASSET_STORAGE_DIR="$temporary_root/storage" \
  MAILGUN_API_KEY="" \
  MAILGUN_DOMAIN="" \
  DEPENDENCY_CHECKS_ENABLED="false" \
    exec node dist/main.js
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

if [[ "$smoke_command" == "test:smoke:auth-web" || "$smoke_command" == "test:smoke:operator-web" ]]; then
  web_dist_dir="apps/web/.next-onboarding-crm-smoke"
  if [[ -e "$web_dist_dir" ]]; then
    echo "Refusing to overwrite an existing web smoke build directory." >&2
    exit 1
  fi
  mkdir "$web_dist_dir"
  (
    cd apps/web
    BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" \
    BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" \
    NEXT_PUBLIC_BUSINESS_API_URL="http://127.0.0.1:${test_port}/api/v1" \
    E2E_AUTH_BYPASS="false" \
    WODANA_CRM_ONLY_WORKSPACE_SLUGS="${WODANA_CRM_ONLY_WORKSPACE_SLUGS:-}" \
    WODANA_NEXT_DIST_DIR="${web_dist_dir##*/}" \
    NEXT_TELEMETRY_DISABLED="1" \
      exec node ../../node_modules/next/dist/bin/next dev -p "$web_test_port"
  ) >"$temporary_root/web.log" 2>&1 &
  web_pid=$!
  web_ready="false"
  for _attempt in {1..200}; do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${web_test_port}/login" 2>/dev/null; then
      web_ready="true"
      break
    fi
    if ! kill -0 "$web_pid" >/dev/null 2>&1; then break; fi
    sleep 0.3
  done
  if [[ "$web_ready" != "true" ]]; then
    echo "Web did not start for the isolated onboarding to CRM smoke." >&2
    exit 1
  fi
  if [[ "$smoke_command" == "test:smoke:operator-web" ]]; then
    BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" \
    DATABASE_URL="$database_url" \
    PLATFORM_TEST_DATABASE_URL="$database_url" \
    PLATFORM_TEST_WEB_URL="http://127.0.0.1:${web_test_port}" \
    PLATFORM_TEST_VISUAL_DIR="${PLATFORM_TEST_VISUAL_DIR:-}" \
    PLATFORM_TEST_ACCESS_UI_ONLY="true" \
    BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" \
      npm run test:smoke:operator --workspace @wodana/business-core
  else
    BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" \
    BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" \
    WEB_BASE_URL="http://127.0.0.1:${web_test_port}" \
    WODANA_CRM_ONLY_WORKSPACE_SLUGS="${WODANA_CRM_ONLY_WORKSPACE_SLUGS:-}" \
      node ./scripts/smoke-onboarding-crm-web.mjs
  fi
else
  BUSINESS_CORE_URL="http://127.0.0.1:${test_port}/api/v1" \
    DATABASE_URL="$database_url" \
    PLATFORM_TEST_DATABASE_URL="$database_url" \
    APP_EFFECTS_TEST_DATABASE_URL="$database_url" \
    BUSINESS_CORE_INTERNAL_TOKEN="local-development-token" \
    npm run "$smoke_command" --workspace @wodana/business-core
fi
