"""Linked Google Sheets: a drive.file-only Picker token, and reading a picked sheet."""

from collections.abc import Sequence
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
import pytest
from fakes import FakeBusinessCore, FakeRedis
from test_google_integration_service import FakeGoogle

from wodana_intelligence.integrations.google_client import GoogleApiError, GoogleCalendarClient
from wodana_intelligence.integrations.google_service import (
    DRIVE_FILE_SCOPE,
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.models import GoogleTokenResponse, OAuthStartRequest
from wodana_intelligence.integrations.security import OAuthStateStore, TokenCipher
from wodana_intelligence.integrations.vault import RedisCredentialVault


class FakeSheetsGoogle(FakeGoogle):
    """Google as Wodana sees it with drive.file: only the picked sheet answers."""

    def __init__(self) -> None:
        super().__init__()
        self.narrowed_to: Optional[Sequence[str]] = None
        self.narrowed_scope = DRIVE_FILE_SCOPE
        self.ranges: list[str] = []

    async def refresh_token(
        self, refresh_token: str, scopes: Optional[Sequence[str]] = None
    ) -> GoogleTokenResponse:
        assert refresh_token == "refresh"
        self.narrowed_to = scopes
        return GoogleTokenResponse(
            access_token="picker-token" if scopes else "refreshed",
            expires_in=3599,
            scope=self.narrowed_scope if scopes else " ".join(self.requested_scopes),
        )

    async def spreadsheet(self, access_token: str, spreadsheet_id: str) -> dict[str, Any]:
        assert access_token == "access"
        if spreadsheet_id != "picked-sheet-0001":
            raise GoogleApiError("sheet_read_failed", "Requested entity was not found.", 404)
        return {
            "properties": {"title": "Factory stock"},
            "sheets": [
                {"properties": {"title": "Stock", "sheetType": "GRID"}},
                {"properties": {"title": "Owner's notes", "sheetType": "GRID"}},
                {"properties": {"title": "Chart", "sheetType": "OBJECT"}},
            ],
        }

    async def sheet_values(
        self, access_token: str, spreadsheet_id: str, ranges: Sequence[str]
    ) -> list[list[list[Any]]]:
        self.ranges = list(ranges)
        tables = {
            "'Stock'": [
                ["Code", "Item", "Qty"],
                ["MAT-001", "Oak veneer", "1,240.5"],
                [],
                ["MAT-002", None, 3],
            ],
            "'Owner''s notes'": [["Check the showroom on Fridays"]],
        }
        return [tables[value.split("!")[0]] for value in ranges]


async def linked_service(
    drive_files: bool = True,
) -> tuple[GoogleIntegrationService, FakeSheetsGoogle, Any, Any]:
    redis = FakeRedis()
    google = FakeSheetsGoogle()
    core = FakeBusinessCore()
    service = GoogleIntegrationService(
        google=google,  # type: ignore[arg-type]
        business_core=core,  # type: ignore[arg-type]
        state_store=OAuthStateStore(redis, 600),
        vault=RedisCredentialVault(
            redis, TokenCipher("a-strong-local-test-key-that-is-not-production")
        ),
        state_ttl_seconds=600,
    )
    workspace_id, connection_id = uuid4(), uuid4()
    started = await service.start_oauth(
        OAuthStartRequest(
            workspace_id=workspace_id,
            connection_id=connection_id,
            version=1,
            drive_files=drive_files,
        ),
        {"authorization": "Bearer user-token"},
    )
    state = parse_qs(urlparse(started.authorization_url).query)["state"][0]
    await service.complete_oauth(state, "authorization-code", None)
    return service, google, workspace_id, connection_id


@pytest.mark.asyncio
async def test_the_picker_gets_a_token_narrowed_to_drive_file() -> None:
    service, google, workspace_id, connection_id = await linked_service()

    token = await service.picker_token(
        workspace_id, connection_id, {"authorization": "Bearer user-token"}
    )

    assert google.narrowed_to == [DRIVE_FILE_SCOPE]
    assert token.access_token == "picker-token"
    assert token.account_email == "operations@palmlivingae.com"


@pytest.mark.asyncio
async def test_the_picker_never_gets_a_broader_token() -> None:
    service, google, workspace_id, connection_id = await linked_service()
    google.narrowed_scope = f"{DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/calendar.events"

    with pytest.raises(IntegrationFlowError) as raised:
        await service.picker_token(
            workspace_id, connection_id, {"authorization": "Bearer user-token"}
        )

    assert raised.value.code == "picker_scope_unavailable"


@pytest.mark.asyncio
async def test_a_connection_without_drive_files_cannot_link_or_read_sheets() -> None:
    service, google, workspace_id, connection_id = await linked_service(drive_files=False)

    with pytest.raises(IntegrationFlowError) as picker:
        await service.picker_token(
            workspace_id, connection_id, {"authorization": "Bearer user-token"}
        )
    with pytest.raises(IntegrationFlowError) as read:
        await service.read_sheet(workspace_id, connection_id, "picked-sheet-0001")

    assert picker.value.code == read.value.code == "drive_file_not_granted"
    assert google.narrowed_to is None


@pytest.mark.asyncio
async def test_the_importer_reads_every_grid_tab_as_text() -> None:
    service, google, workspace_id, connection_id = await linked_service()

    read = await service.read_sheet(workspace_id, connection_id, "picked-sheet-0001")

    assert google.ranges == ["'Stock'!A1:CV5000", "'Owner''s notes'!A1:CV5000"]
    assert read["title"] == "Factory stock"
    assert read["sheets"][0] == {
        "name": "Stock",
        "rows": [
            ["Code", "Item", "Qty"],
            ["MAT-001", "Oak veneer", "1,240.5"],
            [],
            ["MAT-002", "", "3"],
        ],
    }
    assert read["rowCounts"] == {"Stock": 4, "Owner's notes": 1}


@pytest.mark.asyncio
async def test_the_importer_reads_one_tab_and_says_when_the_sheet_is_gone() -> None:
    service, google, workspace_id, connection_id = await linked_service()

    preview = await service.read_sheet(
        workspace_id, connection_id, "picked-sheet-0001", "Stock", 30
    )
    assert google.ranges == ["'Stock'!A1:CV30"]
    assert [sheet["name"] for sheet in preview["sheets"]] == ["Stock"]

    with pytest.raises(IntegrationFlowError) as missing_tab:
        await service.read_sheet(workspace_id, connection_id, "picked-sheet-0001", "Fabrics")
    with pytest.raises(IntegrationFlowError) as gone:
        await service.read_sheet(workspace_id, connection_id, "another-sheet-0002")

    assert missing_tab.value.code == "sheet_tab_missing"
    assert gone.value.code == "sheet_unavailable"


@pytest.mark.asyncio
async def test_the_client_narrows_refresh_and_reads_formatted_values() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/token":
            return httpx.Response(
                200, json={"access_token": "a", "expires_in": 3599, "scope": DRIVE_FILE_SCOPE}
            )
        return httpx.Response(200, json={"valueRanges": [{"values": [["Code"], ["MAT-001"]]}, {}]})

    client = GoogleCalendarClient(
        "id",
        "secret",
        "https://wodana.test/callback",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    token = await client.refresh_token("refresh", [DRIVE_FILE_SCOPE])
    values = await client.sheet_values(
        "a", "picked-sheet-0001", ["'Stock'!A1:CV5000", "'Fabrics'!A1:CV5000"]
    )

    assert token.scope == DRIVE_FILE_SCOPE
    assert parse_qs(seen[0].content.decode())["scope"] == [DRIVE_FILE_SCOPE]
    assert seen[1].url.params.get_list("ranges") == ["'Stock'!A1:CV5000", "'Fabrics'!A1:CV5000"]
    assert seen[1].url.params["valueRenderOption"] == "FORMATTED_VALUE"
    assert values == [[["Code"], ["MAT-001"]], []]
