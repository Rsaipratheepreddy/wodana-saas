import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectCoreController } from "./project-core.controller";
import { ProjectCoreService } from "./project-core.service";
import { ProjectMoneyService } from "./project-money.service";
import { ProjectWorkService } from "./project-work.service";

@Module({ imports: [WorkspacesModule], controllers: [ProjectCoreController], providers: [ProjectCoreService, ProjectWorkService, ProjectMoneyService, BrandAssetStorageService] })
export class ProjectCoreModule {}
