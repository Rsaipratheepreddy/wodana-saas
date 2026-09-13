from fastapi import APIRouter

from wodana_intelligence.api.routes import capabilities, google_workspace, health, providers

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(capabilities.router, prefix="/capabilities", tags=["capabilities"])
api_router.include_router(
    google_workspace.router,
    prefix="/integrations/google",
    tags=["google-workspace"],
)

api_router.include_router(providers.router, prefix="/integrations/providers", tags=["providers"])
