import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard, RequireOperatorPermission } from "../auth/platform-operator-permission.guard";
import { Public } from "../auth/public.decorator";
import { TransitionTenantLifecycleDto } from "../workspaces/dto/tenant-operations.dto";
import { TenantDomainsService } from "../workspaces/tenant-domains.service";
import { AccountDirectoryService } from "./account-directory.service";
import { ControlPlaneSweepService } from "./control-plane-sweep.service";
import {
  ChangeSeatLimitDto,
  ListAccountsQueryDto,
  RecordCertificateDto,
  RequestSupportSessionDto,
  SlugAvailabilityQueryDto,
  SupportSessionCommandDto,
  VersionedDomainCommandDto,
} from "./control-plane.dto";
import { OrganizationSeatsService } from "./organization-seats.service";
import { SupportSessionsService } from "./support-sessions.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";

const KEY = /^[a-zA-Z0-9_-]{1,160}$/;

function operator(request: OperatorRequest) {
  const current = request.platformOperator!;
  return { userId: current.userId, permissions: current.permissions };
}

/** Accounts list, account header and control-plane activity (§6.1 screens). */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/accounts")
export class OperatorAccountsController {
  constructor(private readonly directory: AccountDirectoryService) {}

  @Get()
  @RequireOperatorPermission("tenants.read")
  list(@Query() query: ListAccountsQueryDto, @Req() request: OperatorRequest) {
    return this.directory.list(request.platformOperator!.userId, query);
  }

  @Get("slug-availability")
  @RequireOperatorPermission("tenants.read")
  slugAvailability(@Query() query: SlugAvailabilityQueryDto) {
    return this.directory.slugAvailability(query.slug);
  }

  @Get(":accountId")
  @RequireOperatorPermission("tenants.read")
  detail(@Param("accountId", ParseUUIDPipe) accountId: string, @Req() request: OperatorRequest) {
    return this.directory.detail(request.platformOperator!.userId, accountId);
  }

  @Get(":accountId/activity")
  @RequireOperatorPermission("tenants.read")
  activity(@Param("accountId", ParseUUIDPipe) accountId: string, @Req() request: OperatorRequest) {
    return this.directory.activity(request.platformOperator!.userId, accountId);
  }
}

/**
 * One organization's control-plane records: lifecycle, seats, support sessions (and the tenant records they
 * open), and the domain steps after verification. Addressed by provisioning ID or workspace ID.
 */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/organizations/:key")
export class OperatorOrganizationsController {
  constructor(
    private readonly lifecycle: TenantLifecycleService,
    private readonly support: SupportSessionsService,
    private readonly seatsService: OrganizationSeatsService,
    private readonly domains: TenantDomainsService,
  ) {}

  @Get("lifecycle")
  @RequireOperatorPermission("tenants.read")
  lifecycleOverview(@Param("key") key: string, @Req() request: OperatorRequest) {
    return this.lifecycle.overview(this.key(key), request.platformOperator!.userId);
  }

  @Post("lifecycle/transitions")
  @RequireOperatorPermission("lifecycle.manage")
  transition(
    @Param("key") key: string,
    @Body() input: TransitionTenantLifecycleDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.lifecycle.transition(this.key(key), input, idempotencyKey, request.platformOperator!.userId, correlationId);
  }

  @Get("seats")
  @RequireOperatorPermission("tenants.read")
  seats(@Param("key") key: string, @Req() request: OperatorRequest) {
    return this.seatsService.view(this.key(key), request.platformOperator!.userId);
  }

  @Patch("seats")
  @RequireOperatorPermission("billing.manage")
  changeSeats(@Param("key") key: string, @Body() input: ChangeSeatLimitDto, @Req() request: OperatorRequest) {
    return this.seatsService.change(this.key(key), input, request.platformOperator!.userId);
  }

  @Get("support-sessions")
  @RequireOperatorPermission("tenants.read")
  supportSessions(@Param("key") key: string, @Req() request: OperatorRequest) {
    return this.support.list(this.key(key), operator(request));
  }

  @Post("support-sessions")
  @RequireOperatorPermission("support.request")
  requestSupport(
    @Param("key") key: string,
    @Body() input: RequestSupportSessionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: OperatorRequest,
  ) {
    return this.support.request(this.key(key), input, idempotencyKey, operator(request));
  }

  @Post("support-sessions/:sessionId/approve")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("support.approve")
  approveSupport(@Param("key") key: string, @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: SupportSessionCommandDto, @Req() request: OperatorRequest) {
    return this.support.command(this.key(key), sessionId, "approve", input, operator(request));
  }

  @Post("support-sessions/:sessionId/reject")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("support.approve")
  rejectSupport(@Param("key") key: string, @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: SupportSessionCommandDto, @Req() request: OperatorRequest) {
    return this.support.command(this.key(key), sessionId, "reject", input, operator(request));
  }

  @Post("support-sessions/:sessionId/start")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("support.request")
  startSupport(@Param("key") key: string, @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: SupportSessionCommandDto, @Req() request: OperatorRequest) {
    return this.support.command(this.key(key), sessionId, "start", input, operator(request));
  }

  @Post("support-sessions/:sessionId/revoke")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("tenants.read")
  revokeSupport(@Param("key") key: string, @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: SupportSessionCommandDto, @Req() request: OperatorRequest) {
    return this.support.command(this.key(key), sessionId, "revoke", input, operator(request));
  }

  @Get("support/members")
  @RequireOperatorPermission("support.request")
  supportMembers(@Param("key") key: string, @Req() request: OperatorRequest) {
    return this.support.members(this.key(key), operator(request));
  }

  @Get("support/activity")
  @RequireOperatorPermission("support.request")
  supportActivity(@Param("key") key: string, @Req() request: OperatorRequest) {
    return this.support.activity(this.key(key), operator(request));
  }

  @Post("domains/:domainId/certificate")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("domains.manage")
  recordCertificate(@Param("key") key: string, @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: RecordCertificateDto, @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest) {
    return this.domains.recordCertificate(this.key(key), domainId, input.expectedVersion, input.expiresAt,
      request.platformOperator!.userId, correlationId);
  }

  @Post("domains/:domainId/activate")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("domains.manage")
  activateDomain(@Param("key") key: string, @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedDomainCommandDto, @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest) {
    return this.domains.activate(this.key(key), domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  @Post("domains/:domainId/rollback-complete")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("domains.manage")
  completeDomainRollback(@Param("key") key: string, @Param("domainId", ParseUUIDPipe) domainId: string,
    @Body() input: VersionedDomainCommandDto, @Headers("x-request-id") correlationId: string | undefined,
    @Req() request: OperatorRequest) {
    return this.domains.completeRollback(this.key(key), domainId, input.expectedVersion, request.platformOperator!.userId, correlationId);
  }

  private key(value: string) {
    if (!KEY.test(value)) throw new BadRequestException("Choose a valid organization.");
    return value;
  }
}

/** The worker's entry point for the control-plane sweep (grace, suspension, support expiry, domain checks). */
@ApiTags("internal control plane")
@Public()
@UseGuards(InternalServiceGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@Controller("internal/control-plane")
export class InternalControlPlaneController {
  constructor(private readonly sweep: ControlPlaneSweepService) {}

  @Post("sweep")
  @HttpCode(HttpStatus.OK)
  run() {
    return this.sweep.run();
  }
}
