import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard } from "../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard } from "../auth/platform-operator-permission.guard";
import { EmailModule } from "../email/email.module";
import { TenantDomainsService } from "../workspaces/tenant-domains.service";
import { AccountDirectoryService } from "./account-directory.service";
import { ControlNoticesService } from "./control-notices.service";
import { ControlPlaneSweepService } from "./control-plane-sweep.service";
import {
  InternalControlPlaneController,
  OperatorAccountsController,
  OperatorOrganizationsController,
} from "./operator-console.controller";
import { OrganizationSeatsService } from "./organization-seats.service";
import { SupportSessionsService } from "./support-sessions.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";

/** Wodana's control plane (master plan §6.1): accounts, lifecycle, support sessions, notices and the sweep. */
@Module({
  imports: [EmailModule],
  controllers: [OperatorAccountsController, OperatorOrganizationsController, InternalControlPlaneController],
  providers: [
    AccountDirectoryService,
    ControlNoticesService,
    ControlPlaneSweepService,
    OrganizationSeatsService,
    SupportSessionsService,
    TenantLifecycleService,
    TenantDomainsService,
    InternalServiceGuard,
    PlatformOperatorGuard,
    PlatformOperatorPermissionGuard,
  ],
  exports: [ControlNoticesService],
})
export class ControlPlaneModule {}
