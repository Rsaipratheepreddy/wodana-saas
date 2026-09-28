#!/bin/bash
# Writes the production env files in /opt/wodana/prod once. Secrets are generated here and never leave
# the host; platform app keys (Google, QuickBooks, Zoho, WhatsApp, Gemini) come from thirdparty.env.
# Existing files are kept, so re-running is safe. Settings that are not secret can be re-applied with
# `bootstrap-env.sh --refresh`.
set -euo pipefail
P=/opt/wodana/prod
BASE_DOMAIN="${BASE_DOMAIN:-wodana.ai}"
WEB_ORIGIN="${WEB_ORIGIN:-https://admin.$BASE_DOMAIN}"
API_ORIGIN="https://api.$BASE_DOMAIN"
AWS_REGION="${AWS_REGION:-ap-south-1}"
BUCKET="${OBJECT_STORAGE_BUCKET:-wodana-prod-files-aps1}"
SES_FROM="${SES_FROM:-Wodana <no-reply@$BASE_DOMAIN>}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
cd "$P"
umask 077

secret() { openssl rand -hex 32; }
third() { grep -m1 "^$1=" thirdparty.env | cut -d= -f2- || true; }
set_var() { local f=$1 k=$2 v=$3; if grep -q "^$k=" "$f"; then k="$k" v="$v" perl -pi -e 's/^\Q$ENV{k}\E=.*/$ENV{k}=$ENV{v}/' "$f"; else printf '%s=%s\n' "$k" "$v" >> "$f"; fi; }

[ -f thirdparty.env ] || { echo "missing $P/thirdparty.env" >&2; exit 1; }

if [ ! -f postgres.env ]; then
  printf 'POSTGRES_USER=wodana_owner\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=wodana\nPOSTGRES_APP_USER=wodana_app\nPOSTGRES_APP_PASSWORD=%s\n' "$(secret)" "$(secret)" > postgres.env
fi
OWNER_PW=$(grep '^POSTGRES_PASSWORD=' postgres.env | cut -d= -f2-)
APP_PW=$(grep '^POSTGRES_APP_PASSWORD=' postgres.env | cut -d= -f2-)
printf 'DATABASE_URL=postgresql://wodana_owner:%s@127.0.0.1:5432/wodana\nDATABASE_SSL=false\n' "$OWNER_PW" > migrate.env

[ -f internal-token ] || secret > internal-token
TOKEN=$(cat internal-token)

if [ ! -f core.env ]; then
  {
    echo "LOCAL_AUTH_JWT_SECRET=$(secret)"
    echo "MFA_ENCRYPTION_KEY=$(secret)"
    echo "PORTAL_OTP_SECRET=$(secret)"
  } > core.env
fi
if [ ! -f intelligence.env ]; then
  echo "INTEGRATIONS_ENCRYPTION_KEY=$(secret)" > intelligence.env
fi
touch web.env

# Core
set_var core.env AUTH_MODE password
set_var core.env LOCAL_AUTH_ISSUER "https://admin.$BASE_DOMAIN"
set_var core.env LOCAL_AUTH_AUDIENCE wodana-web
set_var core.env BUSINESS_CORE_INTERNAL_TOKEN "$TOKEN"
set_var core.env DATABASE_URL "postgresql://wodana_app:$APP_PW@127.0.0.1:5432/wodana"
set_var core.env DATABASE_SSL false
set_var core.env REDIS_URL redis://127.0.0.1:6379/0
set_var core.env WEB_ORIGIN "$WEB_ORIGIN"
set_var core.env INTELLIGENCE_API_URL http://127.0.0.1:8001/api/v1
set_var core.env BRAND_ASSET_STORAGE_DIR /app/.data/workspace-assets
set_var core.env EMAIL_PROVIDER ses
set_var core.env SES_FROM "$SES_FROM"
set_var core.env SES_REGION "$AWS_REGION"
set_var core.env AWS_REGION "$AWS_REGION"
set_var core.env OBJECT_STORAGE_BUCKET "$BUCKET"
set_var core.env OBJECT_STORAGE_REGION "$AWS_REGION"
set_var core.env GEMINI_API_KEY "$(third GEMINI_API_KEY)"
set_var core.env GEMINI_MODEL "$GEMINI_MODEL"

# Web (server-side only; the browser always calls its own host)
set_var web.env BUSINESS_CORE_URL http://127.0.0.1:8000/api/v1
set_var web.env INTELLIGENCE_API_URL http://127.0.0.1:8001/api/v1
set_var web.env BUSINESS_CORE_INTERNAL_TOKEN "$TOKEN"
set_var web.env NEXT_PUBLIC_BUSINESS_API_URL "$API_ORIGIN/api/v1"
set_var web.env NEXT_PUBLIC_INTELLIGENCE_API_URL "$API_ORIGIN/api/v1"
set_var web.env REDIS_URL redis://127.0.0.1:6379/0
set_var web.env WEB_ORIGIN "$WEB_ORIGIN"
set_var web.env LOGIN_TENANT_SLUG ""

# Intelligence (API and worker)
set_var intelligence.env ENVIRONMENT production
set_var intelligence.env PORT 8001
set_var intelligence.env BUSINESS_CORE_URL http://127.0.0.1:8000/api/v1
set_var intelligence.env BUSINESS_CORE_INTERNAL_TOKEN "$TOKEN"
set_var intelligence.env REDIS_URL redis://127.0.0.1:6379/0
set_var intelligence.env DEPENDENCY_CHECKS_ENABLED true
set_var intelligence.env WEB_ORIGIN "$WEB_ORIGIN"
set_var intelligence.env NOTIFICATION_ADAPTER_MODE live
set_var intelligence.env INTEGRATION_PUBLIC_URL "$API_ORIGIN/api/v1/integrations/providers"
set_var intelligence.env GOOGLE_REDIRECT_URI "$API_ORIGIN/api/v1/integrations/google/oauth/callback"
set_var intelligence.env QUICKBOOKS_REDIRECT_URI "$API_ORIGIN/api/v1/integrations/providers/quickbooks/oauth/callback"
set_var intelligence.env ZOHO_REDIRECT_URI "$API_ORIGIN/api/v1/integrations/providers/zoho_books/oauth/callback"
set_var intelligence.env QUICKBOOKS_ENVIRONMENT "${QUICKBOOKS_ENVIRONMENT:-sandbox}"
set_var intelligence.env PORTAL_OTP_TEMPLATE wodana_portal_login
set_var intelligence.env PORTAL_OTP_LANGUAGE en_US
for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET QUICKBOOKS_CLIENT_ID QUICKBOOKS_CLIENT_SECRET ZOHO_CLIENT_ID ZOHO_CLIENT_SECRET WHATSAPP_APP_ID WHATSAPP_APP_SECRET WHATSAPP_WEBHOOK_VERIFY_TOKEN; do
  v=$(third "$k"); [ -n "$v" ] && set_var intelligence.env "$k" "$v"
done

chmod 600 ./*.env internal-token
echo "env ready: $(ls *.env | tr '\n' ' ')"
