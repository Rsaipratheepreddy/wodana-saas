import { Module } from "@nestjs/common";
import { CrmIntakeModule } from "../crm/intake/crm-intake.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GalleryController, PublicGalleryController } from "./gallery.controller";
import { GalleryService } from "./gallery.service";

@Module({ imports: [WorkspacesModule, CrmIntakeModule], controllers: [GalleryController, PublicGalleryController], providers: [GalleryService, BrandAssetStorageService] })
export class GalleryModule {}
