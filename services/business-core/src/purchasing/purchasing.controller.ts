import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { OrdersService } from "./orders.service";
import { SuppliersService } from "./suppliers.service";

/** Purchasing: suppliers, what projects need to order, and purchase orders. Bodies are validated in the services. */
@ApiTags("purchasing")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/purchasing")
export class PurchasingController {
  constructor(private readonly suppliers: SuppliersService, private readonly orders: OrdersService) {}

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
}
