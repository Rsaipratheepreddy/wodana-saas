import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DesignJourneyService } from "./design-journey.service";

class StageVersionDto { @IsInt() @Min(1) version!: number; @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000) note?: string | null; }
class ScheduleSiteVisitDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt!: string;
  @IsString() @MaxLength(64) timezone!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) address?: string | null;
}
class SkipStageDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(2000) note!: string; }
class CompleteSiteVisitDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(5000) summary!: string; }

@ApiTags("design")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects/:caseId/design-journey")
export class DesignJourneyController {
  constructor(private readonly journey: DesignJourneyService) {}

  @Get()
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.journey.get(actor, workspaceId, caseId); }

  @Post("start")
  start(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.journey.start(actor, workspaceId, caseId); }

  @Post("inspiration/close")
  closeInspiration(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.closeInspiration(actor, workspaceId, caseId, input); }

  @Post("site-visit/schedule")
  scheduleSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: ScheduleSiteVisitDto) { return this.journey.scheduleSiteVisit(actor, workspaceId, caseId, input); }

  @Post("stages/:stage/skip")
  skipStage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("stage") stage: string, @Body() input: SkipStageDto) { return this.journey.skipStage(actor, workspaceId, caseId, stage, input); }

  @Post("sign-off")
  signOff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.signOff(actor, workspaceId, caseId, input); }

  @Post("site-visit/complete")
  completeSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: CompleteSiteVisitDto) { return this.journey.completeSiteVisit(actor, workspaceId, caseId, input); }
}
