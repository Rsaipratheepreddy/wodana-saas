"""DELIVERY_ALLOWLIST: in local and UAT, nothing leaves for a recipient who isn't on the list."""

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
import pytest
from test_google_integration_service import build_service
from test_providers import CONNECTION, HEADERS, WORKSPACE, connect_fake
from test_providers import service as provider_service

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.delivery_allowlist import NOT_ALLOWLISTED, DeliveryAllowlist
from wodana_intelligence.integrations.google_actions import execute_google
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.models import GoogleAccessMode, OAuthStartRequest
from wodana_intelligence.integrations.provider_models import OperationRequest
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.worker.adapters import ConnectedProviderAdapter
from wodana_intelligence.worker.models import DeliveryJob

LIST = "qa@palm.test, *@wodana.invalid, +971500000001"


def guarded(instance: ProviderService, allowlist: str = LIST) -> ProviderService:
    instance.settings = instance.settings.model_copy(update={"delivery_allowlist": allowlist})
    return instance


def whatsapp(to: str) -> OperationRequest:
    return OperationRequest(
        action="message.send",
        idempotency_key=uuid4(),
        payload={"to": to, "text": "Your quote is ready", "optInConfirmed": True},
    )


def test_unset_means_no_guard_and_the_list_matches_emails_domains_and_numbers() -> None:
    assert not DeliveryAllowlist.parse("").enabled
    assert DeliveryAllowlist.parse(None).allows_email("owner@real-company.example")
    allowlist = DeliveryAllowlist.parse(LIST)
    assert allowlist.allows_email("QA@palm.test")
    assert allowlist.allows_email("anyone@wodana.invalid")
    assert not allowlist.allows_email("owner@real-company.example")
    assert not allowlist.allows_email("qa@palm.test.evil.example")
    assert allowlist.allows_phone("+971 50 000 0001")
    assert allowlist.allows_phone("971500000001")
    assert not allowlist.allows_phone("+971509999999")
    assert not allowlist.allows_phone(None)


def test_a_malformed_entry_is_refused_not_ignored() -> None:
    with pytest.raises(ValueError, match="E.164"):
        DeliveryAllowlist.parse("qa@palm.test, 0501234567")


def test_production_refuses_the_guard_and_uat_accepts_it() -> None:
    with pytest.raises(ValueError, match="remove it in production"):
        Settings(environment="production", delivery_allowlist=LIST).validate_delivery_settings()
    Settings(environment="uat", delivery_allowlist=LIST).validate_delivery_settings()
    Settings(environment="production", delivery_allowlist="").validate_delivery_settings()


@pytest.mark.asyncio
async def test_whatsapp_to_an_unlisted_number_never_reaches_meta_or_reserves_the_request() -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"messages": [{"id": "wamid.1"}]})

    instance, core, redis = provider_service(handler, "whatsapp")
    await connect_fake(instance, core, redis, "whatsapp")
    guarded(instance)
    blocked = whatsapp("+971509999999")
    with pytest.raises(IntegrationFlowError) as refused:
        await instance.execute(WORKSPACE, CONNECTION, blocked, HEADERS)
    assert refused.value.code == NOT_ALLOWLISTED
    with pytest.raises(IntegrationFlowError, match="DELIVERY_ALLOWLIST"):
        await instance.send_whatsapp_notification(WORKSPACE, whatsapp("+971509999999"))
    assert sent == []
    assert not any("provider-operation" in key for key in redis.values)

    result = await instance.execute(WORKSPACE, CONNECTION, whatsapp("+971500000001"), HEADERS)
    assert result == {"id": "wamid.1", "status": "accepted"}
    assert len(sent) == 1


@pytest.mark.asyncio
async def test_the_worker_reports_a_refused_delivery_as_not_allowlisted() -> None:
    instance, _, _ = provider_service(lambda _: httpx.Response(500), "whatsapp")
    adapter = ConnectedProviderAdapter(object(), object(), guarded(instance))  # type: ignore[arg-type]
    job = DeliveryJob.model_validate({
        "id": str(uuid4()), "workspaceId": WORKSPACE, "attempt": 1, "channel": "whatsapp",
        "body": "Your quote is ready", "destination": {"normalizedValue": "+971509999999"},
    })
    result = await adapter.deliver(job)
    assert result.result == "permanent_failure"
    assert result.error_code == NOT_ALLOWLISTED


@pytest.mark.asyncio
async def test_gmail_send_to_an_unlisted_address_never_reaches_google() -> None:
    google, _, _, _ = build_service()
    workspace, connection = uuid4(), uuid4()
    started = await google.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace, connection_id=connection, version=1,
            access_mode=GoogleAccessMode.MANAGE, gmail_send=True, drive_files=True,
        ),
        {"authorization": "Bearer session"},
    )
    await google.complete_oauth(
        parse_qs(urlparse(started.authorization_url).query)["state"][0], "authorization-code", None
    )
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"id": "gmail-1"})

    providers, _, _ = provider_service(handler)
    guarded(providers)

    def mail(to: str) -> OperationRequest:
        return OperationRequest(
            action="email.send", idempotency_key=uuid4(),
            payload={"to": to, "subject": "Quote", "body": "Hello"},
        )

    with pytest.raises(IntegrationFlowError) as refused:
        await execute_google(
            google, providers, providers.client, workspace, connection,
            mail("owner@real-company.example"), {"authorization": "Bearer session"},
        )
    assert refused.value.code == NOT_ALLOWLISTED
    assert sent == []
    result = await execute_google(
        google, providers, providers.client, workspace, connection,
        mail("qa@palm.test"), {"authorization": "Bearer session"},
    )
    assert result["id"] == "gmail-1"
