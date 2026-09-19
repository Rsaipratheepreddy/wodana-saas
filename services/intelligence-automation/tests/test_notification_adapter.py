from types import SimpleNamespace
from uuid import UUID

import pytest

from wodana_intelligence.config import Settings
from wodana_intelligence.worker.adapters import (
    ConnectedProviderAdapter,
    DeterministicTestAdapter,
    UnconfiguredAdapter,
    notification_adapter,
)
from wodana_intelligence.worker.models import DeliveryJob, PushReceiptJob

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
NOTIFICATION_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"
REFERENCE = f"redis:push:{WORKSPACE_ID}:{USER_ID}:44444444-4444-4444-8444-444444444444"


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code
        self.is_error = status_code >= 400

    def json(self) -> dict:
        return self.payload


class FakeHttp:
    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.requests: list[tuple[str, dict]] = []

    async def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.requests.append((url, kwargs))
        return self.responses.pop(0)


class FakeRedis:
    async def get(self, reference: str) -> str | None:
        return "ExpoPushToken[abcdefghijklmnop]" if reference == REFERENCE else None


def connected(http: FakeHttp) -> ConnectedProviderAdapter:
    providers = SimpleNamespace(redis=FakeRedis(), client=SimpleNamespace(http=http))
    return ConnectedProviderAdapter(object(), object(), providers)  # type: ignore[arg-type]


def test_default_does_not_simulate_delivery() -> None:
    settings = Settings(_env_file=None)
    assert settings.notification_adapter_mode == "unconfigured"
    assert isinstance(notification_adapter("unconfigured", "production"), UnconfiguredAdapter)


def test_simulated_delivery_requires_explicit_nonproduction_mode() -> None:
    assert isinstance(notification_adapter("test", "development"), DeterministicTestAdapter)
    with pytest.raises(ValueError, match="forbidden"):
        notification_adapter("test", "production")


@pytest.mark.asyncio
async def test_expo_ticket_is_acceptance_not_delivery() -> None:
    http = FakeHttp(FakeResponse({"data": {"status": "ok", "id": "expo-ticket"}}))
    result = await connected(http).deliver(DeliveryJob(
        id=UUID(NOTIFICATION_ID), workspaceId=UUID(WORKSPACE_ID), attempt=1,
        channel="push", subject="Assigned", body="A lead needs you",
        destination={"tokenReference": REFERENCE}, deepLink="/workspace/crm/leads",
    ))
    assert result.result == "accepted"
    assert result.provider_message_id == "expo-ticket"
    assert result.endpoint_reference == REFERENCE
    sent = http.requests[0][1]["json"]
    assert isinstance(sent, dict)
    assert sent["data"] == {
        "notificationId": NOTIFICATION_ID,
        "workspaceId": WORKSPACE_ID,
        "deepLink": "/workspace/crm/leads",
    }


@pytest.mark.asyncio
async def test_expo_receipt_marks_unregistered_device_terminal() -> None:
    http = FakeHttp(FakeResponse({"data": {"expo-ticket": {
        "status": "error", "message": "Device is not registered",
        "details": {"error": "DeviceNotRegistered"},
    }}}))
    result = await connected(http).verify_push(PushReceiptJob(
        notificationId=UUID(NOTIFICATION_ID), attempt=1, providerMessageId="expo-ticket"
    ))
    assert result.result == "permanent_failure"
    assert result.error_code == "DeviceNotRegistered"


@pytest.mark.asyncio
async def test_oversized_push_is_not_retried() -> None:
    http = FakeHttp(FakeResponse({"data": {"expo-ticket": {
        "status": "error", "message": "Message is too big",
        "details": {"error": "MessageTooBig"},
    }}}))
    result = await connected(http).verify_push(PushReceiptJob(
        notificationId=UUID(NOTIFICATION_ID), attempt=1, providerMessageId="expo-ticket"
    ))
    assert result.result == "permanent_failure"
    assert result.error_code == "MessageTooBig"
