import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmNotificationsController, InternalCrmNotificationsController } from "./crm-notifications.controller";
import { CrmNotificationsService } from "./crm-notifications.service";
import { CrmMessageReceiptModule } from "../conversations/crm-message-receipt.module";
import { DeviceTokenStoreService } from "./device-token-store.service";
@Module({imports:[WorkspacesModule,CrmMessageReceiptModule],controllers:[CrmNotificationsController,InternalCrmNotificationsController],providers:[CrmNotificationsService,DeviceTokenStoreService,InternalServiceGuard],exports:[CrmNotificationsService]}) export class CrmNotificationsModule{}
