import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DesignJourneyService } from "./design-journey.service";

class StageVersionDto { @IsInt() @Min(1) version!: number; @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000) note?: string | null; }
class ScheduleDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) startsAt!: string;
  /** Not needed when the firm books the showroom on its booking engine (the type sets the length). */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) endsAt?: string | null;
  @IsString() @MaxLength(64) timezone!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) address?: string | null;
  /** PLM-144: the sample meeting at the client's home instead of the showroom. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsBoolean() atClientHome?: boolean | null;
}
class SkipStageDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(2000) note!: string; }
class AssignStageDto { @IsInt() @Min(1) version!: number; @IsUUID() membershipId!: string; }
class CompleteSiteVisitDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(5000) summary!: string; }
class SiteAnswerDto { @IsString() @MinLength(1) @MaxLength(60) key!: string; @IsString() @MaxLength(2000) answer!: string; }
class AnswerSiteVisitDto { @IsInt() @Min(1) version!: number; @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => SiteAnswerDto) answers!: SiteAnswerDto[]; }
class TeamRoleDto {
  @IsIn(["lead_designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator"]) slot!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() membershipId?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsBoolean() notApplicable?: boolean | null;
}
class TeamDto {
  @IsInt() @Min(1) version!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => TeamRoleDto) roles!: TeamRoleDto[];
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500) reason?: string | null;
}
class KickoffDto extends StageVersionDto { @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) renderSignoffOn?: string | null; }
class DeadlineDto { @IsInt() @Min(1) version!: number; @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueOn!: string; }
class RenderSignOffDto extends StageVersionDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) signedOn!: string;
  @IsUUID() assetId!: string;
  @IsString() @MinLength(1) @MaxLength(200) signer!: string;
}
class SignOffDto extends StageVersionDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) approvedOn!: string;
  @IsUUID() assetId!: string;
  @IsString() @MinLength(1) @MaxLength(200) signer!: string;
  @IsOptional() @IsIn(["portal", "signed_document", "email", "in_person", "message"]) method?: string;
}

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

  @Put("team")
  setTeam(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: TeamDto) { return this.journey.setTeam(actor, workspaceId, caseId, input); }

  @Post("kickoff/schedule")
  scheduleKickoff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: ScheduleDto) { return this.journey.scheduleKickoff(actor, workspaceId, caseId, input); }

  @Post("kickoff/complete")
  completeKickoff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: KickoffDto) { return this.journey.completeKickoff(actor, workspaceId, caseId, input); }

  @Post("renders/sign-off")
  recordRenderSignOff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: RenderSignOffDto) { return this.journey.recordRenderSignOff(actor, workspaceId, caseId, input); }

  @Post("samples/collected")
  completeSampleCollection(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.completeSampleCollection(actor, workspaceId, caseId, input); }

  @Post("samples/approve")
  approveSamples(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.approveSamples(actor, workspaceId, caseId, input); }

  @Post("stages/:stage/deadline")
  setDeadline(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("stage") stage: string, @Body() input: DeadlineDto) { return this.journey.setDeadline(actor, workspaceId, caseId, stage, input); }

  @Post("site-visit/schedule")
  scheduleSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: ScheduleDto) { return this.journey.scheduleSiteVisit(actor, workspaceId, caseId, input); }

  @Put("site-visit/answers")
  answerSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: AnswerSiteVisitDto) { return this.journey.answerSiteVisit(actor, workspaceId, caseId, input); }

  @Post("site-visit/complete")
  completeSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: CompleteSiteVisitDto) { return this.journey.completeSiteVisit(actor, workspaceId, caseId, input); }

  @Get("material-selection/slots")
  materialSlots(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Query() query: { from?: string; to?: string }) { return this.journey.materialSlots(actor, workspaceId, caseId, query); }

  @Post("material-selection/schedule")
  scheduleMaterialSelection(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: ScheduleDto) { return this.journey.scheduleMaterialSelection(actor, workspaceId, caseId, input); }

  @Post("material-selection/confirm")
  confirmMaterialList(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.confirmMaterialList(actor, workspaceId, caseId, input); }

  @Post("material-selection/not-required")
  materialsNotRequired(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: StageVersionDto) { return this.journey.materialsNotRequired(actor, workspaceId, caseId, input); }

  @Post("stages/:stage/assign")
  assignStage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("stage") stage: string, @Body() input: AssignStageDto) { return this.journey.assignStage(actor, workspaceId, caseId, stage, input); }

  @Post("stages/:stage/skip")
  skipStage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("stage") stage: string, @Body() input: SkipStageDto) { return this.journey.skipStage(actor, workspaceId, caseId, stage, input); }

  @Post("sign-off")
  signOff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: SignOffDto) { return this.journey.signOff(actor, workspaceId, caseId, input); }

  @Post("estimate")
  handOff(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.journey.handOff(actor, workspaceId, caseId); }
}
