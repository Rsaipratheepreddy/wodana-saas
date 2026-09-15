import { Module } from "@nestjs/common";
import { CrmLeadsModule } from "../leads/crm-leads.module";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";

@Module({
  imports: [CrmLeadsModule],
  providers: [CrmMessageReceiptService],
  exports: [CrmMessageReceiptService],
})
export class CrmMessageReceiptModule {}
