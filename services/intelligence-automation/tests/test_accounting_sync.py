import json
import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Optional, Union
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from test_providers import CONNECTION, WORKSPACE, connect_fake, service

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.provider_client import (
    SCOPES,
    ProviderClient,
    exact_json_value,
)
from wodana_intelligence.integrations.provider_models import ProviderCredential
from wodana_intelligence.worker.accounting_sync import sync_postings_once

TOKEN = "secret-access-token-4f1c"
EMAIL = "maya.obrien@example.com"
NAME = "Maya O'Brien"
MARKER = "W1a2b3c4d"
QBO_PREFIX = "/v3/company/9130"
ZOHO_PREFIX = "/books/v3"

Route = Union[dict[str, Any], tuple[int, Any], list[Any], Callable[[httpx.Request], Any]]


class Books:
    """A scripted accounting provider: routes (method, path) to responses and records requests."""

    def __init__(self, routes: dict[tuple[str, str], Route]) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        for prefix in (QBO_PREFIX, ZOHO_PREFIX):
            if path.startswith(prefix):
                path = path[len(prefix) :]
        route = self.routes.get((request.method, path))
        if route is None:
            pytest.fail(f"Unexpected provider call {request.method} {path}")
        if isinstance(route, list):
            route = route.pop(0)
        if callable(route):
            route = route(request)
        if isinstance(route, httpx.Response):
            return route
        status, payload = route if isinstance(route, tuple) else (200, route)
        return httpx.Response(status, json=payload)

    def calls(self, method: str, path: str) -> list[httpx.Request]:
        return [
            request
            for request in self.requests
            if request.method == method and request.url.path.endswith(path)
        ]

    def body(self, method: str, path: str, index: int = 0) -> Any:
        return json.loads(self.calls(method, path)[index].content, parse_float=Decimal)


class Core:
    def __init__(self, postings: list[Any], fail_results: int = 0) -> None:
        self.postings = postings
        self.results: list[dict[str, Any]] = []
        self.fail_results = fail_results

    async def _internal_request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        assert method == "POST"
        if path == "/internal/accounting/postings/claim":
            return {"postings": self.postings}
        assert path == "/internal/accounting/postings/result"
        if self.fail_results:
            self.fail_results -= 1
            raise RuntimeError("business-core unavailable")
        self.results.append(kwargs["json"])
        return {"recorded": True}


def settings() -> Settings:
    return Settings(
        quickbooks_client_id="qbo-id",
        quickbooks_client_secret="qbo-secret",
        zoho_client_id="zoho-id",
        zoho_client_secret="zoho-secret",
    )


def credential(provider: str, scopes: Optional[list[str]] = None) -> ProviderCredential:
    quickbooks = provider == "quickbooks"
    return ProviderCredential(
        provider=provider,
        access_token=TOKEN,
        refresh_token="refresh-secret",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        account_id="9130" if quickbooks else "600123",
        configuration={"environment": "sandbox"} if quickbooks else {"region": "us"},
        scopes=SCOPES[provider] if scopes is None else scopes,
    )


def customer(provider_id: Optional[str] = None, name: str = NAME) -> dict[str, Any]:
    return {
        "kind": "customer",
        "providerId": provider_id,
        "name": name,
        "email": EMAIL,
        "taxNumber": "100234567800003",
        "currency": "AED",
    }


def vendor(provider_id: Optional[str] = None) -> dict[str, Any]:
    return {
        "kind": "vendor",
        "providerId": provider_id,
        "name": "Al Noor Timber",
        "email": "accounts@alnoor.example",
        "taxNumber": "100987654300003",
        "currency": "AED",
    }


def invoice_document(item_id: Optional[str] = "7") -> dict[str, Any]:
    return {
        "number": "FAC-INV-2026-00001",
        "date": "2026-09-27",
        "dueDate": "2026-10-10",
        "currency": "AED",
        "reference": "PRJ-0007 · Advance",
        "itemId": item_id,
        "lines": [
            {"description": "Advance 50%", "amount": "3737.50", "taxId": "5"},
            {"description": "Site survey", "amount": "1234567.89", "taxId": None},
        ],
        "net": "1238305.39",
        "tax": "186.88",
        "total": "1238492.27",
    }


def credit_note_document() -> dict[str, Any]:
    return {
        "number": "FAC-CN-2026-00001",
        "date": "2026-09-28",
        "currency": "AED",
        "reference": "FAC-INV-2026-00001",
        "itemId": "7",
        "lines": [{"description": "Advance credited", "amount": "500.00", "taxId": "5"}],
        "net": "500.00",
        "tax": "25.00",
        "total": "525.00",
        "invoiceProviderId": "4400",
        "reason": "Milestone cancelled",
    }


def invoice_payment_document() -> dict[str, Any]:
    return {
        "date": "2026-09-29",
        "currency": "AED",
        "amount": "3924.38",
        "invoiceProviderId": "4400",
        "reference": "PRJ-0007 · Advance",
        "depositAccountId": "35",
    }


def bill_document() -> dict[str, Any]:
    return {
        "number": "SUP-889",
        "date": "2026-09-20",
        "dueDate": "2026-10-20",
        "currency": "AED",
        "reference": "PO-0042",
        "lines": [
            {"description": "Plywood 18mm", "amount": "100.00", "taxId": "8", "accountId": "64"},
            {"description": "Delivery", "amount": "0.25", "taxId": None, "accountId": "65"},
        ],
        "net": "100.25",
        "tax": "5.00",
        "total": "105.25",
    }


def bill_payment_document(method: str = "bank") -> dict[str, Any]:
    return {
        "date": "2026-09-30",
        "currency": "AED",
        "amount": "105.25",
        "billProviderId": "501",
        "reference": "Transfer 7781",
        "paidFromAccountId": "36",
        "method": method,
    }


DOCUMENTS: dict[str, Callable[[], dict[str, Any]]] = {
    "invoice": invoice_document,
    "credit_note": credit_note_document,
    "invoice_payment": invoice_payment_document,
    "bill": bill_document,
    "bill_payment": bill_payment_document,
}


