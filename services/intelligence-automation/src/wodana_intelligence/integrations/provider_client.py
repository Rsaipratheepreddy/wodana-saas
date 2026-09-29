"""Provider HTTP contracts. No caller-supplied hosts or arbitrary endpoint forwarding."""

import base64
import hashlib
import hmac
import json as jsonlib
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal, Optional
from urllib.parse import quote, urlencode, urlparse

import httpx

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.platform_credentials import (
    PlatformCredentialResolver,
    PlatformCredentials,
)
from wodana_intelligence.integrations.provider_models import (
    InvoiceRequest,
    Provider,
    ProviderCredential,
    Region,
    WhatsAppMessageRequest,
)

ZOHO_REGIONS = {
    "us": ("accounts.zoho.com", "www.zohoapis.com"),
    "in": ("accounts.zoho.in", "www.zohoapis.in"),
    "eu": ("accounts.zoho.eu", "www.zohoapis.eu"),
    "au": ("accounts.zoho.com.au", "www.zohoapis.com.au"),
    "ca": ("accounts.zohocloud.ca", "www.zohoapis.ca"),
    "jp": ("accounts.zoho.jp", "www.zohoapis.jp"),
    "sa": ("accounts.zoho.sa", "www.zohoapis.sa"),
}
# What accounting sync writes to Zoho Books. Connections made before sync existed lack these
# and must reconnect; QuickBooks' single accounting scope already covers every posting.
ZOHO_POSTING_SCOPES = (
    "ZohoBooks.contacts.CREATE",
    "ZohoBooks.creditnotes.READ",
    "ZohoBooks.creditnotes.CREATE",
    "ZohoBooks.customerpayments.CREATE",
    "ZohoBooks.bills.CREATE",
    "ZohoBooks.vendorpayments.READ",
    "ZohoBooks.vendorpayments.CREATE",
    "ZohoBooks.vendorpayments.DELETE",
    "ZohoBooks.expenses.CREATE",
)
SCOPES = {
    "quickbooks": ["com.intuit.quickbooks.accounting"],
    "zoho_books": [
        "ZohoBooks.contacts.READ",
        "ZohoBooks.settings.READ",
        "ZohoBooks.invoices.READ",
        "ZohoBooks.invoices.CREATE",
        "ZohoBooks.customerpayments.READ",
        "ZohoBooks.bills.READ",
        "ZohoBooks.purchaseorders.READ",
        "ZohoBooks.expenses.READ",
        # Chart of accounts, for the account mapping dropdowns.
        "ZohoBooks.accountants.READ",
        *ZOHO_POSTING_SCOPES,
    ],
    "whatsapp": ["whatsapp_business_management", "whatsapp_business_messaging"],
}
AccountingProvider = Literal["quickbooks", "zoho_books"]
CallFailure = Literal[
    "timeout", "network", "auth", "rate_limited", "unavailable", "rejected", "invalid_response"
]
CallHint = Literal[
    "duplicate", "duplicate_name", "closed_period", "invalid_tax", "invalid_reference", "not_found"
]
# Provider error codes whose meaning is stable enough to name. Anything else is reported by code.
_QUICKBOOKS_HINTS: dict[str, CallHint] = {
    "610": "not_found",  # Object Not Found
    "2500": "invalid_reference",  # Invalid Reference Id (item, account, tax code, customer)
    "6140": "duplicate",  # Duplicate Document Number Error
    "6210": "closed_period",  # Account Period Closed
    "6240": "duplicate_name",  # Duplicate Name Exists Error
}
_ZOHO_HINTS: dict[str, CallHint] = {"1001": "duplicate", "1002": "not_found"}
_SAFE_CODE = re.compile(r"^[A-Za-z0-9_.-]{1,20}$")


class ProviderCallError(RuntimeError):
    """A signed accounting call failed.

    Carries only structured facts that are safe to store and show: never the response body, the
    request URL (which holds names and numbers) or a token.
    """

    def __init__(
        self,
        failure: CallFailure,
        *,
        status: Optional[int] = None,
        provider_code: Optional[str] = None,
        hint: Optional[CallHint] = None,
    ) -> None:
        super().__init__(f"Accounting provider call failed: {failure}")
        self.failure = failure
        self.status = status
        self.provider_code = provider_code
        self.hint = hint


