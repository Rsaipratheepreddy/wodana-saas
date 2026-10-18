import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { ProjectProfitService } from "./project-profit.service";

/** Ledger project profit: one project's P&L and the Projects profit grid. Read only. */
@ApiTags("ledger")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books")
export class ProjectProfitController {
  constructor(private readonly profit: ProjectProfitService) {}

  @Get("projects/:projectId/pnl")
  pnl(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.profit.pnl(actor, workspaceId, projectId);
  }

  @Get("projects-profit")
  projectsProfit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query("entity") entity?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.profit.projectsProfit(actor, workspaceId, { entity, from, to });
  }
}
