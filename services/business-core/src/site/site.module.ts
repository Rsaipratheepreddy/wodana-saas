import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SiteController, WarrantySettingsController } from "./site.controller";
import { HandoverService } from "./handover.service";
import { SiteService } from "./site.service";
import { WarrantyService } from "./warranty.service";

@Module({ imports: [WorkspacesModule], controllers: [SiteController, WarrantySettingsController], providers: [SiteService, HandoverService, WarrantyService, BrandAssetStorageService], exports: [SiteService] })
export class SiteModule {}
