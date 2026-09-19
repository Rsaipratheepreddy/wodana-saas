#!/usr/bin/env bash
set -euo pipefail

# One-time split of plm.wodana.ai from the shared Wodana HTTPS vhost.
# Usage: bash cutover-palm-vhost.native-host.sh RELEASE WEB_PORT CORE_PORT BACKUP_DIR

release="${1:?release required}"
web_port="${2:?web port required}"
core_port="${3:?core port required}"
backup_dir="${4:?backup directory required}"
release_dir="/opt/wodana/releases/${release}"
shared_config=/etc/nginx/sites-available/wodana.ai
palm_config=/etc/nginx/sites-available/plm.wodana.ai
palm_link=/etc/nginx/sites-enabled/plm.wodana.ai
old_names='server_name wodana.ai www.wodana.ai admin.wodana.ai iglo.wodana.ai client.wodana.ai plm.wodana.ai;'
new_names='server_name wodana.ai www.wodana.ai admin.wodana.ai iglo.wodana.ai client.wodana.ai;'

[[ "$(id -u)" == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ "$release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]] || exit 1
[[ "$web_port" =~ ^[0-9]+$ && "$core_port" =~ ^[0-9]+$ ]] || exit 1
[[ "$backup_dir" =~ ^/var/backups/wodana/current/[a-zA-Z0-9._-]+$ ]] || exit 1
[[ -f "$release_dir/palm-only-vhost.nginx.conf" && -f "$backup_dir/nginx-before.conf" ]] || exit 1
[[ ! -e "$palm_config" && ! -e "$palm_link" ]] || { echo 'Palm vhost already exists.' >&2; exit 1; }
[[ "$(grep -Fc "$old_names" "$shared_config")" == 1 ]] || { echo 'Unexpected shared vhost configuration.' >&2; exit 1; }
cmp -s "$shared_config" "$backup_dir/nginx-before.conf" || { echo 'Shared vhost changed since backup.' >&2; exit 1; }
curl -fsS "http://127.0.0.1:${web_port}/login" -H 'Host: plm.wodana.ai' >/dev/null
curl -fsS "http://127.0.0.1:${core_port}/api/v1/health/ready" >/dev/null

sed -e "s/__RELEASE__/${release}/g" \
    -e "s/__WEB_PORT__/${web_port}/g" \
    -e "s/__CORE_PORT__/${core_port}/g" \
    "$release_dir/palm-only-vhost.nginx.conf" > "$release_dir/nginx-palm-new.conf"
sed "s/${old_names}/${new_names}/" "$shared_config" > "$release_dir/nginx-shared-new.conf"
cp "$shared_config" "$release_dir/nginx-before.conf"

cutover_started=0
restore_on_error() {
  result=$?
  failed_command="${1:-unknown}"
  if [[ "$cutover_started" == 1 ]]; then
    curl -fsSI https://plm.wodana.ai/login | grep -Ei 'HTTP/|X-Wodana-Release' >&2 || true
    cp "$backup_dir/nginx-before.conf" "$shared_config"
    [[ ! -L "$palm_link" ]] || unlink "$palm_link"
    [[ ! -f "$palm_config" ]] || unlink "$palm_config"
    nginx -t && systemctl reload nginx
    echo "Palm cutover check failed (${failed_command}); previous vhost restored." >&2
  fi
  exit "$result"
}
trap 'restore_on_error "$BASH_COMMAND"' ERR

cutover_started=1
cp "$release_dir/nginx-shared-new.conf" "$shared_config"
cp "$release_dir/nginx-palm-new.conf" "$palm_config"
ln -s "$palm_config" "$palm_link"
nginx -t
systemctl reload nginx

for attempt in $(seq 1 15); do
  if curl -fsSI https://plm.wodana.ai/login | grep -qi "X-Wodana-Release: ${release}"; then
    break
  fi
  sleep 1
done
curl -fsSI https://plm.wodana.ai/login | grep -qi "X-Wodana-Release: ${release}"
curl -fsS https://plm.wodana.ai/api/v1/health/ready | grep -q "\"releaseId\":\"${release}\""
curl -fsSI https://wodana.ai/login | grep -qi 'X-Wodana-Release: 20260917-palm-crm-r2'

cutover_started=0
trap - ERR
printf 'Palm cutover complete: %s\n' "$release"
