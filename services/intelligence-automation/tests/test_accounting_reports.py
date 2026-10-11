"""Financial statements read from QuickBooks and Zoho Books: the report calls, exact amounts, scopes
and failures, with the providers' HTTP mocked."""

import json
from datetime import date
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from test_providers import CONNECTION, WORKSPACE, connect_fake, service

from wodana_intelligence.container import get_provider_service
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.provider_client import (
    SCOPES,
    ZOHO_REPORT_SCOPES,
    exact_text,
)
from wodana_intelligence.main import app

OCTOBER = [(date(2026, 10, 1), date(2026, 10, 31))]
QUARTER = [
    (date(2026, 7, 1), date(2026, 7, 31)),
    (date(2026, 8, 1), date(2026, 8, 31)),
    (date(2026, 9, 1), date(2026, 9, 30)),
]

QBO_PNL = {
    "Header": {"ReportName": "ProfitAndLoss", "Currency": "AED", "ReportBasis": "Cash"},
    "Columns": {
        "Column": [
            {"ColTitle": "", "ColType": "Account"},
            {"ColTitle": "Total", "ColType": "Money"},
        ]
    },
    "Rows": {
        "Row": [
            {
                "type": "Section",
                "group": "Income",
                "Header": {"ColData": [{"value": "Income"}, {"value": ""}]},
                "Rows": {
                    "Row": [
                        {
                            "type": "Data",
                            "ColData": [{"value": "Design fees", "id": "4"}, {"value": "1234.50"}],
                        }
                    ]
                },
                "Summary": {"ColData": [{"value": "Total Income"}, {"value": "1234.50"}]},
            }
        ]
    },
}


def requests_of(seen: list[httpx.Request], path: str) -> list[httpx.Request]:
    return [request for request in seen if request.url.path.endswith(path)]


def test_zoho_asks_for_the_reports_scope_with_its_other_scopes() -> None:
    assert set(ZOHO_REPORT_SCOPES) == {"ZohoBooks.reports.READ"}
    assert set(ZOHO_REPORT_SCOPES).issubset(SCOPES["zoho_books"])
    # QuickBooks' one accounting scope already covers the Reports API.
    assert SCOPES["quickbooks"] == ["com.intuit.quickbooks.accounting"]


def test_exact_text_keeps_every_digit_and_leaves_text_alone() -> None:
    from decimal import Decimal

    value = {
        "total": Decimal("1234.50"),
        "count": 3,
        "flag": True,
        "name": "Sales",
        "rows": [Decimal("-0.10")],
    }
    assert exact_text(value) == {
        "total": "1234.50",
        "count": "3",
        "flag": True,
        "name": "Sales",
        "rows": ["-0.10"],
    }
    with pytest.raises(ValueError):
        exact_text({"bad": Decimal("NaN")})


@pytest.mark.asyncio
async def test_quickbooks_profit_and_loss_on_cash_basis_in_one_call() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.path == "/v3/company/123/reports/ProfitAndLoss"
        return httpx.Response(200, json=QBO_PNL)

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    result = await instance.accounting_report_internal(
        WORKSPACE, CONNECTION, "quickbooks", "profit_and_loss", OCTOBER, basis="cash"
    )
    [request] = seen
    assert dict(request.url.params) == {
        "start_date": "2026-10-01",
        "end_date": "2026-10-31",
        "summarize_column_by": "Total",
        "accounting_method": "Cash",
        "minorversion": "75",
    }
    assert request.headers["authorization"] == "Bearer access"
    assert result["provider"] == "quickbooks" and result["currency"] == "AED"
    [report] = result["reports"]
    assert (report["from"], report["to"]) == ("2026-10-01", "2026-10-31")
    assert report["data"]["Rows"]["Row"][0]["Summary"]["ColData"][1]["value"] == "1234.50"
    assert (
        "health",
        CONNECTION,
        WORKSPACE,
        "provider.reports.profit_and_loss",
        True,
    ) in core.activities


