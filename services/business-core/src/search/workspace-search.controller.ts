import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspaceSearchService } from "./workspace-search.service";

@ApiTags("workspace-search")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/search")
export class WorkspaceSearchController {
  constructor(private readonly search: WorkspaceSearchService) {}

  @Get()
  find(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query("q") query?: string,
    @Query("limit") limit?: string,
  ) {
    return this.search.search(actor, workspaceId, query, limit);
  }
}
