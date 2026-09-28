from typing import Any

import httpx
import redis.asyncio as redis
from fastapi import APIRouter, HTTPException, status

from wodana_intelligence.config import get_settings

router = APIRouter()


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok", "service": "intelligence-automation"}


@router.get("/ready")
async def ready() -> dict[str, Any]:
    settings = get_settings()
    if not settings.dependency_checks_enabled:
        return {
            "status": "ready",
            "service": settings.service_name,
            "dependencies": "checks-disabled",
        }

    checks: dict[str, str] = {}
    failures: list[str] = []

    redis_client = redis.from_url(  # type: ignore[no-untyped-call]
        settings.redis_url,
        decode_responses=True,
    )
    try:
        await redis_client.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"
        failures.append("redis")
    finally:
        await redis_client.aclose()

    try:
        # Reachability only: Business Core's own readiness also fails on a silent worker in
        # production, and this API (OAuth callbacks, webhooks) must keep serving while it's down.
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{settings.business_core_url}/health/live")
            response.raise_for_status()
        checks["business_core"] = "ok"
    except (httpx.HTTPError, ValueError):
        checks["business_core"] = "unavailable"
        failures.append("business_core")

    if failures:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "not-ready", "checks": checks},
        )

    return {"status": "ready", "service": settings.service_name, "checks": checks}
