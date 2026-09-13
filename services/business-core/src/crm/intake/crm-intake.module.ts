import { LeadFormsService } from "./lead-forms.service";
import { LeadFormsController, PublicLeadFormsController } from "./lead-forms.controller";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmIntakeController, InternalCrmIntakeController } from "./crm-intake.controller";
import { CrmIntakeService } from "./crm-intake.service";
import { CrmLeadsModule } from "../leads/crm-leads.module";

@Module({
  imports: [WorkspacesModule, CrmLeadsModule],
  controllers: [LeadFormsController, PublicLeadFormsController, CrmIntakeController, InternalCrmIntakeController],
  providers: [LeadFormsService, CrmIntakeService],
  exports: [CrmIntakeService],
})
export class CrmIntakeModule {}
