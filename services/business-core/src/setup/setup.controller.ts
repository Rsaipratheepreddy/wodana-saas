import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { MAX_OPTIONS, MAX_QUESTIONS, QUESTION_KINDS } from "./questionnaires.domain";
import { SetupQuestionnairesService } from "./questionnaires.service";

class QuestionDto {
  @IsOptional() @IsString() @MaxLength(60) key?: string;
  @IsString() @MaxLength(300) label!: string;
  @IsIn(QUESTION_KINDS) kind!: (typeof QUESTION_KINDS)[number];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_OPTIONS) @IsString({ each: true }) @MaxLength(120, { each: true }) options?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true }) jobTypes?: string[];
  @IsOptional() @IsString() @MaxLength(300) help?: string;
}
class DraftDto {
  @IsInt() @Min(0) revision!: number;
  @IsArray() @ArrayMaxSize(MAX_QUESTIONS) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions!: QuestionDto[];
}
class PublishDto { @IsInt() @Min(0) revision!: number; @IsOptional() @IsString() @MaxLength(500) note?: string | null; }
class RestoreDto { @IsInt() @Min(0) revision!: number; @IsInt() @Min(0) number!: number; }

/** §0.3 P3: the Setup module, where the firm's admin manages its own configuration. */
@ApiTags("setup")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/setup")
export class SetupController {
  constructor(private readonly questionnaires: SetupQuestionnairesService) {}

  @Get("push-templates")
  pushTemplates(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.questionnaires.pushTemplates(actor, workspaceId); }

  @Put("push-templates")
  savePushTemplates(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: unknown) {
    return this.questionnaires.savePushTemplates(actor, workspaceId, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }

  @Get("commission-types")
  commissionTypes(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.questionnaires.commissionTypes(actor, workspaceId); }

  @Put("commission-types")
  saveCommissionTypes(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: unknown) {
    return this.questionnaires.saveCommissionTypes(actor, workspaceId, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }

  @Get("documents/client-invoice")
  invoiceLayout(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.questionnaires.invoiceLayout(actor, workspaceId); }

  @Put("documents/client-invoice")
  saveInvoiceLayout(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: unknown) {
    return this.questionnaires.saveInvoiceLayout(actor, workspaceId, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }

  @Get("questionnaires")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.questionnaires.list(actor, workspaceId); }

  @Get("questionnaires/:purpose")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("purpose") purpose: string) {
    return this.questionnaires.get(actor, workspaceId, purpose);
  }

  @Put("questionnaires/:purpose/draft")
  saveDraft(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("purpose") purpose: string, @Body() input: DraftDto) {
    return this.questionnaires.saveDraft(actor, workspaceId, purpose, input);
  }

  @Post("questionnaires/:purpose/publish")
  publish(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("purpose") purpose: string, @Body() input: PublishDto) {
    return this.questionnaires.publish(actor, workspaceId, purpose, input);
  }

  @Post("questionnaires/:purpose/restore")
  restore(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("purpose") purpose: string, @Body() input: RestoreDto) {
    return this.questionnaires.restore(actor, workspaceId, purpose, input);
  }
}
