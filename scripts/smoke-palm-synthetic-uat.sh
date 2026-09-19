#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# This fixture is deliberately disposable. The delegated runner creates a
# uniquely named loopback database, applies migrations, starts a loopback-only
# Business Core, executes the UAT path, and drops that exact database on exit.
WODANA_SYNTHETIC_FIXTURE=palm \
SMOKE_COMMAND=test:smoke:funnel \
  bash ./scripts/smoke-funnel-isolated.sh
