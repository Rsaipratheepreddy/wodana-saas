import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { SuppliersService } from "./suppliers.service";

/** Purchasing: the supplier register. Bodies are validated in the services. */
@ApiTags("purchasing")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/purchasing")
export class PurchasingController {
  constructor(private readonly suppliers: SuppliersService) {}

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
}
