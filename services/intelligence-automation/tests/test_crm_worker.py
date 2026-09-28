import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import pytest
from fakes import FakeRedis

from wodana_intelligence.worker.adapters import DeterministicTestAdapter, UnconfiguredAdapter
from wodana_intelligence.worker.models import DeliveryJob, DomainEventV1
from wodana_intelligence.worker.runtime import CrmWorker

EVENT_ID = "11111111-1111-4111-8111-111111111111"
WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"
AGGREGATE_ID = "33333333-3333-4333-8333-333333333333"
CORRELATION_ID = "44444444-4444-4444-8444-444444444444"


def event_payload() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "eventId": EVENT_ID,
        "workspaceId": WORKSPACE_ID,
        "aggregateType": "notification",
        "aggregateId": AGGREGATE_ID,
        "actorUserId": None,
        "occurredAt": "2026-09-05T00:00:00Z",
        "correlationId": CORRELATION_ID,
        "causationId": None,
        "data": {"channel": "email"},
    }


class FakeStreamRedis:
    def __init__(self) -> None:
        self.acked: list[str] = []
        self.dead_letters: list[dict[str, str]] = []

    async def xreadgroup(self, *_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            (
                "wodana:domain-events",
                [
                    (
                        "1-0",
                        {
                            "eventType": "notification.delivery_requested.v1",
                            "payload": json.dumps(event_payload()),
                        },
                    )
                ],
            )
        ]

    async def xautoclaim(self, *_args: Any, **_kwargs: Any) -> list[Any]:
        return ["0-0", []]

    async def xack(self, _stream: str, _group: str, message_id: str) -> None:
        self.acked.append(message_id)

    async def xadd(
        self,
        _stream: str,
        fields: dict[str, str],
        **_kwargs: Any,
    ) -> str:
        self.dead_letters.append(fields)
        return "dead-1"


class FakeLegacyStreamRedis(FakeStreamRedis):
    async def xreadgroup(self, *_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            (
                "wodana:domain-events",
                [
                    (
                        "2-0",
                        {
                            "eventId": EVENT_ID,
                            "eventType": "workspace.updated.v1",
                            "workspaceId": WORKSPACE_ID,
                            "aggregateType": "workspace",
                            "aggregateId": AGGREGATE_ID,
                            "payload": json.dumps(
                                {"name": "Legacy workspace", "correlationId": CORRELATION_ID}
                            ),
                        },
                    )
                ],
            )
        ]


