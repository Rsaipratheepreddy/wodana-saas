#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/hostinger/compose.production.yaml"
ENV_FILE="${1:-${ROOT_DIR}/.env.production}"
MODE="${2:-full}"

[[ -f "${ENV_FILE}" ]] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

if [[ "${MODE}" != "structure-only" ]]; then
  required=(
    BASE_DOMAIN CERTBOT_EMAIL POSTGRES_PASSWORD POSTGRES_APP_PASSWORD
    BUSINESS_CORE_INTERNAL_TOKEN INTEGRATIONS_ENCRYPTION_KEY PORTAL_OTP_SECRET
    GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI
    QUICKBOOKS_CLIENT_ID QUICKBOOKS_CLIENT_SECRET QUICKBOOKS_REDIRECT_URI QUICKBOOKS_WEBHOOK_VERIFIER
    ZOHO_CLIENT_ID ZOHO_CLIENT_SECRET ZOHO_REDIRECT_URI
    WHATSAPP_APP_ID WHATSAPP_APP_SECRET WHATSAPP_CONFIG_ID WHATSAPP_WEBHOOK_VERIFY_TOKEN
  )
  auth_mode="$(sed -n 's/^AUTH_MODE=//p' "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
  case "${auth_mode:-password}" in
    password) required+=(LOCAL_AUTH_JWT_SECRET LOCAL_AUTH_ISSUER LOCAL_AUTH_AUDIENCE MAILGUN_API_KEY MAILGUN_DOMAIN) ;;
    oidc) required+=(OIDC_ISSUER OIDC_AUDIENCE OIDC_JWKS_URI) ;;
    *) echo "Production AUTH_MODE must be password or oidc" >&2; exit 1 ;;
  esac
  for key in "${required[@]}"; do
    value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
    if [[ -z "${value}" || "${value}" == *CHANGE_ME* ]]; then
      echo "Set ${key} in ${ENV_FILE}" >&2
      exit 1
    fi
  done

  secret_keys=(BUSINESS_CORE_INTERNAL_TOKEN INTEGRATIONS_ENCRYPTION_KEY PORTAL_OTP_SECRET)
  [[ "${auth_mode:-password}" != "password" ]] || secret_keys+=(LOCAL_AUTH_JWT_SECRET)
  for key in "${secret_keys[@]}"; do
    value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
    (( ${#value} >= 32 )) || { echo "${key} must contain at least 32 characters" >&2; exit 1; }
  done

  https_keys=(WEB_ORIGIN GOOGLE_REDIRECT_URI QUICKBOOKS_REDIRECT_URI ZOHO_REDIRECT_URI)
  if [[ "${auth_mode:-password}" == "password" ]]; then
    https_keys+=(LOCAL_AUTH_ISSUER)
  else
    https_keys+=(OIDC_ISSUER OIDC_JWKS_URI)
  fi
  for key in "${https_keys[@]}"; do
    value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1 | tr -d '\r')"
    [[ "${value}" == https://* ]] || { echo "${key} must use HTTPS" >&2; exit 1; }
  done
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet
bash -n "${ROOT_DIR}/infra/hostinger/"*.sh
echo "Production infrastructure configuration is valid."
