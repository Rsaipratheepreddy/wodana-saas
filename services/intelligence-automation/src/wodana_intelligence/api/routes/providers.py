import base64
import hashlib
import hmac
import json
from typing import Annotated, Any, cast
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
from pydantic import BaseModel, Field, ValidationError

from wodana_intelligence.api.routes.google_workspace import actor_headers
from wodana_intelligence.config import get_settings
from wodana_intelligence.container import get_google_integration_service, get_provider_service
from wodana_intelligence.integrations.gmail_sync import sync_gmail
from wodana_intelligence.integrations.google_actions import execute_google
from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.provider_models import (
    OperationRequest,
    Provider,
    ProviderStartRequest,
    WhatsAppCompleteRequest,
)
from wodana_intelligence.integrations.provider_service import ProviderService

router = APIRouter()
Service = Annotated[ProviderService, Depends(get_provider_service)]
Google = Annotated[GoogleIntegrationService, Depends(get_google_integration_service)]


@router.get("/readiness")
async def readiness(service: Service) -> dict[str, Any]:
    return {
        "google_workspace": bool(
            service.settings.google_client_id and service.settings.google_client_secret
        ),
        **{
            provider: service.client.configured(cast(Provider, provider))
            for provider in ("quickbooks", "zoho_books", "whatsapp")
        },
    }


@router.post("/{provider}/oauth/start")
async def start(
    provider: Provider, payload: ProviderStartRequest, request: Request, service: Service
) -> dict[str, Any]:
    return await service.start(provider, payload, actor_headers(request))


