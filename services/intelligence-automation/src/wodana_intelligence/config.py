from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    service_name: str = "intelligence-automation"
    environment: str = "development"
    log_level: str = "INFO"
    port: int = 8001
    web_origin: str = "http://localhost:3000"
    business_core_url: str = "http://localhost:8000/api/v1"
    business_core_internal_token: str = "local-development-token"
    portal_otp_template: str = ""
    portal_otp_language: str = "en_US"
    redis_url: str = "redis://localhost:6379/0"
    worker_consumer_group: str = "wodana-intelligence"
    worker_consumer_name: str = "worker-1"
    notification_adapter_mode: str = "unconfigured"
    dependency_checks_enabled: bool = False
    integrations_encryption_key: str = "local-development-integration-key-change-me"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8001/api/v1/integrations/google/oauth/callback"
    google_oauth_state_ttl_seconds: int = 600
    google_request_timeout_seconds: float = 15.0

    quickbooks_client_id: str = ""
    quickbooks_client_secret: str = ""
    quickbooks_environment: Literal["sandbox", "production"] = "sandbox"
    quickbooks_redirect_uri: str = (
        "http://localhost:8001/api/v1/integrations/providers/quickbooks/oauth/callback"
    )
    quickbooks_webhook_verifier: str = ""
    zoho_client_id: str = ""
    zoho_client_secret: str = ""
    zoho_redirect_uri: str = (
        "http://localhost:8001/api/v1/integrations/providers/zoho_books/oauth/callback"
    )
    whatsapp_app_id: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_config_id: str = ""
    whatsapp_graph_version: str = "v23.0"
    whatsapp_webhook_verify_token: str = ""
    integration_public_url: str = "http://localhost:8001/api/v1/integrations/providers"

    def validate_integration_settings(self) -> None:
        if self.environment.lower() == "production":
            if (
                len(self.business_core_internal_token) < 32
                or self.business_core_internal_token == "local-development-token"
            ):
                raise ValueError(
                    "Production requires BUSINESS_CORE_INTERNAL_TOKEN with at least 32 characters"
                )
            if (
                len(self.integrations_encryption_key) < 32
                or self.integrations_encryption_key == "local-development-integration-key-change-me"
            ):
                raise ValueError(
                    "Production requires INTEGRATIONS_ENCRYPTION_KEY with at least 32 characters"
                )
            if not self.google_client_id or not self.google_client_secret:
                raise ValueError("Production requires Google OAuth client credentials")
            secure_urls = [
                ("WEB_ORIGIN", self.web_origin.split(",", 1)[0]),
                ("GOOGLE_REDIRECT_URI", self.google_redirect_uri),
            ]
            if self.quickbooks_client_id:
                secure_urls.append(("QUICKBOOKS_REDIRECT_URI", self.quickbooks_redirect_uri))
            if self.zoho_client_id:
                secure_urls.append(("ZOHO_REDIRECT_URI", self.zoho_redirect_uri))
            for name, value in secure_urls:
                parsed = urlparse(value)
                if parsed.scheme != "https" or not parsed.netloc:
                    raise ValueError(f"Production requires an HTTPS {name}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
