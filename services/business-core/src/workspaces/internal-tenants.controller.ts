import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { Public } from "../auth/public.decorator";
import { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import {
  ProvisionedOwnerInvitationResponseDto,
  ProvisionTenantResponseDto,
} from "./dto/workspace-response.dto";
import { WorkspacesService } from "./workspaces.service";
import { TenantManagementService } from "./tenant-management.service";
import { UpdateTenantManagementDto } from "./dto/update-tenant-management.dto";

@ApiTags("internal tenant provisioning")
@Public()
@UseGuards(InternalServiceGuard)
@ApiHeader({
  name: "x-wodana-internal-token",
  required: true,
  description: "Internal administration service credential",
})
@Controller("internal/tenants")
export class InternalTenantsController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly tenants: TenantManagementService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List tenants for the internal management portal" })
  @ApiOkResponse()
  list() {
    return this.tenants.listManagedTenants();
  }

  @Post()
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for one logical tenant provisioning attempt",
  })
  @ApiOperation({ summary: "Provision a tenant and issue its first owner invitation" })
  @ApiCreatedResponse({ type: ProvisionTenantResponseDto })
  provision(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: ProvisionTenantDto,
  ) {
    return this.workspaces.provisionTenant(input, idempotencyKey);
  }

  @Get(":externalTenantId")
  @ApiOperation({ summary: "Read the safe provisioning and onboarding status" })
  @ApiOkResponse({ type: ProvisionTenantResponseDto })
  get(@Param("externalTenantId") externalTenantId: string) {
    return this.workspaces.getProvisionedTenant(externalTenantId);
  }

  @Get(":externalTenantId/management")
  @ApiOperation({ summary: "Read one client and its subscription" })
  @ApiOkResponse()
  getManagement(@Param("externalTenantId") externalTenantId: string) {
    return this.tenants.getManagedTenant(externalTenantId);
  }

  @Get(":externalTenantId/status")
  @ApiOperation({ summary: "Read a tenant's safe account, onboarding, access and domain status" })
  @ApiOkResponse()
  getStatus(@Param("externalTenantId") externalTenantId: string) {
    return this.tenants.getTenantStatus(externalTenantId);
  }

  @Patch(":externalTenantId/management")
  @ApiOperation({ summary: "Update client access and subscription terms" })
  @ApiOkResponse()
  updateManagement(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateTenantManagementDto,
  ) {
    return this.tenants.updateManagedTenant(externalTenantId, input);
  }

  @Post(":externalTenantId/owner-invitation/resend")
  @ApiOperation({ summary: "Rotate and return the first owner invitation token" })
  @ApiCreatedResponse({ type: ProvisionedOwnerInvitationResponseDto })
  resendOwnerInvitation(@Param("externalTenantId") externalTenantId: string) {
    return this.workspaces.resendProvisionedOwnerInvitation(externalTenantId);
  }
}
