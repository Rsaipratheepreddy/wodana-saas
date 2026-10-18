from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import pytest
from fakes import FakeBusinessCore, FakeRedis

from wodana_intelligence.integrations.business_core import BusinessCoreError
from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.models import (
    AvailabilityRequest,
    CancelCalendarEventRequest,
    CreateCalendarEventRequest,
    GoogleAccessMode,
    GoogleCalendarEntry,
    GoogleTokenResponse,
    GoogleUserInfo,
    OAuthStartRequest,
    UpdateCalendarEventRequest,
)
from wodana_intelligence.integrations.security import OAuthStateStore, TokenCipher
from wodana_intelligence.integrations.vault import CredentialNotFoundError, RedisCredentialVault


class FakeGoogle:
    client_id = "client-id"
    client_secret = "client-secret"

    def __init__(self, email: str = "operations@palmlivingae.com") -> None:
        self.email = email
        self.requested_scopes: list[str] = []

    async def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    async def authorization_url(
        self,
        state: str,
        code_challenge: str,
        scopes: list[str],
        hosted_domain: Optional[str] = None,
    ) -> str:
        assert code_challenge
        assert hosted_domain == "palmlivingae.com"
        self.requested_scopes = scopes
        return f"https://accounts.google.test/auth?state={state}"

    async def exchange_code(self, code: str, code_verifier: str) -> GoogleTokenResponse:
        assert code == "authorization-code" and code_verifier
        return GoogleTokenResponse(
            access_token="access",
            refresh_token="refresh",
            expires_in=3600,
            scope=" ".join(self.requested_scopes),
        )

    async def user_info(self, access_token: str) -> GoogleUserInfo:
        assert access_token == "access"
        return GoogleUserInfo(email=self.email, email_verified=True)

    async def list_calendars(self, access_token: str) -> list[GoogleCalendarEntry]:
        assert access_token == "access"
        return [
            GoogleCalendarEntry(
                id=self.email,
                summary="Operations",
                primary=True,
                access_role="owner",
                time_zone="Asia/Dubai",
            ),
            GoogleCalendarEntry(
                id="design@palmlivingae.com",
                summary="Design team",
                access_role="writer",
                time_zone="Asia/Dubai",
            ),
        ]

    async def refresh_token(self, refresh_token: str) -> GoogleTokenResponse:
        assert refresh_token == "refresh"
        return GoogleTokenResponse(
            access_token="refreshed",
            expires_in=3600,
            scope=" ".join(self.requested_scopes),
        )

    async def list_events(
        self, access_token: str, calendar_id: str, time_min: str, time_max: str, time_zone: str
    ) -> list[dict[str, Any]]:
        assert access_token == "access"
        assert calendar_id == self.email, "Disabled calendars must never be read"
        return [
            {
                "id": "meeting-1",
                "summary": "Design consultation",
                "start": {"date": "2026-09-03"},
                "end": {"date": "2026-09-04"},
                "attendees": [{"email": "private@example.com"}],
            }
        ]

    async def free_busy(
        self,
        access_token: str,
        calendar_ids: list[str],
        time_min: str,
        time_max: str,
        time_zone: str,
    ) -> dict[str, Any]:
        assert access_token in {"access", "refreshed"}
        assert time_min < time_max and time_zone == "Asia/Dubai"
        return {
            "calendars": {
                calendar_id: {
                    "busy": [
                        {
                            "start": "2026-09-03T08:00:00Z",
                            "end": "2026-09-03T09:00:00Z",
                        },
                        {
                            "start": "2026-09-03T08:30:00Z",
                            "end": "2026-09-03T10:00:00Z",
                        },
                    ]
                }
                for calendar_id in calendar_ids
            }
        }

    async def revoke(self, token: str) -> None:
        assert token == "refresh"

    async def create_event(
        self,
        access_token: str,
        calendar_id: str,
        event: dict[str, Any],
        send_updates: str,
    ) -> dict[str, Any]:
        assert access_token == "access"
        assert calendar_id == self.email
        assert send_updates == "all"
        return {
            **event,
            "etag": '"event-version-1"',
            "status": "confirmed",
            "htmlLink": "https://calendar.google.test/event",
        }

    async def update_event(
        self,
        access_token: str,
        calendar_id: str,
        event_id: str,
        event: dict[str, Any],
        etag: str,
        send_updates: str,
    ) -> dict[str, Any]:
        assert access_token == "access" and etag == '"event-version-1"'
        assert calendar_id == self.email and send_updates == "all"
        return {
            "id": event_id,
            "etag": '"event-version-2"',
            "status": "confirmed",
            **event,
        }

    async def cancel_event(
        self,
        access_token: str,
        calendar_id: str,
        event_id: str,
        etag: str,
        send_updates: str,
    ) -> None:
        assert access_token == "access"
        assert calendar_id == self.email and event_id
        assert etag == '"event-version-2"' and send_updates == "all"


