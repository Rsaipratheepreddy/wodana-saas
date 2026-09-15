import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmNotificationsModule } from "../notifications/crm-notifications.module";
import { CrmMessageReceiptModule } from "./crm-message-receipt.module";
import { CrmConversationsController, InternalCrmConversationsController } from "./crm-conversations.controller";
import { CrmConversationsService } from "./crm-conversations.service";

@Module({ imports: [WorkspacesModule, CrmNotificationsModule, CrmMessageReceiptModule], controllers: [CrmConversationsController, InternalCrmConversationsController], providers: [CrmConversationsService] })
export class CrmConversationsModule {}