def exact_json_value(value: Any) -> Any:
    """Prepare a body for JSON: amounts leave Decimal only here, and only if they survive exactly.

    Every amount the contract allows (at most 15 significant digits) round-trips through a double,
    so providers that require JSON numbers receive exactly the decimal Business Core sent.
    """
    if isinstance(value, Decimal):
        number = float(value)
        if not value.is_finite() or Decimal(repr(number)) != value:
            raise ValueError("Amount cannot be represented exactly as a JSON number")
        return number
    if isinstance(value, dict):
        return {key: exact_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [exact_json_value(item) for item in value]
    return value


def _call_error_facts(
    provider: AccountingProvider, data: Any
) -> tuple[Optional[str], Optional[CallHint]]:
    """Read the provider's error code and classify it. The provider's text never leaves here."""
    code: Any = None
    message = ""
    if isinstance(data, dict):
        if provider == "quickbooks":
            fault = data.get("Fault") or data.get("fault")
            errors = fault.get("Error") or fault.get("error") if isinstance(fault, dict) else None
            first = errors[0] if isinstance(errors, list) and errors else {}
            if isinstance(first, dict):
                code = first.get("code")
                message = f"{first.get('Message', '')} {first.get('Detail', '')}"
        else:
            code = data.get("code")
            message = str(data.get("message", ""))
    safe = str(code) if code is not None and _SAFE_CODE.fullmatch(str(code)) else None
    hints = _QUICKBOOKS_HINTS if provider == "quickbooks" else _ZOHO_HINTS
    hint: Optional[CallHint] = hints.get(safe or "")
    text = message.lower()
    if hint is None:
        if "already exist" in text or "duplicate" in text:
            hint = "duplicate"
        elif "locked" in text or ("period" in text and "closed" in text):
            hint = "closed_period"
        elif "tax" in text and ("invalid" in text or "not valid" in text):
            hint = "invalid_tax"
    return safe, hint


def safe_payment_url(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    allowed = (
        "intuit.com",
        "intuit.me",
        "zoho.com",
        "zoho.in",
        "zoho.eu",
        "zoho.com.au",
        "zohocloud.ca",
        "zoho.jp",
        "zoho.sa",
    )
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        return None
    return (
        value if any(host == domain or host.endswith("." + domain) for domain in allowed) else None
    )


class ProviderClient:
    def __init__(
        self,
        settings: Settings,
        client: Optional[httpx.AsyncClient] = None,
        credentials: Optional[PlatformCredentialResolver] = None,
    ) -> None:
        self.settings = settings
        self.http = client or httpx.AsyncClient(timeout=25, follow_redirects=False)
        # Wodana's app credentials, read live (Wodana Control, else the environment).
        self.credentials = credentials or PlatformCredentialResolver(settings)

    async def configured(self, provider: Provider) -> bool:
        return (await self.credentials.current()).configured(provider)

    @staticmethod
    def redirect_uri(credentials: PlatformCredentials, provider: Provider) -> str:
        return (
            credentials.quickbooks_redirect_uri
            if provider == "quickbooks"
            else credentials.zoho_redirect_uri
        )

    async def authorization_url(self, provider: Provider, region: Region, state: str) -> str:
        credentials = await self.credentials.current()
        params = {
            "response_type": "code",
            "state": state,
            "redirect_uri": self.redirect_uri(credentials, provider),
        }
        if provider == "quickbooks":
            params.update(
                client_id=credentials.quickbooks_client_id, scope=" ".join(SCOPES[provider])
            )
            return "https://appcenter.intuit.com/connect/oauth2?" + urlencode(params)
        params.update(
            client_id=credentials.zoho_client_id,
            scope=",".join(SCOPES[provider]),
            access_type="offline",
            prompt="consent",
        )
        return f"https://{ZOHO_REGIONS[region][0]}/oauth/v2/auth?" + urlencode(params)

    async def request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = await self.http.request(method, url, **kwargs)
        except httpx.HTTPError as error:
            raise IntegrationFlowError(
                "provider_unavailable", "Provider request could not be confirmed", 502
            ) from error
        if response.is_error:
            code = "provider_request_failed"
            status = 502
            if response.status_code in (401, 403):
                code, status = "provider_access_denied", 409
            elif response.status_code == 429:
                code, status = "provider_rate_limited", 429
            elif response.status_code >= 500:
                # Transient: callers retry these, unlike a rejected request or refresh token.
                code = "provider_unavailable"
            raise IntegrationFlowError(
                code, "Provider rejected the request. Check account access and settings.", status
            )
        try:
            data = response.json()
        except ValueError as error:
            raise IntegrationFlowError(
                "provider_invalid_response", "Provider returned an invalid response", 502
            ) from error
        if (
            not isinstance(data, dict)
            or data.get("error")
            or data.get("Fault")
            or data.get("code", 0) != 0
        ):
            raise IntegrationFlowError(
                "provider_request_failed", "Provider rejected the request", 502
            )
        return data

    async def token(
        self, provider: Provider, region: Region, *, code: str = "", refresh: str = ""
    ) -> dict[str, Any]:
        credentials = await self.credentials.current()
        if provider == "whatsapp":
            return await self.request(
                "GET",
                f"{credentials.graph}/oauth/access_token",
                params={
                    "client_id": credentials.whatsapp_app_id,
                    "client_secret": credentials.whatsapp_app_secret,
                    "code": code,
                },
            )
        payload = {"grant_type": "refresh_token" if refresh else "authorization_code"}
        payload.update(
            {"refresh_token": refresh}
            if refresh
            else {"code": code, "redirect_uri": self.redirect_uri(credentials, provider)}
        )
        if provider == "quickbooks":
            pair = f"{credentials.quickbooks_client_id}:{credentials.quickbooks_client_secret}"
            basic = base64.b64encode(pair.encode()).decode()
            return await self.request(
                "POST",
                "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
                data=payload,
                headers={"Authorization": f"Basic {basic}", "Accept": "application/json"},
            )
        payload.update(
            client_id=credentials.zoho_client_id, client_secret=credentials.zoho_client_secret
        )
        return await self.request(
            "POST", f"https://{ZOHO_REGIONS[region][0]}/oauth/v2/token", data=payload
        )

    async def graph(self) -> str:
        return (await self.credentials.current()).graph

    async def _signed(
        self, credential: ProviderCredential, path: str, params: Optional[dict[str, Any]]
    ) -> tuple[str, dict[str, Any], dict[str, str]]:
        query = dict(params or {})
        if credential.provider == "quickbooks":
            host = (
                "sandbox-quickbooks.api.intuit.com"
                if credential.configuration.get("environment") == "sandbox"
                else "quickbooks.api.intuit.com"
            )
            base = f"https://{host}/v3/company/{quote(credential.account_id, safe='')}"
            query["minorversion"] = "75"
            authorization = f"Bearer {credential.access_token}"
        elif credential.provider == "zoho_books":
            base = f"https://{ZOHO_REGIONS[credential.region][1]}/books/v3"
            query["organization_id"] = credential.account_id
            authorization = f"Zoho-oauthtoken {credential.access_token}"
        else:
            app = await self.credentials.current()
            base = app.graph
            authorization = f"Bearer {credential.access_token}"
            query["appsecret_proof"] = hmac.new(
                app.whatsapp_app_secret.encode(),
                credential.access_token.encode(),
                hashlib.sha256,
            ).hexdigest()
        return base + path, query, {"Authorization": authorization, "Accept": "application/json"}

    async def api(
        self,
        credential: ProviderCredential,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> dict[str, Any]:
        url, query, headers = await self._signed(credential, path, params)
        return await self.request(method, url, params=query, json=json, headers=headers)

    async def books_request(
        self,
        credential: ProviderCredential,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> dict[str, Any]:
        """A signed QuickBooks or Zoho Books call for accounting sync.

        Unlike api(), amounts go out and come back as exact decimals, and failures are raised as
        ProviderCallError with the status and provider error code, so the caller can tell a
        rejected document from a transient outage.
        """
        provider = credential.provider
        if provider != "quickbooks" and provider != "zoho_books":
            raise ValueError("Accounting sync supports QuickBooks and Zoho Books only")
        url, query, headers = await self._signed(credential, path, params)
        content: Optional[bytes] = None
        if json is not None:
            content = jsonlib.dumps(exact_json_value(json)).encode()
            headers["Content-Type"] = "application/json"
        try:
            response = await self.http.request(
                method, url, params=query, content=content, headers=headers
            )
        except httpx.TimeoutException:
            raise ProviderCallError("timeout") from None
        except httpx.HTTPError:
            raise ProviderCallError("network") from None
        try:
            data: Any = jsonlib.loads(response.content, parse_float=Decimal)
        except ValueError:
            data = None
        status = response.status_code
        code, hint = _call_error_facts(provider, data)
        if status in (401, 403):
            raise ProviderCallError("auth", status=status, provider_code=code)
        if status == 429:
            raise ProviderCallError("rate_limited", status=status, provider_code=code)
        if status >= 500:
            raise ProviderCallError("unavailable", status=status, provider_code=code)
        if response.is_error:
            raise ProviderCallError(
                "rejected",
                status=status,
                provider_code=code,
                hint="not_found" if status == 404 and hint is None else hint,
            )
        if not isinstance(data, dict):
            raise ProviderCallError("invalid_response", status=status)
        failed = (
            bool(data.get("Fault"))
            if provider == "quickbooks"
            else data.get("code", 0) != 0
        )
        if failed:
            raise ProviderCallError("rejected", status=status, provider_code=code, hint=hint)
        return data

    async def list_records(
        self, credential: ProviderCredential, kind: str, page: int = 1
    ) -> dict[str, Any]:
        if credential.provider == "quickbooks":
            entity = {
                "customers": "Customer",
                "invoices": "Invoice",
                "items": "Item",
                "vendors": "Vendor",
                "bills": "Bill",
                "payments": "Payment",
                "purchaseorders": "PurchaseOrder",
                "expenses": "Purchase",
                "accounts": "Account",
                "taxes": "TaxCode",
            }.get(kind)
            if not entity:
                raise IntegrationFlowError("invalid_resource", "Unsupported accounting resource")
            data = await self.api(
                credential,
                "GET",
                "/query",
                params={
                    "query": (
                        f"select * from {entity} startposition {(page - 1) * 50 + 1} maxresults 50"
                    )
                },
            )
            items = data.get("QueryResponse", {}).get(entity, [])
            return {"items": items, "page": page, "hasMore": len(items) == 50}
        if credential.provider == "zoho_books":
            # kind -> (path, key of the list in the response)
            endpoint = {
                "customers": ("/contacts", "contacts"),
                "vendors": ("/contacts", "contacts"),
                "invoices": ("/invoices", "invoices"),
                "items": ("/items", "items"),
                "bills": ("/bills", "bills"),
                "payments": ("/customerpayments", "customerpayments"),
                "purchaseorders": ("/purchaseorders", "purchaseorders"),
                "expenses": ("/expenses", "expenses"),
                "accounts": ("/chartofaccounts", "chartofaccounts"),
                "taxes": ("/settings/taxes", "taxes"),
            }.get(kind)
            if not endpoint:
                raise IntegrationFlowError("invalid_resource", "Unsupported accounting resource")
            path, key = endpoint
            query: dict[str, Any] = {"page": page, "per_page": 50}
            if kind in ("customers", "vendors"):
                query["contact_type"] = "customer" if kind == "customers" else "vendor"
            data = await self.api(credential, "GET", path, params=query)
            return {
                "items": data.get(key, []),
                "page": page,
                "hasMore": bool(data.get("page_context", {}).get("has_more_page")),
            }
        if kind != "templates":
            raise IntegrationFlowError("invalid_resource", "Only WhatsApp templates can be listed")
        data = await self.api(
            credential, "GET", f"/{credential.account_id}/message_templates", params={"limit": 100}
        )
        return {
            "items": [item for item in data.get("data", []) if item.get("status") == "APPROVED"],
            "hasMore": False,
            "truncated": bool(data.get("paging", {}).get("next")),
        }

    async def invoice(self, credential: ProviderCredential, invoice_id: str) -> dict[str, Any]:
        identity = quote(invoice_id, safe="")
        if credential.provider == "quickbooks":
            data = await self.api(
                credential, "GET", f"/invoice/{identity}", params={"include": "invoiceLink"}
            )
            invoice = data["Invoice"]
            return {
                "id": str(invoice["Id"]),
                "accountId": credential.account_id,
                "number": invoice.get("DocNumber"),
                "customerName": invoice.get("CustomerRef", {}).get("name"),
                "total": invoice.get("TotalAmt"),
                "balance": invoice.get("Balance"),
                "currency": invoice.get("CurrencyRef", {}).get("value"),
                "paymentUrl": safe_payment_url(invoice.get("InvoiceLink")),
                "status": "paid" if invoice.get("Balance") == 0 else "unpaid",
            }
        data = await self.api(credential, "GET", f"/invoices/{identity}")
        invoice = data["invoice"]
        return {
            "id": str(invoice["invoice_id"]),
            "accountId": credential.account_id,
            "number": invoice.get("invoice_number"),
            "customerName": invoice.get("customer_name"),
            "total": invoice.get("total"),
            "balance": invoice.get("balance"),
            "currency": invoice.get("currency_code"),
            "paymentUrl": safe_payment_url(invoice.get("invoice_url")),
            "status": invoice.get("status"),
        }

    async def create_invoice(
        self, credential: ProviderCredential, payload: InvoiceRequest, key: str
    ) -> dict[str, Any]:
        if credential.provider == "quickbooks":
            lines = [
                {
                    "DetailType": "SalesItemLineDetail",
                    "Description": line.description,
                    "Amount": float(
                        (line.quantity * line.rate).quantize(
                            Decimal("0.01"), rounding=ROUND_HALF_UP
                        )
                    ),
                    "SalesItemLineDetail": {
                        "ItemRef": {"value": line.item_id},
                        "Qty": float(line.quantity),
                        "UnitPrice": float(line.rate),
                        **({"TaxCodeRef": {"value": line.tax_id}} if line.tax_id else {}),
                    },
                }
                for line in payload.lines
            ]
            data = await self.api(
                credential,
                "POST",
                "/invoice",
                params={"requestid": key},
                json={
                    "CustomerRef": {"value": payload.customer_id},
                    "TxnDate": str(payload.date),
                    "DueDate": str(payload.due_date),
                    "CurrencyRef": {"value": payload.currency},
                    "PrivateNote": payload.reference,
                    "Line": lines,
                    "AllowOnlineCreditCardPayment": payload.online_payment,
                    "AllowOnlineACHPayment": payload.online_payment,
                },
            )
            return {
                "id": str(data["Invoice"]["Id"]),
                "number": data["Invoice"].get("DocNumber"),
                "status": "created",
            }
        data = await self.api(
            credential,
            "POST",
            "/invoices",
            json={
                "customer_id": payload.customer_id,
                "date": str(payload.date),
                "due_date": str(payload.due_date),
                "reference_number": payload.reference,
                "line_items": [
                    {
                        "item_id": line.item_id,
                        "description": line.description,
                        "quantity": float(line.quantity),
                        "rate": float(line.rate),
                        **({"tax_id": line.tax_id} if line.tax_id else {}),
                    }
                    for line in payload.lines
                ],
            },
        )
        return {
            "id": str(data["invoice"]["invoice_id"]),
            "number": data["invoice"].get("invoice_number"),
            "status": "created",
        }

    async def all_templates(self, credential: ProviderCredential) -> list[dict[str, Any]]:
        """Every template on the WhatsApp Business Account with Meta's status (paged past 100)."""
        items: list[dict[str, Any]] = []
        after: str | None = None
        for _page in range(50):
            params: dict[str, Any] = {
                "limit": 100,
                "fields": "id,name,language,status,category,quality_score,rejected_reason,components",
            }
            if after:
                params["after"] = after
            data = await self.api(
                credential, "GET", f"/{credential.account_id}/message_templates", params=params
            )
            for item in data.get("data", []):
                if not isinstance(item, dict):
                    continue
                body = next(
                    (
                        component.get("text")
                        for component in item.get("components", [])
                        if isinstance(component, dict) and component.get("type") == "BODY"
                    ),
                    None,
                )
                quality = item.get("quality_score")
                reason = item.get("rejected_reason")
                items.append({
                    "id": str(item.get("id", "")),
                    "name": str(item.get("name", "")),
                    "language": str(item.get("language", "")),
                    "status": str(item.get("status", "PENDING")),
                    "category": item.get("category"),
                    "quality": quality.get("score") if isinstance(quality, dict) else None,
                    "reason": reason if reason not in (None, "", "NONE") else None,
                    "body": body,
                })
            paging = data.get("paging", {})
            after = paging.get("cursors", {}).get("after") if paging.get("next") else None
            if not after:
                break
        return items

    async def phone_number_health(self, credential: ProviderCredential) -> dict[str, Any]:
        """The sender's standing at Meta: quality rating, messaging limit and status."""
        data = await self.api(
            credential,
            "GET",
            f"/{credential.configuration['phoneNumberId']}",
            params={"fields": "quality_rating,messaging_limit_tier,status,name_status"},
        )
        return {
            "quality": data.get("quality_rating"),
            "limit": data.get("messaging_limit_tier"),
            "status": data.get("status"),
        }

    async def create_template(
        self, credential: ProviderCredential, template: dict[str, Any]
    ) -> dict[str, Any]:
        """Submits one body-only template to Meta for review, with sample values for its variables."""
        body: dict[str, Any] = {"type": "BODY", "text": template["body"]}
        if template.get("examples"):
            body["example"] = {"body_text": [list(template["examples"])]}
        data = await self.api(
            credential,
            "POST",
            f"/{credential.account_id}/message_templates",
            json={
                "name": template["name"],
                "language": template["language"],
                "category": template["category"],
                "components": [body],
            },
        )
        return {"id": str(data.get("id", "")), "status": str(data.get("status", "PENDING"))}

    async def upload_media(
        self, credential: ProviderCredential, body: bytes, mime_type: str, filename: str
    ) -> str:
        """Uploads a file to the sending number; the answer is the media id a message names."""
        url, query, headers = await self._signed(
            credential, f"/{credential.configuration['phoneNumberId']}/media", None
        )
        data = await self.request(
            "POST",
            url,
            params=query,
            headers=headers,
            data={"messaging_product": "whatsapp", "type": mime_type},
            files={"file": (filename, body, mime_type)},
        )
        media_id = str(data.get("id") or "")
        if not media_id:
            raise IntegrationFlowError(
                "provider_invalid_response", "WhatsApp did not return a media id", 502
            )
        return media_id

    async def download_media(
        self, credential: ProviderCredential, media_id: str, max_bytes: int
    ) -> tuple[bytes, str]:
        """A client's file: the media id's short-lived URL, then its bytes with the same token."""
        metadata = await self.api(credential, "GET", f"/{media_id}")
        url = str(metadata.get("url", ""))
        if not url.startswith("https://"):
            raise IntegrationFlowError("media_unavailable", "WhatsApp media is unavailable", 404)
        declared = int(metadata.get("file_size") or 0)
        if declared > max_bytes:
            raise IntegrationFlowError("media_too_large", "WhatsApp media is too large", 413)
        response = await self.http.get(
            url, headers={"Authorization": f"Bearer {credential.access_token}"}
        )
        if response.is_error:
            raise IntegrationFlowError(
                "media_download_failed",
                "WhatsApp media could not be downloaded",
                response.status_code,
            )
        if len(response.content) > max_bytes:
            raise IntegrationFlowError("media_too_large", "WhatsApp media is too large", 413)
        return response.content, str(metadata.get("mime_type") or "application/octet-stream")

    async def send_template(
        self, credential: ProviderCredential, payload: WhatsAppMessageRequest
    ) -> dict[str, Any]:
        if payload.media_type:
            if not payload.media_id:
                raise IntegrationFlowError(
                    "media_missing", "Upload the file before sending it", 409
                )
            media: dict[str, Any] = {"id": payload.media_id}
            if payload.caption:
                media["caption"] = payload.caption
            if payload.filename and payload.media_type == "document":
                media["filename"] = payload.filename
            data = await self.api(
                credential,
                "POST",
                f"/{credential.configuration['phoneNumberId']}/messages",
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": payload.to.lstrip("+"),
                    "type": payload.media_type,
                    payload.media_type: media,
                },
            )
            return {"id": data["messages"][0]["id"], "status": "accepted"}
        if payload.text:
            data = await self.api(
                credential,
                "POST",
                f"/{credential.configuration['phoneNumberId']}/messages",
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": payload.to.lstrip("+"),
                    "type": "text",
                    "text": {"preview_url": True, "body": payload.text},
                },
            )
            return {"id": data["messages"][0]["id"], "status": "accepted"}
        components: list[dict[str, Any]] = []
        if payload.body_parameters:
            components.append(
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": text} for text in payload.body_parameters
                    ],
                }
            )
        if payload.url_parameter:
            components.append(
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": payload.url_parameter}],
                }
            )
        data = await self.api(
            credential,
            "POST",
            f"/{credential.configuration['phoneNumberId']}/messages",
            json={
                "messaging_product": "whatsapp",
                "to": payload.to.lstrip("+"),
                "type": "template",
                "template": {
                    "name": payload.template_name,
                    "language": {"code": payload.language},
                    "components": components,
                },
            },
        )
        return {"id": data["messages"][0]["id"], "status": "accepted"}
