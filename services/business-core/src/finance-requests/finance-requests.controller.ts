import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { FinanceRequestsService } from "./finance-requests.service";

/** Finance requests: the board, one request, its commands and files, what the form offers, and Finance's settings. Bodies are validated in the module. */
@ApiTags("finance-requests")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/finance-requests")
export class FinanceRequestsController {
  constructor(private readonly requests: FinanceRequestsService) {}

  @Get()
  board(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.requests.board(actor, workspaceId); }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.requests.command(actor, workspaceId, input ?? {});
  }

  @Get("context")
  context(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.requests.context(actor, workspaceId, query ?? {});
  }

  @Get("options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.requests.options(actor, workspaceId, query ?? {});
  }

  @Get("quote-lines")
  quoteLines(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.requests.quoteLines(actor, workspaceId, query ?? {});
  }

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.requests.settings(actor, workspaceId); }

  @Post("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.requests.saveSettings(actor, workspaceId, input ?? {});
  }

  @Get(":requestId")
  detail(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string) {
    return this.requests.detail(actor, workspaceId, requestId);
  }

  @Post(":requestId/files/:kind")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string,
    @Param("kind") kind: string, @UploadedFile() file: ReferenceUpload) {
    return this.requests.upload(actor, workspaceId, requestId, kind, file);
  }

  @Get(":requestId/files/:fileId")
  async file(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.requests.file(actor, workspaceId, requestId, fileId);
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}
