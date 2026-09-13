import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fakes import FakeRedis
from fastapi.testclient import TestClient

from wodana_intelligence.config import Settings
from wodana_intelligence.container import get_provider_service
from wodana_intelligence.integrations.business_core import BusinessCoreError
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.provider_client import ProviderClient, safe_payment_url
from wodana_intelligence.integrations.provider_models import (
    InvoiceRequest,
    OperationRequest,
    ProviderCredential,
    ProviderStartRequest,
)
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.main import app

WORKSPACE = str(uuid4())
CONNECTION = str(uuid4())
HEADERS = {"authorization": "Bearer test-session"}


class Redis(FakeRedis):
    def __init__(self) -> None:
        super().__init__()
        self.sets: dict[str, set[str]] = {}
        self.lists: dict[str, list[str]] = {}

    async def scan_iter(self, match: str, count: int = 100):
        import fnmatch
        for key in self.values:
            if fnmatch.fnmatch(key, match):
                yield key

    async def sadd(self, key: str, member: str) -> None:
        self.sets.setdefault(key, set()).add(member)

    async def smembers(self, key: str) -> set[str]:
        return self.sets.get(key, set())

    async def srem(self, key: str, member: str) -> None:
        self.sets.get(key, set()).discard(member)

    async def eval(self, script: str, count: int, *args: Any) -> int:
        if count == 2:
            key, inbox, value = args
            if key in self.values:
                return 0
            self.values[key] = "1"
            self.lists.setdefault(inbox, []).insert(0, value)
            return 1
        return await self.delete(args[0])