@pytest.mark.asyncio
async def test_quickbooks_cash_flow_by_month_reads_the_home_currency_when_the_header_has_none() -> (
    None
):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/preferences"):
            return httpx.Response(
                200, json={"Preferences": {"CurrencyPrefs": {"HomeCurrency": {"value": "USD"}}}}
            )
        assert request.url.path == "/v3/company/123/reports/CashFlow"
        return httpx.Response(200, json={"Header": {"ReportName": "CashFlow"}, "Rows": {"Row": []}})

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    result = await instance.accounting_report_internal(
        WORKSPACE, CONNECTION, "quickbooks", "cash_flow", QUARTER, columns="month"
    )
    [report_call] = requests_of(seen, "/reports/CashFlow")
    assert report_call.url.params["start_date"] == "2026-07-01"
    assert report_call.url.params["end_date"] == "2026-09-30"
    assert report_call.url.params["summarize_column_by"] == "Month"
    # Cash flow has no accounting basis.
    assert "accounting_method" not in report_call.url.params
    assert result["currency"] == "USD"
    assert len(result["reports"]) == 1


@pytest.mark.asyncio
async def test_zoho_reads_one_report_per_period_with_exact_amounts_and_its_currency() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.params["organization_id"] == "123"
        assert request.headers["authorization"] == "Zoho-oauthtoken access"
        if request.url.path == "/books/v3/organizations/123":
            return httpx.Response(200, json={"code": 0, "organization": {"currency_code": "INR"}})
        assert request.url.path == "/books/v3/reports/cashflow"
        body = (
            '{"code": 0, "message": "success",'
            ' "cash_flow": [{"name": "Net Change in cash", "total": 1234.50}]}'
        )
        return httpx.Response(
            200, content=body.encode(), headers={"content-type": "application/json"}
        )

    instance, core, redis = service(handler, "zoho_books")
    await connect_fake(instance, core, redis, "zoho_books")
    result = await instance.accounting_report_internal(
        WORKSPACE, CONNECTION, "zoho_books", "cash_flow", QUARTER, columns="month"
    )
    calls = requests_of(seen, "/reports/cashflow")
    assert [(call.url.params["from_date"], call.url.params["to_date"]) for call in calls] == [
        ("2026-07-01", "2026-07-31"),
        ("2026-08-01", "2026-08-31"),
        ("2026-09-01", "2026-09-30"),
    ]
    assert all(call.url.params["filter_by"] == "TransactionDate.CustomDate" for call in calls)
    assert "cash_based" not in calls[0].url.params
    assert result["currency"] == "INR"
    # 1234.50 never passes through a double: the trailing zero is kept.
    assert [report["data"]["cash_flow"][0]["total"] for report in result["reports"]] == [
        "1234.50"
    ] * 3
    assert result["reports"][0]["data"]["code"] == "0"


@pytest.mark.asyncio
async def test_zoho_profit_and_loss_asks_for_the_basis() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/organizations/123"):
            return httpx.Response(200, json={"code": 0, "organization": {"currency_code": "AED"}})
        return httpx.Response(200, json={"code": 0, "profit_and_loss": []})

    instance, core, redis = service(handler, "zoho_books")
    await connect_fake(instance, core, redis, "zoho_books")
    await instance.accounting_report_internal(
        WORKSPACE, CONNECTION, "zoho_books", "profit_and_loss", OCTOBER, basis="cash"
    )
    await instance.accounting_report_internal(
        WORKSPACE, CONNECTION, "zoho_books", "profit_and_loss", OCTOBER
    )
    assert [
        call.url.params["cash_based"] for call in requests_of(seen, "/reports/profitandloss")
    ] == ["true", "false"]


