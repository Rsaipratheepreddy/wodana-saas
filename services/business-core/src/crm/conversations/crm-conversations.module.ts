import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmNotificationsModule } from "../notifications/crm-notifications.module";
import { CrmMessageReceiptModule } from "./crm-message-receipt.module";
import { CrmConversationsController, InternalCrmConversationsController } from "./crm-conversations.controller";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxController, InternalCrmInboxController } from "./crm-inbox.controller";
import { CrmInboxService } from "./crm-inbox.service";

@Module({ imports: [WorkspacesModule, CrmNotificationsModule, CrmMessageReceiptModule], controllers: [CrmInboxController, InternalCrmInboxController, CrmConversationsController, InternalCrmConversationsController], providers: [CrmConversationsService, CrmInboxService] })
export class CrmConversationsModule {}
