import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SiteController, SitesTodayController, WarrantySettingsController } from "./site.controller";
import { HandoverService } from "./handover.service";
import { SiteService } from "./site.service";
import { WarrantyService } from "./warranty.service";

@Module({ imports: [WorkspacesModule], controllers: [SitesTodayController, SiteController, WarrantySettingsController], providers: [SiteService, HandoverService, WarrantyService, BrandAssetStorageService] })
export class SiteModule {}
