"""Wodana's app credentials from Wodana Control: resolver, sealing, checks and endpoints."""

from typing import Any, Optional
from uuid import uuid4

import httpx
import pytest
from fakes import FakeRedis
from fastapi.testclient import TestClient

from wodana_intelligence.config import Settings
from wodana_intelligence.container import get_provider_service
from wodana_intelligence.integrations.platform_checks import PROBE_GRANT, check_platform_credentials
from wodana_intelligence.integrations.platform_credentials import (
    PlatformCredentialResolver,
    PlatformCredentials,
    secret_purpose,
)
from wodana_intelligence.integrations.provider_client import ProviderClient
from wodana_intelligence.integrations.provider_models import ProviderStartRequest
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.integrations.security import InvalidEncryptedSecretError, TokenCipher
from wodana_intelligence.main import app

KEY = "fake-integration-key-for-tests-only-0123456789"
INTERNAL = "fake-internal-token-for-tests"
WORKSPACE, CONNECTION = uuid4(), uuid4()
FAKE_META_SECRET = "fake-meta-secret-0123456789abcdef"


def settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "integrations_encryption_key": KEY,
        "business_core_internal_token": INTERNAL,
        "google_client_id": "env-google-id",
        "google_client_secret": "env-google-secret",
        "google_redirect_uri": "http://localhost:8001/api/v1/integrations/google/oauth/callback",
        "quickbooks_client_id": "",
        "quickbooks_client_secret": "",
        "zoho_client_id": "",
        "zoho_client_secret": "",
        "whatsapp_app_id": "111111",
        "whatsapp_app_secret": "env-meta-secret",
        "whatsapp_config_id": "",
        "whatsapp_webhook_verify_token": "",
        "whatsapp_graph_version": "v23.0",
        **overrides,
    }
    return Settings(**values)


def saved(cipher: TokenCipher, **rows: dict[str, Any]) -> dict[str, Any]:
    """Business Core's runtime payload: the secrets arrive sealed for their own field."""
    providers = []
    for vendor in ("platform", "meta", "intuit", "zoho", "google"):
        row: dict[str, Any] = {"provider": vendor, "version": 1, **rows.get(vendor, {})}
        for field in ("clientSecret", "webhookSecret"):
            if row.get(field):
                row[field] = cipher.seal_value(secret_purpose(vendor, field), row[field])
        providers.append(row)
    return {"providers": providers}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Store:
    def __init__(self, payload: Optional[dict[str, Any]]) -> None:
        self.payload = payload
        self.calls = 0

    async def __call__(self) -> dict[str, Any]:
        self.calls += 1
        if self.payload is None:
            raise RuntimeError("Business Core is unavailable")
        return self.payload


@pytest.mark.asyncio
async def test_saved_values_win_field_by_field_and_env_fills_the_rest() -> None:
    cipher = TokenCipher(KEY)
    store = Store(saved(
        cipher,
        platform={"publicApiBase": "https://api.example.test"},
        meta={"configId": "998877665544", "webhookSecret": "fake-verify-token-000000"},
        zoho={
            "clientId": "1000.FAKEZOHO",
            "clientSecret": "fake-zoho-secret-000000",
            "dataCenter": "in",
        },
        intuit={"environment": "production", "version": 4},
    ))
    current = await PlatformCredentialResolver(settings(), store, cipher).current()
    # Meta: config ID and verify token from Wodana Control, the app ID and secret still from env.
    assert current.whatsapp_config_id == "998877665544"
    assert current.whatsapp_webhook_verify_token == "fake-verify-token-000000"
    assert (current.whatsapp_app_id, current.whatsapp_app_secret) == ("111111", "env-meta-secret")
    assert current.configured("whatsapp")
    assert (current.zoho_client_id, current.zoho_client_secret, current.zoho_region) == (
        "1000.FAKEZOHO", "fake-zoho-secret-000000", "in",
    )
    assert current.quickbooks_environment == "production"
    assert not current.configured("quickbooks")
    # One central callback per provider, built from the public address.
    assert current.google_redirect_uri == (
        "https://api.example.test/api/v1/integrations/google/oauth/callback"
    )
    assert current.zoho_redirect_uri == (
        "https://api.example.test/api/v1/integrations/providers/zoho_books/oauth/callback"
    )
    assert current.quickbooks_redirect_uri == (
        "https://api.example.test/api/v1/integrations/providers/quickbooks/oauth/callback"
    )
    assert current.versions["intuit"] == 4