def posting(
    kind: str,
    provider: str = "quickbooks",
    *,
    attempt: int = 0,
    contact: Any = "default",
    document: Optional[dict[str, Any]] = None,
    identity: Optional[str] = None,
) -> dict[str, Any]:
    if contact == "default":
        if kind in ("invoice", "credit_note", "invoice_payment"):
            contact = customer("58")
        elif kind in ("bill", "bill_payment"):
            contact = vendor("77")
        else:
            contact = None
    if document is None:
        document = (
            {"paymentProviderId": "301", "reason": "Paid twice"}
            if kind == "bill_payment_void"
            else DOCUMENTS[kind]()
        )
    return {
        "id": identity or str(uuid4()),
        "leaseToken": str(uuid4()),
        "workspaceId": str(uuid4()),
        "connectionId": str(uuid4()),
        "provider": provider,
        "kind": kind,
        "attempt": attempt,
        "marker": MARKER,
        "contact": contact,
        "document": document,
    }


async def run(
    books: Books,
    *postings: dict[str, Any],
    provider: str = "quickbooks",
    scopes: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    client = ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books)))
    providers = SimpleNamespace(
        client=client,
        runtime_internal=AsyncMock(return_value=({}, credential(provider, scopes))),
    )
    core = Core(list(postings))
    assert await sync_postings_once(core, providers) == len(core.results)
    return core.results


def assert_safe(results: Any) -> None:
    text = json.dumps(results)
    for secret in (TOKEN, "refresh-secret", EMAIL, NAME, "100234567800003"):
        assert secret not in text


def qbo_query(entity: str, rows: list[dict[str, Any]], expected: str) -> Callable[..., Any]:
    def respond(request: httpx.Request) -> dict[str, Any]:
        query = request.url.params["query"]
        assert query == f"select * from {entity} where DisplayName = {expected}"
        return {"QueryResponse": {entity: rows} if rows else {}}

    return respond


# QuickBooks Online


@pytest.mark.asyncio
async def test_quickbooks_invoice_sends_exact_net_lines_with_tax_codes_and_requestid() -> None:
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): {
                "Invoice": {"Id": "130", "DocNumber": "FAC-INV-2026-00001", "TotalAmt": 1238492.27}
            },
        }
    )
    item = posting("invoice")
    [result] = await run(books, item)
    assert result == {
        "id": item["id"],
        "leaseToken": item["leaseToken"],
        "providerId": "130",
        "providerNumber": "FAC-INV-2026-00001",
        "providerTotal": "1238492.27",
    }
    [request] = books.calls("POST", "/invoice")
    assert request.url.host == "sandbox-quickbooks.api.intuit.com"
    assert request.url.params["requestid"] == item["id"]
    assert request.url.params["minorversion"] == "75"
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    body = books.body("POST", "/invoice")
    assert body["CustomerRef"] == {"value": "58"}
    assert body["DocNumber"] == "FAC-INV-2026-00001"
    assert (body["TxnDate"], body["DueDate"]) == ("2026-09-27", "2026-10-10")
    assert body["CurrencyRef"] == {"value": "AED"}
    assert body["PrivateNote"] == f"PRJ-0007 · Advance {MARKER}"
    assert body["GlobalTaxCalculation"] == "TaxExcluded"
    first, second = body["Line"]
    assert first == {
        "DetailType": "SalesItemLineDetail",
        "Amount": Decimal("3737.50"),
        "Description": "Advance 50%",
        "SalesItemLineDetail": {
            "ItemRef": {"value": "7"},
            "Qty": 1,
            "UnitPrice": Decimal("3737.50"),
            "TaxCodeRef": {"value": "5"},
        },
    }
    assert second["Amount"] == Decimal("1234567.89")
    assert "TaxCodeRef" not in second["SalesItemLineDetail"]
    assert b'"Amount": 1234567.89' in request.content


@pytest.mark.asyncio
async def test_quickbooks_finds_customer_by_exact_escaped_name_without_creating_one() -> None:
    books = Books(
        {
            ("GET", "/query"): qbo_query(
                "Customer",
                [{"Id": "58", "DisplayName": NAME, "CurrencyRef": {"value": "AED"}}],
                "'Maya O\\'Brien'",
            ),
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): {"Invoice": {"Id": "130", "TotalAmt": 1238492.27}},
        }
    )
    [result] = await run(books, posting("invoice", contact=customer(None)))
    assert result["contactProviderId"] == "58"
    assert not books.calls("POST", "/customer")
    assert books.body("POST", "/invoice")["CustomerRef"] == {"value": "58"}


@pytest.mark.asyncio
async def test_quickbooks_refuses_an_existing_customer_in_another_currency() -> None:
    books = Books(
        {
            ("GET", "/query"): qbo_query(
                "Customer",
                [{"Id": "58", "DisplayName": NAME, "CurrencyRef": {"value": "USD"}}],
                "'Maya O\\'Brien'",
            ),
        }
    )
    [result] = await run(books, posting("invoice", contact=customer(None)))
    assert result["error"] == {
        "code": "provider_rejected",
        "message": "The accounting contact uses a different currency",
        "retryable": False,
    }
    assert not books.calls("POST", "/invoice")


