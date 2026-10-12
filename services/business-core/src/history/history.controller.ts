import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { HistoryService } from "./history.service";

/** A record's history: who did what, when (`?filter=all|changes|messages|approvals&before=<cursor>`). */
@ApiTags("history")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/history")
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get(":recordType/:recordId") read(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("recordType") recordType: string,
    @Param("recordId", ParseUUIDPipe) recordId: string, @Query("filter") filter?: string, @Query("before") before?: string) {
    return this.history.read(actor, workspaceId, recordType, recordId, { filter, before });
  }
}
