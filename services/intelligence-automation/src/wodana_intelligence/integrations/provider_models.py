from datetime import date as CalendarDate
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from wodana_intelligence.integrations.models import ApiModel

Provider = Literal["quickbooks", "zoho_books", "whatsapp"]
Region = Literal["us", "in", "eu", "au", "ca", "jp", "sa"]


class ProviderStartRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    version: int = Field(ge=1)


class ProviderState(ProviderStartRequest):
    provider: Provider
    region: Region = "us"
    issued_at: datetime


class ProviderCredential(ApiModel):
    provider: Provider
    access_token: str
    refresh_token: str = ""
    expires_at: Optional[datetime] = None
    scopes: list[str] = Field(default_factory=list)
    account_id: str = ""
    region: Region = "us"
    configuration: dict[str, Any] = Field(default_factory=dict)


class WhatsAppCompleteRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    state: str = Field(min_length=20, max_length=200)
    code: str = Field(min_length=1, max_length=4096)
    waba_id: str = Field(pattern=r"^\d{1,50}$")
    phone_number_id: str = Field(pattern=r"^\d{1,50}$")
    registration_pin: Optional[str] = Field(default=None, pattern=r"^\d{6}$", repr=False)


class InvoiceLine(ApiModel):
    description: str = Field(min_length=1, max_length=2000)
    item_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    rate: Decimal = Field(ge=0, max_digits=14, decimal_places=4)
    tax_id: Optional[str] = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")


class InvoiceRequest(ApiModel):
    customer_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    date: CalendarDate
    due_date: CalendarDate
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    reference: str = Field(min_length=1, max_length=80)
    lines: list[InvoiceLine] = Field(min_length=1, max_length=100)
    online_payment: bool = False

    @field_validator("due_date")
    @classmethod
    def due_after_date(cls, value: CalendarDate, info: Any) -> CalendarDate:
        if "date" in info.data and value < info.data["date"]:
            raise ValueError("Due date cannot precede invoice date")
        return value


class EmailRequest(ApiModel):
    to: str = Field(pattern=r"^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$", max_length=254)
    subject: str = Field(min_length=1, max_length=200, pattern=r"^[^\r\n]+$")
    body: str = Field(min_length=1, max_length=50000)


class WhatsAppMessageRequest(ApiModel):
    to: str = Field(pattern=r"^\+?[1-9]\d{7,14}$")
    text: Optional[str] = Field(default=None, min_length=1, max_length=4096)
    template_name: Optional[str] = Field(default=None, pattern=r"^[a-z0-9_]{1,512}$")
    language: Optional[str] = Field(default=None, pattern=r"^[a-z]{2,3}(?:_[A-Z]{2})?$")
    body_parameters: list[str] = Field(default_factory=list, max_length=20)
    url_parameter: Optional[str] = Field(default=None, max_length=2000)
    # A file: its WhatsApp media type, the id WhatsApp gave it on upload, its caption or name.
    media_type: Optional[Literal["image", "document", "audio", "video"]] = None
    media_id: Optional[str] = Field(default=None, pattern=r"^[\w.-]{1,120}$")
    caption: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    filename: Optional[str] = Field(default=None, min_length=1, max_length=240)
    opt_in_confirmed: bool

    @field_validator("opt_in_confirmed")
    @classmethod
    def requires_opt_in(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Confirm the recipient opted in to WhatsApp messages")
        return value

    @model_validator(mode="after")
    def text_or_template(self) -> "WhatsAppMessageRequest":
        if sum(bool(kind) for kind in (self.text, self.template_name, self.media_type)) != 1:
            raise ValueError("Choose either WhatsApp text, an approved template or a file")
        if self.template_name and not self.language:
            raise ValueError("Template language is required")
        if not self.template_name and (self.body_parameters or self.url_parameter):
            raise ValueError("Template parameters cannot be used with a text message")
        if not self.media_type and (self.media_id or self.caption or self.filename):
            raise ValueError("A caption or file name needs a file")
        if self.media_type == "audio" and self.caption:
            raise ValueError("WhatsApp sends audio without a caption")
        return self


class DriveDocumentRequest(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=500000)
    folder_id: Optional[str] = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,200}$")


class OperationRequest(ApiModel):
    action: Literal["invoice.create", "message.send", "email.send", "document.create"]
    idempotency_key: UUID
    payload: dict[str, Any]