class Core:
    def __init__(self, provider: str = "quickbooks") -> None:
        self.runtime: dict[str, Any] = {
            "id": CONNECTION,
            "workspaceId": WORKSPACE,
            "provider": provider,
            "status": "connected",
            "configuration": {},
            "version": 1,
            "externalAccountId": "123",
        }
        self.authorizations: list[str] = []
        self.activities: list[Any] = []
        self.receipts: list[dict[str, Any]] = []

    async def validate_connection(
        self, workspace: str, connection: str, headers: Any
    ) -> dict[str, Any]:
        if workspace != WORKSPACE or connection != CONNECTION or not headers:
            raise BusinessCoreError("Forbidden", 403)
        return self.runtime

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        assert f"/workspaces/{WORKSPACE}/" in path
        if not kwargs.get("headers"):
            raise BusinessCoreError("Forbidden", 403)
        self.authorizations.append(kwargs["json"]["access"])
        return self.runtime

    async def runtime_context(self, workspace: str, connection: str) -> dict[str, Any]:
        assert workspace == WORKSPACE and connection == CONNECTION
        return self.runtime

    async def request_connection(
        self, workspace: str, connection: str, version: int, headers: Any
    ) -> dict[str, Any]:
        await self.validate_connection(workspace, connection, headers)
        self.runtime.update(status="pending", version=version + 1)
        return self.runtime

    async def _internal_request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        payload = kwargs["json"]
        if (
            self.runtime["status"] != "pending"
            or payload["expectedVersion"] != self.runtime["version"]
        ):
            raise BusinessCoreError("Stale authorization", 409)
        self.runtime.update(payload, status="connected", version=payload["expectedVersion"] + 1)
        return {"id": CONNECTION, "status": "connected"}

    async def fail_connection(self, connection: str, payload: Any) -> dict[str, Any]:
        if self.runtime["version"] == payload["expectedVersion"]:
            self.runtime["status"] = "degraded"
        return {}

    async def mark_synced(self, *args: Any) -> None:
        pass

    async def record_health(self, *args: Any) -> None:
        self.activities.append(("health", *args))

    async def record_activity(self, *args: Any) -> None:
        self.activities.append(args)

    async def record_provider_receipt(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.receipts.append(payload)
        return {"status": payload["status"]}


def service(handler: Any, provider: str = "quickbooks") -> tuple[ProviderService, Core, Redis]:
    settings = Settings(
        quickbooks_client_id="qbo-id",
        quickbooks_client_secret="qbo-secret",
        zoho_client_id="zoho-id",
        zoho_client_secret="zoho-secret",
        whatsapp_app_id="123",
        whatsapp_app_secret="meta-secret",
        whatsapp_config_id="456",
        whatsapp_webhook_verify_token="verify",
    )
    client = ProviderClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    core, redis = Core(provider), Redis()
    return ProviderService(settings, client, core, redis), core, redis


async def connect_fake(
    instance: ProviderService, core: Core, redis: Redis, provider: str = "quickbooks"
) -> ProviderCredential:
    reference = f"redis:provider:{provider}:{WORKSPACE}:{CONNECTION}:{uuid4()}"
    credential = ProviderCredential(
        provider=provider,
        access_token="access",
        refresh_token="refresh",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        account_id="123",
        configuration={"environment": "sandbox", "phoneNumberId": "789"},
    )
    core.runtime.update(secretReference=reference, configuration=credential.configuration)
    await redis.set(reference, instance.seal(credential.model_dump(mode="json")))
    return credential


def invoice_payload() -> dict[str, Any]:
    return {
        "customerId": "25",
        "date": "2026-09-07",
        "dueDate": "2026-09-21",
        "currency": "AED",
        "reference": "TEST-MILESTONE-1",
        "lines": [
            {"itemId": "9", "description": "Design deposit", "quantity": "1", "rate": "125.50"}
        ],
    }


@pytest.mark.asyncio
async def test_invoice_retries_reuse_result_without_duplicate_charge_or_invoice() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = json.loads(request.content)
        assert body["Line"][0]["Amount"] == 125.50
        assert body["CurrencyRef"]["value"] == "AED"
        assert "sandbox-quickbooks" in request.url.host
        return httpx.Response(200, json={"Invoice": {"Id": "27", "DocNumber": "INV-27"}})

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    operation = OperationRequest(
        action="invoice.create", idempotency_key=uuid4(), payload=invoice_payload()
    )
    first = await instance.execute(WORKSPACE, CONNECTION, operation, HEADERS)
    assert first == await instance.execute(WORKSPACE, CONNECTION, operation, HEADERS)
    assert len(requests) == 1
    assert core.authorizations == ["write", "write"]
    assert requests[0].url.params["requestid"] == str(operation.idempotency_key)
    operation.payload["reference"] = "CHANGED"
    with pytest.raises(IntegrationFlowError, match="different content"):
        await instance.execute(WORKSPACE, CONNECTION, operation, HEADERS)


@pytest.mark.asyncio
async def test_ambiguous_timeout_never_sends_whatsapp_twice() -> None:
    count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        raise httpx.ReadTimeout("timeout", request=request)

    instance, core, redis = service(handler, "whatsapp")
    await connect_fake(instance, core, redis, "whatsapp")
    operation = OperationRequest(
        action="message.send",
        idempotency_key=uuid4(),
        payload={
            "to": "+919000000000",
            "templateName": "payment_reminder",
            "language": "en_US",
            "optInConfirmed": True,
        },
    )
    with pytest.raises(IntegrationFlowError):
        await instance.execute(WORKSPACE, CONNECTION, operation, HEADERS)
    with pytest.raises(IntegrationFlowError, match="Check its records"):
        await instance.execute(WORKSPACE, CONNECTION, operation, HEADERS)
    assert count == 1


@pytest.mark.asyncio
async def test_oauth_state_one_time_and_no_browser_secrets() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "tokens" in request.url.path:
            return httpx.Response(
                200, json={"access_token": "access", "refresh_token": "refresh", "expires_in": 3600}
            )
        return httpx.Response(200, json={"CompanyInfo": {"CompanyName": "Demo company"}})

    instance, core, redis = service(handler)
    started = await instance.start(
        "quickbooks",
        ProviderStartRequest(
            workspace_id=UUID(WORKSPACE), connection_id=UUID(CONNECTION), version=1
        ),
        HEADERS,
    )
    state = httpx.URL(started["authorizationUrl"]).params["state"]
    assert "qbo-secret" not in json.dumps(started)
    result = await instance.complete("quickbooks", state, "code", "", "123")
    assert result == {"id": CONNECTION, "status": "connected"}
    assert all("refresh_token" not in value for value in redis.values.values())
    with pytest.raises(IntegrationFlowError, match="expired"):
        await instance.complete("quickbooks", state, "code", "", "123")


@pytest.mark.asyncio
async def test_cross_tenant_and_wrong_provider_fail_before_oauth() -> None:
    instance, core, _ = service(lambda _: pytest.fail("Provider must not be called"))
    with pytest.raises(BusinessCoreError):
        await instance.start(
            "quickbooks",
            ProviderStartRequest(workspace_id=uuid4(), connection_id=UUID(CONNECTION), version=1),
            HEADERS,
        )
    with pytest.raises(IntegrationFlowError, match="another provider"):
        await instance.start(
            "zoho_books",
            ProviderStartRequest(
                workspace_id=UUID(WORKSPACE), connection_id=UUID(CONNECTION), version=1
            ),
            HEADERS,
        )
    assert core.runtime["status"] == "connected"


@pytest.mark.asyncio
async def test_zoho_uses_selected_region_and_rejects_currency_mismatch() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.host == "www.zohoapis.in"
        assert request.headers["authorization"] == "Zoho-oauthtoken access"
        assert request.url.params["organization_id"] == "123"
        return httpx.Response(200, json={"code": 0, "contact": {"currency_code": "INR"}})

    instance, core, redis = service(handler, "zoho_books")
    credential = await connect_fake(instance, core, redis, "zoho_books")
    credential.region = "in"
    await redis.set(
        core.runtime["secretReference"], instance.seal(credential.model_dump(mode="json"))
    )
    with pytest.raises(IntegrationFlowError, match="different currency"):
        await instance.execute(
            WORKSPACE,
            CONNECTION,
            OperationRequest(
                action="invoice.create", idempotency_key=uuid4(), payload=invoice_payload()
            ),
            HEADERS,
        )
    assert len(seen) == 1 and seen[0].method == "GET"


@pytest.mark.asyncio
async def test_invoice_status_uses_provider_balance_and_returned_link() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["include"] == "invoiceLink"
        return httpx.Response(
            200,
            json={
                "Invoice": {
                    "Id": "27",
                    "Balance": 50,
                    "TotalAmt": 125.5,
                    "InvoiceLink": "https://connect.intuit.com/pay/abc",
                    "CurrencyRef": {"value": "AED"},
                }
            },
        )

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    result = await instance.invoice(WORKSPACE, CONNECTION, "27", HEADERS)
    assert result["balance"] == 50 and result["status"] == "unpaid"
    assert result["paymentUrl"] == "https://connect.intuit.com/pay/abc"


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://intuit.com.evil.test/pay",
        "https://user:password@intuit.com/pay",
        "http://books.zoho.in/pay",
        "https://evil.test/pay",
    ],
)
def test_payment_links_reject_untrusted_destinations(url: str) -> None:
    assert safe_payment_url(url) is None


