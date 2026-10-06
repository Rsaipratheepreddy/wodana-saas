import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { FactoryService } from "./factory.service";

/** The factory: what to make, work orders with their output and checks, and its settings. Bodies are validated in the service. */
@ApiTags("factory")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/factory")
export class FactoryController {
  constructor(private readonly factory: FactoryService) {}

  @Get("state")
  state(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.factory.state(actor, workspaceId); }

  @Get("schedule")
  schedule(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, string>) {
    return this.factory.schedule(actor, workspaceId, query ?? {});
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

  @Get("photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.factory.checkPhoto(actor, workspaceId, photoId, preview === "1");
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
