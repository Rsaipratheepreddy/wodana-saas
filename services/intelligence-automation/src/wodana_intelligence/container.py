from functools import lru_cache
from typing import Any

import redis.asyncio as redis

from wodana_intelligence.config import get_settings
from wodana_intelligence.integrations.business_core import BusinessCoreClient
from wodana_intelligence.integrations.google_client import GoogleCalendarClient
from wodana_intelligence.integrations.google_service import GoogleIntegrationService
from wodana_intelligence.integrations.provider_client import ProviderClient
from wodana_intelligence.integrations.provider_service import ProviderService
from wodana_intelligence.integrations.security import OAuthStateStore, TokenCipher
from wodana_intelligence.integrations.vault import RedisCredentialVault


@lru_cache
def get_redis_client() -> Any:
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)  # type: ignore[no-untyped-call]


@lru_cache
def get_business_core_client() -> BusinessCoreClient:
    settings = get_settings()
    return BusinessCoreClient(settings.business_core_url, settings.business_core_internal_token)


@lru_cache
def get_google_client() -> GoogleCalendarClient:
    settings = get_settings()
    return GoogleCalendarClient(
        settings.google_client_id,
        settings.google_client_secret,
        settings.google_redirect_uri,
        settings.google_request_timeout_seconds,
    )


@lru_cache
def _cached_google_integration_service() -> GoogleIntegrationService:
    settings = get_settings()
    redis_client = get_redis_client()
    return GoogleIntegrationService(
        google=get_google_client(),
        business_core=get_business_core_client(),
        state_store=OAuthStateStore(redis_client, settings.google_oauth_state_ttl_seconds),
        vault=RedisCredentialVault(
            redis_client,
            TokenCipher(settings.integrations_encryption_key),
        ),
        state_ttl_seconds=settings.google_oauth_state_ttl_seconds,
    )


async def get_google_integration_service() -> GoogleIntegrationService:
    """Build event-loop-bound clients on the request loop, not a FastAPI worker thread."""
    return _cached_google_integration_service()


@lru_cache
def _cached_provider_service() -> ProviderService:
    settings = get_settings()
    return ProviderService(
        settings, ProviderClient(settings), get_business_core_client(), get_redis_client()
    )


async def get_provider_service() -> ProviderService:
    return _cached_provider_service()


async def close_clients() -> None:
    if _cached_provider_service.cache_info().currsize:
        await _cached_provider_service().client.http.aclose()
    _cached_provider_service.cache_clear()
    if get_google_client.cache_info().currsize:
        await get_google_client().close()
    if get_business_core_client.cache_info().currsize:
        await get_business_core_client().close()
    if get_redis_client.cache_info().currsize:
        await get_redis_client().aclose()

    _cached_google_integration_service.cache_clear()
    get_google_client.cache_clear()
    get_business_core_client.cache_clear()
    get_redis_client.cache_clear()
