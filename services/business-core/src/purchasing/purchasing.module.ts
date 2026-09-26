import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { OrdersService } from "./orders.service";
import { PriceRequestsService } from "./price-requests.service";
import { PurchasingController } from "./purchasing.controller";
import { ReceivingService } from "./receiving.service";
import { SupplierReturnsService } from "./returns.service";
import { SuppliersService } from "./suppliers.service";

@Module({ imports: [WorkspacesModule, EmailModule], controllers: [PurchasingController], providers: [SuppliersService, OrdersService, PriceRequestsService, ReceivingService, SupplierReturnsService] })
export class PurchasingModule {}
