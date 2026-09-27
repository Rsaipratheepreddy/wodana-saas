import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SiteController } from "./site.controller";
import { SiteService } from "./site.service";

@Module({ imports: [WorkspacesModule], controllers: [SiteController], providers: [SiteService, BrandAssetStorageService] })
export class SiteModule {}