@pytest.mark.asyncio
async def test_quickbooks_creates_missing_vendor_then_posts_bill_to_expense_accounts() -> None:
    books = Books(
        {
            ("GET", "/query"): qbo_query("Vendor", [], "'Al Noor Timber'"),
            ("POST", "/vendor"): {"Vendor": {"Id": "77", "DisplayName": "Al Noor Timber"}},
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/bill"): {"Bill": {"Id": "501", "DocNumber": "SUP-889", "TotalAmt": 105.25}},
        }
    )
    item = posting("bill", contact=vendor(None))
    [result] = await run(books, item)
    assert result["providerId"] == "501"
    assert result["providerTotal"] == "105.25"
    assert result["contactProviderId"] == "77"
    [created] = books.calls("POST", "/vendor")
    assert created.url.params["requestid"] != item["id"]
    UUID(created.url.params["requestid"])
    assert books.body("POST", "/vendor") == {
        "DisplayName": "Al Noor Timber",
        "CurrencyRef": {"value": "AED"},
        "PrimaryEmailAddr": {"Address": "accounts@alnoor.example"},
        "TaxIdentifier": "100987654300003",
    }
    [bill_request] = books.calls("POST", "/bill")
    assert bill_request.url.params["requestid"] == item["id"]
    body = books.body("POST", "/bill")
    assert body["VendorRef"] == {"value": "77"}
    assert body["DocNumber"] == "SUP-889"
    assert (body["TxnDate"], body["DueDate"]) == ("2026-09-20", "2026-10-20")
    assert body["PrivateNote"] == f"PO-0042 {MARKER}"
    assert body["GlobalTaxCalculation"] == "TaxExcluded"
    assert body["Line"] == [
        {
            "DetailType": "AccountBasedExpenseLineDetail",
            "Amount": Decimal("100.00"),
            "Description": "Plywood 18mm",
            "AccountBasedExpenseLineDetail": {
                "AccountRef": {"value": "64"},
                "TaxCodeRef": {"value": "8"},
            },
        },
        {
            "DetailType": "AccountBasedExpenseLineDetail",
            "Amount": Decimal("0.25"),
            "Description": "Delivery",
            "AccountBasedExpenseLineDetail": {"AccountRef": {"value": "65"}},
        },
    ]


@pytest.mark.asyncio
async def test_quickbooks_creates_customer_with_email_and_tax_number() -> None:
    books = Books(
        {
            ("GET", "/query"): qbo_query("Customer", [], "'Maya O\\'Brien'"),
            ("POST", "/customer"): {"Customer": {"Id": "59"}},
            ("POST", "/payment"): {"Payment": {"Id": "880", "TotalAmt": 3924.38}},
        }
    )
    [result] = await run(books, posting("invoice_payment", contact=customer(None)))
    assert result["contactProviderId"] == "59"
    assert books.body("POST", "/customer") == {
        "DisplayName": NAME,
        "CurrencyRef": {"value": "AED"},
        "PrimaryEmailAddr": {"Address": EMAIL},
        "PrimaryTaxIdentifier": "100234567800003",
    }


@pytest.mark.asyncio
async def test_quickbooks_credit_memo_for_us_company_leaves_tax_model_alone() -> None:
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "US"}},
            ("POST", "/creditmemo"): {
                "CreditMemo": {"Id": "140", "DocNumber": "FAC-CN-2026-00001", "TotalAmt": 525.0}
            },
        }
    )
    item = posting("credit_note")
    [result] = await run(books, item)
    assert result["providerId"] == "140"
    assert result["providerNumber"] == "FAC-CN-2026-00001"
    assert Decimal(result["providerTotal"]) == Decimal("525.00")
    body = books.body("POST", "/creditmemo")
    assert "GlobalTaxCalculation" not in body and "DueDate" not in body
    assert body["DocNumber"] == "FAC-CN-2026-00001"
    assert body["PrivateNote"] == f"FAC-INV-2026-00001 Milestone cancelled {MARKER}"
    assert body["Line"][0]["SalesItemLineDetail"]["ItemRef"] == {"value": "7"}
    assert books.calls("POST", "/creditmemo")[0].url.params["requestid"] == item["id"]


@pytest.mark.asyncio
async def test_quickbooks_payment_links_the_invoice_and_deposit_account() -> None:
    books = Books({("POST", "/payment"): {"Payment": {"Id": "880", "TotalAmt": 3924.38}}})
    item = posting("invoice_payment")
    [result] = await run(books, item)
    assert result == {
        "id": item["id"],
        "leaseToken": item["leaseToken"],
        "providerId": "880",
        "providerNumber": None,
        "providerTotal": "3924.38",
    }
    [request] = books.calls("POST", "/payment")
    assert request.url.params["requestid"] == item["id"]
    assert books.body("POST", "/payment") == {
        "CustomerRef": {"value": "58"},
        "TotalAmt": Decimal("3924.38"),
        "TxnDate": "2026-09-29",
        "CurrencyRef": {"value": "AED"},
        "PrivateNote": f"PRJ-0007 · Advance {MARKER}",
        "Line": [
            {"Amount": Decimal("3924.38"), "LinkedTxn": [{"TxnId": "4400", "TxnType": "Invoice"}]}
        ],
        "PaymentRefNum": "PRJ-0007 · Advance",
        "DepositToAccountRef": {"value": "35"},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "pay_type", "detail", "account_key"),
    [
        ("bank", "Check", "CheckPayment", "BankAccountRef"),
        ("cheque", "Check", "CheckPayment", "BankAccountRef"),
        ("cash", "Check", "CheckPayment", "BankAccountRef"),
        ("card", "CreditCard", "CreditCardPayment", "CCAccountRef"),
    ],
)
async def test_quickbooks_bill_payment_pays_from_the_chosen_account(
    method: str, pay_type: str, detail: str, account_key: str
) -> None:
    books = Books({("POST", "/billpayment"): {"BillPayment": {"Id": "301", "TotalAmt": 105.25}}})
    item = posting("bill_payment", document=bill_payment_document(method))
    [result] = await run(books, item)
    assert result["providerId"] == "301" and result["providerTotal"] == "105.25"
    body = books.body("POST", "/billpayment")
    assert body["PayType"] == pay_type
    assert body[detail] == {account_key: {"value": "36"}}
    assert body["VendorRef"] == {"value": "77"}
    assert body["TotalAmt"] == Decimal("105.25")
    assert body["Line"] == [
        {"Amount": Decimal("105.25"), "LinkedTxn": [{"TxnId": "501", "TxnType": "Bill"}]}
    ]
    assert books.calls("POST", "/billpayment")[0].url.params["requestid"] == item["id"]


@pytest.mark.asyncio
async def test_quickbooks_voids_a_bill_payment_with_its_current_sync_token() -> None:
    books = Books(
        {
            ("GET", "/billpayment/301"): {
                "BillPayment": {"Id": "301", "SyncToken": "2", "TotalAmt": 105.25}
            },
            ("POST", "/billpayment"): {
                "BillPayment": {"Id": "301", "TotalAmt": 0, "PrivateNote": "Voided"}
            },
        }
    )
    item = posting("bill_payment_void")
    [result] = await run(books, item)
    assert result["providerId"] == "301" and "error" not in result
    [void] = books.calls("POST", "/billpayment")
    assert void.url.params["operation"] == "update"
    assert void.url.params["include"] == "void"
    assert void.url.params["requestid"] == item["id"]
    assert books.body("POST", "/billpayment") == {"Id": "301", "SyncToken": "2", "sparse": True}
    assert not books.calls("DELETE", "/billpayment/301")