@pytest.mark.asyncio
async def test_a_change_applies_within_a_minute_without_a_restart() -> None:
    cipher, clock = TokenCipher(KEY), Clock()
    store = Store(saved(cipher, meta={"configId": "123456"}))
    resolver = PlatformCredentialResolver(settings(), store, cipher, clock=clock)
    assert (await resolver.current()).whatsapp_config_id == "123456"
    store.payload = saved(cipher, meta={"configId": "654321"})
    clock.now += 59
    assert (await resolver.current()).whatsapp_config_id == "123456"
    assert store.calls == 1
    clock.now += 2
    assert (await resolver.current()).whatsapp_config_id == "654321"
    # A Test reads what is saved now.
    store.payload = saved(cipher, meta={"configId": "777777"})
    assert (await resolver.refresh()).whatsapp_config_id == "777777"


@pytest.mark.asyncio
async def test_an_outage_keeps_the_last_good_values_then_falls_back_to_env() -> None:
    cipher, clock = TokenCipher(KEY), Clock()
    store = Store(None)
    resolver = PlatformCredentialResolver(settings(), store, cipher, clock=clock)
    assert (await resolver.current()).whatsapp_config_id == ""
    assert (await resolver.current()).google_client_id == "env-google-id"
    assert store.calls == 1
    clock.now += 11
    store.payload = saved(cipher, meta={"configId": "123456"})
    assert (await resolver.current()).whatsapp_config_id == "123456"
    store.payload = None
    clock.now += 61
    assert (await resolver.current()).whatsapp_config_id == "123456"


@pytest.mark.asyncio
async def test_a_secret_sealed_for_another_field_or_key_is_never_used() -> None:
    cipher = TokenCipher(KEY)
    payload = saved(cipher, google={"clientId": "1-abc.apps.googleusercontent.com"})
    google = next(row for row in payload["providers"] if row["provider"] == "google")
    google["clientSecret"] = cipher.seal_value(secret_purpose("meta", "clientSecret"), "stolen")
    meta = next(row for row in payload["providers"] if row["provider"] == "meta")
    meta["clientSecret"] = TokenCipher("another-key-for-tests-0123456789").seal_value(
        secret_purpose("meta", "clientSecret"), "other-key"
    )
    current = await PlatformCredentialResolver(settings(), Store(payload), cipher).current()
    assert current.google_client_secret == "env-google-secret"
    assert current.whatsapp_app_secret == "env-meta-secret"
    with pytest.raises(InvalidEncryptedSecretError):
        cipher.open_value(secret_purpose("google", "clientSecret"), google["clientSecret"])


class Core:
    def __init__(self, provider: str) -> None:
        self.runtime: dict[str, Any] = {"provider": provider, "version": 1, "configuration": {}}

    async def validate_connection(self, *_: Any) -> dict[str, Any]:
        return self.runtime

    async def request_connection(self, *_: Any) -> dict[str, Any]:
        return {**self.runtime, "status": "pending", "version": 2}


def provider_service(
    resolver: PlatformCredentialResolver, provider: str, base: Settings
) -> ProviderService:
    client = ProviderClient(
        base,
        httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("No call"))),
        resolver,
    )
    return ProviderService(base, client, Core(provider), FakeRedis())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_whatsapp_embedded_signup_uses_the_saved_config_id() -> None:
    cipher, base = TokenCipher(KEY), settings()
    store = Store(saved(cipher, meta={
        "clientId": "222222", "clientSecret": FAKE_META_SECRET, "configId": "998877665544",
        "graphVersion": "v24.0",
    }))
    service = provider_service(PlatformCredentialResolver(base, store, cipher), "whatsapp", base)
    started = await service.start(
        "whatsapp",
        ProviderStartRequest(workspace_id=WORKSPACE, connection_id=CONNECTION, version=1),
        {"authorization": "Bearer test"},
    )
    assert started["appId"] == "222222"
    assert started["configId"] == "998877665544"
    assert started["version"] == "v24.0"
    assert FAKE_META_SECRET not in str(started)


