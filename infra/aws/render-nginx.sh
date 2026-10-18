#!/bin/bash
# Installs the nginx site from /opt/wodana/prod/nginx: HTTPS when the certificate exists, HTTP before.
# The files nginx reads are kept until the new set passes `nginx -t`; a failing set is put back, so a bad
# config never waits on disk for the next nginx restart or reboot.
set -euo pipefail
N=/opt/wodana/prod/nginx
R=$(sed -n 's/^RELEASE=//p' /opt/wodana/prod/.env)
FILES=(/etc/nginx/snippets/wodana-{routes,proxy,http-include,http-redirect}.conf
  /etc/nginx/conf.d/wodana-release.conf /etc/nginx/sites-available/wodana)
B=$(mktemp -d)
trap 'rm -rf "$B"' EXIT
for f in "${FILES[@]}"; do [ -e "$f" ] && cp -p "$f" "$B/$(basename "$f")"; done
restore() {
  for f in "${FILES[@]}"; do
    if [ -e "$B/$(basename "$f")" ]; then cp -p "$B/$(basename "$f")" "$f"; else rm -f "$f"; fi
  done
}

install -m 644 "$N"/wodana-{routes,proxy,http-include,http-redirect}.conf /etc/nginx/snippets/
printf 'map "" $wodana_release { default "%s"; }\n' "$R" > /etc/nginx/conf.d/wodana-release.conf
if [ -s /etc/letsencrypt/live/wodana-prod/fullchain.pem ]; then
  sed 's/__HTTP_MODE__/redirect/' "$N/wodana.conf" > /etc/nginx/sites-available/wodana
else
  sed -e 's/__HTTP_MODE__/include/' -e '/# __TLS_BEGIN__/,/# __TLS_END__/d' "$N/wodana.conf" > /etc/nginx/sites-available/wodana
fi
ln -sf /etc/nginx/sites-available/wodana /etc/nginx/sites-enabled/wodana
rm -f /etc/nginx/sites-enabled/default
if ! nginx -t; then
  restore
  echo "nginx rejected the new site; the previous files are back and nginx was not reloaded" >&2
  exit 1
fi
systemctl reload nginx
