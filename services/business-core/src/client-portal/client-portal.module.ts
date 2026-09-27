import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module";
import { EmailModule } from "../email/email.module";
import { PreProjectsModule } from "../pre-projects/pre-projects.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ClientPortalAdminService } from "./client-portal-admin.service";
import { ClientPortalAdminController, ClientPortalController, ClientPortalSitesController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";

/** The client portal (plan §6.22): the tenant's own site for homeowners, and the firm's controls over what they see. */
@Module({
  imports: [WorkspacesModule, CommercialModule, PreProjectsModule, EmailModule],
  controllers: [ClientPortalController, ClientPortalSitesController, ClientPortalAdminController],
  providers: [ClientPortalService, ClientPortalAdminService, BrandAssetStorageService],
})
export class ClientPortalModule {}
