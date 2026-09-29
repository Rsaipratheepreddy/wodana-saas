"""Wodana's own app credentials for Meta, Intuit, Zoho and Google, read live.

Operators set them in Wodana Control; Business Core keeps them with the secrets sealed by this
service (the key that already seals firms' integration tokens). The resolver reads them through
Business Core's internal endpoint, caches them for a minute, and falls back to the environment for
anything not saved, so a change applies within a minute without a restart.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal, Optional, cast, get_args

from pydantic import BaseModel, ConfigDict

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.provider_models import Region
from wodana_intelligence.integrations.security import InvalidEncryptedSecretError, TokenCipher

logger = logging.getLogger("wodana.platform-credentials")

Vendor = Literal["meta", "intuit", "zoho", "google"]
SecretField = Literal["clientSecret", "webhookSecret"]
VENDORS: tuple[Vendor, ...] = get_args(Vendor)
# The product's provider names for each vendor's app.
VENDOR_OF_PROVIDER: dict[str, Vendor] = {
    "whatsapp": "meta",
    "quickbooks": "intuit",
    "zoho_books": "zoho",
    "google_workspace": "google",
}
REGIONS: tuple[Region, ...] = get_args(Region)

# One callback per provider for every firm (the firm travels in the OAuth state). Kept in step
# with the routes in api/router.py and with the URLs Wodana Control shows to register.
GOOGLE_CALLBACK = "/api/v1/integrations/google/oauth/callback"
QUICKBOOKS_CALLBACK = "/api/v1/integrations/providers/quickbooks/oauth/callback"
ZOHO_CALLBACK = "/api/v1/integrations/providers/zoho_books/oauth/callback"

CACHE_SECONDS = 60.0
RETRY_SECONDS = 10.0


def secret_purpose(vendor: str, field: str) -> str:
    """What a sealed platform secret is for: a value sealed for one field never opens as another."""
    return f"platform-credential:{vendor}:{field}"


class PlatformCredentials(BaseModel):
    """The credentials in effect: Wodana Control's value for each field, else the environment's."""

    model_config = ConfigDict(frozen=True)

    public_api_base: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    quickbooks_client_id: str = ""
    quickbooks_client_secret: str = ""
    quickbooks_environment: Literal["sandbox", "production"] = "sandbox"
    quickbooks_redirect_uri: str = ""
    quickbooks_webhook_verifier: str = ""
    zoho_client_id: str = ""
    zoho_client_secret: str = ""
    zoho_redirect_uri: str = ""
    zoho_region: Region = "us"
    whatsapp_app_id: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_config_id: str = ""
    whatsapp_graph_version: str = "v23.0"
    whatsapp_webhook_verify_token: str = ""
    # The saved version of each vendor's credentials (absent when Wodana Control couldn't be read).
    versions: dict[str, int] = {}

    @classmethod
    def from_settings(cls, settings: Settings) -> "PlatformCredentials":
        return cls(
            google_client_id=settings.google_client_id,
            google_client_secret=settings.google_client_secret,
            google_redirect_uri=settings.google_redirect_uri,
            quickbooks_client_id=settings.quickbooks_client_id,
            quickbooks_client_secret=settings.quickbooks_client_secret,
            quickbooks_environment=settings.quickbooks_environment,
            quickbooks_redirect_uri=settings.quickbooks_redirect_uri,
            quickbooks_webhook_verifier=settings.quickbooks_webhook_verifier,
            zoho_client_id=settings.zoho_client_id,
            zoho_client_secret=settings.zoho_client_secret,
            zoho_redirect_uri=settings.zoho_redirect_uri,
            whatsapp_app_id=settings.whatsapp_app_id,
            whatsapp_app_secret=settings.whatsapp_app_secret,
            whatsapp_config_id=settings.whatsapp_config_id,
            whatsapp_graph_version=settings.whatsapp_graph_version,
            whatsapp_webhook_verify_token=settings.whatsapp_webhook_verify_token,
        )

    def configured(self, provider: str) -> bool:
        """Whether firms can connect this provider (a product name or the vendor's)."""
        vendor = VENDOR_OF_PROVIDER.get(provider, provider)
        if vendor == "meta":
            return bool(
                self.whatsapp_app_id and self.whatsapp_app_secret and self.whatsapp_config_id
            )
        if vendor == "intuit":
            return bool(self.quickbooks_client_id and self.quickbooks_client_secret)
        if vendor == "zoho":
            return bool(self.zoho_client_id and self.zoho_client_secret)
        if vendor == "google":
            return bool(self.google_client_id and self.google_client_secret)
        return False

    @property
    def graph(self) -> str:
        return f"https://graph.facebook.com/{self.whatsapp_graph_version}"


def merge(
    settings: Settings, rows: list[dict[str, Any]], cipher: TokenCipher
) -> PlatformCredentials:
    """Wodana Control's saved values over the environment, field by field."""
    env = PlatformCredentials.from_settings(settings)
    saved = {str(row.get("provider")): row for row in rows if isinstance(row, dict)}
    values: dict[str, Any] = env.model_dump()

    def text(vendor: str, key: str) -> str:
        value = saved.get(vendor, {}).get(key)
        return value.strip() if isinstance(value, str) else ""

    def secret(vendor: str, field: SecretField) -> str:
        sealed = saved.get(vendor, {}).get(field)
        if not isinstance(sealed, str) or not sealed:
            return ""
        try:
            return cipher.open_value(secret_purpose(vendor, field), sealed)
        except InvalidEncryptedSecretError:
            # A value sealed with another key (or for another field) is unusable: fall back, loudly.
            logger.warning("A saved %s %s could not be opened; using the fallback", vendor, field)
            return ""

    def take(name: str, value: str) -> None:
        if value:
            values[name] = value

    base = text("platform", "publicApiBase").rstrip("/")
    values["public_api_base"] = base
    if base:
        values["google_redirect_uri"] = base + GOOGLE_CALLBACK
        values["quickbooks_redirect_uri"] = base + QUICKBOOKS_CALLBACK
        values["zoho_redirect_uri"] = base + ZOHO_CALLBACK

    take("whatsapp_app_id", text("meta", "clientId"))
    take("whatsapp_app_secret", secret("meta", "clientSecret"))
    take("whatsapp_config_id", text("meta", "configId"))
    take("whatsapp_graph_version", text("meta", "graphVersion"))
    take("whatsapp_webhook_verify_token", secret("meta", "webhookSecret"))

    take("quickbooks_client_id", text("intuit", "clientId"))
    take("quickbooks_client_secret", secret("intuit", "clientSecret"))
    if text("intuit", "environment") in ("sandbox", "production"):
        values["quickbooks_environment"] = text("intuit", "environment")
    take("quickbooks_webhook_verifier", secret("intuit", "webhookSecret"))

    take("zoho_client_id", text("zoho", "clientId"))
    take("zoho_client_secret", secret("zoho", "clientSecret"))
    if text("zoho", "dataCenter") in REGIONS:
        values["zoho_region"] = text("zoho", "dataCenter")

    take("google_client_id", text("google", "clientId"))
    take("google_client_secret", secret("google", "clientSecret"))

    values["versions"] = {
        vendor: int(row["version"])
        for vendor, row in saved.items()
        if isinstance(row.get("version"), int) and row["version"] > 0
    }
    return PlatformCredentials.model_validate(values)


class PlatformCredentialResolver:
    """The credentials in effect now: Wodana Control (cached a minute), env as the fallback."""

    def __init__(
        self,
        settings: Settings,
        fetch: Optional[Callable[[], Awaitable[dict[str, Any]]]] = None,
        cipher: Optional[TokenCipher] = None,
        *,
        ttl_seconds: float = CACHE_SECONDS,
        retry_seconds: float = RETRY_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._fetch = fetch
        self._cipher = cipher or TokenCipher(settings.integrations_encryption_key)
        self._ttl = ttl_seconds
        self._retry = retry_seconds
        self._clock = clock
        self._value: Optional[PlatformCredentials] = None
        self._fresh_until = 0.0
        self._lock = asyncio.Lock()

    async def current(self) -> PlatformCredentials:
        if self._value is not None and self._clock() < self._fresh_until:
            return self._value
        async with self._lock:
            if self._value is not None and self._clock() < self._fresh_until:
                return self._value
            return await self._load()

    async def refresh(self) -> PlatformCredentials:
        """Reads Wodana Control now (a Test checks exactly what is saved)."""
        async with self._lock:
            return await self._load()

    def seal(self, vendor: Vendor, field: SecretField, value: str) -> str:
        return self._cipher.seal_value(secret_purpose(vendor, field), value)

    async def _load(self) -> PlatformCredentials:
        if self._fetch is None:
            self._value = PlatformCredentials.from_settings(self._settings)
            self._fresh_until = float("inf")
            return self._value
        try:
            payload = await self._fetch()
            rows = payload.get("providers")
            if not isinstance(rows, list):
                raise ValueError("Platform credentials response has no providers")
            self._value = merge(self._settings, cast(list[dict[str, Any]], rows), self._cipher)
            self._fresh_until = self._clock() + self._ttl
        except Exception as error:  # Any failure keeps the last good value (or the environment).
            logger.warning("Platform credentials could not be read (%s)", type(error).__name__)
            if self._value is None or not self._value.versions:
                self._value = PlatformCredentials.from_settings(self._settings)
            self._fresh_until = self._clock() + self._retry
        return self._value
