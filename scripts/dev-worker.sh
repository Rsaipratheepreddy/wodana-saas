#!/usr/bin/env bash
# Runs the intelligence worker locally: email, WhatsApp and push delivery, CRM timers, SLAs and
# automation waits. It reads the root .env (like Business Core) and talks to Business Core at
# BUSINESS_CORE_URL. Business Core's /health/ready shows its heartbeat as checks.worker.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
python_runtime=".venv/bin/python"

if [[ ! -x "${python_runtime}" ]] || ! "${python_runtime}" -c 'import wodana_intelligence' 2>/dev/null; then
  echo "Set up the worker's Python first:" >&2
  echo "  python3.12 -m venv .venv && .venv/bin/pip install -e 'services/intelligence-automation[dev]'" >&2
  exit 1
fi

# The value the worker will use: the process environment wins over .env, as in pydantic-settings.
setting() {
  local name="$1"
  if [[ -n "${!name+x}" ]]; then printf '%s' "${!name}"; return; fi
  [[ -f .env ]] && sed -n "s/^${name}=//p" .env | tail -n 1 | tr -d '\r"'"'" || true
}

# Live delivery from a laptop can reach real customers through a tenant's connected Gmail or
# WhatsApp. Allow it only with a DELIVERY_ALLOWLIST (set it for Business Core too, e.g. in .env).
if [[ "$(setting NOTIFICATION_ADAPTER_MODE)" == "live" && -z "$(setting DELIVERY_ALLOWLIST)" ]]; then
  echo "NOTIFICATION_ADAPTER_MODE=live needs DELIVERY_ALLOWLIST locally (your own addresses and numbers)," >&2
  echo "or use NOTIFICATION_ADAPTER_MODE=test to mark deliveries done without sending." >&2
  exit 1
fi

exec "${python_runtime}" -m wodana_intelligence.worker
