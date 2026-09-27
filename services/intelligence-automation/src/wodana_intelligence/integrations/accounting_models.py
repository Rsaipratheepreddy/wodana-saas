"""The accounting posting contract claimed from Business Core.

Amounts arrive as exact decimal strings and stay Decimal until the provider's JSON boundary.
A posting that does not validate is reported back as "invalid_posting" and never reaches a provider.
"""

import re
from datetime import date as CalendarDate
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from pydantic import BeforeValidator, Field, model_validator

from wodana_intelligence.integrations.models import ApiModel

PostingKind = Literal[
    "invoice", "credit_note", "invoice_payment", "bill", "bill_payment", "bill_payment_void"
]
PaymentMethod = Literal["bank", "cheque", "cash", "card", "other"]

# At most 12 integer digits and 3 decimals: 15 significant digits always survive a JSON number.
_AMOUNT = re.compile(r"^\d{1,12}(?:\.\d{1,3})?$")


def _amount(value: Any) -> Decimal:
    # Strings only: a JSON number may already have passed through binary floating point.
    if not isinstance(value, str) or not _AMOUNT.fullmatch(value):
        raise ValueError("must be a non-negative decimal string with at most 3 decimals")
    return Decimal(value)


def _single_line(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        if any(character in value for character in "\r\n\t"):
            raise ValueError("must be a single line")
    return value


Amount = Annotated[Decimal, BeforeValidator(_amount)]
ProviderId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
DocumentNumber = Annotated[
    str, BeforeValidator(_single_line), Field(min_length=1, max_length=100)
]
Reference = Annotated[str, BeforeValidator(_single_line), Field(max_length=200)]


class PostingContact(ApiModel):
    kind: Literal["customer", "vendor"]
    provider_id: Optional[ProviderId] = None
    name: Annotated[str, BeforeValidator(_single_line), Field(min_length=1, max_length=200)]
    email: Optional[str] = Field(
        default=None, max_length=254, pattern=r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$"
    )
    tax_number: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9 ./-]{1,50}$")
    currency: Currency


class DocumentLine(ApiModel):
    description: str = Field(min_length=1, max_length=2000)
    amount: Amount  # net of tax; the provider applies tax_id
    tax_id: Optional[ProviderId] = None


class BillLine(DocumentLine):
    account_id: ProviderId


class _Totals(ApiModel):
    net: Amount
    tax: Amount
    total: Amount

    def _check_totals(self, lines: list[DocumentLine]) -> None:
        if sum((line.amount for line in lines), Decimal(0)) != self.net:
            raise ValueError("line amounts must add up to net")
        if self.net + self.tax != self.total:
            raise ValueError("net plus tax must equal total")


class InvoiceDocument(_Totals):
    kind: Literal["invoice"]
    number: DocumentNumber
    date: CalendarDate
    due_date: CalendarDate
    currency: Currency
    reference: Reference = ""
    item_id: Optional[ProviderId] = None
    lines: list[DocumentLine] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def consistent(self) -> "InvoiceDocument":
        if self.due_date < self.date:
            raise ValueError("due date cannot precede the invoice date")
        self._check_totals(self.lines)
        return self


class CreditNoteDocument(_Totals):
    kind: Literal["credit_note"]
    number: DocumentNumber
    date: CalendarDate
    currency: Currency
    reference: Reference = ""
    item_id: Optional[ProviderId] = None
    lines: list[DocumentLine] = Field(min_length=1, max_length=200)
    invoice_provider_id: ProviderId
    reason: Reference = ""

    @model_validator(mode="after")
    def consistent(self) -> "CreditNoteDocument":
        self._check_totals(self.lines)
        return self


class InvoicePaymentDocument(ApiModel):
    kind: Literal["invoice_payment"]
    date: CalendarDate
    currency: Currency
    amount: Amount = Field(gt=0)
    invoice_provider_id: ProviderId
    reference: Reference = ""
    deposit_account_id: Optional[ProviderId] = None
    # Not in the first contract draft; Zoho Books requires a payment mode.
    method: PaymentMethod = "bank"


class BillDocument(_Totals):
    kind: Literal["bill"]
    number: DocumentNumber
    date: CalendarDate
    due_date: Optional[CalendarDate] = None
    currency: Currency
    reference: Reference = ""
    lines: list[BillLine] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def consistent(self) -> "BillDocument":
        if self.due_date is not None and self.due_date < self.date:
            raise ValueError("due date cannot precede the bill date")
        self._check_totals(list(self.lines))
        return self


class BillPaymentDocument(ApiModel):
    kind: Literal["bill_payment"]
    date: CalendarDate
    currency: Currency
    amount: Amount = Field(gt=0)
    bill_provider_id: ProviderId
    reference: Reference = ""
    paid_from_account_id: ProviderId
    method: PaymentMethod


class BillPaymentVoidDocument(ApiModel):
    kind: Literal["bill_payment_void"]
    payment_provider_id: ProviderId
    reason: Reference = ""


PostingDocument = Annotated[
    Union[
        InvoiceDocument,
        CreditNoteDocument,
        InvoicePaymentDocument,
        BillDocument,
        BillPaymentDocument,
        BillPaymentVoidDocument,
    ],
    Field(discriminator="kind"),
]
CONTACT_KIND: dict[str, Literal["customer", "vendor"]] = {
    "invoice": "customer",
    "credit_note": "customer",
    "invoice_payment": "customer",
    "bill": "vendor",
    "bill_payment": "vendor",
}


class Posting(ApiModel):
    id: UUID
    lease_token: UUID
    workspace_id: UUID
    connection_id: UUID
    provider: Literal["quickbooks", "zoho_books"]
    kind: PostingKind
    attempt: int = Field(ge=0, le=10000)
    marker: str = Field(pattern=r"^[A-Za-z0-9]{4,32}$")
    contact: Optional[PostingContact] = None
    document: PostingDocument

    @model_validator(mode="before")
    @classmethod
    def document_takes_posting_kind(cls, data: Any) -> Any:
        # The document's shape is chosen by the posting's kind, so validation errors point at
        # the exact document field (document.<kind>.lines.0.amount).
        if isinstance(data, dict) and isinstance(data.get("document"), dict):
            data = {**data, "document": {**data["document"], "kind": data.get("kind")}}
        return data

    @model_validator(mode="after")
    def contact_matches_document(self) -> "Posting":
        expected = CONTACT_KIND.get(self.kind)
        if expected is None:
            return self
        if self.contact is None:
            raise ValueError(f"a {expected} contact is required")
        if self.contact.kind != expected:
            raise ValueError(f"the contact must be a {expected}")
        currency = getattr(self.document, "currency", None)
        if currency != self.contact.currency:
            raise ValueError("the contact and document currencies differ")
        return self
