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
async def test_an_approval_push_shows_approve_and_names_the_row_to_decide() -> None:
    order = "55555555-5555-4555-8555-555555555555"
    http = FakeHttp(FakeResponse({"data": {"status": "ok", "id": "expo-ticket"}}))
    result = await connected(http).deliver(DeliveryJob.model_validate({
        "id": NOTIFICATION_ID, "workspaceId": WORKSPACE_ID, "attempt": 1,
        "channel": "push", "subject": "PO-0042 needs approval", "body": "Al Noor Timber",
        "destination": {"tokenReference": REFERENCE},
        "deepLink": f"/workspace/purchasing/orders?order={order}",
        "eventType": "purchasing.approval_needed",
        "pushCategory": "approval", "approval": {"kind": "order", "id": order, "version": 5},
    }))
    assert result.result == "accepted"
    sent = http.requests[0][1]["json"]
    assert isinstance(sent, dict)
    assert sent["categoryId"] == "approval"
    assert sent["data"]["approval"] == {"kind": "order", "id": order, "version": 5}


def test_an_unknown_push_category_is_refused() -> None:
    with pytest.raises(ValueError):
        DeliveryJob.model_validate({
            "id": NOTIFICATION_ID, "workspaceId": WORKSPACE_ID, "attempt": 1, "channel": "push",
            "body": "x", "pushCategory": "delete_everything",
            "approval": {"kind": "order", "id": NOTIFICATION_ID, "version": 1},
        })


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


class FakeWhatsApp:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.connections: list[str | None] = []
        self.uploads: list[tuple[bytes, str, str] | None] = []

    async def send_whatsapp_notification(
        self,
        _workspace: str,
        request: object,
        connection: str | None = None,
        upload: tuple[bytes, str, str] | None = None,
    ) -> dict:
        self.requests.append(request.payload)  # type: ignore[attr-defined]
        self.connections.append(connection)
        self.uploads.append(upload)
        return {"id": "wamid.accepted", "status": "accepted"}


class FakeCoreFiles:
    def __init__(self) -> None:
        self.read: list[str] = []

    async def attachment_content(self, _workspace: str, attachment: str) -> tuple[bytes, str]:
        self.read.append(attachment)
        return b"%PDF-1.7 quote", "application/pdf"


@pytest.mark.asyncio
async def test_a_chat_file_goes_from_the_chats_number_uploaded_then_sent_with_its_caption() -> None:
    providers, core = FakeWhatsApp(), FakeCoreFiles()
    adapter = ConnectedProviderAdapter(core, object(), providers)  # type: ignore[arg-type]
    number = "55555555-5555-4555-8555-555555555555"
    result = await adapter.deliver(DeliveryJob.model_validate({
        "id": NOTIFICATION_ID, "workspaceId": WORKSPACE_ID, "attempt": 1, "channel": "whatsapp",
        "body": "Your quote", "destination": {"normalizedValue": "+15551234567"},
        "connectionId": number,
        "media": {"attachmentId": USER_ID, "kind": "document", "mimeType": "application/pdf",
                  "fileName": "Quote V2.pdf", "caption": "Your quote"},
    }))
    assert result.result == "accepted"
    assert core.read == [USER_ID]
    assert providers.connections == [number]
    assert providers.uploads == [(b"%PDF-1.7 quote", "application/pdf", "Quote V2.pdf")]
    assert providers.requests[0] == {
        "to": "+15551234567", "optInConfirmed": True, "mediaType": "document",
        "caption": "Your quote", "filename": "Quote V2.pdf",
    }


@pytest.mark.asyncio
async def test_a_voice_note_has_no_caption_and_a_reply_without_a_number_uses_the_default() -> None:
    providers, core = FakeWhatsApp(), FakeCoreFiles()
    adapter = ConnectedProviderAdapter(core, object(), providers)  # type: ignore[arg-type]
    await adapter.deliver(DeliveryJob.model_validate({
        "id": NOTIFICATION_ID, "workspaceId": WORKSPACE_ID, "attempt": 1, "channel": "whatsapp",
        "body": "voice.ogg", "destination": {"normalizedValue": "+15551234567"},
        "media": {"attachmentId": USER_ID, "kind": "audio", "mimeType": "audio/ogg",
                  "fileName": "voice.ogg", "caption": "ignored"},
    }))
    assert providers.connections == [None]
    assert providers.requests[0] == {
        "to": "+15551234567", "optInConfirmed": True, "mediaType": "audio"
    }


@pytest.mark.asyncio
async def test_test_and_unconfigured_delivery_never_fetch_client_files() -> None:
    for adapter in (DeterministicTestAdapter(), UnconfiguredAdapter()):
        with pytest.raises(RuntimeError) as failure:
            await adapter.download_whatsapp_media(WORKSPACE_ID, None, "123")
        assert getattr(failure.value, "code", None) == "provider_unconfigured"


@pytest.mark.asyncio
async def test_whatsapp_template_sends_its_values_and_is_only_accepted() -> None:
    providers = FakeWhatsApp()
    adapter = ConnectedProviderAdapter(object(), object(), providers)  # type: ignore[arg-type]
    result = await adapter.deliver(DeliveryJob(
        id=UUID(NOTIFICATION_ID), workspaceId=UUID(WORKSPACE_ID), attempt=1,
        channel="whatsapp", body="Hi Noura, quote V2 is ready.",
        destination={"normalizedValue": "+15551234567"},
        templateCode="quote_ready", locale="en_US", templateParameters=["Noura", "V2"],
    ))
    assert result.result == "accepted"
    assert result.provider_message_id == "wamid.accepted"
    assert providers.requests[0]["bodyParameters"] == ["Noura", "V2"]
    assert providers.requests[0]["templateName"] == "quote_ready"