@pytest.mark.asyncio
async def test_quickbooks_already_voided_payment_is_not_voided_again() -> None:
    books = Books(
        {
            ("GET", "/billpayment/301"): {
                "BillPayment": {
                    "Id": "301",
                    "SyncToken": "3",
                    "TotalAmt": 0,
                    "PrivateNote": "Voided - RC 93",
                }
            },
        }
    )
    [result] = await run(books, posting("bill_payment_void", attempt=1))
    assert result["providerId"] == "301" and "error" not in result
    assert not books.calls("POST", "/billpayment")


@pytest.mark.asyncio
async def test_quickbooks_retry_after_outage_or_timeout_reuses_the_same_requestid() -> None:
    def timeout(request: httpx.Request) -> Any:
        raise httpx.ReadTimeout("timed out", request=request)

    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): [
                (503, {"Fault": {"Error": [{"code": "10000"}]}}),
                timeout,
                {"Invoice": {"Id": "130", "DocNumber": "FAC-INV-2026-00001", "TotalAmt": 1}},
            ],
        }
    )
    identity = str(uuid4())
    results = []
    for attempt in range(3):
        results += await run(books, posting("invoice", attempt=attempt, identity=identity))
    assert [result.get("error", {}).get("retryable") for result in results] == [True, True, None]
    assert results[0]["error"]["code"] == "provider_unavailable"
    assert results[2]["providerId"] == "130"
    assert {request.url.params["requestid"] for request in books.calls("POST", "/invoice")} == {
        identity
    }


@pytest.mark.asyncio
async def test_quickbooks_duplicate_number_resolves_to_the_document_this_posting_made() -> None:
    def lookup(request: httpx.Request) -> dict[str, Any]:
        assert request.url.params["query"] == (
            "select * from Invoice where DocNumber = 'FAC-INV-2026-00001'"
        )
        return {
            "QueryResponse": {
                "Invoice": [
                    {"Id": "99", "DocNumber": "FAC-INV-2026-00001", "PrivateNote": "manual"},
                    {
                        "Id": "130",
                        "DocNumber": "FAC-INV-2026-00001",
                        "PrivateNote": f"PRJ-0007 · Advance {MARKER}",
                        "TotalAmt": 1238492.27,
                    },
                ]
            }
        }

    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): (
                400,
                {"Fault": {"Error": [{"Message": "Duplicate Document Number", "code": "6140"}]}},
            ),
            ("GET", "/query"): lookup,
        }
    )
    [result] = await run(books, posting("invoice", attempt=1))
    assert result["providerId"] == "130"
    assert result["providerTotal"] == "1238492.27"


@pytest.mark.asyncio
async def test_quickbooks_invoice_without_item_mapping_is_refused_before_any_call() -> None:
    books = Books({})
    [result] = await run(
        books, posting("invoice", contact=customer(None), document=invoice_document(None))
    )
    assert result["error"] == {
        "code": "mapping_required",
        "message": "Choose the accounting item for invoice lines",
        "retryable": False,
    }
    assert books.requests == []


@pytest.mark.asyncio
async def test_quickbooks_expired_access_is_not_retried_and_never_echoes_provider_text() -> None:
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): (
                401,
                {"Fault": {"Error": [{"Message": f"{TOKEN} {EMAIL} {NAME}", "code": "3200"}]}},
            ),
        }
    )
    [result] = await run(books, posting("invoice"))
    assert result["error"] == {
        "code": "connection_expired",
        "message": "Reconnect the accounting connection",
        "retryable": False,
    }
    assert_safe(result)


@pytest.mark.asyncio
async def test_quickbooks_validation_error_reports_only_the_provider_code() -> None:
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): (
                400,
                {
                    "Fault": {
                        "Error": [
                            {
                                "Message": "A business validation error has occurred",
                                "Detail": f"Customer {NAME} ({EMAIL}) cannot be used",
                                "code": "6000",
                            }
                        ]
                    }
                },
            ),
        }
    )
    [result] = await run(books, posting("invoice"))
    assert result["error"] == {
        "code": "provider_rejected",
        "message": "The accounting system rejected the document (error 6000)",
        "retryable": False,
    }
    assert_safe(result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("code", "message"),
    [
        ("6140", "The document number is already used in the accounting system (error 6140)"),
        ("6210", "The accounting period for this date is closed (error 6210)"),
        (
            "2500",
            "An item, account, tax code or contact on this document is not valid in the "
            "accounting system (error 2500)",
        ),
    ],
)
async def test_quickbooks_known_rejections_get_fixed_sentences(code: str, message: str) -> None:
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): (400, {"Fault": {"Error": [{"code": code}]}}),
            ("GET", "/query"): {"QueryResponse": {}},
        }
    )
    [result] = await run(books, posting("invoice"))
    assert result["error"] == {"code": "provider_rejected", "message": message, "retryable": False}


# Zoho Books


def zoho(payload: dict[str, Any]) -> dict[str, Any]:
    return {"code": 0, "message": "success", **payload}


def zoho_contact(contact_id: str, currency: str = "AED") -> Route:
    return zoho({"contact": {"contact_id": contact_id, "currency_code": currency}})


