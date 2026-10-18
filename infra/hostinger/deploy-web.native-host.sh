#!/usr/bin/env bash
set -euo pipefail

# Build and publish a Wodana release to the existing native-host stack.
# The password is read without echoing and is never written to disk or passed as
# a command-line argument. The current web container remains available for an
# immediate proxy rollback.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to the production server address}"
DEPLOY_USER="${DEPLOY_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
PUBLIC_URL="${PUBLIC_URL:-https://iglo.wodana.ai}"
NGINX_SITE="${NGINX_SITE:-wodana.ai}"
NGINX_CONFIG_PATH="${NGINX_CONFIG_PATH:-/etc/nginx/sites-available/${NGINX_SITE}}"
RELEASE_NAME="${RELEASE_NAME:-$(date -u +%Y%m%d%H%M%S)-web}"
WEB_PORT="${WEB_PORT:-13230}"
CORE_PORT="${CORE_PORT:-}"
INTELLIGENCE_PORT="${INTELLIGENCE_PORT:-18006}"
CURRENT_INTELLIGENCE_PORT="${CURRENT_INTELLIGENCE_PORT:-}"
CURRENT_INTELLIGENCE_RELEASE_DIR="${CURRENT_INTELLIGENCE_RELEASE_DIR:-}"
CURRENT_INTELLIGENCE_WORKER_CONTAINER="${CURRENT_INTELLIGENCE_WORKER_CONTAINER:-}"
SKIP_LOCAL_CHECKS="${SKIP_LOCAL_CHECKS:-0}"
SKIP_IMAGE_BUILD="${SKIP_IMAGE_BUILD:-0}"
REMOTE_IMAGE_READY="${REMOTE_IMAGE_READY:-0}"
CRM_ONLY_WORKSPACE_SLUGS="${WODANA_CRM_ONLY_WORKSPACE_SLUGS:-}"
ROUTED_TENANT_HOSTS="${ROUTED_TENANT_HOSTS:-}"
IMAGE="wodana-web:${RELEASE_NAME}"
DEPLOY_CORE="${DEPLOY_CORE:-0}"
CORE_IMAGE="wodana-core:${RELEASE_NAME}"
# The worker (email, WhatsApp, push, SLA/takeover timers, reminders) calls one core's port, so it ships
# with every core release. Web-only releases keep the running worker and still require it to be live.
DEPLOY_INTELLIGENCE="${DEPLOY_INTELLIGENCE:-$DEPLOY_CORE}"
INTELLIGENCE_IMAGE="wodana-intelligence:${RELEASE_NAME}"
CURRENT_CORE_PORT="${CURRENT_CORE_PORT:-}"
CURRENT_CORE_RELEASE_DIR="${CURRENT_CORE_RELEASE_DIR:-}"
MIGRATION_FILE="${MIGRATION_FILE:-}"
APPLY_PENDING_MIGRATIONS="${APPLY_PENDING_MIGRATIONS:-0}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
REMOTE_ARCHIVE="/tmp/${RELEASE_NAME}.web-image.tar.gz"

