import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { LabourRatesService } from "./labour-rates.service";
import { ProjectCoreController } from "./project-core.controller";
import { ProjectCoreService } from "./project-core.service";
import { ProjectDrawingsService } from "./project-drawings.service";
import { ProjectFinanceService } from "./project-finance.service";
import { ProjectItemProofController } from "./project-item-proof.controller";
import { ProjectItemProofService } from "./project-item-proof.service";
import { ProjectMoneyService } from "./project-money.service";
import { ProjectOverviewService } from "./project-overview.service";
import { ProjectWorkService } from "./project-work.service";

@Module({ imports: [WorkspacesModule], controllers: [ProjectCoreController, ProjectItemProofController], providers: [ProjectCoreService, ProjectItemProofService, ProjectDrawingsService, ProjectWorkService, ProjectMoneyService, ProjectOverviewService, LabourRatesService, BrandAssetStorageService, ProjectFinanceService], exports: [ProjectWorkService, ProjectFinanceService] })
export class ProjectCoreModule {}
