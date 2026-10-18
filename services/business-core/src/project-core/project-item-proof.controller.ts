import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { ProjectItemProofService } from "./project-item-proof.service";

/** Shop drawings and delivery proof per item. Bodies are validated in the service. */
@ApiTags("projects")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/project-core/projects/:projectId")
export class ProjectItemProofController {
  constructor(private readonly items: ProjectItemProofService) {}

  @Get("item-drawings")
  drawings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.items.drawings(actor, workspaceId, projectId);
  }

  @Get("item-deliveries")
  deliveries(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.items.deliveries(actor, workspaceId, projectId);
  }

  @Post("items")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() input: Record<string, unknown>) {
    return this.items.command(actor, workspaceId, projectId, input ?? {});
  }

  /** A shop drawing version: the file, with its details (quantity, sizes, note, the item's version) as JSON in `meta`. */
  @Post("items/:lineId/drawing-versions/:versionId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 2 } }))
  uploadDrawing(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("lineId", ParseUUIDPipe) lineId: string, @Param("versionId", ParseUUIDPipe) versionId: string, @Body("meta") meta: unknown, @UploadedFile() file: ReferenceUpload) {
    return this.items.uploadDrawing(actor, workspaceId, projectId, lineId, versionId, meta, file);
  }

  @Post("items/:lineId/delivery-photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  uploadPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("lineId", ParseUUIDPipe) lineId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.items.uploadPhoto(actor, workspaceId, projectId, lineId, photoId, file);
  }

  @Get("item-drawings/files/:versionId")
  async drawingFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.items.drawingFile(actor, workspaceId, projectId, versionId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    if (preview !== "1") response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return sendMedia(file, request, response);
  }

  @Get("item-photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.items.photo(actor, workspaceId, projectId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}
