import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { PettyCashService } from "./petty-cash.service";

/** Petty cash: a project's claims and their receipts, and for the people who pay, what's to reimburse. Bodies are validated in the service. */
@ApiTags("petty-cash")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/petty-cash")
export class PettyCashController {
  constructor(private readonly pettyCash: PettyCashService) {}

  @Get()
  reimbursements(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.pettyCash.reimbursements(actor, workspaceId); }

  @Post()
  reimburse(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.pettyCash.reimburse(actor, workspaceId, input ?? {});
  }

  @Get("projects/:projectId")
  state(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.pettyCash.state(actor, workspaceId, projectId);
  }

  @Post("projects/:projectId")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() input: Record<string, unknown>) {
    return this.pettyCash.command(actor, workspaceId, projectId, input ?? {});
  }

  @Post("projects/:projectId/claims/:claimId/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("claimId", ParseUUIDPipe) claimId: string, @UploadedFile() file: ReferenceUpload) {
    return this.pettyCash.uploadReceipt(actor, workspaceId, projectId, claimId, file);
  }

  @Get("claims/:claimId/receipt")
  async receipt(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("claimId", ParseUUIDPipe) claimId: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.pettyCash.receipt(actor, workspaceId, claimId);
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}
