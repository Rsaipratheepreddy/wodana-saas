"""Posts Business Core's accounting documents to QuickBooks Online and Zoho Books.

Every write is safe to repeat, so a retried posting never adds a second document to the books:
- QuickBooks deduplicates creates by `requestid`, which is the posting id on every attempt.
- Zoho Books has no request ids. A repeated attempt (attempt > 0) first looks for the document this
  posting may already have created: by number for invoices, credit notes and bills, and by the
  posting marker in the reference for payments. A "number already exists" rejection is resolved
  the same way.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Optional, Union
from urllib.parse import quote
from uuid import uuid5

from wodana_intelligence.integrations.accounting_models import (
    BillDocument,
    BillPaymentDocument,
    BillPaymentVoidDocument,
    CreditNoteDocument,
    DocumentLine,
    InvoiceDocument,
    InvoicePaymentDocument,
    Posting,
    PostingContact,
)
from wodana_intelligence.integrations.provider_client import (
    ZOHO_POSTING_SCOPES,
    CallHint,
    ProviderCallError,
    ProviderClient,
)
from wodana_intelligence.integrations.provider_models import ProviderCredential

RECONNECT = "Reconnect the accounting connection"
CURRENCY_MISMATCH = "The accounting contact uses a different currency"
DUPLICATE_ELSEWHERE = "The document number is already used in the accounting system"
_REJECTIONS: dict[CallHint, str] = {
    "duplicate": DUPLICATE_ELSEWHERE,
    "duplicate_name": "A contact with this name already exists in the accounting system",
    "closed_period": "The accounting period for this date is closed",
    "invalid_tax": "A tax code on this document is not valid in the accounting system",
    "invalid_reference": (
        "An item, account, tax code or contact on this document is not valid in the accounting "
        "system"
    ),
    "not_found": "A linked record no longer exists in the accounting system",
}
# QuickBooks "Stale Object Error": the record changed between our read and write.
_STALE_OBJECT = "5010"
# QuickBooks limits DocNumber to 21 characters.
_QUICKBOOKS_NUMBER_LIMIT = 21
_ZOHO_REFERENCE_LIMIT = 100


@dataclass(frozen=True)
class _ZohoNumbered:
    """A Zoho Books document identified by its number."""

    path: str
    entity: str
    number_field: str
    party_field: str
    # Invoice and credit note numbers are unique in the organisation, which numbers them itself
    # unless told not to. Bill numbers are the supplier's, so only unique per vendor.
    org_unique: bool = True

    @property
    def identity(self) -> str:
        return f"{self.entity}_id"


_ZOHO_INVOICES = _ZohoNumbered("invoices", "invoice", "invoice_number", "customer_id")
_ZOHO_CREDIT_NOTES = _ZohoNumbered("creditnotes", "creditnote", "creditnote_number", "customer_id")
_ZOHO_BILLS = _ZohoNumbered("bills", "bill", "bill_number", "vendor_id", org_unique=False)
_ZOHO_PAYMENT_MODES = {
    "bank": "banktransfer",
    "cheque": "check",
    "cash": "cash",
    "card": "creditcard",
    "other": "others",
}


class PostingFailure(Exception):
    """A posting outcome to report to Business Core. `message` is always safe to show."""

    def __init__(
        self,
        code: str,
        message: str,
        retryable: bool,
        contact_provider_id: Optional[str] = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.contact_provider_id = contact_provider_id


@dataclass
class PostingOutcome:
    provider_id: str
    provider_number: Optional[str] = None
    provider_total: Optional[Decimal] = None
    contact_provider_id: Optional[str] = None
    # (code, safe message) for a posted document with a follow-up that did not complete.
    warning: Optional[tuple[str, str]] = None
    # Open balance the provider reported; used to apply a credit note, never reported.
    provider_balance: Optional[Decimal] = None


def failure_for(error: ProviderCallError) -> PostingFailure:
    if error.failure == "auth":
        return PostingFailure("connection_expired", RECONNECT, False)
    if error.failure == "rate_limited":
        return PostingFailure(
            "rate_limited", "The accounting system is limiting requests; this will be retried", True
        )
    if error.failure != "rejected":
        # Timeouts included: QuickBooks deduplicates the retry by requestid, and a Zoho Books
        # retry searches for the document before creating it.
        return PostingFailure(
            "provider_unavailable",
            "The accounting system did not respond; this will be retried",
            True,
        )
    if error.provider_code == _STALE_OBJECT:
        return PostingFailure(
            "provider_conflict",
            "The record changed in the accounting system while posting; this will be retried",
            True,
        )
    message = (
        _REJECTIONS[error.hint] if error.hint else "The accounting system rejected the document"
    )
    if error.provider_code:
        message += f" (error {error.provider_code})"
    return PostingFailure("provider_rejected", message, False)


def _decimal(value: Any) -> Optional[Decimal]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (Decimal, int)):
        return Decimal(value)
    if isinstance(value, str):
        try:
            number = Decimal(value)
        except InvalidOperation:
            return None
        return number if number.is_finite() else None
    return None


def _entity(data: dict[str, Any], key: str, identity: str) -> dict[str, Any]:
    entity = data.get(key)
    if not isinstance(entity, dict) or entity.get(identity) in (None, ""):
        raise ProviderCallError("invalid_response")
    return entity


def _rows(data: Any, key: str) -> list[dict[str, Any]]:
    rows = data.get(key) if isinstance(data, dict) else None
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _text(value: Any) -> Optional[str]:
    return None if value in (None, "") else str(value)


def _note(*parts: str) -> str:
    return " ".join(part for part in parts if part)


def _with_marker(reference: str, marker: str, limit: int) -> str:
    """Keep the marker whole, so a later attempt can find the document by it."""
    room = limit - len(marker) - 1
    return _note(reference[:room].rstrip() if room > 0 else "", marker)


def _counterparty(value: Optional[str]) -> str:
    if value is None:  # Posting validation requires a contact for every document but a void.
        raise PostingFailure("invalid_posting", "Invalid posting: contact", False)
    return value


class QuickBooksAdapter:
    def __init__(self, client: ProviderClient) -> None:
        self.client = client
        self._us_company: dict[str, bool] = {}

    async def call(
        self,
        credential: ProviderCredential,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> dict[str, Any]:
        return await self.client.books_request(credential, method, path, params=params, json=json)

    def preflight(self, credential: ProviderCredential, posting: Posting) -> None:
        document = posting.document
        if isinstance(document, (InvoiceDocument, CreditNoteDocument)) and not document.item_id:
            raise PostingFailure(
                "mapping_required", "Choose the accounting item for invoice lines", False
            )
        number = getattr(document, "number", None)
        if isinstance(number, str) and len(number) > _QUICKBOOKS_NUMBER_LIMIT:
            raise PostingFailure(
                "provider_rejected",
                "QuickBooks document numbers are limited to 21 characters",
                False,
            )

    async def check_contact(self, credential: ProviderCredential, contact: PostingContact) -> None:
        # QuickBooks rejects a transaction whose currency differs from its customer's or vendor's.
        return None

    async def find_or_create_contact(
        self, credential: ProviderCredential, posting: Posting, contact: PostingContact
    ) -> str:
        entity = "Customer" if contact.kind == "customer" else "Vendor"
        found = await self.call(
            credential,
            "GET",
            "/query",
            params={
                "query": f"select * from {entity} where DisplayName = {_query_text(contact.name)}"
            },
        )
        rows = _rows(found.get("QueryResponse") or {}, entity)
        match = next((row for row in rows if row.get("DisplayName") == contact.name), None)
        if match is not None and _text(match.get("Id")):
            currency = (match.get("CurrencyRef") or {}).get("value")
            if currency and currency != contact.currency:
                raise PostingFailure("provider_rejected", CURRENCY_MISMATCH, False)
            return str(match["Id"])
        body: dict[str, Any] = {
            "DisplayName": contact.name,
            "CurrencyRef": {"value": contact.currency},
        }
        if contact.email:
            body["PrimaryEmailAddr"] = {"Address": contact.email}
        if contact.tax_number and len(contact.tax_number) <= 20:
            # Customer.PrimaryTaxIdentifier / Vendor.TaxIdentifier hold at most 20 characters.
            key = "PrimaryTaxIdentifier" if contact.kind == "customer" else "TaxIdentifier"
            body[key] = contact.tax_number
        created = await self.call(
            credential,
            "POST",
            f"/{entity.lower()}",
            # Its own request id: the posting id is reserved for the document create.
            params={"requestid": str(uuid5(posting.id, "contact"))},
            json=body,
        )
        return str(_entity(created, entity, "Id")["Id"])

    async def document(
        self, credential: ProviderCredential, posting: Posting, counterparty: Optional[str]
    ) -> PostingOutcome:
        document = posting.document
        if isinstance(document, BillPaymentVoidDocument):
            return await self._void_bill_payment(credential, posting, document)
        party = _counterparty(counterparty)
        note = _note(document.reference, posting.marker)
        body: dict[str, Any]
        if isinstance(document, (InvoiceDocument, CreditNoteDocument)):
            entity = "Invoice" if isinstance(document, InvoiceDocument) else "CreditMemo"
            body = {
                "CustomerRef": {"value": party},
                "DocNumber": document.number,
                "TxnDate": document.date.isoformat(),
                "CurrencyRef": {"value": document.currency},
                "PrivateNote": note,
                "Line": self._sales_lines(document),
                **await self._tax_mode(credential, document.lines),
            }
            if isinstance(document, InvoiceDocument):
                body["DueDate"] = document.due_date.isoformat()
            else:
                body["PrivateNote"] = _note(document.reference, document.reason, posting.marker)
            return await self._create(credential, posting, entity, body)
        if isinstance(document, InvoicePaymentDocument):
            body = {
                "CustomerRef": {"value": party},
                "TotalAmt": document.amount,
                "TxnDate": document.date.isoformat(),
                "CurrencyRef": {"value": document.currency},
                "PrivateNote": note,
                "Line": [
                    {
                        "Amount": document.amount,
                        "LinkedTxn": [
                            {"TxnId": document.invoice_provider_id, "TxnType": "Invoice"}
                        ],
                    }
                ],
            }
            if document.reference:
                # PaymentRefNum holds 21 characters; the full reference is in PrivateNote.
                body["PaymentRefNum"] = document.reference[:21]
            if document.deposit_account_id:
                body["DepositToAccountRef"] = {"value": document.deposit_account_id}
            return await self._create(credential, posting, "Payment", body, numbered=False)
        if isinstance(document, BillDocument):
            body = {
                "VendorRef": {"value": party},
                "DocNumber": document.number,
                "TxnDate": document.date.isoformat(),
                "CurrencyRef": {"value": document.currency},
                "PrivateNote": note,
                "Line": [
                    {
                        "DetailType": "AccountBasedExpenseLineDetail",
                        "Amount": line.amount,
                        "Description": line.description,
                        "AccountBasedExpenseLineDetail": {
                            "AccountRef": {"value": line.account_id},
                            **({"TaxCodeRef": {"value": line.tax_id}} if line.tax_id else {}),
                        },
                    }
                    for line in document.lines
                ],
                **await self._tax_mode(credential, document.lines),
            }
            if document.due_date:
                body["DueDate"] = document.due_date.isoformat()
            return await self._create(credential, posting, "Bill", body)
        card = document.method == "card"
        body = {
            "VendorRef": {"value": party},
            "TotalAmt": document.amount,
            "TxnDate": document.date.isoformat(),
            "CurrencyRef": {"value": document.currency},
            "PrivateNote": note,
            "PayType": "CreditCard" if card else "Check",
            ("CreditCardPayment" if card else "CheckPayment"): {
                ("CCAccountRef" if card else "BankAccountRef"): {
                    "value": document.paid_from_account_id
                }
            },
            "Line": [
                {
                    "Amount": document.amount,
                    "LinkedTxn": [{"TxnId": document.bill_provider_id, "TxnType": "Bill"}],
                }
            ],
        }
        return await self._create(credential, posting, "BillPayment", body, numbered=False)

    def _sales_lines(
        self, document: Union[InvoiceDocument, CreditNoteDocument]
    ) -> list[dict[str, Any]]:
        item = str(document.item_id)
        return [
            {
                "DetailType": "SalesItemLineDetail",
                "Amount": line.amount,
                "Description": line.description,
                "SalesItemLineDetail": {
                    "ItemRef": {"value": item},
                    "Qty": 1,
                    "UnitPrice": line.amount,
                    **({"TaxCodeRef": {"value": line.tax_id}} if line.tax_id else {}),
                },
            }
            for line in document.lines
        ]

    async def _tax_mode(
        self, credential: ProviderCredential, lines: Sequence[DocumentLine]
    ) -> dict[str, Any]:
        """Line amounts are net. Outside the US, QuickBooks follows the company's default
        (possibly tax-inclusive) unless told otherwise; the US tax model has no such field."""
        if not any(line.tax_id for line in lines) or await self._is_us_company(credential):
            return {}
        return {"GlobalTaxCalculation": "TaxExcluded"}

    async def _is_us_company(self, credential: ProviderCredential) -> bool:
        if credential.account_id not in self._us_company:
            data = await self.call(
                credential, "GET", f"/companyinfo/{quote(credential.account_id, safe='')}"
            )
            info = data.get("CompanyInfo") or {}
            country = info.get("Country") or (info.get("CompanyAddr") or {}).get("Country") or ""
            self._us_company[credential.account_id] = str(country).strip().upper() in (
                "US",
                "USA",
                "UNITED STATES",
            )
        return self._us_company[credential.account_id]

    async def _create(
        self,
        credential: ProviderCredential,
        posting: Posting,
        entity: str,
        body: dict[str, Any],
        *,
        numbered: bool = True,
    ) -> PostingOutcome:
        try:
            data = await self.call(
                credential,
                "POST",
                f"/{entity.lower()}",
                params={"requestid": str(posting.id)},
                json=body,
            )
        except ProviderCallError as error:
            # With duplicate-number checks on, QuickBooks refuses a number already in use. If this
            # posting made that document (the marker is in its private note), it is ours.
            if numbered and error.hint == "duplicate":
                own = await self._find_own(credential, posting, entity, str(body["DocNumber"]))
                if own is not None:
                    return self._outcome(own, numbered)
            raise
        return self._outcome(_entity(data, entity, "Id"), numbered)

    async def _find_own(
        self, credential: ProviderCredential, posting: Posting, entity: str, number: str
    ) -> Optional[dict[str, Any]]:
        data = await self.call(
            credential,
            "GET",
            "/query",
            params={"query": f"select * from {entity} where DocNumber = {_query_text(number)}"},
        )
        for row in _rows(data.get("QueryResponse") or {}, entity):
            if posting.marker in str(row.get("PrivateNote", "")).split() and _text(row.get("Id")):
                return row
        return None

    @staticmethod
    def _outcome(row: dict[str, Any], numbered: bool) -> PostingOutcome:
        return PostingOutcome(
            provider_id=str(row["Id"]),
            provider_number=_text(row.get("DocNumber")) if numbered else None,
            provider_total=_decimal(row.get("TotalAmt")),
        )

    async def _void_bill_payment(
        self, credential: ProviderCredential, posting: Posting, document: BillPaymentVoidDocument
    ) -> PostingOutcome:
        identity = document.payment_provider_id
        current = _entity(
            await self.call(credential, "GET", f"/billpayment/{quote(identity, safe='')}"),
            "BillPayment",
            "Id",
        )
        voided = _decimal(current.get("TotalAmt")) == 0 and str(
            current.get("PrivateNote", "")
        ).startswith("Voided")
        if not voided:
            # QuickBooks supports voiding a BillPayment (a sparse update with include=void).
            # A void keeps the payment in the audit trail at zero and reopens the bill, as an
            # accountant would do by hand; deleting would erase the record, so it is not used.
            await self.call(
                credential,
                "POST",
                "/billpayment",
                params={"operation": "update", "include": "void", "requestid": str(posting.id)},
                json={"Id": current["Id"], "SyncToken": current.get("SyncToken"), "sparse": True},
            )
        return PostingOutcome(provider_id=identity)


def _query_text(value: str) -> str:
    """Quote a value for the QuickBooks query language."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


