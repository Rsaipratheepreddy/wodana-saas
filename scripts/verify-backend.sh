#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

if [[ -x ".venv/bin/python" ]]; then
  python_runtime=".venv/bin/python"
elif command -v python3.12 >/dev/null 2>&1; then
  python_runtime="$(command -v python3.12)"
else
  echo "Backend verification requires Python 3.12 or a .venv created with Python 3.12." >&2
  exit 1
fi

"$python_runtime" -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12 or newer is required"'

npm run typecheck --workspace @wodana/business-core
npm run test --workspace @wodana/business-core
npm run build --workspace @wodana/business-core

"$python_runtime" -m pytest services/intelligence-automation
"$python_runtime" -m mypy services/intelligence-automation/src/wodana_intelligence
"$python_runtime" -m ruff check \
  services/intelligence-automation/src \
  services/intelligence-automation/tests