@pytest.mark.asyncio
async def test_zoho_invoice_uses_exact_named_customer_and_net_line_items() -> None:
    books = Books(
        {
            ("GET", "/contacts"): zoho(
                {
                    "contacts": [
                        {
                            "contact_id": "901",
                            "contact_name": f"{NAME} Ltd",
                            "currency_code": "AED",
                        },
                        {
                            "contact_id": "902",
                            "contact_name": NAME,
                            "contact_type": "customer",
                            "currency_code": "AED",
                        },
                    ]
                }
            ),
            ("POST", "/invoices"): zoho(
                {
                    "invoice": {
                        "invoice_id": "4400",
                        "invoice_number": "FAC-INV-2026-00001",
                        "total": 1238492.27,
                    }
                }
            ),
        }
    )
    item = posting("invoice", "zoho_books", contact=customer(None))
    [result] = await run(books, item, provider="zoho_books")
    assert result == {
        "id": item["id"],
        "leaseToken": item["leaseToken"],
        "providerId": "4400",
        "providerNumber": "FAC-INV-2026-00001",
        "providerTotal": "1238492.27",
        "contactProviderId": "902",
    }
    [search] = books.calls("GET", "/contacts")
    assert search.url.params["contact_name"] == NAME
    assert search.url.params["contact_type"] == "customer"
    assert not books.calls("POST", "/contacts")
    [create] = books.calls("POST", "/invoices")
    assert create.url.host == "www.zohoapis.com"
    assert create.url.params["organization_id"] == "600123"
    assert create.url.params["ignore_auto_number_generation"] == "true"
    assert create.headers["authorization"] == f"Zoho-oauthtoken {TOKEN}"
    assert books.body("POST", "/invoices") == {
        "invoice_number": "FAC-INV-2026-00001",
        "customer_id": "902",
        "date": "2026-09-27",
        "due_date": "2026-10-10",
        "reference_number": "PRJ-0007 · Advance",
        "line_items": [
            {
                "item_id": "7",
                "description": "Advance 50%",
                "rate": Decimal("3737.50"),
                "quantity": 1,
                "tax_id": "5",
            },
            {
                "item_id": "7",
                "description": "Site survey",
                "rate": Decimal("1234567.89"),
                "quantity": 1,
            },
        ],
        "is_inclusive_tax": False,
    }


@pytest.mark.asyncio
async def test_zoho_creates_missing_contacts_with_currency_id_looked_up_once() -> None:
    created = iter(["903", "904"])
    books = Books(
        {
            ("GET", "/contacts"): zoho({"contacts": []}),
            ("GET", "/settings/currencies"): zoho(
                {
                    "currencies": [
                        {"currency_id": "3000000000100", "currency_code": "USD"},
                        {"currency_id": "3000000000123", "currency_code": "AED"},
                    ]
                }
            ),
            ("POST", "/contacts"): lambda _: zoho({"contact": {"contact_id": next(created)}}),
            ("POST", "/invoices"): lambda request: zoho(
                {
                    "invoice": {
                        "invoice_id": "44" + json.loads(request.content)["customer_id"],
                        "total": 1,
                    }
                }
            ),
        }
    )
    results = await run(
        books,
        posting("invoice", "zoho_books", contact=customer(None)),
        posting("invoice", "zoho_books", contact=customer(None, name="Omar Haddad")),
        provider="zoho_books",
    )
    assert [result["contactProviderId"] for result in results] == ["903", "904"]
    assert len(books.calls("GET", "/settings/currencies")) == 1
    assert books.body("POST", "/contacts") == {
        "contact_name": NAME,
        "contact_type": "customer",
        "currency_id": "3000000000123",
    }
    assert books.body("POST", "/contacts", 1)["contact_name"] == "Omar Haddad"


@pytest.mark.asyncio
async def test_zoho_refuses_linked_contact_in_another_currency() -> None:
    books = Books({("GET", "/contacts/902"): zoho_contact("902", "USD")})
    [result] = await run(
        books, posting("invoice", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["error"]["message"] == "The accounting contact uses a different currency"
    assert not books.calls("POST", "/invoices")


@pytest.mark.asyncio
async def test_zoho_credit_note_is_applied_to_the_invoice_balance() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/creditnotes"): zoho(
                {
                    "creditnote": {
                        "creditnote_id": "7700",
                        "creditnote_number": "FAC-CN-2026-00001",
                        "total": 525.0,
                        "balance": 525.0,
                    }
                }
            ),
            ("GET", "/invoices/4400"): zoho({"invoice": {"invoice_id": "4400", "balance": 300.1}}),
            ("POST", "/creditnotes/7700/invoices"): zoho({}),
        }
    )
    [result] = await run(
        books, posting("credit_note", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["providerId"] == "7700"
    assert result["providerNumber"] == "FAC-CN-2026-00001"
    assert "warning" not in result and "error" not in result
    create = books.calls("POST", "/creditnotes")[0]
    assert create.url.params["ignore_auto_number_generation"] == "true"
    assert books.body("POST", "/creditnotes") == {
        "creditnote_number": "FAC-CN-2026-00001",
        "customer_id": "902",
        "date": "2026-09-28",
        "reference_number": "FAC-INV-2026-00001",
        "line_items": [
            {
                "item_id": "7",
                "description": "Advance credited",
                "rate": Decimal("500.00"),
                "quantity": 1,
                "tax_id": "5",
            }
        ],
        "is_inclusive_tax": False,
    }
    assert books.body("POST", "/creditnotes/7700/invoices") == {
        "invoices": [{"invoice_id": "4400", "amount_applied": Decimal("300.1")}]
    }


@pytest.mark.asyncio
async def test_zoho_credit_note_apply_failure_is_a_warning_not_a_failure() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/creditnotes"): zoho(
                {"creditnote": {"creditnote_id": "7700", "total": 525.0, "balance": 525.0}}
            ),
            ("GET", "/invoices/4400"): zoho({"invoice": {"invoice_id": "4400", "balance": 525.0}}),
            ("POST", "/creditnotes/7700/invoices"): (400, {"code": 4, "message": NAME}),
        }
    )
    [result] = await run(
        books, posting("credit_note", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["providerId"] == "7700" and "error" not in result
    assert result["warning"] == {
        "code": "credit_not_applied",
        "message": "The credit note was created but could not be applied to the invoice",
    }


@pytest.mark.asyncio
async def test_zoho_credit_note_skips_apply_when_the_invoice_is_settled() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/creditnotes"): zoho(
                {"creditnote": {"creditnote_id": "7700", "total": 525.0, "balance": 525.0}}
            ),
            ("GET", "/invoices/4400"): zoho({"invoice": {"invoice_id": "4400", "balance": 0}}),
        }
    )
    [result] = await run(
        books, posting("credit_note", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert "warning" not in result and not books.calls("POST", "/creditnotes/7700/invoices")


@pytest.mark.asyncio
async def test_zoho_customer_payment_carries_the_marker_in_its_reference() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/customerpayments"): zoho(
                {"payment": {"payment_id": "5500", "payment_number": "12", "amount": 3924.38}}
            ),
        }
    )
    [result] = await run(
        books,
        posting("invoice_payment", "zoho_books", contact=customer("902")),
        provider="zoho_books",
    )
    assert (result["providerId"], result["providerNumber"], result["providerTotal"]) == (
        "5500",
        "12",
        "3924.38",
    )
    assert books.body("POST", "/customerpayments") == {
        "customer_id": "902",
        "payment_mode": "banktransfer",
        "amount": Decimal("3924.38"),
        "date": "2026-09-29",
        "reference_number": f"PRJ-0007 · Advance {MARKER}",
        "invoices": [{"invoice_id": "4400", "amount_applied": Decimal("3924.38")}],
        "account_id": "35",
    }