class ZohoBooksAdapter:
    def __init__(self, client: ProviderClient) -> None:
        self.client = client
        self._currencies: dict[str, dict[str, str]] = {}
        self._contact_currency: dict[tuple[str, str], Optional[str]] = {}

    async def call(
        self,
        credential: ProviderCredential,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> dict[str, Any]:
        return await self.client.books_request(credential, method, path, params=params, json=json)

    def preflight(self, credential: ProviderCredential, posting: Posting) -> None:
        # Connections made before accounting sync were never granted write access.
        if credential.scopes and not set(ZOHO_POSTING_SCOPES).issubset(credential.scopes):
            raise PostingFailure("connection_expired", RECONNECT, False)

    async def check_contact(self, credential: ProviderCredential, contact: PostingContact) -> None:
        # Zoho Books documents take the contact's currency; never book in a different one.
        identity = str(contact.provider_id)
        key = (credential.account_id, identity)
        if key not in self._contact_currency:
            data = await self.call(credential, "GET", f"/contacts/{quote(identity, safe='')}")
            self._contact_currency[key] = _text(
                _entity(data, "contact", "contact_id").get("currency_code")
            )
        if self._contact_currency[key] not in (None, contact.currency):
            raise PostingFailure("provider_rejected", CURRENCY_MISMATCH, False)

    async def find_or_create_contact(
        self, credential: ProviderCredential, posting: Posting, contact: PostingContact
    ) -> str:
        found = await self.call(
            credential,
            "GET",
            "/contacts",
            params={"contact_name": contact.name, "contact_type": contact.kind, "per_page": 200},
        )
        matches = [
            row
            for row in _rows(found, "contacts")
            if row.get("contact_name") == contact.name
            and row.get("contact_type", contact.kind) == contact.kind
            and _text(row.get("contact_id"))
        ]
        if matches:
            same = [row for row in matches if row.get("currency_code") == contact.currency]
            if not same:
                raise PostingFailure("provider_rejected", CURRENCY_MISMATCH, False)
            if len(same) > 1:
                raise PostingFailure(
                    "provider_rejected",
                    "Several accounting contacts have this name; link the contact in settings",
                    False,
                )
            return str(same[0]["contact_id"])
        currency_id = await self._currency_id(credential, contact.currency)
        try:
            created = await self.call(
                credential,
                "POST",
                "/contacts",
                json={
                    "contact_name": contact.name,
                    "contact_type": contact.kind,
                    "currency_id": currency_id,
                },
            )
        except ProviderCallError as error:
            if error.hint == "duplicate":
                error.hint = "duplicate_name"
            raise
        return str(_entity(created, "contact", "contact_id")["contact_id"])

    async def _currency_id(self, credential: ProviderCredential, code: str) -> str:
        if credential.account_id not in self._currencies:
            data = await self.call(credential, "GET", "/settings/currencies")
            self._currencies[credential.account_id] = {
                str(row["currency_code"]): str(row["currency_id"])
                for row in _rows(data, "currencies")
                if _text(row.get("currency_code")) and _text(row.get("currency_id"))
            }
        currency_id = self._currencies[credential.account_id].get(code)
        if currency_id is None:
            raise PostingFailure(
                "provider_rejected", "The currency is not enabled in the accounting system", False
            )
        return currency_id

    async def document(
        self, credential: ProviderCredential, posting: Posting, counterparty: Optional[str]
    ) -> PostingOutcome:
        document = posting.document
        if isinstance(document, BillPaymentVoidDocument):
            identity = document.payment_provider_id
            try:
                await self.call(credential, "DELETE", f"/vendorpayments/{quote(identity, safe='')}")
            except ProviderCallError as error:
                # An earlier attempt may have deleted it before its result was recorded.
                if not (error.hint == "not_found" and posting.attempt > 0):
                    raise
            return PostingOutcome(provider_id=identity)
        party = _counterparty(counterparty)
        if isinstance(document, InvoiceDocument):
            return await self._numbered(
                credential,
                posting,
                party,
                _ZOHO_INVOICES,
                {
                    "invoice_number": document.number,
                    "customer_id": party,
                    "date": document.date.isoformat(),
                    "due_date": document.due_date.isoformat(),
                    "reference_number": document.reference[:_ZOHO_REFERENCE_LIMIT],
                    "line_items": self._lines(document.lines, document.item_id),
                    **self._tax_mode(document.lines),
                },
            )
        if isinstance(document, CreditNoteDocument):
            outcome = await self._numbered(
                credential,
                posting,
                party,
                _ZOHO_CREDIT_NOTES,
                {
                    "creditnote_number": document.number,
                    "customer_id": party,
                    "date": document.date.isoformat(),
                    "reference_number": document.reference[:_ZOHO_REFERENCE_LIMIT],
                    "line_items": self._lines(document.lines, document.item_id),
                    **self._tax_mode(document.lines),
                },
            )
            outcome.warning = await self._apply_credit(credential, outcome, document)
            return outcome
        if isinstance(document, BillDocument):
            body: dict[str, Any] = {
                "bill_number": document.number,
                "vendor_id": party,
                "date": document.date.isoformat(),
                "reference_number": document.reference[:_ZOHO_REFERENCE_LIMIT],
                "line_items": [
                    {
                        "account_id": line.account_id,
                        "description": line.description,
                        "rate": line.amount,
                        "quantity": 1,
                        **({"tax_id": line.tax_id} if line.tax_id else {}),
                    }
                    for line in document.lines
                ],
                **self._tax_mode(document.lines),
            }
            if document.due_date:
                body["due_date"] = document.due_date.isoformat()
            return await self._numbered(credential, posting, party, _ZOHO_BILLS, body)
        if isinstance(document, InvoicePaymentDocument):
            body = {
                "customer_id": party,
                "payment_mode": _ZOHO_PAYMENT_MODES[document.method],
                "amount": document.amount,
                "date": document.date.isoformat(),
                "reference_number": _with_marker(
                    document.reference, posting.marker, _ZOHO_REFERENCE_LIMIT
                ),
                "invoices": [
                    {"invoice_id": document.invoice_provider_id, "amount_applied": document.amount}
                ],
            }
            if document.deposit_account_id:
                body["account_id"] = document.deposit_account_id
            return await self._payment(
                credential, posting, party, "customerpayments", "payment", "customer_id", body
            )
        if not isinstance(document, BillPaymentDocument):
            raise PostingFailure("invalid_posting", "Invalid posting: kind", False)
        body = {
            "vendor_id": party,
            "payment_mode": _ZOHO_PAYMENT_MODES[document.method],
            "amount": document.amount,
            "date": document.date.isoformat(),
            "reference_number": _with_marker(
                document.reference, posting.marker, _ZOHO_REFERENCE_LIMIT
            ),
            "paid_through_account_id": document.paid_from_account_id,
            "bills": [{"bill_id": document.bill_provider_id, "amount_applied": document.amount}],
        }
        return await self._payment(
            credential, posting, party, "vendorpayments", "vendorpayment", "vendor_id", body
        )

    @staticmethod
    def _lines(lines: Sequence[DocumentLine], item_id: Optional[str]) -> list[dict[str, Any]]:
        return [
            {
                **({"item_id": item_id} if item_id else {}),
                "description": line.description,
                "rate": line.amount,
                "quantity": 1,
                **({"tax_id": line.tax_id} if line.tax_id else {}),
            }
            for line in lines
        ]

    @staticmethod
    def _tax_mode(lines: Sequence[DocumentLine]) -> dict[str, Any]:
        # Line amounts are net, whatever the organisation's default pricing.
        return {"is_inclusive_tax": False} if any(line.tax_id for line in lines) else {}

    async def _numbered(
        self,
        credential: ProviderCredential,
        posting: Posting,
        party: str,
        kind: _ZohoNumbered,
        body: dict[str, Any],
    ) -> PostingOutcome:
        number = str(body[kind.number_field])
        if posting.attempt > 0:
            found = await self._find_numbered(credential, kind, number, party)
            if found is not None:
                return found
        params = {"ignore_auto_number_generation": "true"} if kind.org_unique else {}
        try:
            data = await self.call(credential, "POST", f"/{kind.path}", params=params, json=body)
        except ProviderCallError as error:
            if error.hint == "duplicate":
                found = await self._find_numbered(credential, kind, number, party)
                if found is not None:
                    return found
            raise
        return self._numbered_outcome(_entity(data, kind.entity, kind.identity), kind)

    async def _find_numbered(
        self, credential: ProviderCredential, kind: _ZohoNumbered, number: str, party: str
    ) -> Optional[PostingOutcome]:
        params = {kind.number_field: number}
        if not kind.org_unique:
            params[kind.party_field] = party
        data = await self.call(credential, "GET", f"/{kind.path}", params=params)
        rows = [
            row
            for row in _rows(data, kind.path)
            if row.get(kind.number_field) == number and _text(row.get(kind.identity))
        ]
        mine = [row for row in rows if str(row.get(kind.party_field)) == party]
        if mine:
            return self._numbered_outcome(mine[0], kind)
        if kind.org_unique and rows:
            raise PostingFailure(
                "provider_rejected", DUPLICATE_ELSEWHERE + " for another contact", False
            )
        return None

    @staticmethod
    def _numbered_outcome(row: dict[str, Any], kind: _ZohoNumbered) -> PostingOutcome:
        return PostingOutcome(
            provider_id=str(row[kind.identity]),
            provider_number=_text(row.get(kind.number_field)),
            provider_total=_decimal(row.get("total")),
            provider_balance=_decimal(row.get("balance")),
        )

    async def _apply_credit(
        self, credential: ProviderCredential, outcome: PostingOutcome, document: CreditNoteDocument
    ) -> Optional[tuple[str, str]]:
        """Apply the credit to its invoice while the invoice still has a balance.

        The credit note is already in the books, so a failure here is reported as a warning
        rather than failing the posting.
        """
        credit = (
            outcome.provider_balance
            if outcome.provider_balance is not None
            else outcome.provider_total
        )
        if credit is None or credit <= 0:
            return None
        invoice_id = document.invoice_provider_id
        try:
            data = await self.call(credential, "GET", f"/invoices/{quote(invoice_id, safe='')}")
            balance = _decimal(_entity(data, "invoice", "invoice_id").get("balance"))
            if balance is None or balance <= 0:
                return None
            await self.call(
                credential,
                "POST",
                f"/creditnotes/{quote(outcome.provider_id, safe='')}/invoices",
                json={
                    "invoices": [{"invoice_id": invoice_id, "amount_applied": min(balance, credit)}]
                },
            )
        except ProviderCallError:
            return (
                "credit_not_applied",
                "The credit note was created but could not be applied to the invoice",
            )
        return None

    async def _payment(
        self,
        credential: ProviderCredential,
        posting: Posting,
        party: str,
        path: str,
        entity: str,
        party_field: str,
        body: dict[str, Any],
    ) -> PostingOutcome:
        if posting.attempt > 0:
            data = await self.call(
                credential, "GET", f"/{path}", params={"reference_number_contains": posting.marker}
            )
            for row in _rows(data, path):
                if (
                    posting.marker in str(row.get("reference_number", "")).split()
                    and str(row.get(party_field)) == party
                    and _text(row.get("payment_id"))
                ):
                    return self._payment_outcome(row)
        data = await self.call(credential, "POST", f"/{path}", json=body)
        return self._payment_outcome(_entity(data, entity, "payment_id"))

    @staticmethod
    def _payment_outcome(row: dict[str, Any]) -> PostingOutcome:
        return PostingOutcome(
            provider_id=str(row["payment_id"]),
            provider_number=_text(row.get("payment_number")),
            provider_total=_decimal(row.get("amount")),
        )


class AccountingClient:
    """One instance per claimed batch: its caches (currencies, company country) stay fresh."""

    def __init__(self, client: ProviderClient) -> None:
        self._adapters: dict[str, Union[QuickBooksAdapter, ZohoBooksAdapter]] = {
            "quickbooks": QuickBooksAdapter(client),
            "zoho_books": ZohoBooksAdapter(client),
        }

    async def post(self, credential: ProviderCredential, posting: Posting) -> PostingOutcome:
        if credential.provider != posting.provider:
            raise PostingFailure("connection_expired", RECONNECT, False)
        adapter = self._adapters[posting.provider]
        resolved: Optional[str] = None  # a contact this posting found or created
        try:
            adapter.preflight(credential, posting)
            counterparty: Optional[str] = None
            contact = posting.contact
            if contact is not None and not isinstance(posting.document, BillPaymentVoidDocument):
                if contact.provider_id:
                    counterparty = contact.provider_id
                    await adapter.check_contact(credential, contact)
                else:
                    counterparty = resolved = await adapter.find_or_create_contact(
                        credential, posting, contact
                    )
            outcome = await adapter.document(credential, posting, counterparty)
        except ProviderCallError as error:
            failure = failure_for(error)
            failure.contact_provider_id = resolved
            raise failure from None
        except PostingFailure as failure:
            failure.contact_provider_id = resolved
            raise
        outcome.contact_provider_id = resolved
        return outcome

