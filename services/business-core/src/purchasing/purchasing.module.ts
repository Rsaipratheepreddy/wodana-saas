import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { OrdersService } from "./orders.service";
import { PayablesController } from "./payables.controller";
import { PayablesService } from "./payables.service";
import { PaymentRunsService } from "./payment-runs.service";
import { PriceRequestsService } from "./price-requests.service";
import { PurchasingController } from "./purchasing.controller";
import { ReceivingService } from "./receiving.service";
import { SupplierReturnsService } from "./returns.service";
import { SupplierControlsService } from "./supplier-controls.service";
import { SuppliersService } from "./suppliers.service";

@Module({ imports: [WorkspacesModule, EmailModule], controllers: [PurchasingController, PayablesController], providers: [SuppliersService, PayablesService, PaymentRunsService, OrdersService, PriceRequestsService, ReceivingService, SupplierReturnsService, SupplierControlsService, BrandAssetStorageService],
  exports: [OrdersService, PayablesService, PaymentRunsService, SuppliersService] })
export class PurchasingModule {}