@pytest.mark.asyncio
async def test_zoho_long_reference_is_shortened_but_keeps_the_marker() -> None:
    document = invoice_payment_document()
    document["reference"] = "R" * 150
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/customerpayments"): zoho({"payment": {"payment_id": "5500"}}),
        }
    )
    await run(
        books,
        posting("invoice_payment", "zoho_books", contact=customer("902"), document=document),
        provider="zoho_books",
    )
    reference = books.body("POST", "/customerpayments")["reference_number"]
    assert len(reference) == 100 and reference.endswith(f" {MARKER}")


@pytest.mark.asyncio
async def test_zoho_bill_and_vendor_payment_bodies() -> None:
    books = Books(
        {
            ("GET", "/contacts/905"): zoho_contact("905"),
            ("POST", "/bills"): zoho(
                {"bill": {"bill_id": "6600", "bill_number": "SUP-889", "total": 105.25}}
            ),
            ("POST", "/vendorpayments"): zoho(
                {"vendorpayment": {"payment_id": "8800", "payment_number": "7", "amount": 105.25}}
            ),
        }
    )
    results = await run(
        books,
        posting("bill", "zoho_books", contact=vendor("905")),
        posting(
            "bill_payment",
            "zoho_books",
            contact=vendor("905"),
            document=bill_payment_document("cheque"),
        ),
        provider="zoho_books",
    )
    assert [result["providerId"] for result in results] == ["6600", "8800"]
    assert "ignore_auto_number_generation" not in books.calls("POST", "/bills")[0].url.params
    assert books.body("POST", "/bills") == {
        "bill_number": "SUP-889",
        "vendor_id": "905",
        "date": "2026-09-20",
        "reference_number": "PO-0042",
        "line_items": [
            {
                "account_id": "64",
                "description": "Plywood 18mm",
                "rate": Decimal("100.00"),
                "quantity": 1,
                "tax_id": "8",
            },
            {"account_id": "65", "description": "Delivery", "rate": Decimal("0.25"), "quantity": 1},
        ],
        "is_inclusive_tax": False,
        "due_date": "2026-10-20",
    }
    assert books.body("POST", "/vendorpayments") == {
        "vendor_id": "905",
        "payment_mode": "check",
        "amount": Decimal("105.25"),
        "date": "2026-09-30",
        "reference_number": f"Transfer 7781 {MARKER}",
        "paid_through_account_id": "36",
        "bills": [{"bill_id": "501", "amount_applied": Decimal("105.25")}],
    }


@pytest.mark.asyncio
async def test_zoho_retry_finds_the_invoice_it_already_created() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("GET", "/invoices"): zoho(
                {
                    "invoices": [
                        {
                            "invoice_id": "4400",
                            "invoice_number": "FAC-INV-2026-00001",
                            "customer_id": "902",
                            "total": 1238492.27,
                        }
                    ]
                }
            ),
        }
    )
    [result] = await run(
        books,
        posting("invoice", "zoho_books", attempt=1, contact=customer("902")),
        provider="zoho_books",
    )
    assert result["providerId"] == "4400" and result["providerTotal"] == "1238492.27"
    assert books.calls("GET", "/invoices")[0].url.params["invoice_number"] == "FAC-INV-2026-00001"
    assert not books.calls("POST", "/invoices")


@pytest.mark.asyncio
async def test_zoho_retry_finds_payments_by_marker_and_does_not_pay_twice() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("GET", "/customerpayments"): zoho(
                {
                    "customerpayments": [
                        {
                            "payment_id": "5400",
                            "reference_number": "PRJ-0007 · Advance W1a2b3c4dX",
                            "customer_id": "902",
                        },
                        {
                            "payment_id": "5500",
                            "payment_number": "12",
                            "reference_number": f"PRJ-0007 · Advance {MARKER}",
                            "customer_id": "902",
                            "amount": 3924.38,
                        },
                    ]
                }
            ),
        }
    )
    [result] = await run(
        books,
        posting("invoice_payment", "zoho_books", attempt=2, contact=customer("902")),
        provider="zoho_books",
    )
    assert result["providerId"] == "5500"
    assert books.calls("GET", "/customerpayments")[0].url.params["reference_number_contains"] == (
        MARKER
    )
    assert not books.calls("POST", "/customerpayments")


@pytest.mark.asyncio
async def test_zoho_first_attempt_creates_when_the_retry_search_finds_nothing() -> None:
    books = Books(
        {
            ("GET", "/contacts/905"): zoho_contact("905"),
            ("GET", "/vendorpayments"): zoho({"vendorpayments": []}),
            ("POST", "/vendorpayments"): zoho({"vendorpayment": {"payment_id": "8800"}}),
        }
    )
    [result] = await run(
        books,
        posting("bill_payment", "zoho_books", attempt=1, contact=vendor("905")),
        provider="zoho_books",
    )
    assert result["providerId"] == "8800"
    assert len(books.calls("POST", "/vendorpayments")) == 1


