import { MemberProfileController } from "./member-profile.controller";
import { MemberProfileService } from "./member-profile.service";
import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesService } from "./workspaces.service";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { InternalTenantsController } from "./internal-tenants.controller";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import { PublicBrandingController } from "./public-branding.controller";
import { EmailModule } from "../email/email.module";
import { ControlPlaneModule } from "../control-plane/control-plane.module";
import { TenantManagementService } from "./tenant-management.service";
import { WorkspaceBillingController } from "./workspace-billing.controller";
import { CustomerAccountsController } from "./customer-accounts.controller";
import { CustomerAccountsService } from "./customer-accounts.service";
import { InternalOrganizationAccountsController } from "./internal-organization-accounts.controller";
import { OperatorTenantsController } from "./operator-tenants.controller";
import { PlatformOperatorGuard } from "../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard } from "../auth/platform-operator-permission.guard";
import { OperatorTenantDraftsController } from "./operator-tenant-drafts.controller";
import { TenantProvisioningDraftsService } from "./tenant-provisioning-drafts.service";
import { TenantDomainsService } from "./tenant-domains.service";
import { ConfigurationRevisionsService } from "./configuration-revisions.service";
import { TenantOperationsService } from "./tenant-operations.service";
import { TaxNumberingController } from "./tax-numbering.controller";
import { TaxNumberingService } from "./tax-numbering.service";
import { MemberOffboardingController, MemberOffboardingService } from "./member-offboarding.service";

@Module({
  imports: [EmailModule, ControlPlaneModule],
  controllers: [
    MemberProfileController,
    WorkspacesController,
    WorkspaceBillingController,
    CustomerAccountsController,
    InternalTenantsController,
    OperatorTenantsController,
    OperatorTenantDraftsController,
    InternalOrganizationAccountsController,
    PublicBrandingController,
    TaxNumberingController,
    MemberOffboardingController,
  ],
  providers: [
    MemberProfileService,
    WorkspaceAccessService,
    WorkspacesService,
    CustomerAccountsService,
    TenantManagementService,
    TenantProvisioningDraftsService,
    TenantDomainsService,
    InternalServiceGuard,
    PlatformOperatorGuard,
    PlatformOperatorPermissionGuard,
    BrandAssetStorageService,
    ConfigurationRevisionsService,
    TenantOperationsService,
    TaxNumberingService,
    MemberOffboardingService,
  ],
  exports: [WorkspaceAccessService, WorkspacesService, ConfigurationRevisionsService],
})
export class WorkspacesModule {}
