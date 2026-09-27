import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { sendMedia } from "../gallery/gallery.controller";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { OrdersService } from "./orders.service";
import { PriceRequestsService } from "./price-requests.service";
import { ReceivingService } from "./receiving.service";
import { SupplierReturnsService } from "./returns.service";
import { SuppliersService } from "./suppliers.service";

/** Purchasing: suppliers, what projects need to order, and purchase orders. Bodies are validated in the services. */
@ApiTags("purchasing")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/purchasing")
export class PurchasingController {
  constructor(private readonly suppliers: SuppliersService, private readonly orders: OrdersService, private readonly requests: PriceRequestsService,
    private readonly receiving: ReceivingService, private readonly returns: SupplierReturnsService) {}

  @Get("suppliers")
  listSuppliers(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.suppliers.list(actor, workspaceId); }

  @Post("suppliers")
  saveSupplier(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.suppliers.save(actor, workspaceId, input ?? {}); }

  @Post("suppliers/import")
  importSuppliers(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.suppliers.importSuppliers(actor, workspaceId, input ?? {}); }

  @Post("suppliers/:supplierId/approval")
  approveSupplier(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("supplierId", ParseUUIDPipe) supplierId: string, @Body() input: Record<string, unknown>) {
    return this.suppliers.approve(actor, workspaceId, supplierId, input ?? {});
  }

  @Post("suppliers/:supplierId/archive")
  archiveSupplier(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("supplierId", ParseUUIDPipe) supplierId: string, @Body() input: Record<string, unknown>) {
    return this.suppliers.archive(actor, workspaceId, supplierId, input ?? {});
  }

  @Get("settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.orders.settings(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.orders.saveSettings(actor, workspaceId, input ?? {}); }

  @Get("needs")
  needs(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.orders.needs(actor, workspaceId); }

  @Get("orders")
  listOrders(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.orders.list(actor, workspaceId); }

  @Post("orders")
  createOrder(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.orders.create(actor, workspaceId, input ?? {}); }

  @Get("orders/:orderId")
  order(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string) { return this.orders.get(actor, workspaceId, orderId); }

  @Post("orders/:orderId")
  orderCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string, @Body() input: Record<string, unknown>) {
    return this.orders.command(actor, workspaceId, orderId, input ?? {});
  }

  @Get("price-requests")
  listRequests(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.requests.list(actor, workspaceId); }

  @Post("price-requests")
  createRequest(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.requests.create(actor, workspaceId, input ?? {}); }

  @Get("price-requests/:requestId")
  request(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string) { return this.requests.get(actor, workspaceId, requestId); }

  @Post("price-requests/:requestId")
  requestCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string, @Body() input: Record<string, unknown>) {
    return this.requests.command(actor, workspaceId, requestId, input ?? {});
  }

  @Get("deliveries")
  deliveries(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.receiving.deliveries(actor, workspaceId); }

  @Get("orders/:orderId/receiving")
  receivingForm(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.receiving.receiving(actor, workspaceId, orderId);
  }

  @Post("receipts")
  receive(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.receiving.receive(actor, workspaceId, input ?? {}); }

  @Get("receipts/:receiptId")
  receipt(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("receiptId", ParseUUIDPipe) receiptId: string) {
    return this.receiving.receipt(actor, workspaceId, receiptId);
  }

  @Post("receipts/:receiptId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  receiptPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.receiving.uploadPhoto(actor, workspaceId, { kind: "receipt", id: receiptId }, photoId, file);
  }

  @Get("photos/:photoId")
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("photoId", ParseUUIDPipe) photoId: string, @Query("preview") preview: string,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.receiving.photo(actor, workspaceId, photoId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }

  @Post("unmatched")
  recordUnmatched(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.receiving.recordUnmatched(actor, workspaceId, input ?? {});
  }

  @Get("unmatched/:deliveryId")
  unmatched(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("deliveryId", ParseUUIDPipe) deliveryId: string) {
    return this.receiving.unmatched(actor, workspaceId, deliveryId);
  }

  @Post("unmatched/:deliveryId")
  resolveUnmatched(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("deliveryId", ParseUUIDPipe) deliveryId: string, @Body() input: Record<string, unknown>) {
    return this.receiving.resolveUnmatched(actor, workspaceId, deliveryId, input ?? {});
  }

  @Post("unmatched/:deliveryId/photos/:photoId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  unmatchedPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("deliveryId", ParseUUIDPipe) deliveryId: string,
    @Param("photoId", ParseUUIDPipe) photoId: string, @UploadedFile() file: ReferenceUpload) {
    return this.receiving.uploadPhoto(actor, workspaceId, { kind: "unmatched", id: deliveryId }, photoId, file);
  }

  @Post("receipts/:receiptId/reversal")
  reverse(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("receiptId", ParseUUIDPipe) receiptId: string, @Body() input: Record<string, unknown>) {
    return this.receiving.reverse(actor, workspaceId, receiptId, input ?? {});
  }

  @Get("returns")
  listReturns(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.returns.list(actor, workspaceId); }

  @Post("returns")
  createReturn(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.returns.create(actor, workspaceId, input ?? {}); }

  @Get("returns/:returnId")
  supplierReturn(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("returnId", ParseUUIDPipe) returnId: string) {
    return this.returns.get(actor, workspaceId, returnId);
  }

  @Post("returns/:returnId")
  returnCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("returnId", ParseUUIDPipe) returnId: string, @Body() input: Record<string, unknown>) {
    return this.returns.command(actor, workspaceId, returnId, input ?? {});
  }

  @Post("receipts/:receiptId/inspection")
  inspect(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("receiptId", ParseUUIDPipe) receiptId: string, @Body() input: Record<string, unknown>) {
    return this.receiving.inspect(actor, workspaceId, receiptId, input ?? {});
  }
}
