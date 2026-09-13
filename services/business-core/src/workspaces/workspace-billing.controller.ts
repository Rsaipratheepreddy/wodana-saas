import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { TenantManagementService } from "./tenant-management.service";

@ApiTags("workspace billing")
@ApiBearerAuth()
@Controller("workspaces")
export class WorkspaceBillingController {
  constructor(private readonly tenants: TenantManagementService) {}

  @Get(":workspaceId/billing")
  @ApiOperation({ summary: "Read the current workspace subscription and usage" })
  getBilling(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.tenants.getWorkspaceBilling(actor, workspaceId);
  }
}