@pytest.mark.asyncio
async def test_zoho_number_already_exists_resolves_to_the_existing_invoice() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/invoices"): (
                400,
                {"code": 1001, "message": 'Invoice "FAC-INV-2026-00001" already exists.'},
            ),
            ("GET", "/invoices"): zoho(
                {
                    "invoices": [
                        {
                            "invoice_id": "4400",
                            "invoice_number": "FAC-INV-2026-00001",
                            "customer_id": "902",
                            "total": 10,
                        }
                    ]
                }
            ),
        }
    )
    [result] = await run(
        books, posting("invoice", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["providerId"] == "4400" and "error" not in result
    assert len(books.calls("POST", "/invoices")) == 1


@pytest.mark.asyncio
async def test_zoho_number_used_by_another_customer_is_rejected() -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/invoices"): (400, {"code": 1001, "message": "already exists"}),
            ("GET", "/invoices"): zoho(
                {
                    "invoices": [
                        {
                            "invoice_id": "4401",
                            "invoice_number": "FAC-INV-2026-00001",
                            "customer_id": "777",
                        }
                    ]
                }
            ),
        }
    )
    [result] = await run(
        books, posting("invoice", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["error"] == {
        "code": "provider_rejected",
        "message": "The document number is already used in the accounting system for another "
        "contact",
        "retryable": False,
    }


@pytest.mark.asyncio
async def test_zoho_void_deletes_the_vendor_payment_and_tolerates_an_earlier_delete() -> None:
    books = Books({("DELETE", "/vendorpayments/301"): [zoho({}), (404, {"code": 1002})]})
    first = await run(books, posting("bill_payment_void", "zoho_books"), provider="zoho_books")
    again = await run(
        books, posting("bill_payment_void", "zoho_books", attempt=1), provider="zoho_books"
    )
    assert [result["providerId"] for result in first + again] == ["301", "301"]
    assert all("error" not in result for result in first + again)
    assert len(books.calls("DELETE", "/vendorpayments/301")) == 2


@pytest.mark.asyncio
async def test_zoho_void_of_a_missing_payment_on_first_attempt_is_rejected() -> None:
    books = Books({("DELETE", "/vendorpayments/301"): (404, {"code": 1002})})
    [result] = await run(books, posting("bill_payment_void", "zoho_books"), provider="zoho_books")
    assert result["error"] == {
        "code": "provider_rejected",
        "message": "A linked record no longer exists in the accounting system (error 1002)",
        "retryable": False,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (503, "provider_unavailable", True),
        (500, "provider_unavailable", True),
        (429, "rate_limited", True),
        (401, "connection_expired", False),
        (403, "connection_expired", False),
    ],
)
async def test_zoho_status_mapping(status: int, code: str, retryable: bool) -> None:
    books = Books(
        {
            ("GET", "/contacts/902"): zoho_contact("902"),
            ("POST", "/invoices"): (status, {"code": 57, "message": f"{TOKEN} {EMAIL}"}),
        }
    )
    [result] = await run(
        books, posting("invoice", "zoho_books", contact=customer("902")), provider="zoho_books"
    )
    assert result["error"]["code"] == code
    assert result["error"]["retryable"] is retryable
    assert_safe(result)


@pytest.mark.asyncio
async def test_zoho_connection_without_write_scopes_must_reconnect_before_any_call() -> None:
    books = Books({})
    old_scopes = [scope for scope in SCOPES["zoho_books"] if not scope.endswith(".CREATE")]
    [result] = await run(
        books,
        posting("invoice", "zoho_books", contact=customer(None)),
        provider="zoho_books",
        scopes=old_scopes,
    )
    assert result["error"] == {
        "code": "connection_expired",
        "message": "Reconnect the accounting connection",
        "retryable": False,
    }
    assert books.requests == []


# The worker


@pytest.mark.asyncio
async def test_worker_reports_one_result_per_posting_and_keeps_going_after_failures(
    caplog: pytest.LogCaptureFixture,
) -> None:
    malformed = posting("invoice")
    malformed["document"]["lines"][0]["amount"] = 3737.5  # a JSON number, not a decimal string
    unbalanced = posting("invoice")
    unbalanced["document"]["total"] = "1.00"
    books = Books(
        {
            ("GET", "/companyinfo/9130"): {"CompanyInfo": {"Country": "AE"}},
            ("POST", "/invoice"): [
                (503, {"Fault": {"Error": [{"Message": EMAIL}]}}),
                {"Invoice": {"Id": "131", "TotalAmt": 1238492.27}},
            ],
        }
    )
    failing, working = posting("invoice"), posting("invoice")
    client = ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books)))
    providers = SimpleNamespace(
        client=client,
        runtime_internal=AsyncMock(return_value=({}, credential("quickbooks"))),
    )
    core = Core(
        [{"id": "not-a-uuid", "leaseToken": "x"}, malformed, unbalanced, failing, working]
    )
    with caplog.at_level(logging.DEBUG):
        assert await sync_postings_once(core, providers) == 4
    assert [result["id"] for result in core.results] == [
        malformed["id"],
        unbalanced["id"],
        failing["id"],
        working["id"],
    ]
    invalid, totals, unavailable, success = core.results
    assert invalid["error"] == {
        "code": "invalid_posting",
        "message": (
            "Invalid posting: document.invoice.lines.0.amount (must be a non-negative decimal "
            "string with at most 3 decimals)"
        ),
        "retryable": False,
    }
    assert "3737.5" not in json.dumps(invalid)
    assert totals["error"]["code"] == "invalid_posting"
    assert "net plus tax must equal total" in totals["error"]["message"]
    assert unavailable["error"]["retryable"] is True
    assert success["providerId"] == "131" and "error" not in success
    assert_safe(core.results)
    for secret in (TOKEN, EMAIL, NAME):
        assert secret not in caplog.text
    providers.runtime_internal.assert_awaited_with(
        working["workspaceId"], "quickbooks", working["connectionId"]
    )


@pytest.mark.asyncio
async def test_worker_continues_when_a_result_cannot_be_recorded() -> None:
    books = Books({("POST", "/payment"): {"Payment": {"Id": "880", "TotalAmt": 1}}})
    client = ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books)))
    providers = SimpleNamespace(
        client=client,
        runtime_internal=AsyncMock(return_value=({}, credential("quickbooks"))),
    )
    first, second = posting("invoice_payment"), posting("invoice_payment")
    core = Core([first, second], fail_results=1)
    assert await sync_postings_once(core, providers) == 1
    assert [result["id"] for result in core.results] == [second["id"]]
    assert len(books.calls("POST", "/payment")) == 2


