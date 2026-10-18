import os
import time
from typing import Any

import pytest

from wodana_intelligence.worker import healthcheck


def test_a_fresh_heartbeat_file_is_healthy_and_a_missing_or_stale_one_is_not(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    beat = tmp_path / "worker.beat"
    monkeypatch.setenv("WORKER_HEARTBEAT_FILE", str(beat))
    healthcheck.get_settings.cache_clear()
    try:
        assert healthcheck.main() == 1  # never beaten

        beat.write_text("now")
        assert healthcheck.main() == 0

        old = time.time() - healthcheck.STALE_SECONDS - 30
        os.utime(beat, (old, old))
        assert healthcheck.main() == 1
    finally:
        healthcheck.get_settings.cache_clear()
