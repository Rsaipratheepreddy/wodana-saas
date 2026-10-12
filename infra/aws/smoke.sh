#!/bin/bash
# Smoke check after a deploy or rollback (deploy.sh and rollback.sh run it; safe to run any time as root):
# every service answers through nginx over HTTPS, the running release is the expected one, the security headers
# are there and nothing sensitive is served. Retries each check for up to a minute; exits 1 if any check fails.
set -uo pipefail
P=/opt/wodana/prod
HOST="${SMOKE_HOST:-admin.wodana.ai}"
R=$(sed -n 's/^RELEASE=//p' "$P/.env")
CERT=/etc/letsencrypt/live/wodana-prod/fullchain.pem
if [ -s "$CERT" ]; then
  BASE="https://$HOST"; CURL=(curl -sS --max-time 15 --resolve "$HOST:443:127.0.0.1")
else
  BASE="http://$HOST"; CURL=(curl -sS --max-time 15 --resolve "$HOST:80:127.0.0.1")
fi
failed=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; failed=1; }

# expect <status> <path>: the path answers with that status (retried while the apps start).
expect() {
  local want=$1 path=$2 got=000
  for _ in $(seq 1 12); do
    got=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null) || got=000
    [ "$got" = "$want" ] && { ok "$path -> $got"; return 0; }
    sleep 5
  done
  bad "$path -> $got (want $want)"
}

expect 200 /login
expect 200 /api/v1/health/live
expect 200 /api/v1/health/ready
# Bots probe these; nginx answers 404 without reaching the apps.
expect 404 /.env
expect 404 /.git/config
expect 404 /wp-login.php

ready=$("${CURL[@]}" "$BASE/api/v1/health/ready" 2>/dev/null || true)
grep -q "\"releaseId\":\"$R\"" <<<"$ready" && ok "business-core runs $R" || bad "business-core release is not $R: $ready"
headers=$("${CURL[@]}" -o /dev/null -D - "$BASE/login" 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]')
for header in "x-wodana-release: ${R,,}" "content-security-policy:" "x-content-type-options: nosniff" "referrer-policy:"; do
  grep -q "^$header" <<<"$headers" && ok "header $header" || bad "missing header $header"
done
if [ -s "$CERT" ]; then
  grep -q "^strict-transport-security:" <<<"$headers" && ok "header strict-transport-security" || bad "missing HSTS"
  openssl x509 -in "$CERT" -noout -checkend $((14 * 86400)) >/dev/null && ok "certificate valid for 14+ days" \
    || bad "certificate expires within 14 days: $(openssl x509 -in "$CERT" -noout -enddate)"
fi

# Containers: every long-running service up, and healthy where it has a healthcheck.
cd "$P"
for service in postgres redis business-core intelligence-api intelligence-worker web; do
  id=$(docker compose ps -q "$service" 2>/dev/null)
  state=$([ -n "$id" ] && docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null)
  case "$state" in running/healthy|running/none) ok "$service $state" ;; *) bad "$service ${state:-missing}" ;; esac
done
curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8001/api/v1/health/live && ok "intelligence-api live" || bad "intelligence-api not answering"

free_gb=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge 5 ] && ok "disk: ${free_gb} GB free" || bad "disk: only ${free_gb} GB free"

[ "$failed" -eq 0 ] && echo "== smoke ok ($R)" || echo "== smoke FAILED ($R)"
exit "$failed"
