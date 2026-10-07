import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { sendMedia } from "../../gallery/gallery.controller";
import { BillCaptureService } from "./bill-capture.service";
import { CAPTURE_MAX_BYTES, type CaptureUpload } from "./capture-file";

/** Bill capture (Ledger): a bill's photo or PDF read into a draft supplier invoice a person confirms. Bodies are validated in the service. */
@ApiTags("books")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/books")
export class BillCaptureController {
  constructor(private readonly captures: BillCaptureService) {}

  @Post("captures")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: CAPTURE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @UploadedFile() file: CaptureUpload) {
    return this.captures.upload(actor, workspaceId, file);
  }

  @Get("captures/:captureId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("captureId", ParseUUIDPipe) captureId: string) {
    return this.captures.get(actor, workspaceId, captureId);
  }

  /** confirm (with the saved invoice's id) · discard; each with its capture's version and a command id. */
  @Post("captures/:captureId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("captureId", ParseUUIDPipe) captureId: string,
    @Body() input: Record<string, unknown>) {
    return this.captures.command(actor, workspaceId, captureId, input ?? {});
  }

  @Get("captures/:captureId/file")
  async file(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("captureId", ParseUUIDPipe) captureId: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.captures.file(actor, workspaceId, captureId);
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  /** The tax codes and accounts a company's bill lines can name. */
  @Get("bill-coding/:legalEntityId")
  coding(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("legalEntityId", ParseUUIDPipe) legalEntityId: string,
    @Query("date") date?: string) {
    return this.captures.coding(actor, workspaceId, legalEntityId, date);
  }
}
