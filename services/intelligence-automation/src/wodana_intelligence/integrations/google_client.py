from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import quote, urlencode

import httpx
from pydantic import ValidationError

from wodana_intelligence.integrations.models import (
    GoogleCalendarEntry,
    GoogleTokenResponse,
    GoogleUserInfo,
)

if TYPE_CHECKING:
    from wodana_intelligence.integrations.platform_credentials import PlatformCredentialResolver

GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"


class GoogleApiError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class GoogleCalendarClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        timeout_seconds: float = 15.0,
        http_client: Optional[httpx.AsyncClient] = None,
        credentials: Optional["PlatformCredentialResolver"] = None,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        # When given, Wodana's Google app is read live from it (Wodana Control, else env).
        self._credentials = credentials
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def app(self) -> tuple[str, str, str]:
        """Wodana's Google app now: client ID, client secret and the central callback."""
        if self._credentials is None:
            return self.client_id, self.client_secret, self.redirect_uri
        current = await self._credentials.current()
        return current.google_client_id, current.google_client_secret, current.google_redirect_uri

    async def configured(self) -> bool:
        client_id, client_secret, _ = await self.app()
        return bool(client_id and client_secret)

    async def authorization_url(
        self,
        state: str,
        code_challenge: str,
        scopes: Sequence[str],
        hosted_domain: Optional[str] = None,
    ) -> str:
        client_id, _, redirect_uri = await self.app()
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if hosted_domain and hosted_domain not in {"gmail.com", "googlemail.com"}:
            params["hd"] = hosted_domain
        query = urlencode(params)
        return f"{GOOGLE_AUTHORIZATION_URL}?{query}"

    async def exchange_code(self, code: str, code_verifier: str) -> GoogleTokenResponse:
        client_id, client_secret, redirect_uri = await self.app()
        response = await self._client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
        payload = self._json(response, "oauth_exchange_failed")
        try:
            return GoogleTokenResponse.model_validate(payload)
        except ValidationError as error:
            raise GoogleApiError(
                "oauth_exchange_failed", "Google returned an incomplete token response"
            ) from error

    async def refresh_token(
        self, refresh_token: str, scopes: Optional[Sequence[str]] = None
    ) -> GoogleTokenResponse:
        """A new access token; with `scopes`, one narrowed to those granted scopes only."""
        client_id, client_secret, _ = await self.app()
        data = {
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
        }
        if scopes:
            data["scope"] = " ".join(scopes)
        response = await self._client.post(GOOGLE_TOKEN_URL, data=data)
        payload = self._json(response, "oauth_refresh_failed")
        try:
            return GoogleTokenResponse.model_validate(payload)
        except ValidationError as error:
            raise GoogleApiError(
                "oauth_refresh_failed", "Google returned an incomplete refresh response"
            ) from error

    async def user_info(self, access_token: str) -> GoogleUserInfo:
        response = await self._client.get(
            GOOGLE_USERINFO_URL,
            headers=self._authorization(access_token),
        )
        try:
            return GoogleUserInfo.model_validate(self._json(response, "userinfo_failed"))
        except ValidationError as error:
            raise GoogleApiError(
                "userinfo_failed", "Google returned incomplete account information"
            ) from error

    async def list_calendars(self, access_token: str) -> list[GoogleCalendarEntry]:
        calendars: list[GoogleCalendarEntry] = []
        page_token: Optional[str] = None
        for _ in range(20):
            params: dict[str, str] = {"maxResults": "250", "showHidden": "false"}
            if page_token:
                params["pageToken"] = page_token
            response = await self._client.get(
                f"{GOOGLE_CALENDAR_API}/users/me/calendarList",
                params=params,
                headers=self._authorization(access_token),
            )
            payload = self._json(response, "calendar_discovery_failed")
            for item in payload.get("items", []):
                if item.get("deleted") or not item.get("id"):
                    continue
                calendars.append(
                    GoogleCalendarEntry(
                        id=item["id"],
                        summary=item.get("summaryOverride") or item.get("summary") or item["id"],
                        primary=bool(item.get("primary", False)),
                        access_role=item.get("accessRole", "reader"),
                        time_zone=item.get("timeZone"),
                    )
                )
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        else:
            raise GoogleApiError("calendar_pagination_limit", "Google returned too many pages")
        return calendars

    async def list_events(
        self, access_token: str, calendar_id: str, time_min: str, time_max: str, time_zone: str
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        page_token: Optional[str] = None
        for _ in range(10):
            params = {
                "timeMin": time_min,
                "timeMax": time_max,
                "timeZone": time_zone,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "250",
                "showDeleted": "false",
            }
            if page_token:
                params["pageToken"] = page_token
            response = await self._client.get(
                f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events",
                params=params,
                headers=self._authorization(access_token),
            )
            payload = self._json(response, "event_list_failed")
            events.extend(
                item for item in payload.get("items", []) if item.get("status") != "cancelled"
            )
            page_token = payload.get("nextPageToken")
            if not page_token:
                return events
        raise GoogleApiError(
            "event_pagination_limit", "Too many events; choose a shorter date range"
        )

    async def free_busy(
        self,
        access_token: str,
        calendar_ids: Sequence[str],
        time_min: str,
        time_max: str,
        time_zone: str,
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"{GOOGLE_CALENDAR_API}/freeBusy",
            headers=self._authorization(access_token),
            json={
                "timeMin": time_min,
                "timeMax": time_max,
                "timeZone": time_zone,
                "calendarExpansionMax": 50,
                "groupExpansionMax": 100,
                "items": [{"id": calendar_id} for calendar_id in calendar_ids],
            },
        )
        return self._json(response, "freebusy_failed")

    async def create_event(
        self,
        access_token: str,
        calendar_id: str,
        event: dict[str, Any],
        send_updates: str,
    ) -> dict[str, Any]:
        path = f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events"
        response = await self._client.post(
            path,
            params={"sendUpdates": send_updates},
            headers=self._authorization(access_token),
            json=event,
        )
        if response.status_code == 409 and event.get("id"):
            return await self.get_event(access_token, calendar_id, str(event["id"]))
        return self._json(response, "event_create_failed")

    async def get_event(self, access_token: str, calendar_id: str, event_id: str) -> dict[str, Any]:
        response = await self._client.get(
            f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events/"
            f"{quote(event_id, safe='')}",
            headers=self._authorization(access_token),
        )
        return self._json(response, "event_read_failed")

    async def update_event(
        self,
        access_token: str,
        calendar_id: str,
        event_id: str,
        event: dict[str, Any],
        etag: str,
        send_updates: str,
    ) -> dict[str, Any]:
        response = await self._client.patch(
            f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events/"
            f"{quote(event_id, safe='')}",
            params={"sendUpdates": send_updates},
            headers={**self._authorization(access_token), "If-Match": etag},
            json=event,
        )
        if response.status_code == 412:
            raise GoogleApiError(
                "event_changed", "The Google event changed; reload before editing", 409
            )
        return self._json(response, "event_update_failed")

    async def cancel_event(
        self,
        access_token: str,
        calendar_id: str,
        event_id: str,
        etag: str,
        send_updates: str,
    ) -> None:
        response = await self._client.delete(
            f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events/"
            f"{quote(event_id, safe='')}",
            params={"sendUpdates": send_updates},
            headers={**self._authorization(access_token), "If-Match": etag},
        )
        if response.status_code == 412:
            raise GoogleApiError(
                "event_changed", "The Google event changed; reload before cancelling", 409
            )
        if response.status_code not in {204, 410}:
            self._json(response, "event_cancel_failed")

    async def spreadsheet(self, access_token: str, spreadsheet_id: str) -> dict[str, Any]:
        """A spreadsheet's title and its tabs (drive.file: only a file picked for Wodana)."""
        response = await self._client.get(
            f"{GOOGLE_SHEETS_API}/{quote(spreadsheet_id, safe='')}",
            params={"fields": "properties.title,sheets.properties(title,sheetType)"},
            headers=self._authorization(access_token),
        )
        return self._json(response, "sheet_read_failed")

    async def sheet_values(
        self, access_token: str, spreadsheet_id: str, ranges: Sequence[str]
    ) -> list[list[list[Any]]]:
        """The cells of each range as the sheet shows them (formatted), row by row."""
        response = await self._client.get(
            f"{GOOGLE_SHEETS_API}/{quote(spreadsheet_id, safe='')}/values:batchGet",
            params=[
                *(("ranges", value) for value in ranges),
                ("valueRenderOption", "FORMATTED_VALUE"),
                ("majorDimension", "ROWS"),
            ],
            headers=self._authorization(access_token),
        )
        payload = self._json(response, "sheet_read_failed")
        return [
            value_range.get("values", []) if isinstance(value_range, dict) else []
            for value_range in payload.get("valueRanges", [])
        ]

    async def revoke(self, token: str) -> None:
        response = await self._client.post(
            GOOGLE_REVOKE_URL,
            data={"token": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code not in {200, 400}:
            self._json(response, "oauth_revoke_failed")

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    @staticmethod
    def _authorization(access_token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access_token}"}

    @staticmethod
    def _json(response: httpx.Response, code: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as error:
            raise GoogleApiError(code, "Google returned an invalid response") from error
        if response.is_error:
            detail = payload.get("error_description") or payload.get("error", {}).get("message")
            if not isinstance(detail, str):
                detail = "Google request failed"
            raise GoogleApiError(code, detail, response.status_code)
        if not isinstance(payload, dict):
            raise GoogleApiError(code, "Google returned an invalid response")
        return payload
