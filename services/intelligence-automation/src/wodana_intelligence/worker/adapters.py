from hashlib import sha256
from typing import Any, Protocol
from uuid import UUID

from wodana_intelligence.integrations.business_core import BusinessCoreClient, BusinessCoreError
from wodana_intelligence.integrations.google_actions import execute_google
from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.provider_models import OperationRequest
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.worker.models import DeliveryJob, DeliveryResult


class NotificationAdapter(Protocol):
    async def deliver(self, job: DeliveryJob) -> DeliveryResult: ...


class DeterministicTestAdapter:
    def __init__(self, provider: str = "deterministic-test") -> None:
        self.provider = provider

    async def deliver(self, job: DeliveryJob) -> DeliveryResult:
        message_id = sha256(f"{job.id}:{job.channel}".encode()).hexdigest()[:24]
        return DeliveryResult(
            result="delivered", provider=self.provider, provider_message_id=message_id
        )


class UnconfiguredAdapter:
    async def deliver(self, job: DeliveryJob) -> DeliveryResult:
        return DeliveryResult(
            result="permanent_failure",
            provider="unconfigured",
            error_code=f"{job.channel.upper()}_PROVIDER_UNCONFIGURED",
            error_message=f"No live {job.channel} provider is configured",
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
                if job.template_code:
                    payload.update(
                        {
                            "templateName": job.template_code,
                            "language": (job.locale or "en_US").replace("-", "_"),
                        }
                    )
                else:
                    payload["text"] = job.body
                result = await self.providers.send_whatsapp_notification(
                    str(job.workspace_id),
                    OperationRequest(
                        action="message.send", idempotency_key=job.id, payload=payload
                    ),
                )
                return DeliveryResult(
                    result="delivered",
                    provider="whatsapp",
                    provider_message_id=str(result["id"]),
                )
            return DeliveryResult(
                result="permanent_failure",
                provider="unconfigured",
                error_code=f"{job.channel.upper()}_PROVIDER_UNCONFIGURED",
                error_message=f"No live {job.channel} provider is configured",
            )
        except (BusinessCoreError, IntegrationFlowError) as error:
            status = getattr(error, "status_code", 502)
            return DeliveryResult(
                result="retry" if status == 429 or status >= 500 else "permanent_failure",
                provider="google_workspace" if job.channel == "email" else job.channel,
                error_code=getattr(error, "code", "PROVIDER_DELIVERY_FAILED"),
                error_message=str(error)[:1000],
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
