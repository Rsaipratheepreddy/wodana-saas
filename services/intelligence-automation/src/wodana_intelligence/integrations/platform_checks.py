"""Safe live checks of Wodana's app credentials (Wodana Control → Platform connections → Test).

Each check proves the provider recognises the app without acting for anyone: no firm's account is
touched and nothing is ever sent. The answer is a reason code, never the provider's own text.
"""

import base64
import re
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from wodana_intelligence.integrations.platform_credentials import PlatformCredentials, Vendor
from wodana_intelligence.integrations.provider_client import ZOHO_REGIONS

INTUIT_DISCOVERY = {
    "sandbox": "https://developer.intuit.com/.well-known/openid_sandbox_configuration",
    "production": "https://developer.intuit.com/.well-known/openid_configuration",
}
GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration"
# A refresh token that cannot exist: a token endpoint answers "bad grant" for an app it recognises
# and "bad client" for one it doesn't, so nothing is granted either way.
PROBE_GRANT = "wodana-platform-credential-check"
TIMEOUT = 10.0
GRAPH_VERSION = re.compile(r"^v\d{1,2}\.\d$")
# Meta: calling a deprecated or unknown Graph API version.
META_VERSION_ERRORS = {2635}


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    reason: Optional[str] = None


PASSED = CheckResult(True)


def failed(reason: str) -> CheckResult:
    return CheckResult(False, reason)


async def check_platform_credentials(
    vendor: Vendor, credentials: PlatformCredentials, http: httpx.AsyncClient
) -> CheckResult:
    try:
        if vendor == "meta":
            return await _meta(credentials, http)
        if vendor == "intuit":
            return await _intuit(credentials, http)
        if vendor == "zoho":
            return await _zoho(credentials, http)
        return await _google(credentials, http)
    except httpx.HTTPError:
        return failed("unreachable")


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def _meta(credentials: PlatformCredentials, http: httpx.AsyncClient) -> CheckResult:
    app_id, secret = credentials.whatsapp_app_id, credentials.whatsapp_app_secret
    if not app_id or not secret or not credentials.whatsapp_config_id:
        return failed("not_set")
    if (
        not app_id.isdigit()
        or not credentials.whatsapp_config_id.isdigit()
        or not GRAPH_VERSION.fullmatch(credentials.whatsapp_graph_version)
    ):
        return failed("invalid_format")
    # The app's own access token (client credentials) proves the ID and secret belong together.
    response = await http.get(
        f"{credentials.graph}/oauth/access_token",
        params={"client_id": app_id, "client_secret": secret, "grant_type": "client_credentials"},
        timeout=TIMEOUT,
    )
    if response.status_code >= 500:
        return failed("unreachable")
    data = _json(response)
    if response.is_error:
        error = data.get("error")
        code = error.get("code") if isinstance(error, dict) else None
        return failed("graph_version" if code in META_VERSION_ERRORS else "rejected")
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        return failed("unexpected_response")
    # debug_token confirms the token is valid and issued to this app.
    debug = await http.get(
        f"{credentials.graph}/debug_token",
        params={"input_token": token, "access_token": token},
        timeout=TIMEOUT,
    )
    if debug.status_code >= 500:
        return failed("unreachable")
    details = _json(debug).get("data")
    if debug.is_error or not isinstance(details, dict):
        return failed("unexpected_response")
    if not details.get("is_valid") or str(details.get("app_id")) != app_id:
        return failed("app_mismatch")
    return PASSED


async def _token_probe(
    http: httpx.AsyncClient,
    url: str,
    *,
    data: dict[str, str],
    headers: Optional[dict[str, str]] = None,
    recognised: tuple[str, ...] = ("invalid_grant",),
) -> CheckResult:
    response = await http.post(url, data=data, headers=headers, timeout=TIMEOUT)
    if response.status_code >= 500:
        return failed("unreachable")
    error = str(_json(response).get("error") or "")
    if error in ("invalid_client", "invalid_client_secret", "unauthorized_client"):
        return failed("rejected")
    if error in recognised:
        return PASSED
    if response.status_code in (401, 403):
        return failed("rejected")
    return failed("unexpected_response")


def _https_on(url: Any, *hosts: str) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(
        host == item or host.endswith("." + item) for item in hosts
    )


async def _intuit(credentials: PlatformCredentials, http: httpx.AsyncClient) -> CheckResult:
    client_id, secret = credentials.quickbooks_client_id, credentials.quickbooks_client_secret
    if not client_id or not secret:
        return failed("not_set")
    discovery = await http.get(
        INTUIT_DISCOVERY[credentials.quickbooks_environment], timeout=TIMEOUT
    )
    if discovery.status_code >= 500:
        return failed("unreachable")
    endpoint = _json(discovery).get("token_endpoint")
    if discovery.is_error or not _https_on(endpoint, "intuit.com"):
        return failed("unexpected_response")
    basic = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    return await _token_probe(
        http,
        str(endpoint),
        data={"grant_type": "refresh_token", "refresh_token": PROBE_GRANT},
        headers={"Authorization": f"Basic {basic}", "Accept": "application/json"},
    )


async def _zoho(credentials: PlatformCredentials, http: httpx.AsyncClient) -> CheckResult:
    if not credentials.zoho_client_id or not credentials.zoho_client_secret:
        return failed("not_set")
    # Zoho answers "invalid_code" for an unknown refresh token from an app it knows.
    return await _token_probe(
        http,
        f"https://{ZOHO_REGIONS[credentials.zoho_region][0]}/oauth/v2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": PROBE_GRANT,
            "client_id": credentials.zoho_client_id,
            "client_secret": credentials.zoho_client_secret,
        },
        recognised=("invalid_code", "invalid_grant"),
    )


async def _google(credentials: PlatformCredentials, http: httpx.AsyncClient) -> CheckResult:
    if not credentials.google_client_id or not credentials.google_client_secret:
        return failed("not_set")
    discovery = await http.get(GOOGLE_DISCOVERY, timeout=TIMEOUT)
    if discovery.status_code >= 500:
        return failed("unreachable")
    endpoint = _json(discovery).get("token_endpoint")
    if discovery.is_error or not _https_on(endpoint, "googleapis.com", "google.com"):
        return failed("unexpected_response")
    return await _token_probe(
        http,
        str(endpoint),
        data={
            "grant_type": "refresh_token",
            "refresh_token": PROBE_GRANT,
            "client_id": credentials.google_client_id,
            "client_secret": credentials.google_client_secret,
        },
    )