[[ "$RELEASE_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]] || { echo "RELEASE_NAME contains unsupported characters." >&2; exit 1; }
[[ "$WEB_PORT" =~ ^[0-9]+$ && ( -z "$CORE_PORT" || "$CORE_PORT" =~ ^[0-9]+$ ) && "$INTELLIGENCE_PORT" =~ ^[0-9]+$ ]] || { echo "Ports must be numeric." >&2; exit 1; }
[[ "$PUBLIC_URL" =~ ^https://[a-z0-9.-]+$ ]] || { echo "PUBLIC_URL must be a path-free HTTPS origin." >&2; exit 1; }
[[ "$NGINX_SITE" == "wodana.ai" || "$NGINX_SITE" == "plm.wodana.ai" ]] || { echo "NGINX_SITE must be wodana.ai or plm.wodana.ai." >&2; exit 1; }
[[ "$DEPLOY_CORE" == 0 || "$DEPLOY_CORE" == 1 ]] || exit 1
[[ "$DEPLOY_INTELLIGENCE" == 0 || "$DEPLOY_INTELLIGENCE" == 1 ]] || exit 1
[[ "$DEPLOY_CORE" == 0 || "$DEPLOY_INTELLIGENCE" == 1 ]] || { echo "A core release ships its worker too (the worker calls this core's port): keep DEPLOY_INTELLIGENCE=1." >&2; exit 1; }
[[ "$SKIP_IMAGE_BUILD" == 0 || "$SKIP_IMAGE_BUILD" == 1 ]] || exit 1
[[ "$REMOTE_IMAGE_READY" == 0 || "$REMOTE_IMAGE_READY" == 1 ]] || exit 1
[[ "$NGINX_CONFIG_PATH" == /etc/nginx/sites-available/wodana.ai || "$NGINX_CONFIG_PATH" == /etc/nginx/sites-available/plm.wodana.ai || "$NGINX_CONFIG_PATH" == /etc/nginx/sites-enabled/plm.wodana.ai ]] || { echo "Unsupported Nginx config path." >&2; exit 1; }
[[ "$APPLY_PENDING_MIGRATIONS" == 0 || "$APPLY_PENDING_MIGRATIONS" == 1 ]] || exit 1
[[ "$CRM_ONLY_WORKSPACE_SLUGS" =~ ^[a-z0-9,-]*$ ]] || { echo "Invalid CRM-only workspace slugs." >&2; exit 1; }
[[ "$ROUTED_TENANT_HOSTS" =~ ^[a-z0-9.,-]*$ ]] || { echo "Invalid routed tenant hostnames." >&2; exit 1; }
[[ ( -z "$CURRENT_CORE_PORT" || "$CURRENT_CORE_PORT" =~ ^[0-9]+$ ) && ( -z "$CURRENT_CORE_RELEASE_DIR" || "$CURRENT_CORE_RELEASE_DIR" =~ ^/opt/wodana/releases/[a-zA-Z0-9._-]+$ ) ]] || exit 1
[[ ( -z "$CURRENT_INTELLIGENCE_PORT" || "$CURRENT_INTELLIGENCE_PORT" =~ ^[0-9]+$ ) && ( -z "$CURRENT_INTELLIGENCE_RELEASE_DIR" || "$CURRENT_INTELLIGENCE_RELEASE_DIR" =~ ^/opt/wodana/releases/[a-zA-Z0-9._-]+$ ) && ( -z "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" || "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ) ]] || exit 1
[[ -z "$MIGRATION_FILE" || ( "$DEPLOY_CORE" == 1 && "$MIGRATION_FILE" == services/business-core/drizzle/0052_client_design_approval.sql ) ]] || { echo "Unrecognized migration; review its deployment procedure first." >&2; exit 1; }
[[ "$APPLY_PENDING_MIGRATIONS" == 0 || ( "$DEPLOY_CORE" == 1 && -z "$MIGRATION_FILE" ) ]] || { echo "Pending migrations require a core deployment and cannot be combined with MIGRATION_FILE." >&2; exit 1; }

for command in curl docker gzip scp ssh; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

SSH=(ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP=(scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "${DEPLOY_PASSWORD:-}" ]]; then
  SSHPASS="$DEPLOY_PASSWORD"
  export SSHPASS
elif [[ -t 0 ]]; then
  read -r -s -p "Password for ${REMOTE}: " SSHPASS
  printf '\n'
  export SSHPASS
fi
if [[ -n "${SSHPASS:-}" ]]; then
  command -v sshpass >/dev/null || { echo "Password deployment requires sshpass." >&2; exit 1; }
  SSH=(sshpass -e ssh -p "$SSH_PORT" -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new)
  SCP=(sshpass -e scp -P "$SSH_PORT" -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new)
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wodana-web-release.XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
  unset SSHPASS DEPLOY_PASSWORD
}
trap cleanup EXIT

CURRENT_RELEASE="$(curl -fsSI "${PUBLIC_URL}/login" | tr -d '\r' | sed -n 's/^X-Wodana-Release:[[:space:]]*//Ip' | tail -n 1)"
[[ -n "$CURRENT_RELEASE" ]] || { echo "The live release header is missing; refusing an ambiguous deployment." >&2; exit 1; }
[[ "$CURRENT_RELEASE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]] || exit 1
CURRENT_RELEASE_DIR="${CURRENT_RELEASE_DIR:-/opt/wodana/releases/${CURRENT_RELEASE}}"
[[ "$CURRENT_RELEASE_DIR" =~ ^/opt/wodana/releases/[a-zA-Z0-9._-]+$ ]] || { echo "Invalid current release directory." >&2; exit 1; }

echo "Preflight: ${CURRENT_RELEASE} is live."
"${SSH[@]}" "$REMOTE" "test -f '$CURRENT_RELEASE_DIR/compose.yaml' && test -f '$CURRENT_RELEASE_DIR/web.env' && test -f '$NGINX_CONFIG_PATH'"
DETECTED_CORE_PORT="$("${SSH[@]}" "$REMOTE" "sed -n 's@.*BUSINESS_CORE_URL: http://127.0.0.1:\\([0-9]*\\)/api/v1.*@\\1@p' '$CURRENT_RELEASE_DIR/compose.yaml' | head -n 1")"
CURRENT_CORE_PORT="${CURRENT_CORE_PORT:-$DETECTED_CORE_PORT}"
[[ "$CURRENT_CORE_PORT" =~ ^[0-9]+$ ]] || { echo "Could not resolve the live core port." >&2; exit 1; }
if [[ "$DEPLOY_CORE" == 1 && -z "$CORE_PORT" ]]; then echo "Set an unused CORE_PORT for a backend deployment." >&2; exit 1; fi
CORE_PORT="${CORE_PORT:-$CURRENT_CORE_PORT}"
CURRENT_CORE_RELEASE_DIR="${CURRENT_CORE_RELEASE_DIR:-$CURRENT_RELEASE_DIR}"
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
  # Found from the live release when not given: the Intelligence API port the live web calls, the newest
  # release that runs it (its intelligence.env is reused) and the running worker, if any (none is fine:
  # this release then starts the first one).
  if [[ -z "$CURRENT_INTELLIGENCE_PORT" ]]; then
    CURRENT_INTELLIGENCE_PORT="$("${SSH[@]}" "$REMOTE" "sed -n 's@.*INTELLIGENCE_API_URL: http://127.0.0.1:\\([0-9]*\\)/api/v1.*@\\1@p' '$CURRENT_RELEASE_DIR/compose.yaml' | head -n 1")"
  fi
  [[ "$CURRENT_INTELLIGENCE_PORT" =~ ^[0-9]+$ ]] || { echo "Could not resolve the live Intelligence API port; set CURRENT_INTELLIGENCE_PORT." >&2; exit 1; }
  [[ "$CURRENT_INTELLIGENCE_PORT" != "$INTELLIGENCE_PORT" ]] || { echo "Set an unused INTELLIGENCE_PORT (the live Intelligence API uses ${CURRENT_INTELLIGENCE_PORT})." >&2; exit 1; }
  if [[ -z "$CURRENT_INTELLIGENCE_RELEASE_DIR" ]]; then
    CURRENT_INTELLIGENCE_RELEASE_DIR="$("${SSH[@]}" "$REMOTE" "for d in \$(ls -1dt /opt/wodana/releases/*/); do d=\${d%/}; if test -f \"\$d/intelligence.env\" && grep -q -- '--port, \"${CURRENT_INTELLIGENCE_PORT}\"' \"\$d/compose.yaml\" 2>/dev/null; then echo \"\$d\"; break; fi; done")"
  fi
  [[ "$CURRENT_INTELLIGENCE_RELEASE_DIR" =~ ^/opt/wodana/releases/[a-zA-Z0-9._-]+$ ]] || { echo "Could not find the release running the Intelligence API on ${CURRENT_INTELLIGENCE_PORT}; set CURRENT_INTELLIGENCE_RELEASE_DIR." >&2; exit 1; }
  if [[ -z "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then
    RUNNING_WORKERS="$("${SSH[@]}" "$REMOTE" "docker ps --filter label=com.docker.compose.service=intelligence-worker --format '{{.Names}}'")"
    [[ "$(printf '%s\n' "$RUNNING_WORKERS" | grep -c .)" -le 1 ]] || { printf 'Several workers are running:\n%s\nSet CURRENT_INTELLIGENCE_WORKER_CONTAINER to the live one and stop the rest.\n' "$RUNNING_WORKERS" >&2; exit 1; }
    CURRENT_INTELLIGENCE_WORKER_CONTAINER="$RUNNING_WORKERS"
  fi
  [[ -z "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" || "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || exit 1
  "${SSH[@]}" "$REMOTE" "test -f '$CURRENT_INTELLIGENCE_RELEASE_DIR/intelligence.env'"
  if [[ -n "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then
    "${SSH[@]}" "$REMOTE" "docker inspect '$CURRENT_INTELLIGENCE_WORKER_CONTAINER' >/dev/null"
    echo "Preflight: worker ${CURRENT_INTELLIGENCE_WORKER_CONTAINER} is replaced by this release's worker."
  else
    echo "Preflight: no worker is running; this release starts one."
  fi
else
  CURRENT_INTELLIGENCE_PORT="$INTELLIGENCE_PORT"
fi

cd "$ROOT_DIR"
if [[ "$SKIP_LOCAL_CHECKS" != 1 ]]; then
  npm run typecheck --workspace @wodana/web
fi

if [[ "$REMOTE_IMAGE_READY" != 1 && "$SKIP_IMAGE_BUILD" == 0 ]]; then
  echo "Building ${IMAGE} for linux/amd64..."
  docker buildx build --progress plain --platform linux/amd64 --load --pull=false -t "$IMAGE" -f apps/web/Dockerfile .
fi
if [[ "$REMOTE_IMAGE_READY" != 1 ]]; then docker image inspect "$IMAGE" >/dev/null; fi
if [[ "$DEPLOY_CORE" == 1 ]]; then
  npm run typecheck --workspace @wodana/business-core
  if [[ "$SKIP_IMAGE_BUILD" == 0 && "$REMOTE_IMAGE_READY" != 1 ]]; then
    docker buildx build --progress plain --platform linux/amd64 --load --pull=false -t "$CORE_IMAGE" -f services/business-core/Dockerfile .
  fi
fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
  (cd services/intelligence-automation && ../../.venv/bin/pytest -q)
  docker buildx build --progress plain --platform linux/amd64 --load --pull=false -t "$INTELLIGENCE_IMAGE" -f services/intelligence-automation/Dockerfile services/intelligence-automation
fi
if [[ "$DEPLOY_CORE" == 1 && "$REMOTE_IMAGE_READY" != 1 ]]; then docker image inspect "$CORE_IMAGE" >/dev/null; fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 && "$REMOTE_IMAGE_READY" != 1 ]]; then docker image inspect "$INTELLIGENCE_IMAGE" >/dev/null; fi

LOCAL_ARCHIVE="$TEMP_DIR/web-image.tar.gz"
if [[ "$REMOTE_IMAGE_READY" != 1 ]]; then
  echo "Packaging the web image..."
  IMAGES=("$IMAGE")
  [[ "$DEPLOY_CORE" == 0 ]] || IMAGES+=("$CORE_IMAGE")
  [[ "$DEPLOY_INTELLIGENCE" == 0 ]] || IMAGES+=("$INTELLIGENCE_IMAGE")
  docker save "${IMAGES[@]}" | gzip -1 > "$LOCAL_ARCHIVE"
  LOCAL_ARCHIVE_HASH="$(sha256sum "$LOCAL_ARCHIVE" | awk '{print $1}')"
  printf '%s  %s\n' "$LOCAL_ARCHIVE_HASH" "$(basename "$REMOTE_ARCHIVE")" > "$TEMP_DIR/web-image.sha256"
fi

MIGRATION_ARCHIVE="$TEMP_DIR/migrations.tar.gz"
MIGRATION_ARCHIVE_HASH=""
if [[ "$APPLY_PENDING_MIGRATIONS" == 1 ]]; then
  MIGRATION_STAGE="$TEMP_DIR/migrations"
  mkdir -p "$MIGRATION_STAGE/sql"
  node - "$ROOT_DIR" "$MIGRATION_STAGE" <<'NODE'
const { createHash } = require("node:crypto");
const { copyFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [root, output] = process.argv.slice(2);
const drizzle = join(root, "services/business-core/drizzle");
const journal = JSON.parse(readFileSync(join(drizzle, "meta/_journal.json"), "utf8"));
let previousIndex = -1;
let previousTimestamp = -1;
const rows = journal.entries.map((entry) => {
  if (!Number.isSafeInteger(entry.idx) || entry.idx <= previousIndex || !Number.isSafeInteger(entry.when) || entry.when <= previousTimestamp || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag))
    throw new Error(`Unsafe migration journal entry: ${JSON.stringify(entry)}`);
  previousIndex = entry.idx;
  previousTimestamp = entry.when;
  const source = join(drizzle, `${entry.tag}.sql`);
  const body = readFileSync(source);
  copyFileSync(source, join(output, "sql", `${entry.tag}.sql`));
  return `${entry.when}\t${entry.tag}\t${createHash("sha256").update(body).digest("hex")}`;
});
writeFileSync(join(output, "manifest.tsv"), `${rows.join("\n")}\n`);
NODE
  tar -C "$MIGRATION_STAGE" -czf "$MIGRATION_ARCHIVE" manifest.tsv sql
  MIGRATION_ARCHIVE_HASH="$(sha256sum "$MIGRATION_ARCHIVE" | awk '{print $1}')"
fi

if [[ "$REMOTE_IMAGE_READY" != 1 ]]; then
  echo "Uploading the release image..."
  "${SCP[@]}" "$LOCAL_ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"
  "${SCP[@]}" "$TEMP_DIR/web-image.sha256" "$REMOTE:/tmp/${RELEASE_NAME}.web-image.sha256"
else
  echo "Using the reviewed image already built on the production host."
fi
if [[ -n "$MIGRATION_FILE" ]]; then "${SCP[@]}" "$ROOT_DIR/$MIGRATION_FILE" "$REMOTE:/tmp/${RELEASE_NAME}.migration.sql"; fi
if [[ "$APPLY_PENDING_MIGRATIONS" == 1 ]]; then "${SCP[@]}" "$MIGRATION_ARCHIVE" "$REMOTE:/tmp/${RELEASE_NAME}.migrations.tar.gz"; fi

echo "Staging, backing up, and switching production traffic..."
"${SSH[@]}" "$REMOTE" "bash -s -- '$RELEASE_NAME' '$IMAGE' '$WEB_PORT' '$CORE_PORT' '$INTELLIGENCE_PORT' '$PUBLIC_URL' '$CURRENT_RELEASE' '$CURRENT_RELEASE_DIR' '$REMOTE_ARCHIVE' '$DEPLOY_CORE' '$CORE_IMAGE' '$CURRENT_CORE_PORT' '$CURRENT_CORE_RELEASE_DIR' '$MIGRATION_FILE' '$DEPLOY_INTELLIGENCE' '$INTELLIGENCE_IMAGE' '$CURRENT_INTELLIGENCE_PORT' '$CURRENT_INTELLIGENCE_RELEASE_DIR' '$CURRENT_INTELLIGENCE_WORKER_CONTAINER' '$CRM_ONLY_WORKSPACE_SLUGS' '$ROUTED_TENANT_HOSTS' '$APPLY_PENDING_MIGRATIONS' '$NGINX_SITE' '$MIGRATION_ARCHIVE_HASH' '$REMOTE_IMAGE_READY' '$NGINX_CONFIG_PATH'" <<'REMOTE_DEPLOY'
set -euo pipefail
umask 077

RELEASE_NAME="$1"
IMAGE="$2"
WEB_PORT="$3"
CORE_PORT="$4"
INTELLIGENCE_PORT="$5"
PUBLIC_URL="$6"
CURRENT_RELEASE="$7"
CURRENT_RELEASE_DIR="$8"
REMOTE_ARCHIVE="$9"
DEPLOY_CORE="${10}"
CORE_IMAGE="${11}"
CURRENT_CORE_PORT="${12}"
CURRENT_CORE_RELEASE_DIR="${13}"
MIGRATION_FILE="${14}"
DEPLOY_INTELLIGENCE="${15}"
INTELLIGENCE_IMAGE="${16}"
CURRENT_INTELLIGENCE_PORT="${17}"
CURRENT_INTELLIGENCE_RELEASE_DIR="${18}"
CURRENT_INTELLIGENCE_WORKER_CONTAINER="${19}"
CRM_ONLY_WORKSPACE_SLUGS="${20}"
ROUTED_TENANT_HOSTS="${21}"
APPLY_PENDING_MIGRATIONS="${22}"
NGINX_SITE="${23}"
MIGRATION_ARCHIVE_HASH="${24}"
REMOTE_IMAGE_READY="${25}"
NGINX_CONFIG_PATH="${26}"
RELEASE_DIR="/opt/wodana/releases/${RELEASE_NAME}"

[[ ! -e "$RELEASE_DIR" ]] || { echo "Release directory already exists: $RELEASE_DIR" >&2; exit 1; }
if [[ "$REMOTE_IMAGE_READY" == 1 ]]; then
  docker image inspect "$IMAGE" >/dev/null
else
  [[ -s "$REMOTE_ARCHIVE" ]] || { echo "Uploaded image archive is missing." >&2; exit 1; }
  REMOTE_CHECKSUM="/tmp/${RELEASE_NAME}.web-image.sha256"
  test -s "$REMOTE_CHECKSUM"
  (cd /tmp && sha256sum --status -c "$(basename "$REMOTE_CHECKSUM")") || { echo "Uploaded image archive checksum failed." >&2; exit 1; }
  rm -f "$REMOTE_CHECKSUM"
fi
if ss -ltn | awk '{print $4}' | grep -Eq ":${WEB_PORT}$"; then
  echo "Web port ${WEB_PORT} is already occupied." >&2
  exit 1
fi
if [[ "$DEPLOY_CORE" == 1 ]]; then
  test -f "$CURRENT_CORE_RELEASE_DIR/core.env"
  if ss -ltn | awk '{print $4}' | grep -Eq ":${CORE_PORT}$"; then echo "Core port is occupied." >&2; exit 1; fi
fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
  test -f "$CURRENT_INTELLIGENCE_RELEASE_DIR/intelligence.env"
  if [[ -n "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then docker inspect "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" >/dev/null; fi
  if ss -ltn | awk '{print $4}' | grep -Eq ":${INTELLIGENCE_PORT}$"; then echo "Intelligence port is occupied." >&2; exit 1; fi
fi

CURRENT_WEB_PORT="$(awk '$1 == "web:" { in_web=1; next } in_web && $1 == "PORT:" { print $2; exit }' "$CURRENT_RELEASE_DIR/compose.yaml")"
[[ "$CURRENT_WEB_PORT" =~ ^[0-9]+$ ]] || { echo "Could not determine the current web port." >&2; exit 1; }

mkdir -m 700 "$RELEASE_DIR"
cp "$CURRENT_RELEASE_DIR/web.env" "$RELEASE_DIR/web.env"
cp "$NGINX_CONFIG_PATH" "$RELEASE_DIR/nginx-before.conf"
if [[ "$DEPLOY_CORE" == 1 ]]; then
  cp "$CURRENT_CORE_RELEASE_DIR/core.env" "$RELEASE_DIR/core.env"
  # Every AI call now goes through Business Core's gateway: a model key kept only for the web moves to the core.
  if ! grep -q '^GEMINI_API_KEY=.' "$RELEASE_DIR/core.env" && grep -q '^GEMINI_API_KEY=.' "$RELEASE_DIR/web.env"; then
    grep -E '^GEMINI_(API_KEY|MODEL)=' "$RELEASE_DIR/web.env" >> "$RELEASE_DIR/core.env"
    echo "The AI key now lives with Business Core (copied from web.env)."
  fi
fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then cp "$CURRENT_INTELLIGENCE_RELEASE_DIR/intelligence.env" "$RELEASE_DIR/intelligence.env"; fi
if [[ "$APPLY_PENDING_MIGRATIONS" == 1 ]]; then
  MIGRATION_ARCHIVE="/tmp/${RELEASE_NAME}.migrations.tar.gz"
  test -s "$MIGRATION_ARCHIVE"
  [[ "$MIGRATION_ARCHIVE_HASH" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(sha256sum "$MIGRATION_ARCHIVE" | awk '{print $1}')" == "$MIGRATION_ARCHIVE_HASH" ]] || {
    echo "Uploaded migration archive checksum failed." >&2
    exit 1
  }
  mkdir -m 700 "$RELEASE_DIR/migrations"
  tar -xzf "$MIGRATION_ARCHIVE" -C "$RELEASE_DIR/migrations"
  rm -f "$MIGRATION_ARCHIVE"
  test -s "$RELEASE_DIR/migrations/manifest.tsv"
fi

if [[ "$REMOTE_IMAGE_READY" != 1 ]]; then
  gzip -dc "$REMOTE_ARCHIVE" | docker load >/dev/null
  rm -f "$REMOTE_ARCHIVE"
fi
docker image inspect "$IMAGE" >/dev/null
if [[ "$DEPLOY_CORE" == 1 ]]; then docker image inspect "$CORE_IMAGE" >/dev/null; fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then docker image inspect "$INTELLIGENCE_IMAGE" >/dev/null; fi

cat > "$RELEASE_DIR/compose.yaml" <<COMPOSE
name: wodana-${RELEASE_NAME}
services:
  web:
    image: ${IMAGE}
    network_mode: host
    env_file: [./web.env]
    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=512
      HOSTNAME: 127.0.0.1
      PORT: ${WEB_PORT}
      BUSINESS_CORE_URL: http://127.0.0.1:${CORE_PORT}/api/v1
      WODANA_CRM_ONLY_WORKSPACE_SLUGS: ${CRM_ONLY_WORKSPACE_SLUGS}
      GEMINI_MODEL: gemini-3.5-flash
      INTELLIGENCE_API_URL: http://127.0.0.1:${INTELLIGENCE_PORT}/api/v1
    init: true
    restart: unless-stopped
    mem_limit: 768m
    logging:
      driver: json-file
      options: {max-size: 10m, max-file: "3"}
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:${WEB_PORT}/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      start_period: 15s
      retries: 8
COMPOSE
if [[ "$DEPLOY_CORE" == 1 ]]; then
cat >> "$RELEASE_DIR/compose.yaml" <<COMPOSE
  business-core:
    image: ${CORE_IMAGE}
    network_mode: host
    env_file: [./core.env]
    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=512
      HOST: 127.0.0.1
      PORT: ${CORE_PORT}
      WODANA_RELEASE_ID: ${RELEASE_NAME}
      INTELLIGENCE_API_URL: http://127.0.0.1:${INTELLIGENCE_PORT}/api/v1
    volumes: [object_data:/app/.data]
    init: true
    restart: unless-stopped
    mem_limit: 768m
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:${CORE_PORT}/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      start_period: 15s
      retries: 8
COMPOSE
fi
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
cat >> "$RELEASE_DIR/compose.yaml" <<COMPOSE
  intelligence-api:
    image: ${INTELLIGENCE_IMAGE}
    network_mode: host
    env_file: [./intelligence.env]
    environment:
      BUSINESS_CORE_URL: http://127.0.0.1:${CORE_PORT}/api/v1
      PORT: ${INTELLIGENCE_PORT}
    command: [uvicorn, "wodana_intelligence.main:app", --host, 127.0.0.1, --port, "${INTELLIGENCE_PORT}"]
    init: true
    restart: unless-stopped
    mem_limit: 384m
    logging:
      driver: json-file
      options: {max-size: 10m, max-file: "3"}
    healthcheck:
      test: [CMD, python, -c, "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${INTELLIGENCE_PORT}/api/v1/health/ready')"]
      interval: 10s
      start_period: 15s
      retries: 8
  # Required: every email, WhatsApp and push, and every SLA, takeover and reminder timer. Started after
  # the previous worker stops (below), then proven live through the core's readiness.
  intelligence-worker:
    image: ${INTELLIGENCE_IMAGE}
    network_mode: host
    env_file: [./intelligence.env]
    environment:
      BUSINESS_CORE_URL: http://127.0.0.1:${CORE_PORT}/api/v1
      WODANA_RELEASE_ID: ${RELEASE_NAME}
    command: [python, -m, wodana_intelligence.worker]
    init: true
    restart: unless-stopped
    mem_limit: 256m
    logging:
      driver: json-file
      options: {max-size: 10m, max-file: "3"}
    healthcheck:
      test: [CMD, python, -m, wodana_intelligence.worker.healthcheck]
      interval: 10s
      start_period: 30s
      retries: 4
COMPOSE
fi
if [[ "$DEPLOY_CORE" == 1 ]]; then
cat >> "$RELEASE_DIR/compose.yaml" <<COMPOSE
volumes:
  object_data: {name: wodana-release-objects, external: true}
COMPOSE
fi

cd "$RELEASE_DIR"
docker compose -f compose.yaml config --quiet

# Business Core readiness, explained. In production a silent or stale worker makes it not ready; a
# release that starts its own worker ($2 = 1) accepts that one failure until its worker reports.
core_ready() {
  local port="$1" allow_worker="${2:-0}" response
  response="$(curl -sS --max-time 10 -w '\n%{http_code}' "http://127.0.0.1:${port}/api/v1/health/ready" 2>/dev/null || true)"
  python3 - "$allow_worker" "$response" <<'PY'
import json, sys
allow_worker = sys.argv[1] == "1"
body, _, code = sys.argv[2].rpartition("\n")
try:
    payload = json.loads(body) if body.strip() else {}
except ValueError:
    payload = {}
if code == "200":
    sys.exit(0)
failures = payload.get("criticalFailures") or []
checks = payload.get("checks") or {}
if allow_worker and failures and set(failures) <= {"worker", "workerDelivery"}:
    print(f"Business Core is ready apart from its worker ({checks.get('worker', 'unknown')}); this release starts one.")
    sys.exit(0)
print(f"Business Core is not ready (HTTP {code or 'no answer'}): {', '.join(failures) or 'unknown'}; checks: {json.dumps(checks)}", file=sys.stderr)
if "worker" in failures or "workerDelivery" in failures:
    print("The delivery worker is not live: redeploy with DEPLOY_INTELLIGENCE=1 (and NOTIFICATION_ADAPTER_MODE=live in intelligence.env), or restart the live worker container.", file=sys.stderr)
sys.exit(1)
PY
}

# Waits until the core's readiness shows this release's worker beating with live delivery.
await_worker() {
  local port="$1" release="$2" deadline=$((SECONDS + 120))
  until curl -fsS --max-time 10 "http://127.0.0.1:${port}/api/v1/health/ready" 2>/dev/null \
    | python3 -c 'import json,sys; c=json.load(sys.stdin).get("checks",{}); sys.exit(0 if c.get("worker")=="ok" and c.get("workerRelease")==sys.argv[1] and c.get("workerDelivery")=="live" else 1)' "$release"; do
    (( SECONDS < deadline )) || { echo "The new worker did not report live delivery within two minutes." >&2; return 1; }
    sleep 5
  done
}

core_ready "$CURRENT_CORE_PORT" "$DEPLOY_INTELLIGENCE"

# Snapshot the live state directly. The older host-wide backup script contains a
# historical container inventory and can fail after those superseded containers
# are intentionally retired.
BACKUP_ROOT="/var/backups/wodana/current"
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT"
BACKUP_STAGING="$(mktemp -d "$BACKUP_ROOT/.incomplete-${BACKUP_STAMP}-XXXXXX")"
backup_failed() {
  status=$?
  rm -rf "$BACKUP_STAGING"
  echo "Pre-release backup failed; the incomplete snapshot was removed." >&2
  exit "$status"
}
trap backup_failed ERR

sudo -u postgres pg_dump -Fc wodana_release </dev/null > "$BACKUP_STAGING/postgres.dump"
sudo -u postgres pg_restore --list < "$BACKUP_STAGING/postgres.dump" > "$BACKUP_STAGING/postgres.contents"
sudo -u postgres pg_dumpall --globals-only </dev/null > "$BACKUP_STAGING/postgres-globals.sql"
docker exec wodana-release-redis-1 redis-cli -p 16379 --rdb /tmp/wodana-release-backup.rdb >/dev/null
docker cp wodana-release-redis-1:/tmp/wodana-release-backup.rdb "$BACKUP_STAGING/redis.rdb" >/dev/null
docker exec wodana-release-redis-1 rm /tmp/wodana-release-backup.rdb >/dev/null
OBJECT_PATH="$(docker volume inspect wodana-release-objects --format '{{.Mountpoint}}')"
tar -C "$OBJECT_PATH" -czf "$BACKUP_STAGING/objects.tar.gz" .
tar -C "$(dirname "$CURRENT_RELEASE_DIR")" -czf "$BACKUP_STAGING/current-release-private.tar.gz" "$(basename "$CURRENT_RELEASE_DIR")"
tar -C /etc -czf "$BACKUP_STAGING/proxy-private.tar.gz" nginx letsencrypt
mapfile -t RUNNING_CONTAINERS < <(docker ps --format '{{.Names}}')
(( ${#RUNNING_CONTAINERS[@]} > 0 )) || { echo "No running containers found." >&2; false; }
docker inspect "${RUNNING_CONTAINERS[@]}" > "$BACKUP_STAGING/running-containers-private.json"
printf '%s\n' "$CURRENT_RELEASE" > "$BACKUP_STAGING/source-release.txt"
(
  cd "$BACKUP_STAGING"
  sha256sum postgres.dump postgres.contents postgres-globals.sql redis.rdb objects.tar.gz \
    current-release-private.tar.gz proxy-private.tar.gz running-containers-private.json source-release.txt > SHA256SUMS
  sha256sum --status -c SHA256SUMS
)
BACKUP_DIR="$BACKUP_ROOT/release-${BACKUP_STAMP}"
mv "$BACKUP_STAGING" "$BACKUP_DIR"
trap - ERR
printf 'Backup complete: %s\n' "$BACKUP_DIR" > pre-backup.log
printf '%s\n' "$BACKUP_DIR" > pre-backup-path.txt

if [[ -n "$MIGRATION_FILE" ]]; then
  MIGRATION_PATH="/tmp/${RELEASE_NAME}.migration.sql"
  test -s "$MIGRATION_PATH"
  LAST_MIGRATION="$(sudo -u postgres psql -d wodana_release -Atc 'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1' </dev/null)"
  [[ "$LAST_MIGRATION" == 1788901200000 ]] || { echo "Unexpected migration state: $LAST_MIGRATION" >&2; exit 1; }
  # Rehearse the additive schema change transactionally, leaving the database unchanged.
  { printf 'BEGIN;\n'; cat "$MIGRATION_PATH"; printf '\nROLLBACK;\n'; } | sudo -u postgres psql -v ON_ERROR_STOP=1 -d wodana_release > migration-rehearsal.log
  MIGRATION_HASH="$(sha256sum "$MIGRATION_PATH" | awk '{print $1}')"
  { printf 'BEGIN;\n'; cat "$MIGRATION_PATH"; printf "\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('%s',1788904800000);\nCOMMIT;\n" "$MIGRATION_HASH"; } | sudo -u postgres psql -v ON_ERROR_STOP=1 -d wodana_release > migration.log
  cp "$MIGRATION_PATH" ./migration.sql
  rm -f "$MIGRATION_PATH"
fi
if [[ "$APPLY_PENDING_MIGRATIONS" == 1 ]]; then
  MIGRATION_DIR="$RELEASE_DIR/migrations"
  DATABASE_MIGRATIONS="$MIGRATION_DIR/database-before.tsv"
  PENDING_MIGRATIONS="$MIGRATION_DIR/pending.tsv"
  sudo -u postgres psql -d wodana_release -AtF $'\t' \
    -c 'SELECT created_at,hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id' \
    </dev/null > "$DATABASE_MIGRATIONS"
  python3 - "$MIGRATION_DIR/manifest.tsv" "$DATABASE_MIGRATIONS" "$PENDING_MIGRATIONS" <<'PY'
from pathlib import Path
import re
import sys

manifest_path, database_path, pending_path = map(Path, sys.argv[1:])
manifest = []
for line_number, raw in enumerate(manifest_path.read_text().splitlines(), 1):
    fields = raw.split("\t")
    if len(fields) != 3:
        raise SystemExit(f"Malformed release migration manifest line {line_number}")
    when, tag, digest = fields
    if not when.isdigit() or not re.fullmatch(r"\d{4}_[a-z0-9_]+", tag) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SystemExit(f"Unsafe release migration manifest line {line_number}")
    manifest.append((when, tag, digest))

database = []
for line_number, raw in enumerate(database_path.read_text().splitlines(), 1):
    fields = raw.split("\t")
    if len(fields) != 2 or not fields[0].isdigit() or not re.fullmatch(r"[0-9a-f]{64}", fields[1]):
        raise SystemExit(f"Malformed database migration history line {line_number}")
    database.append(tuple(fields))

# An older Palm release applied a reviewed 0047 migration that was later
# removed from the journal. Preserve and verify that exact historical record
# while comparing the current journal sequence; never rewrite production history.
legacy_palm_migration = (
    "1788852000000",
    "b11cfde39afe034b900f68feda376d5b2b4661d6bd02c9311fb568ddcc52b4af",
)
if legacy_palm_migration in database:
    database.remove(legacy_palm_migration)

if len(database) > len(manifest):
    raise SystemExit("Database migration history is ahead of this release")
for index, (created_at, digest) in enumerate(database):
    expected_when, expected_tag, expected_digest = manifest[index]
    if (created_at, digest) != (expected_when, expected_digest):
        raise SystemExit(
            f"Migration history diverges at position {index + 1}: expected {expected_tag}"
        )

pending_path.write_text(
    "".join("\t".join(row) + "\n" for row in manifest[len(database):])
)
PY

  PENDING_SQL="$MIGRATION_DIR/pending.sql"
  : > "$PENDING_SQL"
  while IFS=$'\t' read -r created_at tag expected_hash; do
    [[ -n "$tag" ]] || continue
    sql_path="$MIGRATION_DIR/sql/${tag}.sql"
    test -s "$sql_path"
    actual_hash="$(sha256sum "$sql_path" | awk '{print $1}')"
    [[ "$actual_hash" == "$expected_hash" ]] || { echo "Migration checksum mismatch: $tag" >&2; exit 1; }
    cat "$sql_path" >> "$PENDING_SQL"
    printf "\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('%s',%s);\n" "$expected_hash" "$created_at" >> "$PENDING_SQL"
  done < "$PENDING_MIGRATIONS"

  if [[ -s "$PENDING_SQL" ]]; then
    { printf 'BEGIN;\n'; cat "$PENDING_SQL"; printf '\nROLLBACK;\n'; } | \
      sudo -u postgres psql -v ON_ERROR_STOP=1 -d wodana_release > migration-rehearsal.log
    { printf 'BEGIN;\n'; cat "$PENDING_SQL"; printf '\nCOMMIT;\n'; } | \
      sudo -u postgres psql -v ON_ERROR_STOP=1 -d wodana_release > migration.log
  else
    printf '%s\n' 'No pending migrations.' > migration.log
  fi

  sudo -u postgres psql -d wodana_release -AtF $'\t' \
    -c 'SELECT created_at,hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id' \
    </dev/null > "$MIGRATION_DIR/database-after.tsv"
  cut -f1,3 "$MIGRATION_DIR/manifest.tsv" > "$MIGRATION_DIR/expected-after.tsv"
  grep -v '^1788852000000\s' "$MIGRATION_DIR/database-after.tsv" > "$MIGRATION_DIR/database-after-reviewed.tsv" || true
  cmp -s "$MIGRATION_DIR/expected-after.tsv" "$MIGRATION_DIR/database-after-reviewed.tsv" || {
    echo "Database migration history does not exactly match the release after applying migrations." >&2
    exit 1
  }
fi
# The worker starts later, once the previous one has stopped.
SERVICES=(web)
[[ "$DEPLOY_CORE" == 0 ]] || SERVICES+=(business-core)
[[ "$DEPLOY_INTELLIGENCE" == 0 ]] || SERVICES+=(intelligence-api)
docker compose -f compose.yaml up -d --wait --wait-timeout 180 "${SERVICES[@]}"
curl -fsS "http://127.0.0.1:${WEB_PORT}/login" >/dev/null
core_ready "$CORE_PORT" "$DEPLOY_INTELLIGENCE"
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
  curl -fsS "http://127.0.0.1:${INTELLIGENCE_PORT}/api/v1/health/ready" >/dev/null
fi

python3 - "$CURRENT_WEB_PORT" "$WEB_PORT" "$CURRENT_RELEASE" "$RELEASE_NAME" "$DEPLOY_CORE" "$CURRENT_CORE_PORT" "$CORE_PORT" "$DEPLOY_INTELLIGENCE" "$CURRENT_INTELLIGENCE_PORT" "$INTELLIGENCE_PORT" "$ROUTED_TENANT_HOSTS" <<'PY'
from pathlib import Path
import re
import sys

old_port, new_port, old_release, new_release, deploy_core, old_core, new_core, deploy_intelligence, old_intelligence, new_intelligence, routed_tenant_hosts = sys.argv[1:]
source = Path("nginx-before.conf").read_text()
old_upstream = f"127.0.0.1:{old_port}"
new_upstream = f"127.0.0.1:{new_port}"
if old_upstream not in source:
    raise SystemExit(f"Current web upstream {old_upstream} was not found")
if old_release not in source:
    raise SystemExit(f"Current release marker {old_release} was not found")
updated = source.replace(old_upstream, new_upstream).replace(old_release, new_release)
if deploy_core == '1':
    if f'127.0.0.1:{old_core}' not in source:
        raise SystemExit('Current API upstream was not found')
    updated = updated.replace(f'127.0.0.1:{old_core}', f'127.0.0.1:{new_core}')
if deploy_intelligence == '1':
    if f'127.0.0.1:{old_intelligence}' not in source:
        raise SystemExit('Current Intelligence API upstream was not found')
    updated = updated.replace(
        f'127.0.0.1:{old_intelligence}', f'127.0.0.1:{new_intelligence}'
    )
if routed_tenant_hosts:
    route_names = [host for host in routed_tenant_hosts.split(',') if host]
    if any(not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*\.wodana\.ai', host) for host in route_names):
        raise SystemExit('Invalid tenant hostname for Nginx routing')
    modern_names = re.search(r'(?m)^    server_name wodana\.ai www\.wodana\.ai admin\.wodana\.ai iglo\.wodana\.ai client\.wodana\.ai[^;]*;', updated)
    if not modern_names:
        raise SystemExit('Modern Wodana Nginx server block was not found')
    existing = modern_names.group(0).removeprefix('    server_name ').removesuffix(';').split()
    replacement = '    server_name ' + ' '.join(existing + [host for host in route_names if host not in existing]) + ';'
    updated = updated[:modern_names.start()] + replacement + updated[modern_names.end():]
Path("nginx-current.conf").write_text(updated)
PY

cat > rollback.sh <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
cp "\$DIR/nginx-before.conf" "${NGINX_CONFIG_PATH}"
nginx -t
systemctl reload nginx
curl -fsSI ${PUBLIC_URL}/login | grep -qi 'X-Wodana-Release: ${CURRENT_RELEASE}'
ROLLBACK
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
cat >> rollback.sh <<ROLLBACK
docker compose -f "\$DIR/compose.yaml" stop intelligence-worker >/dev/null 2>&1 || true
ROLLBACK
if [[ -n "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then
  printf 'docker start %q >/dev/null\n' "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" >> rollback.sh
else
  printf '%s\n' "echo 'No worker ran before this release: nothing delivers until a worker is started.' >&2" >> rollback.sh
fi
fi
printf '%s\n' "printf '%s\\n' 'Rollback completed and the previous release is live.'" >> rollback.sh
chmod 700 rollback.sh

cutover_started=0
worker_switched=0
restore_proxy() {
  status=$?
  if [[ "$worker_switched" == 1 ]]; then
    docker compose -f "$RELEASE_DIR/compose.yaml" logs --no-color --tail=100 intelligence-worker > "$RELEASE_DIR/worker-startup.log" 2>&1 || true
    docker compose -f "$RELEASE_DIR/compose.yaml" stop intelligence-worker >/dev/null 2>&1 || true
    if [[ -n "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then
      docker start "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" >/dev/null 2>&1 || true
      echo "Worker cutover failed; the previous worker was restarted (see worker-startup.log)." >&2
    else
      echo "Worker cutover failed and no worker ran before; nothing delivers until one runs (see worker-startup.log)." >&2
    fi
  fi
  if [[ "$cutover_started" == 1 ]]; then
    cp "$RELEASE_DIR/nginx-before.conf" "$NGINX_CONFIG_PATH"
    nginx -t >/dev/null
    systemctl reload nginx
    echo "Cutover failed; the previous proxy configuration was restored." >&2
  fi
  exit "$status"
}
trap restore_proxy ERR

# The worker switches first: stop the previous one, start this release's and wait until the core's
# readiness shows it beating with live delivery. A worker that doesn't come up leaves the proxy alone.
if [[ "$DEPLOY_INTELLIGENCE" == 1 ]]; then
  worker_switched=1
  if [[ -n "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" ]]; then docker stop "$CURRENT_INTELLIGENCE_WORKER_CONTAINER" >/dev/null; fi
  docker compose -f compose.yaml up -d --wait --wait-timeout 120 intelligence-worker
  await_worker "$CORE_PORT" "$RELEASE_NAME"
  docker compose -f compose.yaml logs --no-color --tail=50 intelligence-worker > worker-startup.log
  if grep -q 'Traceback (most recent call last)' worker-startup.log; then echo "The new worker logged an error at start-up." >&2; false; fi
fi

cutover_started=1
cp nginx-current.conf "$NGINX_CONFIG_PATH"
nginx -t
systemctl reload nginx

curl -fsS "${PUBLIC_URL}/login" >/dev/null
curl -fsS "${PUBLIC_URL}/workspace/pre-projects/requirements" >/dev/null
# Fails in production unless a worker beats: a release never goes live with nothing delivering.
curl -fsS "${PUBLIC_URL}/api/v1/health/ready" >/dev/null
curl -fsSI "${PUBLIC_URL}/login" | grep -qi "X-Wodana-Release: ${RELEASE_NAME}"
cutover_started=0
trap - ERR

BUILD_ID="$(docker compose -f compose.yaml exec -T web sh -c 'cat /app/apps/web/.next/BUILD_ID' </dev/null)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$RELEASE_NAME" "$DEPLOYED_AT" "$BUILD_ID" "$PUBLIC_URL" "$CURRENT_RELEASE" "$WEB_PORT" "$CORE_PORT" "$INTELLIGENCE_PORT" <<'PY'
from pathlib import Path
import json, sys

release, deployed_at, build_id, public_url, previous, port, core_port, intelligence_port = sys.argv[1:]
Path("release.json").write_text(json.dumps({
    "release": release,
    "deployedAt": deployed_at,
    "webBuildId": build_id,
    "status": "live",
    "publicUrl": public_url,
    "previousRelease": previous,
    "webPort": int(port),
    "businessCorePort": int(core_port),
    "intelligencePort": int(intelligence_port),
}, indent=2) + "\n")
PY

docker compose -f compose.yaml ps
printf 'Release %s is live at %s\n' "$RELEASE_NAME" "$PUBLIC_URL"
REMOTE_DEPLOY

echo "Deployment complete: ${PUBLIC_URL} (${RELEASE_NAME})"