@pytest.mark.asyncio
async def test_connect_waits_for_the_app_and_oauth_uses_the_central_callback() -> None:
    cipher, base = TokenCipher(KEY), settings()
    store = Store(saved(cipher))
    resolver = PlatformCredentialResolver(base, store, cipher)
    service = provider_service(resolver, "quickbooks", base)
    request = ProviderStartRequest(workspace_id=WORKSPACE, connection_id=CONNECTION, version=1)
    with pytest.raises(Exception, match="Not available yet"):
        await service.start("quickbooks", request, {"authorization": "Bearer test"})
    store.payload = saved(
        cipher,
        platform={"publicApiBase": "https://api.example.test"},
        intuit={"clientId": "FAKEINTUITID01", "clientSecret": "fake-intuit-secret-0000"},
    )
    await resolver.refresh()
    started = await service.start("quickbooks", request, {"authorization": "Bearer test"})
    url = httpx.URL(started["authorizationUrl"])
    assert url.params["client_id"] == "FAKEINTUITID01"
    assert url.params["redirect_uri"] == (
        "https://api.example.test/api/v1/integrations/providers/quickbooks/oauth/callback"
    )
    assert "fake-intuit-secret" not in str(started)


def recorder(routes: dict[str, httpx.Response]) -> tuple[httpx.AsyncClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        for prefix, response in routes.items():
            if str(request.url).startswith(prefix):
                return response
        pytest.fail(f"Unexpected call {request.method} {request.url.host}{request.url.path}")

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), seen


META = PlatformCredentials(
    whatsapp_app_id="222222", whatsapp_app_secret=FAKE_META_SECRET, whatsapp_config_id="998877"
)


@pytest.mark.asyncio
async def test_meta_check_proves_the_app_and_never_sends_anything() -> None:
    http, seen = recorder({
        "https://graph.facebook.com/v23.0/oauth/access_token": httpx.Response(
            200, json={"access_token": "222222|app-token"}
        ),
        "https://graph.facebook.com/v23.0/debug_token": httpx.Response(
            200, json={"data": {"is_valid": True, "app_id": "222222"}}
        ),
    })
    assert (await check_platform_credentials("meta", META, http)).ok
    assert [request.method for request in seen] == ["GET", "GET"]
    assert all("/messages" not in request.url.path for request in seen)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "body", "reason"),
    [
        (400, {"error": {"code": 1, "message": "Error validating client secret."}}, "rejected"),
        (400, {"error": {"code": 2635, "message": "deprecated version"}}, "graph_version"),
        (503, {}, "unreachable"),
    ],
)
async def test_meta_check_reports_a_reason_code_not_the_provider_text(
    status: int, body: dict[str, Any], reason: str
) -> None:
    http, _ = recorder({"https://graph.facebook.com": httpx.Response(status, json=body)})
    result = await check_platform_credentials("meta", META, http)
    assert (result.ok, result.reason) == (False, reason)


@pytest.mark.asyncio
async def test_meta_check_notices_a_token_for_another_app_and_missing_values() -> None:
    http, _ = recorder({
        "https://graph.facebook.com/v23.0/oauth/access_token": httpx.Response(
            200, json={"access_token": "t"}
        ),
        "https://graph.facebook.com/v23.0/debug_token": httpx.Response(
            200, json={"data": {"is_valid": True, "app_id": "999"}}
        ),
    })
    assert (await check_platform_credentials("meta", META, http)).reason == "app_mismatch"
    missing = META.model_copy(update={"whatsapp_config_id": ""})
    assert (await check_platform_credentials("meta", missing, http)).reason == "not_set"


INTUIT = PlatformCredentials(quickbooks_client_id="FAKEID", quickbooks_client_secret="fake-secret")
INTUIT_DISCOVERY = "https://developer.intuit.com/.well-known/openid_sandbox_configuration"
INTUIT_TOKENS = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "error", "ok", "reason"),
    [
        (400, "invalid_grant", True, None),
        (401, "invalid_client", False, "rejected"),
        (502, "", False, "unreachable"),
    ],
)
async def test_intuit_check_reads_discovery_then_probes_the_token_endpoint(
    status: int, error: str, ok: bool, reason: Optional[str]
) -> None:
    http, seen = recorder({
        INTUIT_DISCOVERY: httpx.Response(200, json={"token_endpoint": INTUIT_TOKENS}),
        INTUIT_TOKENS: httpx.Response(status, json={"error": error} if error else {}),
    })
    result = await check_platform_credentials("intuit", INTUIT, http)
    assert (result.ok, result.reason) == (ok, reason)
    probe = seen[-1]
    assert probe.method == "POST" and PROBE_GRANT in probe.content.decode()


