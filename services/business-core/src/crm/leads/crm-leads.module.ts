import { BriefService } from '../../pre-projects/brief.service';
import { RequirementNotesService, RequirementNotesController } from './requirement-notes.service';
import { RequirementNoteAssetsController } from './requirement-note-assets.controller';
import { BrandAssetStorageService } from '../../workspaces/brand-asset-storage.service';
import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmLeadsController, InternalCrmSlasController } from "./crm-leads.controller";
import { CrmLeadsService } from "./crm-leads.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [RequirementNoteAssetsController, RequirementNotesController, CrmLeadsController, InternalCrmSlasController],
  providers: [BriefService, BrandAssetStorageService, RequirementNotesService, CrmLeadsService, InternalServiceGuard],
  exports: [CrmLeadsService],
})
export class CrmLeadsModule {}
