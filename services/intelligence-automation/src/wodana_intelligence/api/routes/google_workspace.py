from collections.abc import Mapping
from typing import Annotated, Optional
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import RedirectResponse

from wodana_intelligence.container import get_google_integration_service
from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.models import (
    AvailabilityRequest,
    AvailabilityResponse,
    CalendarEventResponse,
    CalendarListResponse,
    CancelCalendarEventRequest,
    CreateCalendarEventRequest,
    OAuthStartRequest,
    OAuthStartResponse,
    UpdateCalendarEventRequest,
)
from wodana_intelligence.integrations.return_origin import web_base

router = APIRouter()
GoogleService = Annotated[GoogleIntegrationService, Depends(get_google_integration_service)]


def actor_headers(request: Request) -> Mapping[str, str]:
    allowed = {
        "authorization",
        "x-wodana-user-subject",
        "x-wodana-user-email",
        "x-wodana-user-name",
    }
    return {
        name.lower(): value
        for name, value in request.headers.items()
        if name.lower() in allowed and value
    }


@router.post("/oauth/start", response_model=OAuthStartResponse, response_model_by_alias=True)
async def start_oauth(
    payload: OAuthStartRequest,
    request: Request,
    service: GoogleService,
) -> OAuthStartResponse:
    return await service.start_oauth(payload, actor_headers(request))


@router.get("/oauth/callback", include_in_schema=False)
async def oauth_callback(
    service: GoogleService,
    state: str = Query(default=""),
    code: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
) -> RedirectResponse:
    base_url = web_base(await service.return_origin(state))
    try:
        workspace_id, connection_id = await service.complete_oauth(state, code, error)
    except IntegrationFlowError as flow_error:
        query = urlencode({"google": "error", "code": flow_error.code})
        return RedirectResponse(f"{base_url}/workspace/integrations?{query}", status_code=303)
    query = urlencode(
        {
            "google": "connected",
            "workspaceId": str(workspace_id),
            "connectionId": str(connection_id),
        }
    )
    return RedirectResponse(f"{base_url}/workspace/integrations?{query}", status_code=303)


@router.get(
    "/workspaces/{workspace_id}/connections/{connection_id}/calendars",
    response_model=CalendarListResponse,
    response_model_by_alias=True,
)
async def list_calendars(
    workspace_id: UUID,
    connection_id: UUID,
    request: Request,
    service: GoogleService,
) -> CalendarListResponse:
    return await service.list_calendars(workspace_id, connection_id, actor_headers(request))


@router.post("/calendar-events")
async def calendar_events(
    payload: AvailabilityRequest,
    request: Request,
    service: GoogleService,
) -> dict[str, object]:
    return await service.calendar_events(payload, actor_headers(request))


@router.post(
    "/availability",
    response_model=AvailabilityResponse,
    response_model_by_alias=True,
)
async def availability(
    payload: AvailabilityRequest,
    request: Request,
    service: GoogleService,
) -> AvailabilityResponse:
    return await service.availability(payload, actor_headers(request))


@router.delete("/workspaces/{workspace_id}/connections/{connection_id}")
async def revoke_connection(
    workspace_id: UUID,
    connection_id: UUID,
    request: Request,
    service: GoogleService,
    version: int = Query(ge=1),
) -> dict[str, object]:
    return await service.revoke(workspace_id, connection_id, version, actor_headers(request))


@router.post(
    "/events",
    response_model=CalendarEventResponse,
    response_model_by_alias=True,
)
async def create_event(
    payload: CreateCalendarEventRequest,
    request: Request,
    service: GoogleService,
) -> CalendarEventResponse:
    return await service.create_event(payload, actor_headers(request))


@router.patch(
    "/events/{event_id}",
    response_model=CalendarEventResponse,
    response_model_by_alias=True,
)
async def update_event(
    event_id: Annotated[str, Path(min_length=1, max_length=1024)],
    payload: UpdateCalendarEventRequest,
    request: Request,
    service: GoogleService,
) -> CalendarEventResponse:
    return await service.update_event(event_id, payload, actor_headers(request))


@router.post("/events/{event_id}/cancel")
async def cancel_event(
    event_id: Annotated[str, Path(min_length=1, max_length=1024)],
    payload: CancelCalendarEventRequest,
    request: Request,
    service: GoogleService,
) -> dict[str, object]:
    return await service.cancel_event(event_id, payload, actor_headers(request))