@pytest.mark.asyncio
async def test_intuit_check_refuses_a_token_endpoint_off_intuit() -> None:
    http, _ = recorder({
        INTUIT_DISCOVERY: httpx.Response(200, json={"token_endpoint": "https://evil.test/token"})
    })
    assert (await check_platform_credentials("intuit", INTUIT, http)).reason == (
        "unexpected_response"
    )


@pytest.mark.asyncio
async def test_zoho_check_uses_the_apps_data_center() -> None:
    zoho = PlatformCredentials(
        zoho_client_id="1000.FAKE", zoho_client_secret="fake-secret", zoho_region="eu"
    )
    http, seen = recorder({
        "https://accounts.zoho.eu/oauth/v2/token": httpx.Response(
            200, json={"error": "invalid_code"}
        )
    })
    assert (await check_platform_credentials("zoho", zoho, http)).ok
    assert seen[0].url.host == "accounts.zoho.eu"
    http, _ = recorder({
        "https://accounts.zoho.eu/oauth/v2/token": httpx.Response(
            200, json={"error": "invalid_client"}
        )
    })
    assert (await check_platform_credentials("zoho", zoho, http)).reason == "rejected"


@pytest.mark.asyncio
async def test_google_check_reads_the_well_known_config() -> None:
    google = PlatformCredentials(google_client_id="1-a.apps.googleusercontent.com",
                                 google_client_secret="fake-secret")
    token = "https://oauth2.googleapis.com/token"
    http, _ = recorder({
        "https://accounts.google.com/.well-known/openid-configuration": httpx.Response(
            200, json={"token_endpoint": token}
        ),
        token: httpx.Response(400, json={"error": "invalid_grant"}),
    })
    assert (await check_platform_credentials("google", google, http)).ok
    http, _ = recorder({
        "https://accounts.google.com/.well-known/openid-configuration": httpx.Response(
            200, json={"token_endpoint": token}
        ),
        token: httpx.Response(401, json={"error": "invalid_client"}),
    })
    assert (await check_platform_credentials("google", google, http)).reason == "rejected"


def test_internal_endpoints_need_the_internal_token_and_never_echo_a_secret() -> None:
    cipher, base = TokenCipher(KEY), settings()
    store = Store(saved(cipher, meta={"version": 3}))
    resolver = PlatformCredentialResolver(base, store, cipher)
    graph = {
        "https://graph.facebook.com/v23.0/oauth/access_token": httpx.Response(
            400, json={"error": {"code": 1, "message": FAKE_META_SECRET}}
        ),
    }
    http, _ = recorder(graph)
    service = ProviderService(
        base,
        ProviderClient(base, http, resolver),
        Core("whatsapp"),  # type: ignore[arg-type]
        FakeRedis(),
    )
    app.dependency_overrides[get_provider_service] = lambda: service
    prefix = "/api/v1/integrations/providers/internal/platform-credentials"
    body = {"provider": "meta", "field": "clientSecret", "value": FAKE_META_SECRET}
    try:
        with TestClient(app) as client:
            assert client.post(f"{prefix}/seal", json=body).status_code == 401
            assert client.post(f"{prefix}/meta/test").status_code == 401
            sealed = client.post(
                f"{prefix}/seal", json=body, headers={"x-wodana-internal-token": INTERNAL}
            )
            assert sealed.status_code == 200
            token = sealed.json()["sealed"]
            assert FAKE_META_SECRET not in token
            assert cipher.open_value(secret_purpose("meta", "clientSecret"), token) == (
                FAKE_META_SECRET
            )
            bad = client.post(
                f"{prefix}/seal",
                json={**body, "provider": "google", "field": "webhookSecret"},
                headers={"x-wodana-internal-token": INTERNAL},
            )
            assert bad.status_code == 422
            store.payload = saved(cipher, meta={
                "clientSecret": FAKE_META_SECRET, "configId": "998877", "version": 3
            })
            tested = client.post(
                f"{prefix}/meta/test", headers={"x-wodana-internal-token": INTERNAL}
            )
            assert tested.json() == {"ok": False, "reason": "rejected", "version": 3}
            assert FAKE_META_SECRET not in tested.text
            readiness = client.get("/api/v1/integrations/providers/readiness").json()
            assert readiness == {
                "google_workspace": True,
                "quickbooks": False,
                "zoho_books": False,
                "whatsapp": True,
            }
    finally:
        app.dependency_overrides.clear()
