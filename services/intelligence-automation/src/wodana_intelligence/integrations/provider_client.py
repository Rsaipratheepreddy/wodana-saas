"""Provider HTTP contracts. No caller-supplied hosts or arbitrary endpoint forwarding."""

import base64
import hashlib
import hmac
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional
from urllib.parse import quote, urlencode, urlparse

import httpx

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.google_service import IntegrationFlowError
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
    ],
    "whatsapp": ["whatsapp_business_management", "whatsapp_business_messaging"],
}


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
    def __init__(self, settings: Settings, client: Optional[httpx.AsyncClient] = None) -> None:
        self.settings = settings
        self.http = client or httpx.AsyncClient(timeout=25, follow_redirects=False)

    def configured(self, provider: Provider) -> bool:
        if provider == "quickbooks":
            return bool(
                self.settings.quickbooks_client_id and self.settings.quickbooks_client_secret
            )
        if provider == "zoho_books":
            return bool(self.settings.zoho_client_id and self.settings.zoho_client_secret)
        return bool(
            self.settings.whatsapp_app_id
            and self.settings.whatsapp_app_secret
            and self.settings.whatsapp_config_id
        )

    def redirect_uri(self, provider: Provider) -> str:
        return (
            self.settings.quickbooks_redirect_uri
            if provider == "quickbooks"
            else self.settings.zoho_redirect_uri
        )

    def authorization_url(self, provider: Provider, region: Region, state: str) -> str:
        params = {
            "response_type": "code",
            "state": state,
            "redirect_uri": self.redirect_uri(provider),
        }
        if provider == "quickbooks":
            params.update(
                client_id=self.settings.quickbooks_client_id, scope=" ".join(SCOPES[provider])
            )
            return "https://appcenter.intuit.com/connect/oauth2?" + urlencode(params)
        params.update(
            client_id=self.settings.zoho_client_id,
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
        if provider == "whatsapp":
            return await self.request(
                "GET",
                f"{self.graph}/oauth/access_token",
                params={
                    "client_id": self.settings.whatsapp_app_id,
                    "client_secret": self.settings.whatsapp_app_secret,
                    "code": code,
                },
            )
        payload = {"grant_type": "refresh_token" if refresh else "authorization_code"}
        payload.update(
            {"refresh_token": refresh}
            if refresh
            else {"code": code, "redirect_uri": self.redirect_uri(provider)}
        )
        if provider == "quickbooks":
            basic = base64.b64encode(
                f"{self.settings.quickbooks_client_id}:{self.settings.quickbooks_client_secret}".encode()
            ).decode()
            return await self.request(
                "POST",
                "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
                data=payload,
                headers={"Authorization": f"Basic {basic}", "Accept": "application/json"},
            )
        payload.update(
            client_id=self.settings.zoho_client_id, client_secret=self.settings.zoho_client_secret
        )
        return await self.request(
            "POST", f"https://{ZOHO_REGIONS[region][0]}/oauth/v2/token", data=payload
        )

    @property
    def graph(self) -> str:
        return f"https://graph.facebook.com/{self.settings.whatsapp_graph_version}"

    async def api(
        self,
        credential: ProviderCredential,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> dict[str, Any]:
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
            base = self.graph
            authorization = f"Bearer {credential.access_token}"
            query["appsecret_proof"] = hmac.new(
                self.settings.whatsapp_app_secret.encode(),
                credential.access_token.encode(),
                hashlib.sha256,
            ).hexdigest()
        return await self.request(
            method,
            base + path,
            params=query,
            json=json,
            headers={"Authorization": authorization, "Accept": "application/json"},
        )

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
            endpoint = {
                "customers": "contacts",
                "vendors": "contacts",
                "invoices": "invoices",
                "items": "items",
                "bills": "bills",
                "payments": "customerpayments",
                "purchaseorders": "purchaseorders",
                "expenses": "expenses",
            }.get(kind)
            if not endpoint:
                raise IntegrationFlowError("invalid_resource", "Unsupported accounting resource")
            query: dict[str, Any] = {"page": page, "per_page": 50}
            if kind in ("customers", "vendors"):
                query["contact_type"] = "customer" if kind == "customers" else "vendor"
            data = await self.api(credential, "GET", f"/{endpoint}", params=query)
            return {
                "items": data.get(endpoint, []),
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

    async def send_template(
        self, credential: ProviderCredential, payload: WhatsAppMessageRequest
    ) -> dict[str, Any]:
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
