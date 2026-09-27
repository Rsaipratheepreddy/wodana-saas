import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SiteController } from "./site.controller";
import { HandoverService } from "./handover.service";
import { SiteService } from "./site.service";

@Module({ imports: [WorkspacesModule], controllers: [SiteController], providers: [SiteService, HandoverService, BrandAssetStorageService] })
export class SiteModule {}
