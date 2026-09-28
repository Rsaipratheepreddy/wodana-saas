#!/bin/bash
# Installs the nginx site from /opt/wodana/prod/nginx: HTTPS when the certificate exists, HTTP before.
set -euo pipefail
N=/opt/wodana/prod/nginx
R=$(sed -n 's/^RELEASE=//p' /opt/wodana/prod/.env)
install -m 644 "$N"/wodana-{routes,proxy,http-include,http-redirect}.conf /etc/nginx/snippets/
printf 'map "" $wodana_release { default "%s"; }\n' "$R" > /etc/nginx/conf.d/wodana-release.conf
if [ -s /etc/letsencrypt/live/wodana-prod/fullchain.pem ]; then
  sed 's/__HTTP_MODE__/redirect/' "$N/wodana.conf" > /etc/nginx/sites-available/wodana
else
  sed -e 's/__HTTP_MODE__/include/' -e '/# __TLS_BEGIN__/,/# __TLS_END__/d' "$N/wodana.conf" > /etc/nginx/sites-available/wodana
fi
ln -sf /etc/nginx/sites-available/wodana /etc/nginx/sites-enabled/wodana
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
