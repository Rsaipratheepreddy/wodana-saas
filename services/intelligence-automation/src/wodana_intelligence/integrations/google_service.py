import hashlib
import json
from collections.abc import Mapping
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from wodana_intelligence.integrations.business_core import BusinessCoreClient, BusinessCoreError
from wodana_intelligence.integrations.google_client import GoogleApiError, GoogleCalendarClient
from wodana_intelligence.integrations.models import (
    AvailabilityRequest,
    AvailabilityResponse,
    BusyInterval,
    CalendarAvailability,
    CalendarEventResponse,
    CalendarListResponse,
    CalendarResource,
    CancelCalendarEventRequest,
    CreateCalendarEventRequest,
    GoogleAccessMode,
    GoogleCalendarEntry,
    OAuthStartRequest,
    OAuthStartResponse,
    OAuthState,
    RuntimeConnection,
    StoredGoogleCredential,
    UpdateCalendarEventRequest,
)
from wodana_intelligence.integrations.security import OAuthStateStore
from wodana_intelligence.integrations.vault import RedisCredentialVault

IDENTITY_SCOPES = (
    "openid",
    "email",
    "profile",
)
CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy"
READ_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly"
MANAGE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


class IntegrationFlowError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class GoogleIntegrationService:
    def __init__(
        self,
        google: GoogleCalendarClient,
        business_core: BusinessCoreClient,
        state_store: OAuthStateStore,
        vault: RedisCredentialVault,
        state_ttl_seconds: int,
    ) -> None:
        self._google = google
        self._business_core = business_core
        self._state_store = state_store
        self._vault = vault
        self._state_ttl_seconds = state_ttl_seconds

    async def start_oauth(
        self,
        request: OAuthStartRequest,
        actor_headers: Mapping[str, str],
    ) -> OAuthStartResponse:
        if not await self._google.configured():
            raise IntegrationFlowError(
                "google_not_configured", "Not available yet — Wodana is setting this up", 503
            )

        public = await self._business_core.validate_connection(
            str(request.workspace_id), str(request.connection_id), actor_headers
        )
        connection = await self._business_core.request_connection(
            str(request.workspace_id),
            str(request.connection_id),
            request.version,
            actor_headers,
        )
        if connection.get("provider") != "google_workspace":
            raise IntegrationFlowError("invalid_provider", "Connection is not Google Workspace")
        expected_domain = str(connection.get("externalDomain") or "").lower()
        if not expected_domain:
            raise IntegrationFlowError(
                "domain_required", "Configure the Google Workspace domain before connecting"
            )

        scopes = self.scopes_for(request.access_mode)
        if request.gmail_send:
            scopes.extend(["https://www.googleapis.com/auth/gmail.send", GMAIL_READ_SCOPE])
        if request.drive_files:
            scopes.append("https://www.googleapis.com/auth/drive.file")
        verifier = self._state_store.create_code_verifier()
        oauth_state = OAuthState(
            workspace_id=request.workspace_id,
            connection_id=request.connection_id,
            expected_version=int(connection["version"]),
            expected_domain=expected_domain,
            expected_email=public.get("configuration", {}).get("accountEmail"),
            code_verifier=verifier,
            access_mode=request.access_mode,
            requested_scopes=scopes,
            issued_at=self._state_store.issued_now(),
            return_origin=request.return_origin,
        )
        try:
            state_id = await self._state_store.issue(oauth_state)
        except Exception as error:
            await self._mark_failed(oauth_state, "oauth_state_unavailable")
            raise IntegrationFlowError(
                "oauth_state_unavailable",
                "Google authorization could not be started; try again",
                503,
            ) from error
        authorization_url = await self._google.authorization_url(
            state_id,
            self._state_store.code_challenge(verifier),
            scopes,
            expected_domain,
        )
        return OAuthStartResponse(
            authorization_url=authorization_url,
            expires_in_seconds=self._state_ttl_seconds,
            connection_version=int(connection["version"]),
        )

    async def return_origin(self, state_id: str) -> str:
        """Where this sign-in started, before the state is used up; empty when unknown."""
        try:
            state = await self._state_store.peek(state_id)
        except Exception:
            return ""
        return state.return_origin if state else ""

    async def complete_oauth(
        self,
        state_id: str,
        code: Optional[str],
        provider_error: Optional[str],
    ) -> tuple[UUID, UUID]:
        state = await self._state_store.consume(state_id)
        if state is None:
            raise IntegrationFlowError(
                "invalid_oauth_state", "This Google connection link is invalid or has expired"
            )
        if provider_error:
            await self._mark_failed(state, f"oauth_{self._safe_error_code(provider_error)}")
            raise IntegrationFlowError("oauth_denied", "Google authorization was cancelled")
        if not code:
            await self._mark_failed(state, "oauth_code_missing")
            raise IntegrationFlowError("oauth_code_missing", "Google did not return an OAuth code")

        reference = self._vault.reference(str(state.workspace_id), str(state.connection_id))
        try:
            token = await self._google.exchange_code(code, state.code_verifier)
            if not token.refresh_token:
                raise IntegrationFlowError(
                    "refresh_token_missing",
                    "Google did not return offline access; reconnect and approve consent again",
                )
            granted_scopes = token.scope.split()
            required_scopes = {
                scope
                for scope in state.requested_scopes
                if scope.startswith("https://www.googleapis.com/auth/")
            }
            missing_scopes = required_scopes - set(granted_scopes)
            if missing_scopes:
                raise IntegrationFlowError(
                    "required_scope_missing",
                    "Google access was granted without all required Calendar permissions",
                )
            user = await self._google.user_info(token.access_token)
            if not user.email_verified:
                raise IntegrationFlowError(
                    "email_not_verified", "Google account email is not verified"
                )
            if state.expected_email and user.email.lower() != state.expected_email.lower():
                raise IntegrationFlowError(
                    "account_mismatch",
                    "Use the exact Google account configured for this connection",
                )
            if (
                state.expected_domain in {"gmail.com", "googlemail.com"}
                and not state.expected_email
            ):
                raise IntegrationFlowError(
                    "account_required", "Configure the exact Gmail address before connecting"
                )
            actual_domain = self._email_domain(user.email)
            if actual_domain != state.expected_domain:
                raise IntegrationFlowError(
                    "domain_mismatch",
                    f"Use an account from {state.expected_domain} to connect this company",
                )
            calendars = await self._google.list_calendars(token.access_token)
            if not calendars:
                raise IntegrationFlowError(
                    "no_calendars", "The connected Google account has no accessible calendars"
                )
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=token.expires_in)
            credential = StoredGoogleCredential(
                access_token=token.access_token,
                refresh_token=token.refresh_token,
                token_type=token.token_type,
                scopes=granted_scopes,
                expires_at=expires_at,
                account_email=user.email.lower(),
            )
            await self._vault.put(reference, credential)
            try:
                await self._business_core.complete_google(
                    str(state.connection_id),
                    {
                        "workspaceId": str(state.workspace_id),
                        "expectedVersion": state.expected_version,
                        "externalAccountId": user.email.lower(),
                        "externalDomain": actual_domain,
                        "grantedScopes": granted_scopes,
                        "secretReference": reference,
                        "tokenExpiresAt": expires_at.isoformat(),
                        "resources": self._discovered_resources(calendars, state.access_mode),
                    },
                )
            except Exception:
                await self._vault.delete(reference)
                raise
            return state.workspace_id, state.connection_id
        except IntegrationFlowError as error:
            await self._vault.delete(reference)
            await self._mark_failed(state, error.code)
            raise
        except GoogleApiError as error:
            await self._vault.delete(reference)
            await self._mark_failed(state, error.code)
            raise IntegrationFlowError(error.code, str(error), error.status_code) from error
        except BusinessCoreError as error:
            await self._vault.delete(reference)
            await self._mark_failed(state, "business_core_error")
            raise IntegrationFlowError(
                "business_core_error",
                "The Google account was authorized but Wodana could not save the connection",
                error.status_code,
            ) from error

    async def list_calendars(
        self,
        workspace_id: UUID,
        connection_id: UUID,
        actor_headers: Mapping[str, str],
    ) -> CalendarListResponse:
        public = await self._business_core.validate_connection(
            str(workspace_id), str(connection_id), actor_headers
        )
        runtime = await self._active_runtime(workspace_id, connection_id, public)
        credential = await self._access_credential(runtime)
        discovered = await self._google.list_calendars(credential.access_token)
        prior = {resource.external_id: resource for resource in runtime.resources}
        resource_payloads = self._discovered_resources(discovered, GoogleAccessMode.AVAILABILITY)
        for calendar, resource_payload in zip(discovered, resource_payloads):
            existing = prior.get(calendar.id)
            resource_payload["enabled"] = existing.enabled if existing else calendar.primary
            resource_payload["direction"] = existing.direction if existing else "inbound"

        await self._business_core.discover_resources(
            str(connection_id),
            {
                "workspaceId": str(workspace_id),
                "resources": resource_payloads,
            },
        )
        refreshed = RuntimeConnection.model_validate(
            await self._business_core.runtime_context(str(workspace_id), str(connection_id))
        )
        refreshed_by_external = {resource.external_id: resource for resource in refreshed.resources}
        calendars: list[CalendarResource] = []
        for calendar in discovered:
            saved = refreshed_by_external.get(calendar.id)
            calendars.append(
                CalendarResource(
                    resource_id=saved.id if saved else None,
                    external_id=calendar.id,
                    display_name=calendar.summary,
                    primary=calendar.primary,
                    access_role=calendar.access_role,
                    time_zone=calendar.time_zone,
                    enabled=saved.enabled if saved else calendar.primary,
                    direction=saved.direction if saved else "inbound",
                )
            )
        await self._business_core.record_health(
            str(connection_id), str(workspace_id), "google.calendars.read", True
        )
        return CalendarListResponse(
            connection_id=connection_id,
            connection_version=runtime.version,
            calendars=calendars,
        )

    async def calendar_events(
        self, request: AvailabilityRequest, actor_headers: Mapping[str, str]
    ) -> dict[str, Any]:
        events: list[dict[str, Any]] = []
        for connection_id in request.connection_ids:
            public = await self._business_core.validate_connection(
                str(request.workspace_id), str(connection_id), actor_headers
            )
            runtime = await self._active_runtime(request.workspace_id, connection_id, public)
            if not {READ_EVENTS_SCOPE, MANAGE_EVENTS_SCOPE}.intersection(runtime.granted_scopes):
                raise IntegrationFlowError(
                    "calendar_read_consent_required",
                    "Reconnect Google with calendar read access",
                    403,
                )
            selected = [r for r in runtime.resources if r.enabled and r.direction != "outbound"]
            if not selected:
                raise IntegrationFlowError(
                    "no_calendars_selected", "Select a calendar in Integrations", 422
                )
            if len(selected) > 20:
                raise IntegrationFlowError("too_many_calendars", "Select at most 20 calendars", 422)
            credential = await self._access_credential(runtime)
            for calendar in selected:
                items = await self._google.list_events(
                    credential.access_token,
                    calendar.external_id,
                    request.time_min.isoformat(),
                    request.time_max.isoformat(),
                    request.time_zone,
                )
                for event in items:
                    events.append(
                        {
                            "id": event.get("id"),
                            "connectionId": str(connection_id),
                            "calendarId": calendar.external_id,
                            "calendarName": calendar.display_name,
                            "title": event.get("summary") or "Busy",
                            "start": event.get("start", {}),
                            "end": event.get("end", {}),
                            "status": event.get("status"),
                            "htmlLink": event.get("htmlLink"),
                            "etag": event.get("etag"),
                            "description": event.get("description"),
                            "location": event.get("location"),
                            "attendees": [
                                {
                                    "email": attendee.get("email"),
                                    "displayName": attendee.get("displayName"),
                                    "responseStatus": attendee.get("responseStatus"),
                                }
                                for attendee in event.get("attendees", [])
                                if attendee.get("email")
                            ],
                        }
                    )
            await self._business_core.record_health(
                str(connection_id), str(request.workspace_id), "google.events.read", True
            )
        return {
            "events": events,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "mode": "live_read",
        }

    async def availability(
        self,
        request: AvailabilityRequest,
        actor_headers: Mapping[str, str],
    ) -> AvailabilityResponse:
        calendar_results: list[CalendarAvailability] = []
        all_intervals: list[BusyInterval] = []
        for connection_id in request.connection_ids:
            public = await self._business_core.validate_connection(
                str(request.workspace_id), str(connection_id), actor_headers
            )
            runtime = await self._active_runtime(request.workspace_id, connection_id, public)
            credential = await self._access_credential(runtime)
            selected = [resource for resource in runtime.resources if resource.enabled]
            if not selected:
                raise IntegrationFlowError(
                    "no_calendars_selected",
                    "Select at least one calendar for every availability connection",
                    422,
                )
            for chunk in self._chunks(selected, 50):
                response = await self._google.free_busy(
                    credential.access_token,
                    [resource.external_id for resource in chunk],
                    request.time_min.isoformat(),
                    request.time_max.isoformat(),
                    request.time_zone,
                )
                google_calendars = response.get("calendars", {})
                for resource in chunk:
                    data = google_calendars.get(resource.external_id, {})
                    intervals = [
                        BusyInterval.model_validate(interval) for interval in data.get("busy", [])
                    ]
                    errors = [
                        str(error.get("reason", "unknown")) for error in data.get("errors", [])
                    ]
                    all_intervals.extend(intervals)
                    calendar_results.append(
                        CalendarAvailability(
                            connection_id=connection_id,
                            calendar_id=resource.external_id,
                            display_name=resource.display_name,
                            busy=intervals,
                            errors=errors,
                        )
                    )
            await self._business_core.record_health(
                str(connection_id), str(request.workspace_id), "google.availability.read", True
            )
        return AvailabilityResponse(
            time_min=request.time_min,
            time_max=request.time_max,
            time_zone=request.time_zone,
            complete=all(not calendar.errors for calendar in calendar_results),
            busy=self._merge_intervals(all_intervals),
            calendars=calendar_results,
        )

    async def revoke(
        self,
        workspace_id: UUID,
        connection_id: UUID,
        version: int,
        actor_headers: Mapping[str, str],
    ) -> dict[str, Any]:
        await self._business_core.validate_connection(
            str(workspace_id), str(connection_id), actor_headers
        )
        runtime = RuntimeConnection.model_validate(
            await self._business_core.runtime_context(str(workspace_id), str(connection_id))
        )
        reference = runtime.secret_reference or self._vault.reference(
            str(workspace_id), str(connection_id)
        )
        credential: Optional[StoredGoogleCredential] = None
        with suppress(LookupError):
            credential = await self._vault.get(reference)
        response = await self._business_core.revoke_connection(
            str(workspace_id), str(connection_id), version, actor_headers
        )
        if credential:
            with suppress(GoogleApiError):
                await self._google.revoke(credential.refresh_token)
        await self._vault.delete(reference)
        return response

    async def create_event(
        self,
        request: CreateCalendarEventRequest,
        actor_headers: Mapping[str, str],
    ) -> CalendarEventResponse:
        runtime, credential = await self._writable_calendar(
            request.workspace_id,
            request.connection_id,
            request.calendar_id,
            actor_headers,
        )
        event_body: dict[str, Any] = {
            "summary": request.summary,
            "start": {"dateTime": request.start.isoformat(), "timeZone": request.time_zone},
            "end": {"dateTime": request.end.isoformat(), "timeZone": request.time_zone},
        }
        if request.description is not None:
            event_body["description"] = request.description
        if request.location is not None:
            event_body["location"] = request.location
        if request.attendee_emails:
            event_body["attendees"] = [{"email": email} for email in request.attendee_emails]
        request_hash = self._event_hash(event_body)
        event_body["id"] = self._event_id(
            request.workspace_id, request.connection_id, request.idempotency_key
        )
        event_body["extendedProperties"] = {
            "private": {
                "wodanaRequestHash": request_hash,
                "wodanaConnectionId": str(request.connection_id),
            }
        }
        event = await self._google.create_event(
            credential.access_token,
            request.calendar_id,
            event_body,
            request.send_updates.value,
        )
        existing_hash = (
            event.get("extendedProperties", {}).get("private", {}).get("wodanaRequestHash")
        )
        if existing_hash != request_hash:
            raise IntegrationFlowError(
                "idempotency_conflict",
                "This idempotency key was already used for a different calendar event",
                409,
            )
        response = self._event_response(request.connection_id, request.calendar_id, event)
        await self._business_core.record_activity(
            str(request.connection_id),
            str(request.workspace_id),
            "calendar.event_created",
            response.event_id,
            {"calendarId": request.calendar_id},
        )
        await self._business_core.mark_synced(str(runtime.id), str(request.workspace_id))
        return response

    async def update_event(
        self,
        event_id: str,
        request: UpdateCalendarEventRequest,
        actor_headers: Mapping[str, str],
    ) -> CalendarEventResponse:
        _runtime, credential = await self._writable_calendar(
            request.workspace_id,
            request.connection_id,
            request.calendar_id,
            actor_headers,
        )
        body: dict[str, Any] = {}
        fields_set = request.model_fields_set
        for field_name, google_name in (
            ("summary", "summary"),
            ("description", "description"),
            ("location", "location"),
        ):
            if field_name in fields_set:
                body[google_name] = getattr(request, field_name)
        if request.start and request.end:
            event_timezone = request.time_zone or "UTC"
            body["start"] = {
                "dateTime": request.start.isoformat(),
                "timeZone": event_timezone,
            }
            body["end"] = {"dateTime": request.end.isoformat(), "timeZone": event_timezone}
        if "attendee_emails" in fields_set:
            body["attendees"] = [{"email": email} for email in (request.attendee_emails or [])]
        event = await self._google.update_event(
            credential.access_token,
            request.calendar_id,
            event_id,
            body,
            request.etag,
            request.send_updates.value,
        )
        response = self._event_response(request.connection_id, request.calendar_id, event)
        await self._business_core.record_activity(
            str(request.connection_id),
            str(request.workspace_id),
            "calendar.event_updated",
            response.event_id,
            {"calendarId": request.calendar_id},
        )
        return response

    async def cancel_event(
        self,
        event_id: str,
        request: CancelCalendarEventRequest,
        actor_headers: Mapping[str, str],
    ) -> dict[str, Any]:
        _runtime, credential = await self._writable_calendar(
            request.workspace_id,
            request.connection_id,
            request.calendar_id,
            actor_headers,
        )
        await self._google.cancel_event(
            credential.access_token,
            request.calendar_id,
            event_id,
            request.etag,
            request.send_updates.value,
        )
        await self._business_core.record_activity(
            str(request.connection_id),
            str(request.workspace_id),
            "calendar.event_cancelled",
            event_id,
            {"calendarId": request.calendar_id},
        )
        return {"eventId": event_id, "status": "cancelled"}

    async def _active_runtime(
        self,
        workspace_id: UUID,
        connection_id: UUID,
        public: Mapping[str, Any],
    ) -> RuntimeConnection:
        if public.get("provider") != "google_workspace":
            raise IntegrationFlowError("invalid_provider", "Connection is not Google Workspace")
        if public.get("status") not in {"connected", "degraded"}:
            raise IntegrationFlowError(
                "connection_inactive", "Google connection is not active", 409
            )
        runtime = RuntimeConnection.model_validate(
            await self._business_core.runtime_context(str(workspace_id), str(connection_id))
        )
        if not runtime.secret_reference:
            raise IntegrationFlowError(
                "credential_missing", "Google connection must be reconnected", 409
            )
        return runtime

    async def _writable_calendar(
        self,
        workspace_id: UUID,
        connection_id: UUID,
        calendar_id: str,
        actor_headers: Mapping[str, str],
    ) -> tuple[RuntimeConnection, StoredGoogleCredential]:
        await self._business_core.authorize_connection(
            str(workspace_id), str(connection_id), actor_headers, write=True
        )
        public = await self._business_core.validate_connection(
            str(workspace_id), str(connection_id), actor_headers
        )
        runtime = await self._active_runtime(workspace_id, connection_id, public)
        if MANAGE_EVENTS_SCOPE not in runtime.granted_scopes:
            raise IntegrationFlowError(
                "calendar_write_not_granted",
                "Reconnect Google with calendar management permission",
                403,
            )
        resource = next(
            (
                item
                for item in runtime.resources
                if item.external_id == calendar_id and item.enabled
            ),
            None,
        )
        if not resource:
            raise IntegrationFlowError(
                "calendar_not_selected", "Select this calendar before scheduling", 422
            )
        if resource.direction not in {"outbound", "bidirectional"}:
            raise IntegrationFlowError(
                "calendar_read_only", "This calendar is configured as read-only", 403
            )
        if resource.configuration.get("accessRole") not in {"owner", "writer"}:
            raise IntegrationFlowError(
                "google_calendar_read_only",
                "The connected Google account cannot edit this calendar",
                403,
            )
        return runtime, await self._access_credential(runtime)

    async def _access_credential(self, runtime: RuntimeConnection) -> StoredGoogleCredential:
        if not runtime.secret_reference:
            raise IntegrationFlowError(
                "credential_missing", "Google connection must be reconnected", 409
            )
        credential = await self._vault.get(runtime.secret_reference)
        if credential.expires_at > datetime.now(timezone.utc) + timedelta(seconds=90):
            return credential
        try:
            refreshed = await self._google.refresh_token(credential.refresh_token)
        except GoogleApiError as error:
            raise IntegrationFlowError(error.code, str(error), error.status_code) from error
        updated = credential.model_copy(
            update={
                "access_token": refreshed.access_token,
                "refresh_token": refreshed.refresh_token or credential.refresh_token,
                "token_type": refreshed.token_type,
                "scopes": refreshed.scope.split() or credential.scopes,
                "expires_at": datetime.now(timezone.utc) + timedelta(seconds=refreshed.expires_in),
            }
        )
        await self._vault.put(runtime.secret_reference, updated)
        return updated

    async def _mark_failed(self, state: OAuthState, error_code: str) -> None:
        with suppress(Exception):
            await self._business_core.fail_connection(
                str(state.connection_id),
                {
                    "workspaceId": str(state.workspace_id),
                    "expectedVersion": state.expected_version,
                    "errorCode": self._safe_error_code(error_code),
                },
            )

    @staticmethod
    def scopes_for(access_mode: GoogleAccessMode) -> list[str]:
        scopes = [*IDENTITY_SCOPES, CALENDAR_LIST_SCOPE, FREE_BUSY_SCOPE]
        if access_mode is GoogleAccessMode.READ:
            scopes.append(READ_EVENTS_SCOPE)
        if access_mode is GoogleAccessMode.MANAGE:
            scopes.append(MANAGE_EVENTS_SCOPE)
        return scopes

    @staticmethod
    def _email_domain(email: str) -> str:
        parts = email.strip().lower().rsplit("@", 1)
        if len(parts) != 2 or not parts[0] or "." not in parts[1]:
            raise IntegrationFlowError("invalid_google_email", "Google returned an invalid email")
        return parts[1]

    @staticmethod
    def _safe_error_code(value: str) -> str:
        normalized = "".join(character if character.isalnum() else "_" for character in value)
        return normalized.lower()[:100] or "unknown_error"

    @staticmethod
    def _discovered_resources(
        calendars: list[GoogleCalendarEntry], access_mode: GoogleAccessMode
    ) -> list[dict[str, Any]]:
        return [
            {
                "externalId": calendar.id,
                "displayName": calendar.summary,
                "enabled": calendar.primary,
                "direction": (
                    "bidirectional"
                    if access_mode is GoogleAccessMode.MANAGE
                    and calendar.access_role in {"owner", "writer"}
                    else "inbound"
                ),
                "configuration": {
                    "primary": calendar.primary,
                    "accessRole": calendar.access_role,
                    "timeZone": calendar.time_zone,
                },
            }
            for calendar in calendars
        ]

    @staticmethod
    def _chunks(values: list[Any], size: int) -> list[list[Any]]:
        return [values[index : index + size] for index in range(0, len(values), size)]

    @staticmethod
    def _merge_intervals(intervals: list[BusyInterval]) -> list[BusyInterval]:
        if not intervals:
            return []
        ordered = sorted(intervals, key=lambda interval: interval.start)
        merged = [ordered[0]]
        for interval in ordered[1:]:
            previous = merged[-1]
            if interval.start <= previous.end:
                if interval.end > previous.end:
                    merged[-1] = BusyInterval(start=previous.start, end=interval.end)
            else:
                merged.append(interval)
        return merged

    @staticmethod
    def _event_hash(event: dict[str, Any]) -> str:
        canonical = json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def _event_id(workspace_id: UUID, connection_id: UUID, idempotency_key: str) -> str:
        source = f"{workspace_id}:{connection_id}:{idempotency_key}".encode()
        return f"w{hashlib.sha256(source).hexdigest()[:39]}"

    @staticmethod
    def _event_response(
        connection_id: UUID,
        calendar_id: str,
        event: dict[str, Any],
    ) -> CalendarEventResponse:
        event_id = event.get("id")
        etag = event.get("etag")
        if not isinstance(event_id, str) or not isinstance(etag, str):
            raise IntegrationFlowError(
                "invalid_event_response", "Google returned an incomplete event", 502
            )
        return CalendarEventResponse(
            connection_id=connection_id,
            calendar_id=calendar_id,
            event_id=event_id,
            etag=etag,
            status=str(event.get("status", "confirmed")),
            summary=event.get("summary"),
            html_link=event.get("htmlLink"),
            start=event.get("start", {}),
            end=event.get("end", {}),
        )
