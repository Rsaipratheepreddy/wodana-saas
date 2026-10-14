from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from wodana_intelligence.integrations.google_client import (
    GOOGLE_AUTHORIZATION_URL,
    RECONNECT_REQUIRED,
    GoogleApiError,
    GoogleCalendarClient,
)


@pytest.mark.asyncio
async def test_event_list_expands_recurrence_paginates_and_omits_cancellations() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["singleEvents"] == "true"
        assert request.url.params["orderBy"] == "startTime"
        calls.append(str(request.url))
        if request.url.params.get("pageToken") == "next":
            return httpx.Response(200, json={"items": [{"id": "two", "status": "confirmed"}]})
        return httpx.Response(
            200,
            json={
                "items": [{"id": "one"}, {"id": "cancelled", "status": "cancelled"}],
                "nextPageToken": "next",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = GoogleCalendarClient(
            "id", "secret", "https://app.test/callback", http_client=http_client
        )
        events = await client.list_events(
            "access", "team@example.com", "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z", "UTC"
        )
    assert [event["id"] for event in events] == ["one", "two"]
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_authorization_url_uses_offline_consent_state_and_pkce() -> None:
    client = GoogleCalendarClient("client-id", "client-secret", "https://app.test/callback")

    url = await client.authorization_url(
        "opaque-state",
        "pkce-challenge",
        ["openid", "calendar"],
        "palmlivingae.com",
    )
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == GOOGLE_AUTHORIZATION_URL
    assert query["state"] == ["opaque-state"]
    assert query["access_type"] == ["offline"]
    assert query["prompt"] == ["consent"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["hd"] == ["palmlivingae.com"]


@pytest.mark.asyncio
async def test_client_paginates_calendar_discovery_and_queries_freebusy() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/calendarList"):
            if request.url.params.get("pageToken") == "page-2":
                return httpx.Response(
                    200,
                    json={"items": [{"id": "team@example.com", "summary": "Team"}]},
                )
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "primary@example.com",
                            "summary": "Primary",
                            "primary": True,
                            "accessRole": "owner",
                            "timeZone": "Asia/Dubai",
                        },
                        {"id": "deleted@example.com", "deleted": True},
                    ],
                    "nextPageToken": "page-2",
                },
            )
        if request.url.path.endswith("/freeBusy"):
            return httpx.Response(
                200,
                json={
                    "calendars": {
                        "primary@example.com": {
                            "busy": [
                                {
                                    "start": "2026-09-03T08:00:00Z",
                                    "end": "2026-09-03T09:00:00Z",
                                }
                            ]
                        }
                    }
                },
            )
        return httpx.Response(404, json={"error": {"message": "not found"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GoogleCalendarClient(
        "client-id", "client-secret", "https://app.test/callback", http_client=http_client
    )

    calendars = await client.list_calendars("access")
    freebusy = await client.free_busy(
        "access",
        ["primary@example.com"],
        "2026-09-03T00:00:00Z",
        "2026-09-04T00:00:00Z",
        "Asia/Dubai",
    )

    assert [calendar.id for calendar in calendars] == [
        "primary@example.com",
        "team@example.com",
    ]
    assert freebusy["calendars"]["primary@example.com"]["busy"]
    assert requests[-1].headers["authorization"] == "Bearer access"
    await http_client.aclose()


@pytest.mark.asyncio
async def test_google_error_is_normalized() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(403, json={"error": {"message": "denied"}})
    )
    http_client = httpx.AsyncClient(transport=transport)
    client = GoogleCalendarClient("id", "secret", "https://app.test", http_client=http_client)

    with pytest.raises(GoogleApiError) as raised:
        await client.list_calendars("bad-token")

    assert raised.value.code == "calendar_discovery_failed"
    # Google's own words stay in the logs; people see Wodana's.
    assert str(raised.value) == "Google could not complete the request"
    await http_client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "body"),
    [
        (
            400,
            {"error": "invalid_grant", "error_description": "Token has been expired or revoked."},
        ),
        (400, {"error": "invalid_grant"}),
    ],
)
async def test_a_revoked_refresh_token_asks_to_reconnect(status: int, body: dict[str, str]) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(status, json=body))
    http_client = httpx.AsyncClient(transport=transport)
    client = GoogleCalendarClient("id", "secret", "https://app.test", http_client=http_client)

    with pytest.raises(GoogleApiError) as raised:
        await client.refresh_token("revoked")

    assert raised.value.code == RECONNECT_REQUIRED
    assert raised.value.status_code == 409
    assert "expired or revoked" not in str(raised.value)
    await http_client.aclose()


@pytest.mark.asyncio
async def test_a_rejected_access_token_asks_to_reconnect() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(401, json={"error": {"message": "Invalid Credentials"}})
    )
    http_client = httpx.AsyncClient(transport=transport)
    client = GoogleCalendarClient("id", "secret", "https://app.test", http_client=http_client)

    with pytest.raises(GoogleApiError) as raised:
        await client.list_calendars("stale")

    assert raised.value.code == RECONNECT_REQUIRED
    await http_client.aclose()


@pytest.mark.asyncio
async def test_google_event_update_uses_etag_and_normalizes_concurrent_change() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(412, json={"error": {"message": "condition not met"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GoogleCalendarClient("id", "secret", "https://app.test", http_client=http_client)

    with pytest.raises(GoogleApiError) as raised:
        await client.update_event(
            "access",
            "team calendar@example.com",
            "event/id",
            {"summary": "Updated"},
            '"event-version-1"',
            "all",
        )

    assert raised.value.code == "event_changed"
    assert raised.value.status_code == 409
    assert captured[0].headers["if-match"] == '"event-version-1"'
    assert "team%20calendar%40example.com" in captured[0].url.raw_path.decode()
    assert "event%2Fid" in captured[0].url.raw_path.decode()
    await http_client.aclose()
