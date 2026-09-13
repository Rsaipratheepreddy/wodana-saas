from datetime import datetime, timezone
from uuid import uuid4

import pytest
from test_google_integration_service import build_service, connect

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
    assert "attendees" not in result["events"][0]


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
