import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { FactoryController } from "./factory.controller";
import { FactorySamplesService } from "./factory-samples.service";
import { FactoryService } from "./factory.service";

@Module({ imports: [WorkspacesModule, PurchasingModule, InventoryModule], controllers: [FactoryController], providers: [FactoryService, FactorySamplesService, BrandAssetStorageService], exports: [FactoryService] })
export class FactoryModule {}
