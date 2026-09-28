from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DomainEventV1(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = Field(alias="schemaVersion")
    event_id: UUID = Field(alias="eventId")
    workspace_id: UUID = Field(alias="workspaceId")
    aggregate_type: str = Field(alias="aggregateType", min_length=1, max_length=80)
    aggregate_id: UUID = Field(alias="aggregateId")
    actor_user_id: Optional[UUID] = Field(alias="actorUserId")
    occurred_at: datetime = Field(alias="occurredAt")
    correlation_id: UUID = Field(alias="correlationId")
    causation_id: Optional[UUID] = Field(alias="causationId")
    data: dict[str, Any]


class DeliveryJob(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    workspace_id: UUID = Field(alias="workspaceId")
    attempt: int = Field(ge=1)
    channel: Literal["email", "whatsapp", "push", "webhook"]
    subject: Optional[str] = None
    body: str
    destination: Optional[dict[str, Any]] = None
    template_code: Optional[str] = Field(default=None, alias="templateCode")
    template_parameters: list[str] = Field(
        default_factory=list, alias="templateParameters", max_length=20
    )
    locale: Optional[str] = None
    deep_link: Optional[str] = Field(default=None, alias="deepLink")


class DeliveryResult(BaseModel):
    result: Literal["accepted", "delivered", "retry", "permanent_failure"]
    provider: str
    provider_message_id: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    endpoint_reference: Optional[str] = None


class PushReceiptJob(BaseModel):
    model_config = ConfigDict(extra="ignore")
    notification_id: UUID = Field(alias="notificationId")
    attempt: int = Field(ge=1)
    provider_message_id: str = Field(alias="providerMessageId", min_length=1, max_length=500)