def build_service(
    email: str = "operations@palmlivingae.com",
) -> tuple[GoogleIntegrationService, FakeGoogle, FakeBusinessCore, RedisCredentialVault]:
    redis = FakeRedis()
    google = FakeGoogle(email)
    business_core = FakeBusinessCore()
    vault = RedisCredentialVault(
        redis, TokenCipher("a-strong-local-test-key-that-is-not-production")
    )
    service = GoogleIntegrationService(
        google=google,  # type: ignore[arg-type]
        business_core=business_core,  # type: ignore[arg-type]
        state_store=OAuthStateStore(redis, 600),
        vault=vault,
        state_ttl_seconds=600,
    )
    return service, google, business_core, vault


async def connect(
    service: GoogleIntegrationService,
    workspace_id: UUID,
    connection_id: UUID,
) -> None:
    started = await service.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            version=1,
            access_mode=GoogleAccessMode.MANAGE,
        ),
        {"authorization": "Bearer user-token"},
    )
    state = parse_qs(urlparse(started.authorization_url).query)["state"][0]
    completed = await service.complete_oauth(state, "authorization-code", None)
    assert completed == (workspace_id, connection_id)


@pytest.mark.asyncio
async def test_oauth_connects_exact_domain_and_stores_only_encrypted_credentials() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, google, business_core, vault = build_service()

    await connect(service, workspace_id, connection_id)

    assert business_core.completed is not None
    assert business_core.completed["externalDomain"] == "palmlivingae.com"
    assert business_core.completed["resources"][0]["enabled"] is True
    assert business_core.completed["resources"][1]["enabled"] is False
    reference = business_core.completed["secretReference"]
    assert (await vault.get(reference)).refresh_token == "refresh"
    assert google.requested_scopes


@pytest.mark.asyncio
async def test_oauth_rejects_account_from_wrong_sister_company_domain() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, business_core, _vault = build_service("person@odginteriors.com")
    started = await service.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            version=1,
        ),
        {"authorization": "Bearer user-token"},
    )
    state = parse_qs(urlparse(started.authorization_url).query)["state"][0]

    with pytest.raises(IntegrationFlowError) as raised:
        await service.complete_oauth(state, "authorization-code", None)

    assert raised.value.code == "domain_mismatch"
    assert business_core.failure is not None
    assert business_core.failure["errorCode"] == "domain_mismatch"


@pytest.mark.asyncio
async def test_oauth_removes_saved_token_when_business_core_completion_fails() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, business_core, vault = build_service()

    async def reject_completion(_connection_id: str, _payload: dict[str, Any]) -> dict[str, Any]:
        raise BusinessCoreError("temporary persistence failure", 503)

    business_core.complete_google = reject_completion  # type: ignore[method-assign,assignment]
    started = await service.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            version=1,
        ),
        {"authorization": "Bearer user-token"},
    )
    state = parse_qs(urlparse(started.authorization_url).query)["state"][0]

    with pytest.raises(IntegrationFlowError) as raised:
        await service.complete_oauth(state, "authorization-code", None)

    assert raised.value.code == "business_core_error"
    assert business_core.failure is not None
    reference = vault.reference(str(workspace_id), str(connection_id))
    with pytest.raises(CredentialNotFoundError):
        await vault.get(reference)


