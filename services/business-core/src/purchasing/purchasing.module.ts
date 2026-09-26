import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { PurchasingController } from "./purchasing.controller";
import { SuppliersService } from "./suppliers.service";

@Module({ imports: [WorkspacesModule], controllers: [PurchasingController], providers: [SuppliersService] })
export class PurchasingModule {}
