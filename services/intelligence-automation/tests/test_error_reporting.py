import json
import logging

from wodana_intelligence.error_reporting import (
    ErrorReportingHandler,
    install_error_reporting,
    parse_dsn,
)


Sent = list[tuple[str, dict[str, str], bytes]]


def handler_with(clock: list[float]) -> tuple[ErrorReportingHandler, Sent]:
    sent: Sent = []
    handler = ErrorReportingHandler(
        "https://o1.ingest.example.io/api/7/envelope/",
        "key1",
        service="intelligence-worker",
        environment="production",
        release="r1",
        send=lambda url, headers, body: sent.append((url, headers, body)),
        clock=lambda: clock[0],
        background=False,
    )
    return handler, sent


def record(message: str, error: Exception | None = None) -> logging.LogRecord:
    exc_info = None
    if error is not None:
        try:
            raise error
        except Exception as raised:  # noqa: BLE001
            exc_info = (type(raised), raised, raised.__traceback__)
    return logging.LogRecord("wodana.worker", logging.ERROR, __file__, 1, message, None, exc_info)


def test_parse_dsn() -> None:
    assert parse_dsn("https://key1@o1.ingest.example.io/7") == (
        "https://o1.ingest.example.io/api/7/envelope/",
        "key1",
    )
    assert parse_dsn("https://key@glitchtip.example.com:8443/sub/9") == (
        "https://glitchtip.example.com:8443/sub/api/9/envelope/",
        "key",
    )
    assert parse_dsn("") is None
    assert parse_dsn("https://example.com/7") is None


def test_off_without_dsn(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert install_error_reporting("intelligence-api") is None


def test_sends_exception_with_release_and_logger() -> None:
    handler, sent = handler_with([1_000.0])
    handler.emit(record("Due-work pass failed", ValueError("bad row")))
    assert len(sent) == 1
    url, headers, body = sent[0]
    assert url == "https://o1.ingest.example.io/api/7/envelope/"
    assert "sentry_key=key1" in headers["x-sentry-auth"]
    event = json.loads(body.decode().split("\n")[2])
    assert event["release"] == "r1"
    assert event["logger"] == "wodana.worker"
    assert event["exception"]["values"][0]["type"] == "ValueError"
    assert "bad row" in event["exception"]["values"][0]["value"]
    assert event["exception"]["values"][0]["stacktrace"]["frames"]


def test_dedupes_and_caps() -> None:
    clock = [1_000.0]
    handler, sent = handler_with(clock)
    for _ in range(3):
        handler.emit(record("same failure"))
    assert len(sent) == 1
    for index in range(50):
        handler.emit(record(f"distinct {index}"))
    assert len(sent) == 30
    clock[0] += 400
    handler.emit(record("same failure"))
    assert len(sent) == 31


def test_reports_error_records_through_a_logger_only() -> None:
    handler, sent = handler_with([1_000.0])
    logger = logging.getLogger("wodana.test.error_reporting")
    logger.propagate = False
    logger.addHandler(handler)
    try:
        logger.info("not an error")
        logger.error("through logging")
    finally:
        logger.removeHandler(handler)
    assert len(sent) == 1


def test_never_raises_when_sending_fails() -> None:
    def failing(url: str, headers: dict[str, str], body: bytes) -> None:
        raise OSError("network down")

    handler = ErrorReportingHandler(
        "https://x/api/1/envelope/",
        "k",
        service="s",
        environment="e",
        send=failing,
        background=False,
    )
    handler.emit(record("boom"))