class FakeCrmCore:
    def __init__(self) -> None:
        self.results: list[dict[str, Any]] = []

    async def matching_automations(self, _workspace: str, _event: str) -> list[dict[str, Any]]:
        return []

    async def claim_notification_jobs(self, _workspace: str) -> list[dict[str, Any]]:
        return [
            {
                "id": AGGREGATE_ID,
                "workspaceId": WORKSPACE_ID,
                "attempt": 1,
                "channel": "email",
                "subject": "Hello",
                "body": "Welcome",
                "destination": {"email": "person@example.com"},
                "version": 1,
            }
        ]

    async def record_notification_result(
        self, notification_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.results.append({"notificationId": notification_id, **payload})
        return {"status": "delivered"}

    async def dispatch_staff_emails(self, _workspace: str) -> dict[str, Any]:
        return {"claimed": 0, "delivered": 0}


class FakeAutomationCore:
    def __init__(self) -> None:
        self.executed: list[dict[str, Any]] = []
        self.advanced: list[dict[str, Any]] = []

    async def execute_automation_step(
        self, run_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.executed.append({"runId": run_id, **payload})
        return {"status": "completed"}

    async def advance_automation_run(
        self, run_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.advanced.append({"runId": run_id, **payload})
        return {"status": payload["status"]}


class FakeDueWorkCore:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def due_crm_workspaces(self) -> list[str]:
        return [WORKSPACE_ID]

    async def process_due_slas(self, _workspace: str) -> dict[str, Any]:
        self.calls.append("slas")
        return {"processed": 0}

    async def process_due_takeovers(self, _workspace: str) -> dict[str, Any]:
        self.calls.append("takeovers")
        return {"reassigned": [], "engaged": []}

    async def process_due_sequences(self, _workspace: str) -> dict[str, Any]:
        self.calls.append("sequences")
        return {"processed": 1}

    async def wake_snoozed_conversations(self, _workspace: str) -> dict[str, Any]:
        self.calls.append("snoozed")
        return {"woken": 0}

    async def claim_notification_jobs(self, _workspace: str) -> list[dict[str, Any]]:
        self.calls.append("notifications")
        return []

    async def dispatch_staff_emails(self, _workspace: str) -> dict[str, Any]:
        self.calls.append("staff-emails")
        return {"claimed": 0, "delivered": 0}

    async def claim_automation_waits(self, _workspace: str) -> list[dict[str, Any]]:
        self.calls.append("waits")
        return []


def test_domain_event_contract_accepts_shared_camel_case_shape() -> None:
    event = DomainEventV1.model_validate(event_payload())
    assert event.workspace_id == UUID(WORKSPACE_ID)
    assert event.schema_version == 1


@pytest.mark.asyncio
async def test_delivery_adapters_are_explicit_and_deterministic() -> None:
    job = DeliveryJob(
        id=UUID(AGGREGATE_ID), workspaceId=UUID(WORKSPACE_ID), attempt=1,
        channel="email", subject="Hello", body="Welcome"
    )
    first = await DeterministicTestAdapter().deliver(job)
    second = await DeterministicTestAdapter().deliver(job)
    assert first == second
    assert first.result == "delivered"
    missing = await UnconfiguredAdapter().deliver(job)
    assert missing.result == "permanent_failure"
    assert missing.error_code == "EMAIL_PROVIDER_UNCONFIGURED"


@pytest.mark.asyncio
async def test_worker_acknowledges_only_after_business_core_accepts_delivery() -> None:
    redis = FakeStreamRedis()
    core = FakeCrmCore()
    worker = CrmWorker(redis, core, DeterministicTestAdapter(), "group", "worker")  # type: ignore[arg-type]
    assert await worker.consume_once() == 1
    assert redis.acked == ["1-0"]
    assert core.results[0]["result"] == "delivered"


@pytest.mark.asyncio
async def test_worker_drains_legacy_stream_payloads_after_upgrade() -> None:
    redis = FakeLegacyStreamRedis()
    core = FakeCrmCore()
    worker = CrmWorker(redis, core, DeterministicTestAdapter(), "group", "worker")  # type: ignore[arg-type]
    assert await worker.consume_once() == 1
    assert redis.acked == ["2-0"]


@pytest.mark.asyncio
async def test_worker_dead_letters_invalid_events_before_acknowledging() -> None:
    redis = FakeStreamRedis()
    core = FakeCrmCore()
    worker = CrmWorker(redis, core, DeterministicTestAdapter(), "group", "worker")  # type: ignore[arg-type]
    assert await worker._handle({"eventType": "broken", "payload": "{}"}) is True  # noqa: SLF001
    assert len(redis.dead_letters) == 1
    assert "eventId" in redis.dead_letters[0]["reason"]


@pytest.mark.asyncio
async def test_due_work_polls_sequences_before_notification_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    core = FakeDueWorkCore()
    worker = CrmWorker(
        FakeStreamRedis(), core, DeterministicTestAdapter(), "group", "worker"  # type: ignore[arg-type]
    )

    async def stop_after_one_cycle(_seconds: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", stop_after_one_cycle)
    with pytest.raises(asyncio.CancelledError):
        await worker.poll_due_work()

    assert core.calls == ["slas", "takeovers", "sequences", "snoozed", "notifications", "staff-emails", "waits"]


@pytest.mark.asyncio
async def test_graph_runner_follows_branch_and_executes_actions_through_core() -> None:
    core = FakeAutomationCore()
    worker = CrmWorker(
        FakeStreamRedis(), core, DeterministicTestAdapter(), "group", "worker"  # type: ignore[arg-type]
    )
    definition = {
        "nodes": [
            {"key": "start", "type": "trigger", "configuration": {}},
            {
                "key": "eligible",
                "type": "filter",
                "configuration": {
                    "condition": {"path": "score", "operator": "gte", "value": 80}
                },
            },
            {"key": "high", "type": "create_task", "configuration": {}},
            {"key": "normal", "type": "create_task", "configuration": {}},
            {"key": "finish", "type": "end", "configuration": {}},
        ],
        "edges": [
            {"from": "start", "to": "eligible"},
            {"from": "eligible", "to": "high", "when": "true"},
            {"from": "eligible", "to": "normal", "when": "false"},
            {"from": "high", "to": "finish"},
            {"from": "normal", "to": "finish"},
        ],
    }

    await worker._execute_safe(  # noqa: SLF001
        WORKSPACE_ID, {"id": EVENT_ID, "context": {"score": 50}}, definition
    )

    assert [item["stepKey"] for item in core.executed] == ["normal"]
    assert core.advanced[-1]["stepKey"] == "finish"
    assert core.advanced[-1]["status"] == "completed"


def test_delay_requires_timezone_or_non_negative_minutes() -> None:
    assert "+00:00" in CrmWorker._due_at({"delayMinutes": 5})  # noqa: SLF001
    resolved = CrmWorker._resolve_value(  # noqa: SLF001
        {"dueAt": "$event.startsAt", "offsetMinutes": -60},
        {"event": {"startsAt": "2026-09-05T10:00:00+04:00"}},
    )
    assert CrmWorker._due_at(resolved) == "2026-09-05T09:00:00+04:00"  # noqa: SLF001
    with pytest.raises(ValueError, match="timezone"):
        CrmWorker._due_at({"dueAt": "2026-09-05T10:00:00"})  # noqa: SLF001


@pytest.mark.asyncio
async def test_bounded_iteration_exits_after_configured_visits() -> None:
    core = FakeAutomationCore()
    worker = CrmWorker(
        FakeStreamRedis(), core, DeterministicTestAdapter(), "group", "worker"  # type: ignore[arg-type]
    )
    definition = {
        "nodes": [
            {"key": "start", "type": "trigger", "configuration": {}},
            {
                "key": "repeat",
                "type": "bounded_iteration",
                "configuration": {"maxIterations": 3},
            },
            {"key": "work", "type": "create_task", "configuration": {}},
            {"key": "finish", "type": "end", "configuration": {}},
        ],
        "edges": [
            {"from": "start", "to": "repeat"},
            {"from": "repeat", "to": "work", "when": "continue"},
            {"from": "repeat", "to": "finish", "when": "done"},
            {"from": "work", "to": "repeat"},
        ],
    }

    await worker._execute_safe(  # noqa: SLF001
        WORKSPACE_ID, {"id": EVENT_ID, "context": {}}, definition
    )

    assert [item["stepKey"] for item in core.executed] == ["work", "work"]
    assert core.advanced[-1]["stepKey"] == "finish"
    assert core.advanced[-1]["status"] == "completed"


class HeartbeatRedis(FakeStreamRedis, FakeRedis):
    def __init__(self) -> None:
        FakeStreamRedis.__init__(self)
        FakeRedis.__init__(self)


@pytest.mark.asyncio
async def test_every_worker_loop_writes_the_heartbeat_business_core_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = HeartbeatRedis()
    worker = CrmWorker(
        redis, FakeDueWorkCore(), DeterministicTestAdapter(), "group", "worker-7"  # type: ignore[arg-type]
    )

    async def stop_after_one_cycle(_seconds: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", stop_after_one_cycle)
    with pytest.raises(asyncio.CancelledError):
        await worker.poll_due_work()

    beat: dict[str, Any] = json.loads(redis.values["wodana:worker:heartbeat"])
    assert beat["consumer"] == "worker-7"
    age = datetime.now(timezone.utc) - datetime.fromisoformat(beat["at"])
    assert age.total_seconds() < 5


@pytest.mark.asyncio
async def test_a_heartbeat_failure_never_stops_the_worker() -> None:
    worker = CrmWorker(
        FakeStreamRedis(), FakeDueWorkCore(), DeterministicTestAdapter(), "g", "w"  # type: ignore[arg-type]
    )
    await worker.beat()
