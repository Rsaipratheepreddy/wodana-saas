"""Container healthcheck for the worker: `python -m wodana_intelligence.worker.healthcheck`.

The worker touches its heartbeat file on every timer pass (see `CrmWorker.beat`). The file is local
to the container, so this proves *this* worker is alive, unlike the shared Redis beat that any
release's worker can write.
"""

import os
import sys
import time

from wodana_intelligence.config import get_settings

# Business Core counts a worker as stale after two minutes without a beat; the container agrees.
STALE_SECONDS = 120


def heartbeat_age(path: str, now: float | None = None) -> float | None:
    try:
        modified = os.stat(path).st_mtime
    except OSError:
        return None
    return max(0.0, (time.time() if now is None else now) - modified)


def main() -> int:
    path = get_settings().worker_heartbeat_file
    age = heartbeat_age(path)
    if age is None:
        print("worker has not beaten yet", file=sys.stderr)
        return 1
    if age > STALE_SECONDS:
        print(f"worker heartbeat is stale ({round(age)}s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
