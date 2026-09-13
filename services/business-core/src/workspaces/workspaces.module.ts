import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesService } from "./workspaces.service";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { InternalTenantsController } from "./internal-tenants.controller";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import { PublicBrandingController } from "./public-branding.controller";
import { EmailModule } from "../email/email.module";
import { TenantManagementService } from "./tenant-management.service";
import { WorkspaceBillingController } from "./workspace-billing.controller";

@Module({
  imports: [EmailModule],
  controllers: [WorkspacesController, WorkspaceBillingController, InternalTenantsController, PublicBrandingController],
  providers: [WorkspaceAccessService, WorkspacesService, TenantManagementService, InternalServiceGuard, BrandAssetStorageService],
  exports: [WorkspaceAccessService, WorkspacesService],
})
export class WorkspacesModule {}
