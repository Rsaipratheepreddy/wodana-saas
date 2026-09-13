import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmTodayService } from "./crm-today.service";

@ApiTags("crm-today") @ApiBearerAuth() @Controller("workspaces/:workspaceId/crm")
export class CrmTodayController {
  constructor(private readonly today: CrmTodayService) {}
  @Get("today") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.today.get(actor, workspaceId); }
}
