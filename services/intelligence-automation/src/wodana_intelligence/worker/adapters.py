from hashlib import sha256
from typing import Any, Protocol
from uuid import UUID

import httpx

from wodana_intelligence.integrations.business_core import BusinessCoreClient, BusinessCoreError
from wodana_intelligence.integrations.google_actions import execute_google
from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.provider_models import OperationRequest
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.worker.models import DeliveryJob, DeliveryResult, PushReceiptJob

# The most Wodana keeps of one chat file (Business Core's ATTACHMENT_MAX_BYTES).
MEDIA_MAX_BYTES = 20 * 1024 * 1024


class NotificationAdapter(Protocol):
    async def deliver(self, job: DeliveryJob) -> DeliveryResult: ...
    async def verify_push(self, receipt: PushReceiptJob) -> DeliveryResult: ...


class MediaUnavailable(RuntimeError):
    """No provider can hand over a client's file here (test or unconfigured): not retried."""

    code = "provider_unconfigured"
    status_code = 409


class DeterministicTestAdapter:
    def __init__(self, provider: str = "deterministic-test") -> None:
        self.provider = provider

    async def download_whatsapp_media(
        self, workspace_id: str, connection_id: str | None, media_id: str
    ) -> tuple[bytes, str]:
        raise MediaUnavailable("Test delivery never fetches files from WhatsApp")

    async def deliver(self, job: DeliveryJob) -> DeliveryResult:
        message_id = sha256(f"{job.id}:{job.channel}".encode()).hexdigest()[:24]
        return DeliveryResult(
            result="delivered", provider=self.provider, provider_message_id=message_id
        )

    async def verify_push(self, receipt: PushReceiptJob) -> DeliveryResult:
        return DeliveryResult(
            result="delivered", provider=self.provider,
            provider_message_id=receipt.provider_message_id,
        )


class UnconfiguredAdapter:
    async def download_whatsapp_media(
        self, workspace_id: str, connection_id: str | None, media_id: str
    ) -> tuple[bytes, str]:
        raise MediaUnavailable("No live WhatsApp provider is configured")

    async def deliver(self, job: DeliveryJob) -> DeliveryResult:
        return DeliveryResult(
            result="permanent_failure",
            provider="unconfigured",
            error_code=f"{job.channel.upper()}_PROVIDER_UNCONFIGURED",
            error_message=f"No live {job.channel} provider is configured",
        )

    async def verify_push(self, receipt: PushReceiptJob) -> DeliveryResult:
        return DeliveryResult(
            result="permanent_failure", provider="unconfigured",
            provider_message_id=receipt.provider_message_id,
            error_code="PUSH_PROVIDER_UNCONFIGURED",
            error_message="No live push provider is configured",
        )


