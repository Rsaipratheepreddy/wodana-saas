import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { PlatformOperatorGuard } from "../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard } from "../auth/platform-operator-permission.guard";
import { EmailModule } from "../email/email.module";
import { TenantDomainsService } from "../workspaces/tenant-domains.service";
import { AccountDirectoryService } from "./account-directory.service";
import { AiCreditsConsoleService } from "./ai-credits-console.service";
import { ControlNoticesService } from "./control-notices.service";
import { ControlPlaneSweepService } from "./control-plane-sweep.service";
import {
  InternalControlPlaneController,
  OperatorAccountsController,
  OperatorAiCreditsController,
  OperatorOrganizationsController,
} from "./operator-console.controller";
import { OperatorNotificationsController } from "./operator-notifications.controller";
import { OperatorNotificationsService } from "./operator-notifications.service";
import { OrganizationSeatsService } from "./organization-seats.service";
import { SalesContactFormService } from "./sales/sales-contact-form.service";
import { OperatorSalesContactFormController, OperatorSalesEnquiriesController, PublicSalesController } from "./sales/sales-enquiries.controller";
import { SalesEnquiriesService } from "./sales/sales-enquiries.service";
import { SupportSessionsService } from "./support-sessions.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";

/** Wodana's control plane (master plan §6.1): accounts, lifecycle, support sessions, notices (tenant and in-app operator), the sweep and sales enquiries. */
@Module({
  imports: [EmailModule],
  controllers: [
    OperatorAccountsController,
    OperatorOrganizationsController,
    OperatorAiCreditsController,
    OperatorNotificationsController,
    InternalControlPlaneController,
    PublicSalesController,
    OperatorSalesEnquiriesController,
    OperatorSalesContactFormController,
  ],
  providers: [
    AccountDirectoryService,
    AiCreditsConsoleService,
    ControlNoticesService,
    ControlPlaneSweepService,
    OperatorNotificationsService,
    OrganizationSeatsService,
    SalesContactFormService,
    SalesEnquiriesService,
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
