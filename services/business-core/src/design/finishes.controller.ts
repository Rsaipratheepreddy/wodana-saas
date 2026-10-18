import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import type { Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { MATERIAL_ORIGINS } from "./finishes.domain";
import { FinishesService } from "./finishes.service";

const optional = () => ValidateIf((_, value) => value !== null && value !== undefined);
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

class DetailsDto {
  @IsInt() @Min(1) entryVersion!: number;
  @IsOptional() @optional() @IsString() @Matches(KEY) categoryKey?: string | null;
  @IsOptional() @optional() @IsUUID() roomId?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(2000) installNote?: string | null;
}
class SnapshotDto {
  @IsUUID() id!: string;
  @IsUUID() assetId!: string;
  @IsNumber() @Min(0) @Max(100) markerX!: number;
  @IsNumber() @Min(0) @Max(100) markerY!: number;
  @IsString() @MinLength(1) @MaxLength(200) label!: string;
}
class NoteDto { @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null; }
class SignatureDto {
  @IsUUID() id!: string;
  @IsUUID() versionId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) signedOn!: string;
  @IsString() @MinLength(1) @MaxLength(200) signer!: string;
  @IsUUID() assetId!: string;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
}
class BudgetRangeDto {
  @IsBoolean() budgetRange!: boolean;
  @IsOptional() @optional() @IsString() @MaxLength(1000) note?: string | null;
}
class CategoryDto {
  @IsString() @Matches(KEY) key!: string;
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
  @IsOptional() @IsBoolean() clientSignature?: boolean;
}
class BandDto {
  @IsOptional() @optional() @IsUUID() id?: string | null;
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
  @IsOptional() @optional() @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) minAmount?: string | null;
  @IsOptional() @optional() @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) maxAmount?: string | null;
}
class SettingsDto {
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CategoryDto) categories?: CategoryDto[];
  @IsOptional() @IsBoolean() specificationGate?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(60) finishesToQsDays?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) materialEditorSlots?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BandDto) bands?: BandDto[];
}
class SampleDto {
  @IsUUID() id!: string;
  @IsOptional() @optional() @IsInt() @Min(1) version?: number | null;
  @IsString() @MinLength(1) @MaxLength(240) name!: string;
  @IsOptional() @optional() @IsString() @MaxLength(80) code?: string | null;
  @IsOptional() @optional() @IsString() @Matches(KEY) categoryKey?: string | null;
  @IsOptional() @optional() @IsIn(MATERIAL_ORIGINS as unknown as string[]) origin?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(200) supplier?: string | null;
  @IsOptional() @optional() @IsUUID() catalogItemId?: string | null;
  @IsOptional() @optional() @IsUUID() priceBandId?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @optional() @IsBoolean() inStock?: boolean | null;
}
class VersionDto { @IsInt() @Min(1) version!: number; }

/** Streams a file of the schedule, like the case's own files: no caching, sandboxed, inline when it's a preview. */
function stream(file: { body: Buffer; contentType: string; name: string; preview?: boolean }, response: Response) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  const inline = file.preview || file.contentType.startsWith("image/") || file.contentType === "application/pdf";
  return new StreamableFile(file.body, { type: file.contentType, disposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
}

/** The finishes schedule, the material log and samples, from the case, the job and the Factory (PLM-146, 148, 156, 157). */
@ApiTags("design")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId")
export class FinishesController {
  constructor(private readonly finishes: FinishesService) {}

  @Get("pre-projects/:caseId/finishes")
  schedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.finishes.schedule(actor, workspaceId, caseId);
  }

  @Post("pre-projects/:caseId/finishes/assets/:id")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: ReferenceUpload) { return this.finishes.upload(actor, workspaceId, caseId, id, file); }

  @Post("pre-projects/:caseId/finishes/entries/:entryId/details")
  details(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string, @Body() input: DetailsDto) { return this.finishes.details(actor, workspaceId, caseId, entryId, input); }

  @Post("pre-projects/:caseId/finishes/entries/:entryId/snapshots")
  snapshot(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string, @Body() input: SnapshotDto) { return this.finishes.addSnapshot(actor, workspaceId, caseId, entryId, input); }

  @Post("pre-projects/:caseId/finishes/snapshots/:snapshotId/archive")
  removeSnapshot(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("snapshotId", ParseUUIDPipe) snapshotId: string) { return this.finishes.removeSnapshot(actor, workspaceId, caseId, snapshotId); }

  @Post("pre-projects/:caseId/finishes/send-to-qs")
  sendToQs(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: NoteDto) {
    return this.finishes.sendToQs(actor, workspaceId, caseId, input);
  }

  @Post("pre-projects/:caseId/finishes/entries/:entryId/signatures")
  signature(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string, @Body() input: SignatureDto) { return this.finishes.recordSignature(actor, workspaceId, caseId, entryId, input); }

  @Post("pre-projects/:caseId/finishes/share")
  share(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: NoteDto) {
    return this.finishes.share(actor, workspaceId, caseId, input);
  }

  @Get("project-core/projects/:projectId/finishes")
  projectSchedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.finishes.projectSchedule(actor, workspaceId, projectId);
  }

  @Get("project-core/projects/:projectId/finishes/assets/:assetId")
  async projectAsset(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string, @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    return stream(await this.finishes.asset(actor, workspaceId, { projectId }, assetId, preview === "1"), response);
  }

  @Get("factory/finishes")
  factoryList(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.finishes.factoryList(actor, workspaceId); }

  @Get("factory/finishes/:caseId")
  factorySchedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.finishes.factorySchedule(actor, workspaceId, caseId);
  }

  @Get("factory/finishes/:caseId/assets/:assetId")
  async factoryAsset(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string, @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    return stream(await this.finishes.asset(actor, workspaceId, { caseId }, assetId, preview === "1"), response);
  }

  @Post("quotation/cases/:caseId/quotes/:quoteId/budget-range")
  budgetRange(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("quoteId") quoteId: string, @Body() input: BudgetRangeDto) { return this.finishes.budgetRange(actor, workspaceId, caseId, quoteId, input); }

  @Get("finish-settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.finishes.settings(actor, workspaceId); }

  @Put("finish-settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SettingsDto) { return this.finishes.saveSettings(actor, workspaceId, input); }

  @Get("sample-library")
  samples(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: { q?: string; band?: string; category?: string; archived?: string }) {
    return this.finishes.samples(actor, workspaceId, query ?? {});
  }

  @Post("sample-library")
  saveSample(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SampleDto) { return this.finishes.saveSample(actor, workspaceId, input); }

  @Post("sample-library/:id/archive")
  archiveSample(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) {
    return this.finishes.archiveSample(actor, workspaceId, id, input);
  }

  @Post("sample-library/:id/photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 0 } }))
  samplePhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: ReferenceUpload) {
    return this.finishes.samplePhoto(actor, workspaceId, id, file);
  }

  @Get("sample-library/:id/photo")
  async readSamplePhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string,
    @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    return stream(await this.finishes.readSamplePhoto(actor, workspaceId, id, preview === "1"), response);
  }
}
