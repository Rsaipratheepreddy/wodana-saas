import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module";
import { QuotationModule } from "../quotation/quotation.module";
import { RemindersSourcesModule } from "../reminders/sources/sources.module";
import { ChangeRequestReminders } from "./change-request-reminder-source";
import { EmailModule } from "../email/email.module";
import { EsignService } from "../proposals/esign.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ChangeRequestsController } from "./change-requests.controller";
import { ChangeRequestsService } from "./change-requests.service";
import { ProjectChangesController } from "./project-changes.controller";
import { ProjectChangesService } from "./project-changes.service";

/**
 * Change requests after the contract (plan §6.20, §0.7 R11): E3 approval inside the firm, e-sign by link for the client.
 * On a started project a change is priced as a variation quotation in the quotation builder and applied to the project.
 */
@Module({
  imports: [WorkspacesModule, CommercialModule, EmailModule, QuotationModule, RemindersSourcesModule],
  controllers: [ChangeRequestsController, ProjectChangesController],
  // E-sign is stateless; this module signs change requests through the same service the proposals use.
  providers: [ChangeRequestsService, ProjectChangesService, EsignService, BrandAssetStorageService, ChangeRequestReminders],
})
export class ChangeRequestsModule {}
