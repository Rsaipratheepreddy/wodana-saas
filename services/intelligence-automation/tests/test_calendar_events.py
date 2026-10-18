from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

import pytest
from test_google_integration_service import build_service, connect

from wodana_intelligence.integrations.google_client import RECONNECT_REQUIRED, GoogleApiError
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.models import AvailabilityRequest


@pytest.mark.asyncio
async def test_calendar_read_is_selected_only_and_minimizes_event_data() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, _core, _vault = build_service()
    await connect(service, workspace_id, connection_id)
    result = await service.calendar_events(
        AvailabilityRequest(
            workspace_id=workspace_id,
            connection_ids=[connection_id],
            time_min=datetime(2026, 9, 1, tzinfo=timezone.utc),
            time_max=datetime(2026, 9, 30, tzinfo=timezone.utc),
        ),
        {"authorization": "Bearer user-token"},
    )
    assert result["mode"] == "live_read"
    assert len(result["events"]) == 1
    assert result["events"][0]["start"] == {"date": "2026-09-03"}
    # Attendees show who is invited, and nothing more about them.
    for attendee in result["events"][0].get("attendees", []):
        assert set(attendee) <= {"displayName", "email", "responseStatus"}


@pytest.mark.asyncio
async def test_calendar_read_requires_event_consent() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, core, _vault = build_service()
    await connect(service, workspace_id, connection_id)
    assert core.completed is not None
    core.completed["grantedScopes"] = ["https://www.googleapis.com/auth/calendar.events.freebusy"]
    with pytest.raises(IntegrationFlowError) as raised:
        await service.calendar_events(
            AvailabilityRequest(
                workspace_id=workspace_id,
                connection_ids=[connection_id],
                time_min=datetime(2026, 9, 1, tzinfo=timezone.utc),
                time_max=datetime(2026, 9, 30, tzinfo=timezone.utc),
            ),
            {"authorization": "Bearer user-token"},
        )
    assert raised.value.code == "calendar_read_consent_required"


def _request(workspace_id: UUID, *connection_ids: UUID) -> AvailabilityRequest:
    return AvailabilityRequest(
        workspace_id=workspace_id,
        connection_ids=list(connection_ids),
        time_min=datetime(2026, 9, 1, tzinfo=timezone.utc),
        time_max=datetime(2026, 9, 30, tzinfo=timezone.utc),
    )


@pytest.mark.asyncio
async def test_a_revoked_google_token_asks_to_reconnect_and_marks_the_connection() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, google, core, vault = build_service()
    await connect(service, workspace_id, connection_id)
    assert core.completed is not None
    reference = core.completed["secretReference"]
    # The stored access token has expired and Google refuses the refresh (access was revoked).
    stored = await vault.get(reference)
    expired = stored.model_copy(update={"expires_at": datetime(2026, 1, 1, tzinfo=timezone.utc)})
    await vault.put(reference, expired)

    async def revoked(_refresh_token: str) -> None:
        raise GoogleApiError(RECONNECT_REQUIRED, "Reconnect Google in Connections", 409)

    google.refresh_token = revoked  # type: ignore[assignment]
    health: list[tuple[str, bool, Optional[str]]] = []

    async def record_health(
        _connection: str,
        _workspace: str,
        operation: str,
        succeeded: bool,
        error_code: Optional[str] = None,
    ) -> None:
        health.append((operation, succeeded, error_code))

    core.record_health = record_health  # type: ignore[method-assign]
    with pytest.raises(IntegrationFlowError) as raised:
        await service.calendar_events(
            _request(workspace_id, connection_id), {"authorization": "Bearer user-token"}
        )
    assert raised.value.code == RECONNECT_REQUIRED
    assert raised.value.status_code == 409
    assert "revoked" not in str(raised.value).lower()
    assert health == [("google.token.refresh", False, RECONNECT_REQUIRED)]


@pytest.mark.asyncio
async def test_one_failing_google_account_does_not_hide_the_others() -> None:
    workspace_id, good, revoked = uuid4(), uuid4(), uuid4()
    service, _google, _core, _vault = build_service()

    async def connection_events(
        _request: AvailabilityRequest, connection_id: UUID, _headers: Any
    ) -> list[dict[str, Any]]:
        if connection_id == revoked:
            raise IntegrationFlowError(RECONNECT_REQUIRED, "Reconnect Google in Connections", 409)
        return [{"id": "meeting-1", "connectionId": str(connection_id)}]

    service._connection_events = connection_events  # type: ignore[method-assign]
    result = await service.calendar_events(_request(workspace_id, good, revoked), {})
    assert [event["id"] for event in result["events"]] == ["meeting-1"]
    assert result["failures"] == [{"connectionId": str(revoked), "code": RECONNECT_REQUIRED}]