@pytest.mark.asyncio
async def test_worker_rejects_postings_whose_contact_does_not_fit_the_document() -> None:
    wrong_kind = posting("bill", contact=customer("58"))
    wrong_currency = posting("invoice", contact={**customer("58"), "currency": "USD"})
    no_contact = posting("invoice_payment", contact=None)
    results = await run(Books({}), wrong_kind, wrong_currency, no_contact)
    assert [result["error"]["code"] for result in results] == ["invalid_posting"] * 3
    assert "the contact must be a vendor" in results[0]["error"]["message"]
    assert "currencies differ" in results[1]["error"]["message"]
    assert "a customer contact is required" in results[2]["error"]["message"]
    assert_safe(results)


@pytest.mark.asyncio
async def test_worker_rejects_zero_payments() -> None:
    document = invoice_payment_document()
    document["amount"] = "0.00"
    [result] = await run(Books({}), posting("invoice_payment", document=document))
    assert result["error"]["code"] == "invalid_posting"
    assert "document.invoice_payment.amount" in result["error"]["message"]


@pytest.mark.asyncio
async def test_worker_leaves_postings_it_cannot_start_within_the_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from wodana_intelligence.worker import accounting_sync

    monkeypatch.setattr(accounting_sync, "BATCH_BUDGET_SECONDS", -1.0)
    books = Books({})
    core = Core([posting("invoice_payment")])
    providers = SimpleNamespace(
        client=ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books))),
        runtime_internal=AsyncMock(),
    )
    assert await sync_postings_once(core, providers) == 0
    assert core.results == [] and books.requests == []
    providers.runtime_internal.assert_not_awaited()


@pytest.mark.asyncio
async def test_poll_loop_survives_failures_without_logging_them_and_stops_when_cancelled(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import asyncio

    from wodana_intelligence.worker import accounting_sync

    sleep = AsyncMock(side_effect=[None, asyncio.CancelledError()])
    monkeypatch.setattr(accounting_sync.asyncio, "sleep", sleep)
    core = SimpleNamespace(_internal_request=AsyncMock(side_effect=RuntimeError(EMAIL)))
    with caplog.at_level(logging.WARNING), pytest.raises(asyncio.CancelledError):
        await accounting_sync.poll_postings(core, SimpleNamespace(client=None))
    assert core._internal_request.await_count == 2
    sleep.assert_awaited_with(30)
    assert "Accounting posting will retry" in caplog.text and EMAIL not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("token_response", "code", "retryable"),
    [
        ((400, {"error": "invalid_grant"}), "connection_expired", False),
        ((401, {"error": "invalid_client"}), "connection_expired", False),
        ((503, {}), "provider_unavailable", True),
    ],
)
async def test_worker_maps_token_refresh_failures(
    token_response: tuple[int, Any], code: str, retryable: bool
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "tokens" in request.url.path, "no accounting call without a fresh token"
        return httpx.Response(token_response[0], json=token_response[1])

    instance, core, redis = service(handler)
    stored = await connect_fake(instance, core, redis)
    stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    await redis.set(core.runtime["secretReference"], instance.seal(stored.model_dump(mode="json")))
    item = posting("invoice")
    item.update(workspaceId=WORKSPACE, connectionId=CONNECTION)
    business_core = Core([item])
    assert await sync_postings_once(business_core, instance) == 1
    [result] = business_core.results
    assert result["error"]["code"] == code
    assert result["error"]["retryable"] is retryable
    assert_safe(result)


# Transport and mapping reads


@pytest.mark.parametrize(
    "value", ["0.10", "3737.50", "999999999999.999", "1234567.89", "0.001", "100"]
)
def test_amounts_reach_provider_json_exactly(value: str) -> None:
    encoded = json.dumps(exact_json_value({"Amount": Decimal(value)}))
    assert json.loads(encoded, parse_float=Decimal)["Amount"] == Decimal(value)


def test_amounts_beyond_double_precision_are_never_rounded_silently() -> None:
    with pytest.raises(ValueError):
        exact_json_value(Decimal("12345678901234567.89"))


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "entity"), [("accounts", "Account"), ("taxes", "TaxCode")])
async def test_quickbooks_lists_accounts_and_tax_codes_for_mapping(kind: str, entity: str) -> None:
    def respond(request: httpx.Request) -> dict[str, Any]:
        assert request.url.params["query"] == (
            f"select * from {entity} startposition 51 maxresults 50"
        )
        return {"QueryResponse": {entity: [{"Id": "1", "Name": "Sales", "Active": True}]}}

    books = Books({("GET", "/query"): respond})
    client = ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books)))
    listed = await client.list_records(credential("quickbooks"), kind, page=2)
    assert listed == {
        "items": [{"Id": "1", "Name": "Sales", "Active": True}],
        "page": 2,
        "hasMore": False,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "path", "key", "row"),
    [
        (
            "accounts",
            "/chartofaccounts",
            "chartofaccounts",
            {"account_id": "64", "account_name": "Materials", "account_type": "expense"},
        ),
        (
            "taxes",
            "/settings/taxes",
            "taxes",
            {"tax_id": "5", "tax_name": "VAT", "tax_percentage": 5},
        ),
    ],
)
async def test_zoho_lists_chart_of_accounts_and_taxes_for_mapping(
    kind: str, path: str, key: str, row: dict[str, Any]
) -> None:
    books = Books(
        {("GET", path): zoho({key: [row], "page_context": {"page": 1, "has_more_page": True}})}
    )
    client = ProviderClient(settings(), httpx.AsyncClient(transport=httpx.MockTransport(books)))
    listed = await client.list_records(credential("zoho_books"), kind, page=1)
    assert listed == {"items": [row], "page": 1, "hasMore": True}
    [request] = books.requests
    assert request.url.params["per_page"] == "50"
    assert request.url.params["organization_id"] == "600123"
