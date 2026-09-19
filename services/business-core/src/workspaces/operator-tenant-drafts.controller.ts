import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../auth/platform-operator.guard";
import {
  PlatformOperatorPermissionGuard,
  RequireOperatorPermission,
} from "../auth/platform-operator-permission.guard";
import { Public } from "../auth/public.decorator";
import { CreateTenantProvisioningDraftDto, ProvisionTenantDraftDto } from "./dto/tenant-provisioning-draft.dto";
import { TenantProvisioningDraftsService } from "./tenant-provisioning-drafts.service";

@ApiTags("operator tenant provisioning drafts")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/tenant-drafts")
export class OperatorTenantDraftsController {
  constructor(private readonly drafts: TenantProvisioningDraftsService) {}

  @Get("setup-profiles")
  @RequireOperatorPermission("tenants.read")
  profiles() { return this.drafts.listProfiles(); }

  @Post()
  @RequireOperatorPermission("tenants.provision")
  create(
    @Body() input: CreateTenantProvisioningDraftDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.drafts.createDraft(input, idempotencyKey, request.platformOperator!.userId, correlationId);
  }

  @Get(":draftId")
  @RequireOperatorPermission("tenants.read")
  get(@Param("draftId") draftId: string) { return this.drafts.getDraft(draftId); }

  @Post(":draftId/provision")
  @RequireOperatorPermission("tenants.provision")
  provision(
    @Param("draftId") draftId: string,
    @Body() input: ProvisionTenantDraftDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.drafts.provisionDraft(
      draftId, input.expectedVersion, idempotencyKey, request.platformOperator!.userId, correlationId,
    );
  }
}
