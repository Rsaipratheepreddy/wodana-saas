import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { HandoverService } from "./handover.service";
import { SiteService } from "./site.service";

/** A project's site: when site work runs, and its daily reports with their photos. Bodies are validated in the service. */
@ApiTags("site")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/site/projects/:projectId")
export class SiteController {
  constructor(private readonly site: SiteService, private readonly handover: HandoverService) {}

  @Get("handover")
  handoverState(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.handover.state(actor, workspaceId, projectId);
  }

  @Post("handover")
  handoverCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() input: Record<string, unknown>) {
    return this.handover.command(actor, workspaceId, projectId, input ?? {});
  }

  @Post("handover/:packId/documents/:documentId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  handoverDocument(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("packId", ParseUUIDPipe) packId: string, @Param("documentId", ParseUUIDPipe) documentId: string, @Query("kind") kind: string, @Query("title") title: string,
    @UploadedFile() file: ReferenceUpload) {
    return this.handover.uploadDocument(actor, workspaceId, projectId, packId, documentId, { kind, title }, file);
  }

  @Get("handover/documents/:documentId")
  async handoverFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.handover.document(actor, workspaceId, projectId, documentId);
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  @Get()
  state(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.site.state(actor, workspaceId, projectId);
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() input: Record<string, unknown>) {
    return this.site.command(actor, workspaceId, projectId, input ?? {});
  }

  @Post("reports/:reportId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("reportId", ParseUUIDPipe) reportId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.site.uploadPhoto(actor, workspaceId, projectId, reportId, photoId, file);
  }

  @Get("photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.site.photo(actor, workspaceId, projectId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}
