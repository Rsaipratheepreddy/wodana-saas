import base64
import json
from email import message_from_bytes
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
import pytest
from test_google_integration_service import build_service
from test_providers import service as provider_service

from wodana_intelligence.integrations.google_actions import execute_google
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.models import GoogleAccessMode, OAuthStartRequest
from wodana_intelligence.integrations.provider_models import OperationRequest


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["email.send", "document.create"])
async def test_google_actions_use_granted_account_and_do_not_repeat_after_retry(
    action: str,
) -> None:
    google, _, core, _ = build_service()
    workspace, connection = uuid4(), uuid4()
    headers = {"authorization": "Bearer session"}
    started = await google.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace,
            connection_id=connection,
            version=1,
            access_mode=GoogleAccessMode.MANAGE,
            gmail_send=True,
            drive_files=True,
        ),
        headers,
    )
    state = parse_qs(urlparse(started.authorization_url).query)["state"][0]
    await google.complete_oauth(state, "authorization-code", None)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer access"
        if action == "email.send":
            assert request.url.host == "gmail.googleapis.com"
            mail = message_from_bytes(base64.urlsafe_b64decode(json.loads(request.content)["raw"]))
            assert mail["From"] == "operations@palmlivingae.com"
            assert mail["To"] == "recipient@example.com"
        else:
            assert request.url.host == "www.googleapis.com"
            assert request.headers["Content-Type"].startswith("multipart/related")
            assert b'"parents": ["chosen-folder"]' in request.content
            assert b"permissions" not in request.content
        return httpx.Response(200, json={"id": "provider-result"})

    providers, _, _ = provider_service(handler)
    payload = {"to": "recipient@example.com", "subject": "Test", "body": "Hello"}
    if action == "document.create":
        payload = {"name": "Test notes", "content": "Private notes", "folderId": "chosen-folder"}
    operation = OperationRequest(action=action, idempotency_key=uuid4(), payload=payload)
    result = await execute_google(
        google, providers, providers.client, workspace, connection, operation, headers
    )
    assert result["id"] == "provider-result"
    assert result == await execute_google(
        google, providers, providers.client, workspace, connection, operation, headers
    )
    assert len(calls) == 1
    assert core.activities


@pytest.mark.asyncio
async def test_google_rejects_ungranted_gmail_send_before_provider_request() -> None:
    from test_google_integration_service import connect

    google, _, _, _ = build_service()
    workspace, connection = uuid4(), uuid4()
    await connect(google, workspace, connection)

    def unexpected(_: httpx.Request) -> httpx.Response:
        raise AssertionError("Must not send mail without the grant")

    providers, _, _ = provider_service(unexpected)
    with pytest.raises(IntegrationFlowError, match="enable this capability"):
        await execute_google(
            google,
            providers,
            providers.client,
            workspace,
            connection,
            OperationRequest(
                action="email.send",
                idempotency_key=uuid4(),
                payload={"to": "a@example.com", "subject": "x", "body": "x"},
            ),
            {"authorization": "Bearer session"},
        )