@router.get("/{provider}/oauth/callback", include_in_schema=False)
async def callback(
    provider: Provider,
    service: Service,
    state: str = "",
    code: str = "",
    error: str = "",
    realmId: str = "",
) -> RedirectResponse:
    result = "connected"
    error_code = ""
    try:
        if provider == "whatsapp":
            raise IntegrationFlowError("embedded_signup_required", "Use WhatsApp Embedded Signup")
        await service.complete(provider, state, code, error, realmId)
    except Exception as exc:
        result, error_code = (
            "error",
            exc.code if isinstance(exc, IntegrationFlowError) else "oauth_failed",
        )
    query = urlencode({"provider": provider, "integration": result, "code": error_code})
    base = get_settings().web_origin.split(",", 1)[0].rstrip("/")
    return RedirectResponse(
        f"{base}/workspace/integrations?{query}",
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.post("/whatsapp/complete")
async def complete_whatsapp(
    payload: WhatsAppCompleteRequest, request: Request, service: Service
) -> dict[str, Any]:
    return await service.complete_whatsapp(payload, actor_headers(request))


@router.delete("/workspaces/{workspace}/connections/{connection}")
async def disconnect(
    workspace: UUID,
    connection: UUID,
    request: Request,
    service: Service,
    google: Google,
    version: int = Query(ge=1),
) -> dict[str, Any]:
    public = await service.core.validate_connection(
        str(workspace), str(connection), actor_headers(request)
    )
    if public["provider"] == "google_workspace":
        return await google.revoke(workspace, connection, version, actor_headers(request))
    return await service.revoke(str(workspace), str(connection), version, actor_headers(request))


@router.get("/workspaces/{workspace}/connections/{connection}/records/{kind}")
async def records(
    workspace: UUID,
    connection: UUID,
    kind: str,
    request: Request,
    service: Service,
    page: int = Query(default=1, ge=1, le=10000),
) -> dict[str, Any]:
    return await service.records(
        str(workspace), str(connection), kind, page, actor_headers(request)
    )


@router.get("/workspaces/{workspace}/connections/{connection}/invoices/{invoice_id}")
async def invoice(
    workspace: UUID, connection: UUID, invoice_id: str, request: Request, service: Service
) -> dict[str, Any]:
    if not invoice_id.isalnum() or len(invoice_id) > 100:
        raise HTTPException(422, "Invalid invoice identifier")
    return await service.invoice(
        str(workspace), str(connection), invoice_id, actor_headers(request)
    )


@router.get("/workspaces/{workspace}/connections/{connection}/media/{media_id}")
async def media(
    workspace: UUID,
    connection: UUID,
    media_id: str,
    request: Request,
    service: Service,
) -> Response:
    if not media_id.isdigit() or len(media_id) > 80:
        raise HTTPException(422, "Invalid media identifier")
    body, content_type = await service.media(
        str(workspace), str(connection), media_id, actor_headers(request)
    )
    return Response(
        body,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/workspaces/{workspace}/connections/{connection}/operations")
async def execute(
    workspace: UUID,
    connection: UUID,
    payload: OperationRequest,
    request: Request,
    service: Service,
    google: Google,
) -> dict[str, Any]:
    try:
        if payload.action in ("email.send", "document.create"):
            return await execute_google(
                google,
                service,
                service.client,
                workspace,
                connection,
                payload,
                actor_headers(request),
            )
        return await service.execute(
            str(workspace), str(connection), payload, actor_headers(request)
        )
    except ValidationError:
        raise HTTPException(
            422, "Check the required fields, dates, amounts, recipient, and consent"
        ) from None


@router.get("/workspaces/{workspace}/connections/{connection}/events")
async def events(
    workspace: UUID, connection: UUID, request: Request, service: Service
) -> dict[str, Any]:
    await service.core.validate_connection(str(workspace), str(connection), actor_headers(request))
    values = await service.redis.lrange(f"wodana:provider-events:{workspace}:{connection}", 0, 99)
    return {"items": [service.open(value) for value in values]}


@router.post("/workspaces/{workspace}/connections/{connection}/inbox/sync")
async def inbox_sync(
    workspace: UUID,
    connection: UUID,
    request: Request,
    service: Service,
    google: Google,
) -> dict[str, Any]:
    public = await service.core.validate_connection(
        str(workspace), str(connection), actor_headers(request)
    )
    if public.get("provider") != "google_workspace":
        raise HTTPException(422, "Only Google connections can sync an email inbox")
    return await sync_gmail(
        google, service.client, workspace, connection, actor_headers(request)
    )


@router.get("/webhooks/whatsapp", response_class=PlainTextResponse)
async def verify_whatsapp(request: Request, service: Service) -> str:
    query = request.query_params
    expected = service.settings.whatsapp_webhook_verify_token
    if (
        not expected
        or query.get("hub.mode") != "subscribe"
        or not hmac.compare_digest(query.get("hub.verify_token", ""), expected)
    ):
        raise HTTPException(403, "Invalid verification token")
    return query.get("hub.challenge", "")


@router.post("/webhooks/{provider}")
async def webhook(provider: Provider, request: Request, service: Service) -> dict[str, Any]:
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1_000_000:
            raise HTTPException(413, "Webhook exceeds the size limit")
    if provider == "whatsapp":
        secret = service.settings.whatsapp_app_secret
        expected = "sha256=" + hmac.new(secret.encode(), bytes(raw), hashlib.sha256).hexdigest()
        provided = request.headers.get("x-hub-signature-256", "")
    elif provider == "quickbooks":
        secret = service.settings.quickbooks_webhook_verifier
        expected = base64.b64encode(
            hmac.new(secret.encode(), bytes(raw), hashlib.sha256).digest()
        ).decode()
        provided = request.headers.get("intuit-signature", "")
    else:
        raise HTTPException(404, "Zoho balances are refreshed directly from the authenticated API")
    if not secret or not hmac.compare_digest(expected, provided):
        raise HTTPException(401, "Invalid webhook signature")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid webhook body")
    entries = (
        data.get("entry", []) if provider == "whatsapp" else data.get("eventNotifications", [])
    )
    for entry in entries:
        account = str(entry.get("id", "") if provider == "whatsapp" else entry.get("realmId", ""))
        routes = await service.webhook_routes(provider, account)
        for route in routes:
            workspace, connection = route.split(":", 1)
            runtime = await service.core.runtime_context(workspace, connection)
            if (
                runtime["status"] != "connected"
                or runtime["provider"] != provider
                or runtime["externalAccountId"] != account
            ):
                continue
            if provider == "whatsapp":
                # Meta's template review results arrive per account, not per phone number.
                template_updates = [
                    change.get("value", {})
                    for change in entry.get("changes", [])
                    if change.get("field") == "message_template_status_update"
                    and isinstance(change.get("value"), dict)
                ]
                if template_updates:
                    await service.core.whatsapp_templates_synced(
                        workspace,
                        [
                            {
                                "id": str(update.get("message_template_id", "")),
                                "name": str(update.get("message_template_name", "")),
                                "language": str(update.get("message_template_language", "")),
                                "status": str(update.get("event", "PENDING")),
                                "reason": (
                                    str(update.get("reason"))[:500]
                                    if update.get("reason") not in (None, "", "NONE")
                                    else None
                                ),
                            }
                            for update in template_updates
                        ],
                        False,
                    )
                changes = [
                    change
                    for change in entry.get("changes", [])
                    if str(change.get("value", {}).get("metadata", {}).get("phone_number_id", ""))
                    == str(runtime.get("configuration", {}).get("phoneNumberId", ""))
                ]
                if not changes:
                    continue
                for change in changes:
                    value = change.get("value", {})
                    contacts = {
                        str(contact.get("wa_id", "")): str(
                            contact.get("profile", {}).get("name", "")
                        )
                        for contact in value.get("contacts", [])
                        if isinstance(contact, dict)
                    }
                    for message in value.get("messages", []):
                        if not isinstance(message, dict):
                            continue
                        sender = str(message.get("from", ""))
                        message_id = str(message.get("id", ""))
                        if not sender or not message_id:
                            continue
                        kind = str(message.get("type", "unknown"))
                        body = _whatsapp_body(message, kind)
                        await service.core.ingest_provider_message(
                            {
                                "workspaceId": workspace,
                                "channel": "whatsapp",
                                "providerThreadId": sender,
                                "providerMessageId": message_id,
                                "contact": f"+{sender.lstrip('+')}",
                                "displayName": contacts.get(sender) or None,
                                "subject": "WhatsApp conversation",
                                "bodyText": body,
                                "metadata": {
                                    "provider": "whatsapp",
                                    "connectionId": connection,
                                    "messageType": kind,
                                    **_whatsapp_media_metadata(message, kind),
                                },
                            }
                        )
                    for status in value.get("statuses", []):
                        if not isinstance(status, dict) or status.get("status") not in {
                            "sent", "delivered", "read", "failed"
                        }:
                            continue
                        errors = status.get("errors", [])
                        failure = (
                            errors[0].get("code")
                            if errors and isinstance(errors[0], dict)
                            else None
                        )
                        await service.core.record_provider_receipt(
                            {
                                "workspaceId": workspace,
                                "providerMessageId": str(status.get("id", "")),
                                "status": status["status"],
                                "failureCode": str(failure)[:120] if failure is not None else None,
                            }
                        )
                event: dict[str, Any] = {"provider": provider, "changes": changes}
            else:
                event = {
                    "provider": provider,
                    "changes": entry.get("dataChangeEvent", {}),
                    "requiresRefresh": True,
                }
            digest = hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()
            # Atomically deduplicate + persist, so a crash cannot acknowledge a missing inbox event.
            await service.redis.eval(
                "if redis.call('set',KEYS[1],'1','NX','EX',604800) then "
                "redis.call('lpush',KEYS[2],ARGV[1]); redis.call('ltrim',KEYS[2],0,1999); "
                "return 1 else return 0 end",
                2,
                f"wodana:provider-webhook:{workspace}:{connection}:{digest}",
                f"wodana:provider-events:{workspace}:{connection}",
                service.seal(event),
            )
    return {"accepted": True}


def _whatsapp_body(message: dict[str, Any], kind: str) -> str:
    if kind == "text":
        return str(message.get("text", {}).get("body", "")) or "WhatsApp message"
    if kind in {"image", "video", "document"}:
        media = message.get(kind, {})
        return str(media.get("caption") or media.get("filename") or f"{kind.title()} received")
    if kind == "button":
        return str(message.get("button", {}).get("text", "Button response"))
    if kind == "interactive":
        interactive = message.get("interactive", {})
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        return str(reply.get("title") or reply.get("id") or "Interactive response")
    if kind == "location":
        location = message.get("location", {})
        return str(location.get("name") or location.get("address") or "Location received")
    return f"{kind.replace('_', ' ').title()} received"


def _whatsapp_media_metadata(message: dict[str, Any], kind: str) -> dict[str, Any]:
    if kind not in {"audio", "document", "image", "sticker", "video"}:
        return {}
    media = message.get(kind, {})
    return {
        "mediaId": str(media.get("id", "")),
        "mimeType": media.get("mime_type"),
        "fileName": media.get("filename"),
        "sha256": media.get("sha256"),
    }


class PortalOtpDelivery(BaseModel):
    workspaceId: UUID
    challengeId: UUID
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/internal/portal-otp", include_in_schema=False)
async def deliver_portal_otp(
    payload: PortalOtpDelivery, request: Request, service: Service
) -> dict[str, Any]:
    expected = service.settings.business_core_internal_token
    supplied = request.headers.get("x-wodana-internal-token", "")
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(401, "Internal service credentials required")
    if not service.settings.portal_otp_template:
        raise HTTPException(503, "Configure the approved WhatsApp authentication template")
    # The requested authentication code is identical in the body and copy-code button.
    # Operation idempotency survives HTTP retries; no code is returned or logged.
    return await service.send_whatsapp_notification(str(payload.workspaceId), OperationRequest(
        action="message.send", idempotency_key=payload.challengeId, payload={
            "to": payload.phone, "templateName": service.settings.portal_otp_template,
            "language": service.settings.portal_otp_language,
            "bodyParameters": [payload.code], "urlParameter": payload.code,
            "optInConfirmed": True,
        },
    ))