@pytest.mark.asyncio
async def test_availability_merges_overlapping_busy_periods() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, business_core, _vault = build_service()
    await connect(service, workspace_id, connection_id)

    assert business_core.completed is not None
    business_core.completed["resources"][1]["enabled"] = True
    response = await service.availability(
        AvailabilityRequest(
            workspace_id=workspace_id,
            connection_ids=[connection_id],
            time_min=datetime(2026, 9, 3, tzinfo=timezone.utc),
            time_max=datetime(2026, 9, 4, tzinfo=timezone.utc),
            time_zone="Asia/Dubai",
        ),
        {"authorization": "Bearer user-token"},
    )

    assert len(response.calendars) == 2
    assert response.complete is True
    assert len(response.busy) == 1
    assert response.busy[0].start == datetime(2026, 9, 3, 8, tzinfo=timezone.utc)
    assert response.busy[0].end == datetime(2026, 9, 3, 10, tzinfo=timezone.utc)
    assert business_core.synced == [str(connection_id)]


@pytest.mark.asyncio
async def test_availability_rejects_a_connection_without_selected_calendars() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, _google, business_core, _vault = build_service()
    await connect(service, workspace_id, connection_id)

    assert business_core.completed is not None
    for resource in business_core.completed["resources"]:
        resource["enabled"] = False

    with pytest.raises(IntegrationFlowError) as raised:
        await service.availability(
            AvailabilityRequest(
                workspace_id=workspace_id,
                connection_ids=[connection_id],
                time_min=datetime(2026, 9, 3, tzinfo=timezone.utc),
                time_max=datetime(2026, 9, 4, tzinfo=timezone.utc),
                time_zone="Asia/Dubai",
            ),
            {"authorization": "Bearer user-token"},
        )

    assert raised.value.code == "no_calendars_selected"


def test_event_update_allows_explicit_clear_but_rejects_orphan_timezone() -> None:
    identifiers = {"workspaceId": str(uuid4()), "connectionId": str(uuid4())}
    cleared = UpdateCalendarEventRequest.model_validate(
        {
            **identifiers,
            "calendarId": "operations@example.com",
            "etag": '"v1"',
            "description": None,
        }
    )
    assert "description" in cleared.model_fields_set

    with pytest.raises(ValueError, match="timeZone can only be changed"):
        UpdateCalendarEventRequest.model_validate(
            {
                **identifiers,
                "calendarId": "operations@example.com",
                "etag": '"v1"',
                "timeZone": "Asia/Dubai",
                "summary": "Unchanged",
            }
        )


@pytest.mark.asyncio
async def test_availability_rejects_more_than_31_days() -> None:
    with pytest.raises(ValueError):
        AvailabilityRequest(
            workspace_id=uuid4(),
            connection_ids=[uuid4()],
            time_min=datetime.now(timezone.utc),
            time_max=datetime.now(timezone.utc) + timedelta(days=32),
            time_zone="UTC",
        )


@pytest.mark.asyncio
async def test_create_update_and_cancel_event_require_selected_writable_calendar() -> None:
    workspace_id, connection_id = uuid4(), uuid4()
    service, google, business_core, _vault = build_service()
    await connect(service, workspace_id, connection_id)

    created = await service.create_event(
        CreateCalendarEventRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            calendar_id=google.email,
            idempotency_key="project-demo-call-1",
            summary="Client design review",
            start=datetime(2026, 9, 3, 8, tzinfo=timezone.utc),
            end=datetime(2026, 9, 3, 9, tzinfo=timezone.utc),
            time_zone="Asia/Dubai",
            attendee_emails=["CLIENT@example.com"],
        ),
        {"authorization": "Bearer user-token"},
    )

    assert created.event_id.startswith("w")
    assert len(created.event_id) == 40
    assert business_core.activities[-1]["action"] == "calendar.event_created"

    updated = await service.update_event(
        created.event_id,
        UpdateCalendarEventRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            calendar_id=google.email,
            etag=created.etag,
            summary="Client technical review",
        ),
        {"authorization": "Bearer user-token"},
    )
    assert updated.etag == '"event-version-2"'
    assert business_core.activities[-1]["action"] == "calendar.event_updated"

    cancelled = await service.cancel_event(
        created.event_id,
        CancelCalendarEventRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            calendar_id=google.email,
            etag=updated.etag,
        ),
        {"authorization": "Bearer user-token"},
    )
    assert cancelled["status"] == "cancelled"
    assert business_core.activities[-1]["action"] == "calendar.event_cancelled"
