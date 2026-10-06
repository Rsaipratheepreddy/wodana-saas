import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { LogisticsService, type BookingInput, type PermitInput } from "./logistics.service";

/**
 * Factory and installation bookings (PLM-063, PLM-069): deliveries, installations, factory slots, permit collection and
 * production, with the people (HRMS workers by name), vehicles and drivers; the vehicles register; building permits.
 * Bodies are validated in the service.
 */
@ApiTags("logistics")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/logistics")
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get("options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.logistics.options(actor, workspaceId); }

  @Get("booking")
  booking(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, string>) {
    return this.logistics.booking(actor, workspaceId, query);
  }

  @Post("bookings")
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: BookingInput) { return this.logistics.save(actor, workspaceId, body ?? {}); }

  @Post("bookings/cancel")
  cancel(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: BookingInput) { return this.logistics.cancel(actor, workspaceId, body ?? {}); }

  @Post("bookings/conflicts")
  conflicts(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: BookingInput & { workerIds?: unknown }) {
    return this.logistics.conflicts(actor, workspaceId, body ?? {});
  }

  @Post("people")
  addPerson(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.addPerson(actor, workspaceId, body ?? {});
  }

  @Get("vehicles")
  vehicles(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.logistics.vehicles(actor, workspaceId); }

  @Post("vehicles")
  saveVehicle(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.saveVehicle(actor, workspaceId, body ?? {});
  }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.saveSettings(actor, workspaceId, body ?? {});
  }

  @Get("projects/:projectId/permits")
  permits(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.logistics.permits(actor, workspaceId, { projectId });
  }

  @Post("projects/:projectId/permits/:permitId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 12 } }))
  collectPermit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: PermitInput, @UploadedFile() file: ReferenceUpload) {
    return this.logistics.collectPermit(actor, workspaceId, { projectId }, permitId, body ?? {}, file);
  }

  @Post("projects/:projectId/permits/:permitId/withdraw")
  withdrawPermit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.cancelPermit(actor, workspaceId, { projectId }, permitId, body ?? {});
  }

  @Put("projects/:projectId/permits/:permitId/reminder")
  permitReminder(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.setPermitReminder(actor, workspaceId, { projectId }, permitId, body ?? {});
  }

  /** PLM-136: an order with no project (Furniture Only) keeps its permit on the deal. */
  @Get("deals/:opportunityId/permits")
  dealPermits(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.logistics.permits(actor, workspaceId, { opportunityId });
  }

  @Post("deals/:opportunityId/permits/:permitId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 12 } }))
  collectDealPermit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: PermitInput, @UploadedFile() file: ReferenceUpload) {
    return this.logistics.collectPermit(actor, workspaceId, { opportunityId }, permitId, body ?? {}, file);
  }

  @Post("deals/:opportunityId/permits/:permitId/withdraw")
  withdrawDealPermit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.cancelPermit(actor, workspaceId, { opportunityId }, permitId, body ?? {});
  }

  @Put("deals/:opportunityId/permits/:permitId/reminder")
  dealPermitReminder(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Param("permitId", ParseUUIDPipe) permitId: string, @Body() body: Record<string, unknown>) {
    return this.logistics.setPermitReminder(actor, workspaceId, { opportunityId }, permitId, body ?? {});
  }

  @Get("permits/:permitId/file")
  async permitFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("permitId", ParseUUIDPipe) permitId: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.logistics.permitFile(actor, workspaceId, permitId);
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return sendMedia(file, request, response);
  }
}
