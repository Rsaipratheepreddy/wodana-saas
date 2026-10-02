from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GoogleAccessMode(str, Enum):
    AVAILABILITY = "availability"
    READ = "read"
    MANAGE = "manage"


class OAuthStartRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    version: int = Field(ge=1)
    access_mode: GoogleAccessMode = GoogleAccessMode.MANAGE
    gmail_send: bool = False
    drive_files: bool = False
    return_origin: str = Field(default="", max_length=200)


class OAuthStartResponse(ApiModel):
    authorization_url: str
    expires_in_seconds: int
    connection_version: int


class OAuthState(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    return_origin: str = ""
    expected_version: int = Field(ge=1)
    expected_domain: str
    expected_email: Optional[str] = None
    code_verifier: str
    access_mode: GoogleAccessMode
    requested_scopes: list[str]
    issued_at: datetime


class StoredGoogleCredential(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    scopes: list[str]
    expires_at: datetime
    account_email: str


class CalendarResource(ApiModel):
    resource_id: Optional[UUID] = None
    external_id: str
    display_name: str
    primary: bool = False
    access_role: str
    time_zone: Optional[str] = None
    enabled: bool = False
    direction: str = "inbound"


class CalendarListResponse(ApiModel):
    connection_id: UUID
    connection_version: int
    calendars: list[CalendarResource]


class AvailabilityRequest(ApiModel):
    workspace_id: UUID
    connection_ids: list[UUID] = Field(min_length=1, max_length=10)
    time_min: datetime
    time_max: datetime
    time_zone: str = "UTC"

    @field_validator("connection_ids")
    @classmethod
    def unique_connections(cls, values: list[UUID]) -> list[UUID]:
        if len(set(values)) != len(values):
            raise ValueError("connectionIds must be unique")
        return values

    @field_validator("time_min", "time_max")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("A timezone offset is required")
        return value

    @field_validator("time_zone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("timeZone must be a valid IANA timezone") from error
        return value

    @model_validator(mode="after")
    def valid_window(self) -> "AvailabilityRequest":
        if self.time_max <= self.time_min:
            raise ValueError("timeMax must be after timeMin")
        if self.time_max - self.time_min > timedelta(days=31):
            raise ValueError("Availability windows cannot exceed 31 days")
        return self


class BusyInterval(ApiModel):
    start: datetime
    end: datetime


class CalendarAvailability(ApiModel):
    connection_id: UUID
    calendar_id: str
    display_name: str
    busy: list[BusyInterval]
    errors: list[str] = Field(default_factory=list)


class AvailabilityResponse(ApiModel):
    time_min: datetime
    time_max: datetime
    time_zone: str
    complete: bool
    busy: list[BusyInterval]
    calendars: list[CalendarAvailability]


class GoogleSendUpdates(str, Enum):
    ALL = "all"
    EXTERNAL_ONLY = "externalOnly"
    NONE = "none"


class CreateCalendarEventRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    calendar_id: str = Field(min_length=1, max_length=500)
    idempotency_key: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    summary: str = Field(min_length=1, max_length=300)
    description: Optional[str] = Field(default=None, max_length=8000)
    location: Optional[str] = Field(default=None, max_length=500)
    start: datetime
    end: datetime
    time_zone: str = "UTC"
    attendee_emails: list[str] = Field(default_factory=list, max_length=100)
    send_updates: GoogleSendUpdates = GoogleSendUpdates.ALL

    @field_validator("start", "end")
    @classmethod
    def event_timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("A timezone offset is required")
        return value

    @field_validator("time_zone")
    @classmethod
    def event_timezone_valid(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("timeZone must be a valid IANA timezone") from error
        return value

    @field_validator("attendee_emails")
    @classmethod
    def attendee_emails_valid(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("attendeeEmails must be unique")
        for email in normalized:
            local, separator, domain = email.rpartition("@")
            if not separator or not local or "." not in domain or " " in email:
                raise ValueError("attendeeEmails contains an invalid email")
        return normalized

    @model_validator(mode="after")
    def event_window_valid(self) -> "CreateCalendarEventRequest":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > timedelta(days=31):
            raise ValueError("An event cannot span more than 31 days")
        return self


class UpdateCalendarEventRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    calendar_id: str = Field(min_length=1, max_length=500)
    etag: str = Field(min_length=1, max_length=500)
    summary: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = Field(default=None, max_length=8000)
    location: Optional[str] = Field(default=None, max_length=500)
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    time_zone: Optional[str] = None
    attendee_emails: Optional[list[str]] = Field(default=None, max_length=100)
    send_updates: GoogleSendUpdates = GoogleSendUpdates.ALL

    @model_validator(mode="after")
    def update_valid(self) -> "UpdateCalendarEventRequest":
        editable_fields = {
            "summary",
            "description",
            "location",
            "start",
            "end",
            "attendee_emails",
        }
        if not self.model_fields_set.intersection(editable_fields):
            raise ValueError("At least one event field must be updated")
        start_present = "start" in self.model_fields_set
        end_present = "end" in self.model_fields_set
        if start_present != end_present:
            raise ValueError("start and end must be updated together")
        if start_present and end_present:
            if self.start is None or self.end is None:
                raise ValueError("start and end cannot be null")
            if self.start.tzinfo is None or self.end.tzinfo is None:
                raise ValueError("A timezone offset is required")
            if self.end <= self.start:
                raise ValueError("end must be after start")
        if "time_zone" in self.model_fields_set and not start_present:
            raise ValueError("timeZone can only be changed with start and end")
        if self.time_zone:
            try:
                ZoneInfo(self.time_zone)
            except ZoneInfoNotFoundError as error:
                raise ValueError("timeZone must be a valid IANA timezone") from error
        if self.attendee_emails is not None:
            self.attendee_emails = CreateCalendarEventRequest.attendee_emails_valid(
                self.attendee_emails
            )
        return self


class CancelCalendarEventRequest(ApiModel):
    workspace_id: UUID
    connection_id: UUID
    calendar_id: str = Field(min_length=1, max_length=500)
    etag: str = Field(min_length=1, max_length=500)
    send_updates: GoogleSendUpdates = GoogleSendUpdates.ALL


class CalendarEventResponse(ApiModel):
    connection_id: UUID
    calendar_id: str
    event_id: str
    etag: str
    status: str
    summary: Optional[str] = None
    html_link: Optional[str] = None
    start: dict[str, Any] = Field(default_factory=dict)
    end: dict[str, Any] = Field(default_factory=dict)


class GoogleCalendarEntry(ApiModel):
    id: str
    summary: str
    primary: bool = False
    access_role: str = "reader"
    time_zone: Optional[str] = None


class GoogleUserInfo(ApiModel):
    email: str
    email_verified: bool


class GoogleTokenResponse(ApiModel):
    access_token: str
    expires_in: int = Field(gt=0)
    refresh_token: Optional[str] = None
    scope: str = ""
    token_type: str = "Bearer"


class RuntimeResource(ApiModel):
    id: UUID
    external_id: str
    display_name: str
    enabled: bool
    direction: str
    configuration: dict[str, Any] = Field(default_factory=dict)


class RuntimeConnection(ApiModel):
    id: UUID
    workspace_id: UUID
    provider: str
    external_account_id: Optional[str] = None
    external_domain: Optional[str] = None
    status: str
    granted_scopes: list[str] = Field(default_factory=list)
    secret_reference: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    version: int
    resources: list[RuntimeResource] = Field(default_factory=list)
