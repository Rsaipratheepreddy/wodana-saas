import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { IsString, Length } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { EvidenceService } from "./evidence.service";

export class AddEvidenceDto {
  @IsString() @Length(1, 40) kind!: string;
}

@ApiTags("evidence")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/evidence")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 2 } }))
  add(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: AddEvidenceDto, @UploadedFile() file?: ReferenceUpload) {
    return this.evidence.add(actor, workspaceId, input.kind, file);
  }

  @Get(":fileId")
  async open(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("fileId", ParseUUIDPipe) fileId: string,
    @Query("preview") preview: string | undefined, @Res({ passthrough: true }) response: Response) {
    const file = await this.evidence.open(actor, workspaceId, fileId, preview === "1");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    return new StreamableFile(file.body, { length: file.body.length, type: file.contentType, disposition: `inline; filename="${encodeURIComponent(file.name)}"` });
  }
}
