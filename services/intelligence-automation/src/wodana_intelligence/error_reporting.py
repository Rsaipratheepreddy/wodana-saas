"""Error reporting to a Sentry-compatible endpoint (Sentry, GlitchTip) for the API and the worker.

Off unless SENTRY_DSN is set. A logging handler forwards ERROR records (with their exception) from a
background thread, so a slow endpoint never blocks the event loop. Only the logger name, the message
and the stack are sent; one report per distinct error per 5 minutes and at most 30 a minute.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import socket
import threading
import time
import traceback
import urllib.request
import uuid
from collections.abc import Callable
from urllib.parse import unquote, urlparse

DEDUPE_SECONDS = 300
MAX_PER_MINUTE = 30
SEND_TIMEOUT_SECONDS = 3

Sender = Callable[[str, dict[str, str], bytes], None]


def parse_dsn(value: str | None) -> tuple[str, str] | None:
    """The envelope endpoint and public key of a DSN, or None when it isn't one."""
    if not value or not value.strip():
        return None
    url = urlparse(value.strip())
    segments = [part for part in url.path.split("/") if part]
    if url.scheme not in ("http", "https") or not url.username or not segments or not url.hostname:
        return None
    project = segments.pop()
    prefix = "/" + "/".join(segments) if segments else ""
    host = url.hostname + (f":{url.port}" if url.port else "")
    return f"{url.scheme}://{host}{prefix}/api/{project}/envelope/", unquote(url.username)


def _post(url: str, headers: dict[str, str], body: bytes) -> None:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    # The URL is the configured DSN, never user input.
    with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_SECONDS):
        pass


class ErrorReportingHandler(logging.Handler):
    def __init__(
        self,
        endpoint: str,
        public_key: str,
        *,
        service: str,
        environment: str,
        release: str = "",
        send: Sender | None = None,
        clock: Callable[[], float] = time.time,
        background: bool = True,
    ) -> None:
        super().__init__(level=logging.ERROR)
        self.endpoint = endpoint
        self.public_key = public_key
        self.service = service
        self.environment = environment
        self.release_id = release
        self.send = send or _post
        self.clock = clock
        self.recent: dict[str, float] = {}
        self.window_start = 0.0
        self.window_count = 0
        self.state_lock = threading.Lock()
        self.queue: queue.Queue[bytes] | None = None
        if background:
            self.queue = queue.Queue(maxsize=100)
            threading.Thread(target=self._drain, name="error-reporting", daemon=True).start()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            body = self.envelope(record)
            if body is None:
                return
            if self.queue is None:
                self._deliver(body)
            else:
                self.queue.put_nowait(body)
        except Exception:  # reporting never breaks logging
            pass

    def envelope(self, record: logging.LogRecord) -> bytes | None:
        message = record.getMessage()
        error_type = "LoggedError"
        value = message
        frames: list[dict[str, object]] = []
        if record.exc_info and record.exc_info[1] is not None:
            error = record.exc_info[1]
            error_type = type(error).__name__
            value = f"{message}: {error}" if str(error) else message
            frames = [
                {
                    "filename": frame.filename,
                    "function": frame.name,
                    "lineno": frame.lineno,
                    "in_app": "site-packages" not in frame.filename,
                }
                for frame in traceback.extract_tb(record.exc_info[2])[-50:]
            ]
        top = "|".join(f"{frame['filename']}:{frame['lineno']}" for frame in frames[-2:])
        key = f"{record.name}:{error_type}:{value[:200]}:{top}"
        now = self.clock()
        with self.state_lock:
            seen = self.recent.get(key)
            if seen is not None and now - seen < DEDUPE_SECONDS:
                return None
            if now - self.window_start >= 60:
                self.window_start, self.window_count = now, 0
            if self.window_count >= MAX_PER_MINUTE:
                return None
            self.window_count += 1
            self.recent[key] = now
            if len(self.recent) > 500:
                self.recent = {k: at for k, at in self.recent.items() if now - at < DEDUPE_SECONDS}
        event_id = uuid.uuid4().hex
        event: dict[str, object] = {
            "event_id": event_id,
            "timestamp": now,
            "platform": "python",
            "level": "error",
            "logger": record.name,
            "server_name": socket.gethostname(),
            "environment": self.environment,
            "tags": {"service": self.service},
            "exception": {
                "values": [
                    {"type": error_type, "value": value[:2000], "stacktrace": {"frames": frames}}
                ]
            },
        }
        if self.release_id:
            event["release"] = self.release_id
        sent_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
        lines = [
            json.dumps({"event_id": event_id, "sent_at": sent_at}),
            json.dumps({"type": "event"}),
            json.dumps(event, default=str),
        ]
        return "\n".join(lines).encode()

    def _deliver(self, body: bytes) -> None:
        headers = {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": (
                f"Sentry sentry_version=7, sentry_key={self.public_key}, "
                "sentry_client=wodana-intelligence/1.0"
            ),
        }
        try:
            self.send(self.endpoint, headers, body)
        except Exception:
            pass

    def _drain(self) -> None:
        assert self.queue is not None
        while True:
            self._deliver(self.queue.get())


def install_error_reporting(service: str) -> ErrorReportingHandler | None:
    """Adds the handler to the root and uvicorn loggers when SENTRY_DSN is set."""
    dsn = parse_dsn(os.environ.get("SENTRY_DSN"))
    if dsn is None:
        return None
    handler = ErrorReportingHandler(
        dsn[0],
        dsn[1],
        service=service,
        environment=os.environ.get("SENTRY_ENVIRONMENT")
        or os.environ.get("ENVIRONMENT", "development"),
        release=os.environ.get("WODANA_RELEASE_ID", ""),
    )
    # uvicorn's loggers don't propagate to the root; its request errors are logged there.
    for name in ("", "uvicorn"):
        logging.getLogger(name).addHandler(handler)
    return handler
