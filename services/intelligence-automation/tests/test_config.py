from typing import Any, cast

import pytest

from wodana_intelligence.config import Settings


def production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "business_core_internal_token": "service-token-that-is-longer-than-thirty-two-characters",
        "integrations_encryption_key": "encryption-key-that-is-longer-than-thirty-two-characters",
        "google_client_id": "google-client-id",
        "google_client_secret": "google-client-secret",
        "web_origin": "https://app.wodana.ai",
        "google_redirect_uri": "https://api.wodana.ai/api/v1/integrations/google/oauth/callback",
        # Keep optional providers deterministic. BaseSettings also reads the caller's
        # environment, which must not make this unit test depend on a developer's
        # locally configured integrations.
        "quickbooks_client_id": "",
        "quickbooks_client_secret": "",
        "zoho_client_id": "",
        "zoho_client_secret": "",
    }
    values.update(overrides)
    return Settings(**cast(Any, values))


def test_production_integration_settings_accept_managed_secrets_and_https() -> None:
    production_settings().validate_integration_settings()


@pytest.mark.parametrize(
    ("override", "message"),
    [
        (
            {
                "quickbooks_client_id": "quickbooks-client-id",
                "quickbooks_redirect_uri": "http://api.wodana.ai/oauth/callback",
            },
            "HTTPS QUICKBOOKS_REDIRECT_URI",
        ),
        (
            {
                "zoho_client_id": "zoho-client-id",
                "zoho_redirect_uri": "http://api.wodana.ai/oauth/callback",
            },
            "HTTPS ZOHO_REDIRECT_URI",
        ),
    ],
)
def test_production_optional_providers_require_https_callbacks(
    override: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        production_settings(**override).validate_integration_settings()


@pytest.mark.parametrize(
    ("override", "message"),
    [
        (
            {"business_core_internal_token": "local-development-token"},
            "BUSINESS_CORE_INTERNAL_TOKEN",
        ),
        (
            {
                "integrations_encryption_key": "local-development-integration-key-change-me"
            },
            "INTEGRATIONS_ENCRYPTION_KEY",
        ),
        ({"google_client_secret": ""}, "Google OAuth client credentials"),
        ({"web_origin": "http://app.wodana.ai"}, "HTTPS WEB_ORIGIN"),
        (
            {"google_redirect_uri": "http://api.wodana.ai/oauth/callback"},
            "HTTPS GOOGLE_REDIRECT_URI",
        ),
    ],
)
def test_production_integration_settings_reject_insecure_defaults(
    override: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        production_settings(**override).validate_integration_settings()
