import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ClientCallsService } from "./client-calls.service";

class FrequencyDto { @IsIn(["weekly", "fortnightly", "monthly", "off"]) frequency!: string; @IsOptional() @IsIn(["call", "portal"]) mode?: string; @IsInt() @Min(0) version!: number; }

/** PLM-046: the recurring client update of a job (a call, or a progress update in the portal). */
@ApiTags("client-calls")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects/:caseId/client-calls")
export class ClientCallsController {
  constructor(private readonly calls: ClientCallsService) {}

  @Get()
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.calls.get(actor, workspaceId, caseId);
  }

  @Put()
  set(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() body: FrequencyDto) {
    return this.calls.set(actor, workspaceId, caseId, body);
  }
}
