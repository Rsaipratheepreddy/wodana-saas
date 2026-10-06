import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
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
}
class SkipStageDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(2000) note!: string; }
class AssignStageDto { @IsInt() @Min(1) version!: number; @IsUUID() membershipId!: string; }
class CompleteSiteVisitDto { @IsInt() @Min(1) version!: number; @IsString() @MinLength(1) @MaxLength(5000) summary!: string; }
class SiteAnswerDto { @IsString() @MinLength(1) @MaxLength(60) key!: string; @IsString() @MaxLength(2000) answer!: string; }
class AnswerSiteVisitDto { @IsInt() @Min(1) version!: number; @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SiteAnswerDto) answers!: SiteAnswerDto[]; }
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
