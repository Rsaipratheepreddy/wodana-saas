import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExcludeController,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { Public } from "../auth/public.decorator";
import {
  CompleteGoogleConnectionDto,
  CompleteProviderConnectionDto,
  AuthorizeIntegrationUseDto,
  DiscoverIntegrationResourcesDto,
  IntegrationFailureDto,
  MarkIntegrationSyncedDto,
  RecordIntegrationHealthDto,
  ReportIntegrationUseDto,
  RecordIntegrationActivityDto,
} from "./dto/integration-runtime.dto";
import { UpdateIntegrationResourcesDto } from "./dto/update-integration-resources.dto";
import { IntegrationsService } from "./integrations.service";

@ApiTags("integrations")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/integration-connections")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post(":connectionId/authorize-use")
  authorizeUse(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: AuthorizeIntegrationUseDto,
  ) {
    return this.integrations.authorizeUse(actor, workspaceId, connectionId, input.access);
  }

  @Get(":connectionId")
  @ApiOperation({ summary: "Get a safe integration connection summary" })
  getConnection(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ) {
    return this.integrations.getConnection(actor, workspaceId, connectionId);
  }

  @Get(":connectionId/resources")
  @ApiOperation({ summary: "List discovered resources and their selection state" })
  listResources(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ) {
    return this.integrations.listResources(actor, workspaceId, connectionId);
  }

  @Post(":connectionId/runtime-health")
  reportRuntimeHealth(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: ReportIntegrationUseDto,
  ) {
    return this.integrations.reportRuntimeHealth(actor, workspaceId, connectionId, input);
  }

  @Patch(":connectionId/resources")
  @ApiOperation({ summary: "Select calendars and configure their sync direction" })
  updateResources(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: UpdateIntegrationResourcesDto,
  ) {
    return this.integrations.updateResources(actor, workspaceId, connectionId, input);
  }
}

@ApiTags("integrations")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/integration-capabilities")
export class ProviderCapabilitiesController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: "List provider capability, connection and verification states" })
  capabilities(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.integrations.capabilities(actor, workspaceId);
  }
}

@ApiTags("internal-integrations")
@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/integrations")
export class InternalIntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post(":connectionId/provider/complete")
  completeProvider(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: CompleteProviderConnectionDto,
  ) {
    return this.integrations.completeProviderConnection(connectionId, input);
  }

  @Post(":connectionId/google/complete")
  @ApiOkResponse({ description: "Marks a Google OAuth connection as connected" })
  completeGoogle(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: CompleteGoogleConnectionDto,
  ) {
    return this.integrations.completeGoogleConnection(connectionId, input);
  }

  @Post(":connectionId/failure")
  failConnection(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: IntegrationFailureDto,
  ) {
    return this.integrations.failConnection(connectionId, input);
  }

  @Post(":connectionId/resources/discover")
  discoverResources(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: DiscoverIntegrationResourcesDto,
  ) {
    return this.integrations.discoverResources(connectionId, input);
  }

  @Post(":connectionId/synced")
  markSynced(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: MarkIntegrationSyncedDto,
  ) {
    return this.integrations.markSynced(connectionId, input);
  }

  @Post(":connectionId/health")
  recordHealth(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: RecordIntegrationHealthDto,
  ) {
    return this.integrations.recordHealth(connectionId, input);
  }

  @Post(":connectionId/activity")
  recordActivity(
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
    @Body() input: RecordIntegrationActivityDto,
  ) {
    return this.integrations.recordActivity(connectionId, input);
  }

  @Get("workspaces/:workspaceId/providers/:provider/runtime")
  providerRuntime(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("provider") provider: string,
  ) {
    return this.integrations.providerRuntime(workspaceId, provider);
  }

  @Get(":workspaceId/:connectionId/runtime")
  runtimeContext(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ) {
    return this.integrations.runtimeContext(workspaceId, connectionId);
  }
}
