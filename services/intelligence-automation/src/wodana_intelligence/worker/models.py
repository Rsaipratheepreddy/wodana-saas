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


class DeliveryMedia(BaseModel):
    """A chat message's file: read from Business Core, uploaded to WhatsApp, sent captioned."""

    model_config = ConfigDict(extra="ignore")
    attachment_id: UUID = Field(alias="attachmentId")
    kind: Literal["image", "document", "audio", "video"]
    mime_type: str = Field(alias="mimeType", min_length=3, max_length=160)
    file_name: Optional[str] = Field(default=None, alias="fileName", max_length=240)
    caption: Optional[str] = Field(default=None, max_length=4096)


class PushApproval(BaseModel):
    """The "Waiting for you" row a lock-screen Approve decides, at the version the push names."""

    model_config = ConfigDict(extra="ignore")
    kind: str = Field(min_length=1, max_length=40, pattern=r"^[a-z_]+$")
    id: UUID
    version: int = Field(ge=0)


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
    # A chat reply goes from the number the client wrote to (none: the workspace's default number).
    connection_id: Optional[UUID] = Field(default=None, alias="connectionId")
    media: Optional[DeliveryMedia] = None
    # An approval a phone can decide from its lock screen (X-2): its buttons and the row to decide.
    push_category: Optional[Literal["approval", "approval_send"]] = Field(
        default=None, alias="pushCategory"
    )
    approval: Optional[PushApproval] = None


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
