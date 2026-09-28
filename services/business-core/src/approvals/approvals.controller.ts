import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { CommercialModule } from "../commercial/commercial.module";
import { FactoryModule } from "../factory/factory.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PettyCashModule } from "../petty-cash/petty-cash.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { SiteModule } from "../site/site.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ApprovalsService } from "./approvals.service";

@ApiTags("approvals")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/approvals")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** Everything waiting for the signed-in person, across modules. */
  @Get("mine")
  mine(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.approvals.mine(actor, workspaceId);
  }

  @Get("mine/count")
  count(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.approvals.count(actor, workspaceId);
  }

  /** Approve, return or refuse one row through its module's own command. */
  @Post("decide")
  decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.approvals.decide(actor, workspaceId, input ?? {});
  }
}

@Module({
  imports: [WorkspacesModule, CommercialModule, PurchasingModule, FactoryModule, InventoryModule, SiteModule, PettyCashModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
