import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { LogisticsController } from "./logistics.controller";
import { LogisticsService } from "./logistics.service";

@Module({ imports: [WorkspacesModule], controllers: [LogisticsController], providers: [LogisticsService, BrandAssetStorageService] })
export class LogisticsModule {}
