import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { MeetingMinutesService } from "./meeting-minutes.service";

/** PLM-153: the minutes of a client meeting (a CRM meeting or call), shared with the client through the portal. */
@ApiTags("meetings")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/meetings/:activityId/minutes")
export class MeetingMinutesController {
  constructor(private readonly minutes: MeetingMinutesService) {}

  @Get()
  read(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string) {
    return this.minutes.read(actor, workspaceId, activityId);
  }

  @Put()
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string,
    @Body() body: Record<string, unknown>) {
    return this.minutes.save(actor, workspaceId, activityId, body ?? {});
  }

  @Post("replies")
  reply(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string,
    @Body() body: Record<string, unknown>) {
    return this.minutes.reply(actor, workspaceId, activityId, body ?? {});
  }

  @Post("files/:fileId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string, @UploadedFile() file: ReferenceUpload) {
    return this.minutes.upload(actor, workspaceId, activityId, fileId, file);
  }

  @Get("files/:fileId")
  async file(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("activityId", ParseUUIDPipe) activityId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.minutes.file(actor, workspaceId, activityId, fileId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    if (preview !== "1") response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return sendMedia(file, request, response);
  }
}
