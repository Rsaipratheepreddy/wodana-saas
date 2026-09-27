import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { PayablesService } from "./payables.service";

/** Suppliers' invoices, what each supplier is owed, and payments to them. Bodies are validated in the service. */
@ApiTags("payables")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/payables")
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.payables.overview(actor, workspaceId);
  }

  @Post()
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.payables.command(actor, workspaceId, input ?? {});
  }

  @Get("bills/:billId")
  bill(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("billId", ParseUUIDPipe) billId: string) {
    return this.payables.bill(actor, workspaceId, billId);
  }

  @Post("bills/:billId/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("billId", ParseUUIDPipe) billId: string,
    @UploadedFile() file: ReferenceUpload) {
    return this.payables.uploadFile(actor, workspaceId, billId, file);
  }

  @Get("bills/:billId/file")
  async file(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("billId", ParseUUIDPipe) billId: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.payables.file(actor, workspaceId, billId);
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  @Get("suppliers/:vendorId")
  supplier(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("vendorId", ParseUUIDPipe) vendorId: string) {
    return this.payables.supplier(actor, workspaceId, vendorId);
  }

  @Get("orders/:orderId")
  invoiceable(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.payables.invoiceable(actor, workspaceId, orderId);
  }
}
