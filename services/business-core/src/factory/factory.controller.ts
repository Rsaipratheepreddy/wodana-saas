import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { FactoryInspectionsService } from "./factory-inspections.service";
import { FactorySamplesService } from "./factory-samples.service";
import { FactoryService } from "./factory.service";

/** The factory: what to make, work orders with their output and checks, and its settings. Bodies are validated in the service. */
@ApiTags("factory")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/factory")
export class FactoryController {
  constructor(private readonly factory: FactoryService, private readonly samples: FactorySamplesService, private readonly inspectionsService: FactoryInspectionsService) {}

  @Get("state")
  state(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.factory.state(actor, workspaceId); }

  @Get("schedule")
  schedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, string>) {
    return this.factory.schedule(actor, workspaceId, query ?? {});
  }

  /** PLM-063: each project's production status and its planned against actual dates. */
  @Get("production")
  production(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.factory.production(actor, workspaceId); }

  /** PLM-061: sample requests, every one (the factory) or one case's. */
  @Get("samples")
  sampleList(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("caseId") caseId?: string) {
    return this.samples.list(actor, workspaceId, caseId && /^[0-9a-f-]{36}$/i.test(caseId) ? caseId : null);
  }

  @Post("samples")
  requestSample(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.samples.request(actor, workspaceId, input ?? {});
  }

  @Post("samples/:sampleId")
  sampleCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("sampleId", ParseUUIDPipe) sampleId: string,
    @Body() input: Record<string, unknown>) {
    return this.samples.command(actor, workspaceId, sampleId, input ?? {});
  }

  @Post("batches")
  saveBatch(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.factory.saveBatch(actor, workspaceId, input ?? {});
  }

  @Post("orders")
  plan(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.factory.plan(actor, workspaceId, input ?? {}); }

  @Get("orders/:orderId")
  order(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.factory.order(actor, workspaceId, orderId);
  }

  @Post("orders/:orderId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() input: Record<string, unknown>) {
    return this.factory.command(actor, workspaceId, orderId, input ?? {});
  }

  @Post("orders/:orderId/checks/:checkId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  checkPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("checkId", ParseUUIDPipe) checkId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.factory.uploadCheckPhoto(actor, workspaceId, orderId, checkId, photoId, file);
  }

  @Get("orders/:orderId/drawings/:versionId")
  async drawing(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.factory.drawingFile(actor, workspaceId, orderId, versionId, preview === "1");
    response.setHeader("Cache-Control", "private, no-store");
    return sendMedia(file, request, response);
  }

  @Get("photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.factory.checkPhoto(actor, workspaceId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  /** PLM-150: the design inspections: the factory's list, or the open rounds (`view=open`, optionally `mine=1`, `from`, `to`) the design calendar reads. */
  @Get("inspections")
  inspections(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, string>) {
    return this.inspectionsService.list(actor, workspaceId, query ?? {});
  }

  @Get("inspections/:inspectionId")
  inspection(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("inspectionId", ParseUUIDPipe) inspectionId: string) {
    return this.inspectionsService.detail(actor, workspaceId, inspectionId);
  }

  @Post("inspections/:inspectionId")
  inspectionCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("inspectionId", ParseUUIDPipe) inspectionId: string,
    @Body() input: Record<string, unknown>) {
    return this.inspectionsService.command(actor, workspaceId, inspectionId, input ?? {});
  }

  @Post("inspections/:inspectionId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  inspectionPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("inspectionId", ParseUUIDPipe) inspectionId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.inspectionsService.uploadPhoto(actor, workspaceId, inspectionId, photoId, file);
  }

  @Get("inspection-photos/:photoId")
  async inspectionPhotoFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("photoId", ParseUUIDPipe) photoId: string,
    @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.inspectionsService.photo(actor, workspaceId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.factory.settings(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.factory.saveSettings(actor, workspaceId, input ?? {});
  }

  @Post("workcenters")
  saveWorkcenter(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.factory.saveWorkcenter(actor, workspaceId, input ?? {});
  }
}
