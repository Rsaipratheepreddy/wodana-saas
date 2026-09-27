import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../auth/platform-operator.guard";
import {
  PlatformOperatorPermissionGuard,
  RequireOperatorPermission,
} from "../auth/platform-operator-permission.guard";
import { Public } from "../auth/public.decorator";
import { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import { UpdateTenantManagementDto } from "./dto/update-tenant-management.dto";
import { TenantManagementService } from "./tenant-management.service";
import { TenantDomainsService } from "./tenant-domains.service";
import { RequestOperatorDomainDto, VersionedOperatorDomainDto } from "./dto/operator-domain.dto";
import { WorkspacesService } from "./workspaces.service";
import { TenantOperationsService } from "./tenant-operations.service";
import {
  CaptureAccountUsageSnapshotDto,
  CreateTenantOperationPlanDto,
  DecideTenantOperationDto,
  RecordAccountBillingDocumentEventDto,
  UpdateAccountCollectionStateDto,
  UpdateAccountContractDto,
  UpdateOrganizationBillingAllocationDto,
  UpdateTenantDataPolicyDto,
  UpdateTenantEntitlementsDto,
  UpdatePlatformCapabilityDto,
} from "./dto/tenant-operations.dto";

@ApiTags("operator tenant management")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/tenants")
export class OperatorTenantsController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly tenants: TenantManagementService,
    private readonly domains: TenantDomainsService,
    private readonly operations: TenantOperationsService,
  ) {}

  @Get()
  @RequireOperatorPermission("tenants.read")
  list() {
    return this.tenants.listManagedTenants();
  }

  @Get("platform/entitlement-catalog")
  @RequireOperatorPermission("tenants.read")
  entitlementCatalog() {
    return this.operations.entitlementCatalog();
  }

  @Patch("platform/capabilities")
  @RequireOperatorPermission("entitlements.manage")
  updatePlatformCapability(
    @Body() input: UpdatePlatformCapabilityDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updatePlatformCapability(input, request.platformOperator!.userId, correlationId);
  }

  @Post()
  @RequireOperatorPermission("tenants.provision")
  provision(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Body() input: ProvisionTenantDto,
    @Req() request: OperatorRequest,
  ) {
    return this.workspaces.provisionTenant(input, idempotencyKey, request.platformOperator!.userId, correlationId);
  }

  @Get(":externalTenantId")
  @RequireOperatorPermission("tenants.read")
  get(@Param("externalTenantId") externalTenantId: string) {
    return this.workspaces.getProvisionedTenant(externalTenantId);
  }

  @Get(":externalTenantId/management")
  @RequireOperatorPermission("tenants.read")
  getManagement(@Param("externalTenantId") externalTenantId: string) {
    return this.tenants.getManagedTenant(externalTenantId);
  }

  @Get(":externalTenantId/status")
  @RequireOperatorPermission("tenants.read")
  getStatus(@Param("externalTenantId") externalTenantId: string) {
    return this.tenants.getTenantStatus(externalTenantId);
  }

  @Get(":externalTenantId/domains")
  @RequireOperatorPermission("tenants.read")
  listDomains(@Param("externalTenantId") externalTenantId: string, @Req() request: OperatorRequest) {
    return this.domains.list(externalTenantId, request.platformOperator!.userId);
  }

  @Post(":externalTenantId/domains")
  @RequireOperatorPermission("domains.manage")
  requestDomain(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: RequestOperatorDomainDto,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.domains.request(externalTenantId, input.hostname, key, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/domains/:domainId/verify")
  @RequireOperatorPermission("domains.manage")
  verifyDomain(
    @Param("externalTenantId") externalTenantId: string,
    @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedOperatorDomainDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.domains.verify(externalTenantId, domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/domains/:domainId/rotate-challenge")
  @RequireOperatorPermission("domains.manage")
  rotateDomainChallenge(
    @Param("externalTenantId") externalTenantId: string,
    @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedOperatorDomainDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.domains.rotateChallenge(externalTenantId, domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/domains/:domainId/recheck")
  @RequireOperatorPermission("domains.manage")
  recheckDomain(
    @Param("externalTenantId") externalTenantId: string,
    @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedOperatorDomainDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.domains.recheckOwnership(externalTenantId, domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/domains/:domainId/remove")
  @RequireOperatorPermission("domains.manage")
  removeDomain(
    @Param("externalTenantId") externalTenantId: string,
    @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedOperatorDomainDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.domains.remove(externalTenantId, domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  @Patch(":externalTenantId/management")
  @RequireOperatorPermission("lifecycle.manage")
  updateManagement(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateTenantManagementDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.tenants.updateManagedTenant(
      externalTenantId, input, request.platformOperator!.userId, correlationId,
    );
  }

  @Post(":externalTenantId/owner-invitation/resend")
  @RequireOperatorPermission("invitations.send")
  resendOwnerInvitation(
    @Param("externalTenantId") externalTenantId: string,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.workspaces.resendProvisionedOwnerInvitation(
      externalTenantId, request.platformOperator!.userId, correlationId,
    );
  }

  @Post(":externalTenantId/owner-invitation/send")
  @RequireOperatorPermission("invitations.send")
  sendOwnerInvitation(
    @Param("externalTenantId") externalTenantId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key is required to send an owner invitation");
    return this.workspaces.resendProvisionedOwnerInvitation(
      externalTenantId, request.platformOperator!.userId, correlationId, idempotencyKey,
    );
  }

  @Get(":externalTenantId/operations")
  @RequireOperatorPermission("tenants.read")
  operationsOverview(@Param("externalTenantId") externalTenantId: string, @Req() request: OperatorRequest) {
    return this.operations.overview(externalTenantId, request.platformOperator!.userId);
  }

  @Get(":externalTenantId/operations/billing")
  @RequireOperatorPermission("tenants.read")
  billingOverview(@Param("externalTenantId") externalTenantId: string, @Req() request: OperatorRequest) {
    return this.operations.billingOverview(externalTenantId, request.platformOperator!.userId);
  }

  @Patch(":externalTenantId/operations/billing/contract")
  @RequireOperatorPermission("billing.manage")
  updateAccountContract(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateAccountContractDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updateAccountContract(externalTenantId, input, request.platformOperator!.userId, correlationId);
  }

  @Patch(":externalTenantId/operations/billing/allocation")
  @RequireOperatorPermission("billing.manage")
  updateBillingAllocation(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateOrganizationBillingAllocationDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updateBillingAllocation(externalTenantId, input, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/operations/billing/documents/events")
  @RequireOperatorPermission("billing.manage")
  recordBillingDocumentEvent(
    @Param("externalTenantId") externalTenantId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Body() input: RecordAccountBillingDocumentEventDto,
    @Req() request: OperatorRequest,
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key is required for a billing document event");
    return this.operations.recordBillingDocumentEvent(
      externalTenantId, input, idempotencyKey, request.platformOperator!.userId, correlationId,
    );
  }

  @Patch(":externalTenantId/operations/billing/collection")
  @RequireOperatorPermission("billing.manage")
  updateCollectionState(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateAccountCollectionStateDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updateCollectionState(externalTenantId, input, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/operations/billing/usage-snapshots")
  @RequireOperatorPermission("billing.manage")
  captureUsageSnapshot(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: CaptureAccountUsageSnapshotDto,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.captureUsageSnapshot(externalTenantId, input, request.platformOperator!.userId);
  }

  @Patch(":externalTenantId/operations/entitlements")
  @RequireOperatorPermission("entitlements.manage")
  updateEntitlements(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateTenantEntitlementsDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updateEntitlements(externalTenantId, input, request.platformOperator!.userId, correlationId);
  }

  @Patch(":externalTenantId/operations/data-policy")
  @RequireOperatorPermission("data.manage")
  updateDataPolicy(
    @Param("externalTenantId") externalTenantId: string,
    @Body() input: UpdateTenantDataPolicyDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.updateDataPolicy(externalTenantId, input, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/operations/plans")
  @RequireOperatorPermission("data.manage")
  planOperation(
    @Param("externalTenantId") externalTenantId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Body() input: CreateTenantOperationPlanDto,
    @Req() request: OperatorRequest,
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key is required to plan a tenant operation");
    return this.operations.plan(externalTenantId, input, idempotencyKey, request.platformOperator!.userId, correlationId);
  }

  @Post(":externalTenantId/operations/:operationId/decision")
  @RequireOperatorPermission("data.manage")
  decideOperation(
    @Param("externalTenantId") externalTenantId: string,
    @Param("operationId", ParseUUIDPipe) operationId: string,
    @Body() input: DecideTenantOperationDto,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.operations.decideOperation(
      externalTenantId, operationId, input, request.platformOperator!.userId, correlationId,
    );
  }

  @Get(":externalTenantId/operations/exports/:exportId/content")
  @RequireOperatorPermission("data.manage")
  async downloadExport(
    @Param("externalTenantId") externalTenantId: string,
    @Param("exportId", ParseUUIDPipe) exportId: string,
    @Req() request: OperatorRequest,
  ) {
    const file = await this.operations.readExport(externalTenantId, exportId, request.platformOperator!.userId);
    return new StreamableFile(file.body, {
      type: "application/json",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: file.body.byteLength,
    });
  }
}
