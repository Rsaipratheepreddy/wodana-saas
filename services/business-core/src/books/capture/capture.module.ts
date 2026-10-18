import { Module } from "@nestjs/common";
import { PurchasingModule } from "../../purchasing/purchasing.module";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BillCaptureController } from "./bill-capture.controller";
import { BillCaptureService } from "./bill-capture.service";

/** Bill capture: a photo or PDF read into a draft supplier bill a person confirms (slice D). */
@Module({ imports: [WorkspacesModule, PurchasingModule], controllers: [BillCaptureController], providers: [BillCaptureService, BrandAssetStorageService] })
export class BooksCaptureModule {}
