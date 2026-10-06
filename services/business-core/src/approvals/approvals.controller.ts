import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
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
import { ApprovalPoliciesService } from "./approval-policies.service";

@ApiTags("approvals")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/approvals")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService, private readonly policies: ApprovalPoliciesService) {}

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

  /** E3: the approval policies per kind (Settings → Approvals). */
  @Get("policies")
  policyList(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.policies.list(actor, workspaceId);
  }

  @Post("policies")
  createPolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.policies.create(actor, workspaceId, input ?? {});
  }

  /** Saves the next version of a policy (requests already waiting keep theirs). */
  @Put("policies/:policyId")
  updatePolicy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("policyId", ParseUUIDPipe) policyId: string, @Body() input: Record<string, unknown>) {
    return this.policies.update(actor, workspaceId, policyId, input ?? {});
  }

  @Post("policies/:policyId/status")
  policyStatus(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("policyId", ParseUUIDPipe) policyId: string, @Body() input: Record<string, unknown>) {
    return this.policies.setStatus(actor, workspaceId, policyId, input ?? {});
  }

  /** Who covers approvals for whom while away (E3-1). */
  @Get("delegations")
  delegations(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.policies.delegations(actor, workspaceId);
  }

  @Post("delegations")
  delegate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) {
    return this.policies.delegate(actor, workspaceId, input ?? {});
  }

  @Post("delegations/:delegationId/end")
  endDelegation(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("delegationId", ParseUUIDPipe) delegationId: string, @Body() input: Record<string, unknown>) {
    return this.policies.cancelDelegation(actor, workspaceId, delegationId, input ?? {});
  }

  /** One request with its steps and who decided (for a module's screen). */
  @Get("requests/:requestId")
  request(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("requestId", ParseUUIDPipe) requestId: string) {
    return this.policies.request(actor, workspaceId, requestId);
  }
}

@Module({
  imports: [WorkspacesModule, CommercialModule, PurchasingModule, FactoryModule, InventoryModule, SiteModule, PettyCashModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalPoliciesService],
})
export class ApprovalsModule {}
