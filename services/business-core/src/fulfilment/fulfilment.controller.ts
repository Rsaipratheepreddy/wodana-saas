import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { FulfilmentService } from "./fulfilment.service";

/** A won order's fulfilment on its deal (PLM-083, PLM-126) and the rules per enquiry type and path. Bodies are validated in the service. */
@ApiTags("fulfilment")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/fulfilment")
export class FulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get("deals/:opportunityId")
  deal(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.fulfilment.view(actor, workspaceId, opportunityId);
  }

  @Post("deals/:opportunityId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Body() input: Record<string, unknown>) {
    return this.fulfilment.command(actor, workspaceId, opportunityId, input ?? {});
  }

  @Get("rules")
  rules(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.fulfilment.rules(actor, workspaceId);
  }

  @Put("rules/:flowId")
  saveRules(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() input: Record<string, unknown>) {
    return this.fulfilment.saveRules(actor, workspaceId, flowId, input ?? {});
  }
}