class ConnectedProviderAdapter:
    def __init__(
        self,
        core: BusinessCoreClient,
        google: GoogleIntegrationService,
        providers: ProviderService,
    ) -> None:
        self.core = core
        self.google = google
        self.providers = providers

    async def whatsapp_templates(self, workspace_id: str) -> list[dict[str, Any]]:
        return await self.providers.whatsapp_templates_internal(workspace_id)

    async def whatsapp_health(self, workspace_id: str) -> dict[str, Any]:
        return await self.providers.whatsapp_health_internal(workspace_id)

    async def submit_whatsapp_template(
        self, workspace_id: str, template: dict[str, Any]
    ) -> dict[str, Any]:
        return await self.providers.submit_whatsapp_template_internal(workspace_id, template)

    async def download_whatsapp_media(
        self, workspace_id: str, connection_id: str | None, media_id: str
    ) -> tuple[bytes, str]:
        """A client's file from WhatsApp, on the number it arrived at, up to what Wodana keeps."""
        return await self.providers.whatsapp_media_internal(
            workspace_id, connection_id, media_id, MEDIA_MAX_BYTES
        )

    async def deliver(self, job: DeliveryJob) -> DeliveryResult:
        try:
            destination = job.destination or {}
            if job.channel == "email":
                address = str(destination.get("email") or destination.get("value") or "")
                runtime = await self.core.provider_runtime(
                    str(job.workspace_id), "google_workspace"
                )
                result = await execute_google(
                    self.google,
                    self.providers,
                    self.providers.client,
                    job.workspace_id,
                    UUID(str(runtime["id"])),
                    OperationRequest(
                        action="email.send",
                        idempotency_key=job.id,
                        payload={
                            "to": address,
                            "subject": job.subject or "Wodana message",
                            "body": job.body,
                        },
                    ),
                    {},
                    authorize=False,
                )
                return DeliveryResult(
                    result="delivered",
                    provider="google_workspace",
                    provider_message_id=str(result["id"]),
                )
            if job.channel == "whatsapp":
                phone = str(
                    destination.get("normalizedValue")
                    or destination.get("value")
                    or destination.get("phone")
                    or ""
                )
                payload: dict[str, Any] = {
                    "to": phone,
                    "optInConfirmed": True,
                }
                # The chat's own number when it has one; otherwise the workspace's default number.
                connection = str(job.connection_id) if job.connection_id else None
                upload: tuple[bytes, str, str] | None = None
                if job.media:
                    # A file: its bytes from Business Core, uploaded to WhatsApp on send (inside
                    # the 24-hour window Business Core checked); the message names its media id.
                    body, mime_type = await self.core.attachment_content(
                        str(job.workspace_id), str(job.media.attachment_id)
                    )
                    upload = (body, job.media.mime_type or mime_type, job.media.file_name or "file")
                    payload["mediaType"] = job.media.kind
                    if job.media.caption and job.media.kind != "audio":
                        payload["caption"] = job.media.caption[:1024]
                    if job.media.kind == "document" and job.media.file_name:
                        payload["filename"] = job.media.file_name
                elif job.template_code:
                    payload.update(
                        {
                            "templateName": job.template_code,
                            "language": (job.locale or "en_US").replace("-", "_"),
                            # The values of the template's {{1}}…{{n}}, snapshotted by business-core.
                            "bodyParameters": list(job.template_parameters),
                        }
                    )
                else:
                    payload["text"] = job.body
                result = await self.providers.send_whatsapp_notification(
                    str(job.workspace_id),
                    OperationRequest(
                        action="message.send", idempotency_key=job.id, payload=payload
                    ),
                    connection=connection,
                    upload=upload,
                )
                # Meta accepting a message is not delivery: its status webhook says delivered or read.
                return DeliveryResult(
                    result="accepted",
                    provider="whatsapp",
                    provider_message_id=str(result["id"]),
                )
            if job.channel == "push":
                destination = job.destination or {}
                reference = str(destination.get("tokenReference") or "")
                expected = f"redis:push:{job.workspace_id}:"
                if not reference.startswith(expected):
                    return DeliveryResult(
                        result="permanent_failure", provider="expo",
                        error_code="PUSH_DESTINATION_INVALID",
                        error_message="Push destination is not bound to this workspace",
                    )
                token = await self.providers.redis.get(reference)
                if not token:
                    return DeliveryResult(
                        result="permanent_failure", provider="expo",
                        endpoint_reference=reference,
                        error_code="DeviceNotRegistered",
                        error_message="The registered push token is no longer available",
                    )
                message: dict[str, Any] = {
                    "to": token,
                    "title": job.subject or "Wodana",
                    "body": job.body,
                    "data": {
                        "notificationId": str(job.id),
                        "workspaceId": str(job.workspace_id),
                        "deepLink": job.deep_link,
                    },
                }
                # An approval the phone can decide from the lock screen shows Approve and Open.
                if job.push_category and job.approval:
                    message["categoryId"] = job.push_category
                    message["data"]["approval"] = {
                        "kind": job.approval.kind,
                        "id": str(job.approval.id),
                    }
                response = await self.providers.client.http.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=message,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                if response.status_code == 429 or response.status_code >= 500:
                    return DeliveryResult(
                        result="retry", provider="expo", endpoint_reference=reference,
                        error_code="PUSH_PROVIDER_UNAVAILABLE",
                        error_message="Expo Push Service is temporarily unavailable",
                    )
                if response.is_error:
                    return DeliveryResult(
                        result="permanent_failure", provider="expo",
                        endpoint_reference=reference, error_code="PUSH_REQUEST_REJECTED",
                        error_message="Expo Push Service rejected the request",
                    )
                payload = response.json()
                ticket_data = payload.get("data", {}) if isinstance(payload, dict) else {}
                ticket = ticket_data[0] if isinstance(ticket_data, list) and ticket_data else (
                    ticket_data if isinstance(ticket_data, dict) else {}
                )
                if ticket.get("status") == "ok" and ticket.get("id"):
                    return DeliveryResult(
                        result="accepted", provider="expo",
                        provider_message_id=str(ticket["id"]),
                        endpoint_reference=reference,
                    )
                details = ticket.get("details", {}) if isinstance(ticket, dict) else {}
                code = str(details.get("error") or "PUSH_TICKET_REJECTED")
                return DeliveryResult(
                    result="permanent_failure", provider="expo",
                    endpoint_reference=reference, error_code=code,
                    error_message=str(ticket.get("message") or "Push ticket was rejected")[:1000],
                )
            return DeliveryResult(
                result="permanent_failure",
                provider="unconfigured",
                error_code=f"{job.channel.upper()}_PROVIDER_UNCONFIGURED",
                error_message=f"No live {job.channel} provider is configured",
            )
        except (BusinessCoreError, IntegrationFlowError, httpx.HTTPError, ValueError) as error:
            status = getattr(error, "status_code", 502)
            return DeliveryResult(
                result="retry" if status == 429 or status >= 500 else "permanent_failure",
                provider="google_workspace" if job.channel == "email" else job.channel,
                error_code=getattr(error, "code", "PROVIDER_DELIVERY_FAILED"),
                error_message=str(error)[:1000],
            )

    async def verify_push(self, receipt: PushReceiptJob) -> DeliveryResult:
        try:
            response = await self.providers.client.http.post(
                "https://exp.host/--/api/v2/push/getReceipts",
                json={"ids": [receipt.provider_message_id]},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            if response.status_code == 429 or response.status_code >= 500:
                return DeliveryResult(
                    result="retry", provider="expo",
                    provider_message_id=receipt.provider_message_id,
                    error_code="PUSH_RECEIPT_UNAVAILABLE",
                    error_message="Push receipt verification is temporarily unavailable",
                )
            if response.is_error:
                return DeliveryResult(
                    result="permanent_failure", provider="expo",
                    provider_message_id=receipt.provider_message_id,
                    error_code="PUSH_RECEIPT_REJECTED",
                    error_message="Expo Push Service rejected receipt verification",
                )
            payload = response.json()
            data = payload.get("data", {}) if isinstance(payload, dict) else {}
            value = data.get(receipt.provider_message_id) if isinstance(data, dict) else None
            if not value:
                return DeliveryResult(
                    result="retry", provider="expo",
                    provider_message_id=receipt.provider_message_id,
                    error_code="PUSH_RECEIPT_MISSING",
                    error_message="Push receipt was not available after the verification window",
                )
            if value.get("status") == "ok":
                return DeliveryResult(
                    result="delivered", provider="expo",
                    provider_message_id=receipt.provider_message_id,
                )
            details = value.get("details", {}) if isinstance(value, dict) else {}
            code = str(details.get("error") or "PUSH_DELIVERY_FAILED")
            retryable = code in {"MessageRateExceeded", "ProviderError"}
            return DeliveryResult(
                result="retry" if retryable else "permanent_failure", provider="expo",
                provider_message_id=receipt.provider_message_id, error_code=code,
                error_message=str(value.get("message") or "Push delivery failed")[:1000],
            )
        except Exception as error:
            return DeliveryResult(
                result="retry", provider="expo",
                provider_message_id=receipt.provider_message_id,
                error_code="PUSH_RECEIPT_UNAVAILABLE", error_message=str(error)[:1000],
            )


def notification_adapter(
    mode: str,
    environment: str,
    core: BusinessCoreClient | None = None,
    google: GoogleIntegrationService | None = None,
    providers: ProviderService | None = None,
) -> NotificationAdapter:
    if mode == "test":
        if environment.lower() == "production":
            raise ValueError("Test notification delivery is forbidden in production")
        return DeterministicTestAdapter()
    if mode == "live":
        if not core or not google or not providers:
            raise ValueError("Live notification delivery requires provider services")
        return ConnectedProviderAdapter(core, google, providers)
    return UnconfiguredAdapter()
