import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { InventoryService } from "./inventory.service";

/** Inventory: stock by place and owner, its ledger, moves between places and the places themselves. Bodies are validated in the service. */
@ApiTags("inventory")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("stock")
  stock(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.inventory.stock(actor, workspaceId); }

  @Post("stock")
  command(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.inventory.command(actor, workspaceId, input ?? {}); }

  @Get("movements")
  movements(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.inventory.movements(actor, workspaceId, query ?? {});
  }

  @Get("transfers")
  transfers(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.inventory.transfers(actor, workspaceId); }

  @Post("transfers")
  send(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.inventory.send(actor, workspaceId, input ?? {}); }

  @Get("transfers/:transferId")
  transfer(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("transferId", ParseUUIDPipe) transferId: string) {
    return this.inventory.transfer(actor, workspaceId, transferId);
  }

  @Post("transfers/:transferId")
  transferCommand(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("transferId", ParseUUIDPipe) transferId: string, @Body() input: Record<string, unknown>) {
    return this.inventory.transferCommand(actor, workspaceId, transferId, input ?? {});
  }

  @Post("adjustments/:requestId")
  decideAdjustment(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string, @Body() input: Record<string, unknown>) {
    return this.inventory.decideAdjustment(actor, workspaceId, requestId, input ?? {});
  }

  @Get("locations")
  locations(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.inventory.locations(actor, workspaceId); }

  @Post("locations")
  saveLocation(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.inventory.saveLocation(actor, workspaceId, input ?? {});
  }
}
