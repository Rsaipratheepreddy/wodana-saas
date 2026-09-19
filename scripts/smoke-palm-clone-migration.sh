#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# The delegated runner creates and later drops the source database. The
# P09.2 script restores it into a second local database, proves mapping and
# rollback there, and also removes that clone in its own finally block.
WODANA_SYNTHETIC_FIXTURE=palm \
SMOKE_COMMAND=test:smoke:palm-clone \
  bash ./scripts/smoke-funnel-isolated.sh