def test_invoice_rejects_invalid_dates_and_negative_amounts() -> None:
    payload = invoice_payload()
    payload["dueDate"] = "2026-09-01"
    with pytest.raises(ValueError):
        InvoiceRequest.model_validate(payload)
    payload["dueDate"] = "2026-09-21"
    payload["lines"][0]["rate"] = "-1"
    with pytest.raises(ValueError):
        InvoiceRequest.model_validate(payload)


def test_signed_whatsapp_webhook_routes_only_matching_tenant_number_and_deduplicates() -> None:
    instance, core, redis = service(lambda _: pytest.fail("No outbound provider call"), "whatsapp")
    core.runtime["configuration"] = {"phoneNumberId": "789"}
    redis.sets["wodana:provider-routing:whatsapp:123"] = {f"{WORKSPACE}:{CONNECTION}"}
    payload = {
        "entry": [
            {
                "id": "123",
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "789"},
                            "statuses": [{"id": "msg1", "status": "delivered"}],
                        }
                    }
                ],
            }
        ]
    }
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(b"meta-secret", raw, hashlib.sha256).hexdigest()
    app.dependency_overrides[get_provider_service] = lambda: instance
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/v1/integrations/providers/webhooks/whatsapp", content=raw
                ).status_code
                == 401
            )
            for _ in range(2):
                assert (
                    client.post(
                        "/api/v1/integrations/providers/webhooks/whatsapp",
                        content=raw,
                        headers={"x-hub-signature-256": signature},
                    ).status_code
                    == 200
                )
            assert len(redis.lists[f"wodana:provider-events:{WORKSPACE}:{CONNECTION}"]) == 1
            assert (
                "delivered"
                not in redis.lists[f"wodana:provider-events:{WORKSPACE}:{CONNECTION}"][0]
            )
            assert (
                client.get(
                    "/api/v1/integrations/providers/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=12345"
                ).text
                == "12345"
            )
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "pin", "scopes", "expected"),
    [
        ("CONNECTED", None, True, "connected"),
        ("DISCONNECTED", "482915", True, "connected"),
        ("DISCONNECTED", None, True, "whatsapp_registration_required"),
        ("CONNECTED", None, False, "whatsapp_account_mismatch"),
    ],
)
async def test_whatsapp_verifies_scopes_and_sender_registration(
    status: str, pin: str | None, scopes: bool, expected: str
) -> None:
    from wodana_intelligence.integrations.provider_models import WhatsAppCompleteRequest

    registrations: list[Any] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/access_token"):
            return httpx.Response(200, json={"access_token": "private-access"})
        if request.url.path.endswith("/debug_token"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "is_valid": True,
                        "app_id": "123",
                        "scopes": ["whatsapp_business_management", "whatsapp_business_messaging"]
                        if scopes
                        else ["whatsapp_business_management"],
                        "granular_scopes": [
                            {"scope": "whatsapp_business_management", "target_ids": ["123"]}
                        ],
                    }
                },
            )
        if request.url.path.endswith("/phone_numbers"):
            return httpx.Response(200, json={"data": [{"id": "789"}]})
        if request.url.path.endswith("/789"):
            return httpx.Response(200, json={"status": status, "is_on_biz_app": False})
        if request.url.path.endswith("/register"):
            registrations.append(json.loads(request.content))
        return httpx.Response(200, json={"success": True})

    instance, core, redis = service(handler, "whatsapp")
    started = await instance.start(
        "whatsapp",
        ProviderStartRequest(
            workspace_id=UUID(WORKSPACE),
            connection_id=UUID(CONNECTION),
            version=1,
        ),
        HEADERS,
    )
    request = WhatsAppCompleteRequest(
        workspace_id=UUID(WORKSPACE),
        connection_id=UUID(CONNECTION),
        state=started["state"],
        code="auth-code",
        waba_id="123",
        phone_number_id="789",
        registration_pin=pin,
    )
    if expected == "connected":
        result = await instance.complete_whatsapp(request, HEADERS)
        assert result["status"] == "connected"
        token = instance.open(await redis.get(core.runtime["secretReference"]))
        assert "registration_pin" not in str(token) and "482915" not in str(token)
        assert len(registrations) == (1 if pin else 0)
        if pin:
            assert registrations == [{"messaging_product": "whatsapp", "pin": pin}]
    else:
        with pytest.raises(IntegrationFlowError) as error:
            await instance.complete_whatsapp(request, HEADERS)
        assert error.value.code == expected
        assert core.runtime["status"] != "connected"
        assert registrations == []


