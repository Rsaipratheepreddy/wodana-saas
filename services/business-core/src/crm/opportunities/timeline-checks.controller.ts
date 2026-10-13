import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from "class-validator";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { TimelineChecksService } from "./timeline-checks.service";

export class AskTimelineCheckDto {
  /** The same id again returns the same question (a retried click). */
  @IsUUID() requestId!: string;
  @IsUUID() assigneeMembershipId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) question!: string;
}

export class AnswerTimelineCheckDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @IsNotEmpty() @MaxLength(4000) answer!: string;
}

export class TimelineCheckVersionDto {
  @IsInt() @Min(1) version!: number;
}

/** PLM-155: timeline questions on an opportunity (the Account Manager asks, the designers or Production answer). */
@ApiTags("crm-timeline-checks") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class TimelineChecksController {
  constructor(private readonly checks: TimelineChecksService) {}

  @Get("opportunities/:opportunityId/timeline-checks")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.checks.list(actor, workspaceId, opportunityId);
  }

  @Post("opportunities/:opportunityId/timeline-checks")
  ask(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Body() input: AskTimelineCheckDto) {
    return this.checks.ask(actor, workspaceId, opportunityId, input);
  }

  @Get("timeline-checks/:checkId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("checkId", ParseUUIDPipe) checkId: string) {
    return this.checks.get(actor, workspaceId, checkId);
  }

  @Post("timeline-checks/:checkId/answer")
  answer(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("checkId", ParseUUIDPipe) checkId: string, @Body() input: AnswerTimelineCheckDto) {
    return this.checks.answer(actor, workspaceId, checkId, input);
  }

  @Post("timeline-checks/:checkId/cancel")
  cancel(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("checkId", ParseUUIDPipe) checkId: string, @Body() input: TimelineCheckVersionDto) {
    return this.checks.cancel(actor, workspaceId, checkId, input);
  }
}
