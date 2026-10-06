import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module";
import { EmailModule } from "../email/email.module";
import { EsignService } from "../proposals/esign.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ChangeRequestsController } from "./change-requests.controller";
import { ChangeRequestsService } from "./change-requests.service";

/** Change requests after the contract (plan §6.20, §0.7 R11): E3 approval inside the firm, e-sign by link for the client. */
@Module({
  imports: [WorkspacesModule, CommercialModule, EmailModule],
  controllers: [ChangeRequestsController],
  // E-sign is stateless; this module signs change requests through the same service the proposals use.
  providers: [ChangeRequestsService, EsignService, BrandAssetStorageService],
})
export class ChangeRequestsModule {}
