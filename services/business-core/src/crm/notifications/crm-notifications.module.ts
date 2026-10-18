import { EmailModule } from "../../email/email.module";
import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmNotificationsController, InternalCrmNotificationsController } from "./crm-notifications.controller";
import { CrmNotificationsService } from "./crm-notifications.service";
import { CrmMessageReceiptModule } from "../conversations/crm-message-receipt.module";
import { DeviceTokenStoreService } from "./device-token-store.service";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
@Module({imports:[WorkspacesModule,CrmMessageReceiptModule,EmailModule],controllers:[CrmNotificationsController,InternalCrmNotificationsController],providers:[CrmNotificationsService,DeviceTokenStoreService,InternalServiceGuard,BrandAssetStorageService],exports:[CrmNotificationsService]}) export class CrmNotificationsModule{}