@pytest.mark.asyncio
async def test_zoho_connection_without_the_reports_scope_must_reconnect_before_any_call() -> None:
    seen: list[httpx.Request] = []
    instance, core, redis = service(lambda request: seen.append(request), "zoho_books")
    credential = await connect_fake(instance, core, redis, "zoho_books")
    credential.scopes = [scope for scope in SCOPES["zoho_books"] if scope not in ZOHO_REPORT_SCOPES]
    await redis.set(
        core.runtime["secretReference"], instance.seal(credential.model_dump(mode="json"))
    )
    with pytest.raises(IntegrationFlowError) as raised:
        await instance.accounting_report_internal(
            WORKSPACE, CONNECTION, "zoho_books", "profit_and_loss", OCTOBER
        )
    assert (raised.value.code, raised.value.status_code) == ("reconnect_required", 409)
    assert seen == []
    assert (
        "health",
        CONNECTION,
        WORKSPACE,
        "provider.reports.profit_and_loss",
        False,
        "reconnect_required",
    ) in core.activities


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "code", "http"),
    [
        (401, "reconnect_required", 409),
        (429, "provider_rate_limited", 429),
        (503, "provider_unavailable", 502),
        (400, "provider_request_failed", 502),
    ],
)
async def test_provider_failures_become_fixed_codes_without_provider_text(
    status: int, code: str, http: int
) -> None:
    secret = "access Bearer leaked-text"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"Fault": {"Error": [{"code": "100", "Message": secret}]}}
        )

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    with pytest.raises(IntegrationFlowError) as raised:
        await instance.accounting_report_internal(
            WORKSPACE, CONNECTION, "quickbooks", "profit_and_loss", OCTOBER
        )
    assert (raised.value.code, raised.value.status_code) == (code, http)
    assert secret not in str(raised.value) and "access" not in str(raised.value).split()


@pytest.mark.asyncio
async def test_a_network_failure_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    instance, core, redis = service(handler)
    await connect_fake(instance, core, redis)
    with pytest.raises(IntegrationFlowError) as raised:
        await instance.accounting_report_internal(
            WORKSPACE, CONNECTION, "quickbooks", "cash_flow", OCTOBER
        )
    assert raised.value.code == "provider_unavailable"


def test_the_internal_route_needs_the_internal_token_and_ordered_periods() -> None:
    instance, core, redis = service(lambda request: httpx.Response(200, json=QBO_PNL))
    instance.settings.business_core_internal_token = "internal-token-for-tests"
    path = "/api/v1/integrations/providers/internal/accounting/reports"
    body: dict[str, Any] = {
        "workspaceId": WORKSPACE,
        "connectionId": CONNECTION,
        "provider": "quickbooks",
        "report": "profit_and_loss",
        "basis": "accrual",
        "periods": [{"from": "2026-10-01", "to": "2026-10-31"}],
    }
    app.dependency_overrides[get_provider_service] = lambda: instance
    try:
        with TestClient(app) as client:
            assert client.post(path, json=body).status_code == 401
            assert (
                client.post(
                    path, json=body, headers={"x-wodana-internal-token": "wrong"}
                ).status_code
                == 401
            )
            backwards = {**body, "periods": [{"from": "2026-10-31", "to": "2026-10-01"}]}
            headers = {"x-wodana-internal-token": "internal-token-for-tests"}
            assert client.post(path, json=backwards, headers=headers).status_code == 422
            overlapping = {
                **body,
                "periods": [
                    {"from": "2026-10-01", "to": "2026-10-31"},
                    {"from": "2026-10-15", "to": "2026-11-30"},
                ],
            }
            assert client.post(path, json=overlapping, headers=headers).status_code == 422
            # Not connected yet: the stored credential is missing, so the firm must reconnect.
            response = client.post(path, json=body, headers=headers)
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "credential_missing"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_the_route_returns_the_report_once_connected() -> None:
    instance, core, redis = service(lambda request: httpx.Response(200, json=QBO_PNL))
    await connect_fake(instance, core, redis)
    instance.settings.business_core_internal_token = "internal-token-for-tests"
    app.dependency_overrides[get_provider_service] = lambda: instance
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/integrations/providers/internal/accounting/reports",
                json={
                    "workspaceId": WORKSPACE,
                    "connectionId": CONNECTION,
                    "provider": "quickbooks",
                    "report": "profit_and_loss",
                    "periods": [{"from": "2026-10-01", "to": "2026-10-31"}],
                },
                headers={"x-wodana-internal-token": "internal-token-for-tests"},
            )
        assert response.status_code == 200
        assert json.loads(response.text)["currency"] == "AED"
    finally:
        app.dependency_overrides.clear()
