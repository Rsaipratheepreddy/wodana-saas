import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { ProjectChangesService } from "./project-changes.service";

const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/**
 * Changes on a started project (plan §6.20): the list with the sealed value and the variations, what a change can be made
 * of, one change's record, raise, edit, price, send for approval, decide, send to the client, apply, withdraw, its files.
 */
@ApiTags("project-changes")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/project-changes/:projectId")
export class ProjectChangesController {
  constructor(private readonly changes: ProjectChangesService) {}

  @Get() list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.changes.list(actor, workspaceId, projectId);
  }

  @Get("sources") sources(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("search") search?: string) {
    return this.changes.sources(actor, workspaceId, projectId, typeof search === "string" ? search : "");
  }

  @Get("variations") variations(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.changes.variations(actor, workspaceId, projectId);
  }

  @Post("preview") preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    return this.changes.preview(actor, workspaceId, projectId, object(body));
  }

  @Post() raise(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    return this.changes.raise(actor, workspaceId, projectId, object(body));
  }

  @Get("files/:fileId") async file(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.changes.file(actor, workspaceId, projectId, fileId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return sendMedia(file, request, response);
  }

  @Get(":id") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string) {
    return this.changes.get(actor, workspaceId, projectId, id);
  }

  @Put(":id") save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.save(actor, workspaceId, projectId, id, object(body));
  }

  @Post(":id/:step") step(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string, @Param("step") step: string, @Body() body: unknown) {
    const input = object(body);
    switch (step) {
      case "price": return this.changes.price(actor, workspaceId, projectId, id, input);
      case "submit": return this.changes.submit(actor, workspaceId, projectId, id, input);
      case "decide": return this.changes.decide(actor, workspaceId, projectId, id, input);
      case "send": return this.changes.send(actor, workspaceId, projectId, id, input);
      case "send-link": return this.changes.sendLink(actor, workspaceId, projectId, id, input);
      case "apply": return this.changes.apply(actor, workspaceId, projectId, id, input);
      case "withdraw": return this.changes.withdraw(actor, workspaceId, projectId, id, input);
      default: return this.changes.get(actor, workspaceId, projectId, id);
    }
  }

  @Post(":id/files/:fileId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("id", ParseUUIDPipe) id: string, @Param("fileId", ParseUUIDPipe) fileId: string, @UploadedFile() file: ReferenceUpload) {
    return this.changes.upload(actor, workspaceId, projectId, id, fileId, file);
  }
}
