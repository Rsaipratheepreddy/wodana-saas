import { Module } from "@nestjs/common";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmNotificationsModule } from "../notifications/crm-notifications.module";
import { CrmMessageReceiptModule } from "./crm-message-receipt.module";
import { CrmAttachmentsController, InternalCrmAttachmentsController } from "./crm-attachments.controller";
import { CrmAttachmentsService } from "./crm-attachments.service";
import { CrmConversationsController, InternalCrmConversationsController } from "./crm-conversations.controller";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxController, InternalCrmInboxController } from "./crm-inbox.controller";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmScheduledMessagesService } from "./crm-scheduled-messages.service";
import { CrmWhatsAppTemplatesService } from "./crm-whatsapp-templates.service";
import { CrmPaymentRemindersService } from "./crm-payment-reminders.service";

@Module({
  imports: [WorkspacesModule, CrmNotificationsModule, CrmMessageReceiptModule],
  controllers: [CrmInboxController, InternalCrmInboxController, CrmConversationsController, InternalCrmConversationsController, CrmAttachmentsController, InternalCrmAttachmentsController],
  providers: [CrmConversationsService, CrmInboxService, CrmWhatsAppTemplatesService, CrmPaymentRemindersService, CrmAttachmentsService, CrmScheduledMessagesService, BrandAssetStorageService],
  exports: [CrmConversationsService, CrmInboxService, CrmScheduledMessagesService],
})
export class CrmConversationsModule {}