@pytest.mark.asyncio
async def test_webhook_route_recovers_from_active_connection_without_reading_credentials():
    instance, core, redis = service(lambda _: pytest.fail("No outbound provider call"), "whatsapp")
    reference = f"redis:provider:whatsapp:{WORKSPACE}:{CONNECTION}:credential"
    core.runtime["secretReference"] = reference
    redis.values[reference] = "never decrypt this to route a webhook"
    assert await instance.webhook_routes("whatsapp", "123") == {f"{WORKSPACE}:{CONNECTION}"}
    assert redis.sets["wodana:provider-routing:whatsapp:123"] == {f"{WORKSPACE}:{CONNECTION}"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [{"status": "revoked"}, {"externalAccountId": "other"}, {"secretReference": "other"}],
)
async def test_webhook_route_rejects_revoked_wrong_account_and_stale_credentials(change):
    instance, core, redis = service(lambda _: pytest.fail("No outbound provider call"), "whatsapp")
    reference = f"redis:provider:whatsapp:{WORKSPACE}:{CONNECTION}:credential"
    core.runtime["secretReference"] = reference
    core.runtime.update(change)
    redis.values[reference] = "sealed"
    with pytest.raises(IntegrationFlowError) as error:
        await instance.webhook_routes("whatsapp", "123")
    assert error.value.status_code == 503
    assert not redis.sets
