import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { FactoryController } from "./factory.controller";
import { FactoryService } from "./factory.service";

@Module({ imports: [WorkspacesModule, PurchasingModule, InventoryModule], controllers: [FactoryController], providers: [FactoryService], exports: [FactoryService] })
export class FactoryModule {}
