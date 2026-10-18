import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { FinanceRequestsController } from "./finance-requests.controller";
import { FinanceRequestsService } from "./finance-requests.service";

@Module({ imports: [WorkspacesModule], controllers: [FinanceRequestsController], providers: [FinanceRequestsService, BrandAssetStorageService], exports: [FinanceRequestsService] })
export class FinanceRequestsModule {}
