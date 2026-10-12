#!/bin/bash
# Host watchdog (systemd timer every 10 minutes): disk space, service readiness, worker heartbeat, last backup and
# certificate expiry. A problem is emailed to ALERT_EMAIL (thirdparty.env) through Mailgun with core.env's key, at
# most once every 6 hours per problem, and again once it clears. It cannot report the host itself being down:
# that needs the external uptime monitor in the go-live checklist.
set -uo pipefail
P=/opt/wodana/prod
STATE="$P/watchdog"
mkdir -p "$STATE"
env_value() { grep -m1 "^$2=" "$P/$1" 2>/dev/null | cut -d= -f2- || true; }
TO=$(env_value thirdparty.env ALERT_EMAIL)
KEY=$(env_value core.env MAILGUN_API_KEY)
DOMAIN=$(env_value core.env MAILGUN_DOMAIN)
BASE_URL=$(env_value core.env MAILGUN_BASE_URL); BASE_URL="${BASE_URL:-https://api.mailgun.net}"
HOST_NAME=$(hostname)

notify() { # <subject> <text>
  logger -t wodana-watchdog "$1: $2"
  [ -n "$TO" ] && [ -n "$KEY" ] && [ -n "$DOMAIN" ] || return 0
  curl -fsS --max-time 20 --user "api:$KEY" "${BASE_URL%/}/v3/$DOMAIN/messages" \
    -F from="Wodana watchdog <no-reply@$DOMAIN>" -F to="$TO" -F subject="[wodana prod] $1" -F text="$2 (host $HOST_NAME)" \
    -o /dev/null || logger -t wodana-watchdog "alert email failed"
}
# problem <key> <message>: alert now, then every 6 hours while it lasts.
problem() {
  local file="$STATE/$1"
  if [ ! -f "$file" ] || [ -n "$(find "$file" -mmin +360 2>/dev/null)" ]; then notify "$1" "$2"; touch "$file"; fi
}
# twice <key> <message>: a problem only when the previous run saw it too, so a deploy's restart is not an alert.
twice() { if [ -f "$STATE/$1.seen" ]; then problem "$1" "$2"; else touch "$STATE/$1.seen"; fi; }
# cleared <key>: the problem is gone; say so once.
cleared() { rm -f "$STATE/$1.seen"; [ -f "$STATE/$1" ] && { rm -f "$STATE/$1"; notify "$1 cleared" "back to normal"; }; return 0; }

free_pct=$((100 - $(df --output=pcent / | tail -1 | tr -dc 0-9)))
free_gb=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
if [ "$free_pct" -lt 15 ] || [ "$free_gb" -lt 5 ]; then problem disk "only ${free_gb} GB (${free_pct}%) free on /"; else cleared disk; fi

ready=$(curl -sS --max-time 15 -w '\n%{http_code}' http://127.0.0.1:8000/api/v1/health/ready 2>&1)
if [ "${ready##*$'\n'}" != "200" ]; then twice ready "business-core is not ready: ${ready:0:600}"; else cleared ready; fi

if ! curl -fsS --max-time 10 -o /dev/null -H "Host: admin.wodana.ai" http://127.0.0.1:3000/login; then
  twice web "the web app does not answer /login"
else
  cleared web
fi

last_backup="$P/logs/last-backup"
if [ ! -f "$last_backup" ] || [ -n "$(find "$last_backup" -mmin +1800 2>/dev/null)" ]; then
  problem backup "no successful backup in the last 30 hours (see journalctl -u wodana-backup)"
else
  cleared backup
fi

cert=/etc/letsencrypt/live/wodana-prod/fullchain.pem
if [ -s "$cert" ] && ! openssl x509 -in "$cert" -noout -checkend $((14 * 86400)) >/dev/null; then
  problem certificate "the certificate expires $(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)"
else
  cleared certificate
fi

restarting=$(docker ps --filter "label=com.docker.compose.project=wodana-prod" --filter status=restarting --format '{{.Names}}')
if [ -n "$restarting" ]; then twice restarting "containers restarting: $restarting"; else cleared restarting; fi
exit 0
