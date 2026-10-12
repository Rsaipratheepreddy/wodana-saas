import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { HandoverService } from "./handover.service";
import { WarrantyService } from "./warranty.service";
import { SiteService } from "./site.service";

/** A project's site: when site work runs, and its daily reports with their photos. Bodies are validated in the service. */
@ApiTags("site")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/site/projects/:projectId")
export class SiteController {
  constructor(private readonly site: SiteService, private readonly handover: HandoverService, private readonly warranty: WarrantyService) {}

  @Get("warranty")
  warrantyState(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.warranty.state(actor, workspaceId, projectId);
  }

  @Post("warranty")
  warrantyCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() input: Record<string, unknown>) {
    return this.warranty.command(actor, workspaceId, projectId, input ?? {});
  }

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

  /** The day cards for a range of days (or the latest days with a report), with the working days that have none. */
  @Get("days")
  days(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("from") from?: string, @Query("to") to?: string, @Query("latest") latest?: string) {
    return this.site.days(actor, workspaceId, projectId, { from, to, latest });
  }

  @Get()
  state(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.site.state(actor, workspaceId, projectId);
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() input: Record<string, unknown>) {
    return this.site.command(actor, workspaceId, projectId, input ?? {});
  }

  @Post("access/:requestId")
  arrangeAccess(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string, @Body() input: Record<string, unknown>) {
    return this.site.arrangeAccess(actor, workspaceId, projectId, requestId, input ?? {});
  }

  /** A photo for a report being written, with its room or area, before/after and the photo it pairs with (query). */
  @Post("reports/:reportId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("reportId", ParseUUIDPipe) reportId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload,
    @Query("area") area?: string, @Query("phase") phase?: string, @Query("pair") pair?: string) {
    return this.site.uploadPhoto(actor, workspaceId, projectId, reportId, photoId, file, { areaId: area || null, phase: phase || null, pairId: pair || null });
  }

  /** The client's card for a day: as it would go now, or as it went. */
  @Get("reports/:reportId/client-view")
  clientView(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("reportId", ParseUUIDPipe) reportId: string) {
    return this.site.clientView(actor, workspaceId, projectId, reportId);
  }

  @Get("photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.site.photo(actor, workspaceId, projectId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}

/** The phone's Today: the sites I'm on that run today, with my report for the day. */
@ApiTags("site")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/site")
export class SitesTodayController {
  constructor(private readonly site: SiteService) {}

  @Get("today")
  today(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.site.sitesToday(actor, workspaceId); }

  /** Home: daily reports waiting for my review, and (after the end-of-day time) running sites without today's report. */
  @Get("attention")
  attention(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.site.attention(actor, workspaceId); }
}

/** Settings → Projects → Warranty: months of warranty for each way of delivering a package. */
@ApiTags("site")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/warranty-settings")
export class WarrantySettingsController {
  constructor(private readonly warranty: WarrantyService) {}

  @Get()
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.warranty.settings(actor, workspaceId); }

  @Put()
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.warranty.saveSettings(actor, workspaceId, input ?? {}); }
}
