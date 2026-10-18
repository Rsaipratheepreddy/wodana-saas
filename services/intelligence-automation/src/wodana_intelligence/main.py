from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from wodana_intelligence import __version__
from wodana_intelligence.api.router import api_router
from wodana_intelligence.config import get_settings
from wodana_intelligence.container import close_clients
from wodana_intelligence.error_reporting import install_error_reporting
from wodana_intelligence.integrations.business_core import BusinessCoreError
from wodana_intelligence.integrations.google_client import GoogleApiError
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.vault import CredentialNotFoundError

settings = get_settings()
settings.validate_integration_settings()
install_error_reporting("intelligence-api")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await close_clients()


app = FastAPI(
    title="Wodana Intelligence & Automation",
    description="AI, document processing, integrations, and background automation.",
    version=__version__,
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.web_origin.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api/v1")


@app.exception_handler(IntegrationFlowError)
async def integration_flow_error(_request: Request, error: IntegrationFlowError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": str(error)}},
    )


@app.exception_handler(BusinessCoreError)
async def business_core_error(_request: Request, error: BusinessCoreError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": "business_core_error", "message": str(error)}},
    )


@app.exception_handler(GoogleApiError)
async def google_api_error(_request: Request, error: GoogleApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": str(error)}},
    )


@app.exception_handler(CredentialNotFoundError)
async def missing_credential(_request: Request, error: CredentialNotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"error": {"code": "credential_missing", "message": str(error)}},
    )
