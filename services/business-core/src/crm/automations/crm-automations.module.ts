import { Module } from "@nestjs/common";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmLeadsModule } from "../leads/crm-leads.module";
import { CrmNotificationsModule } from "../notifications/crm-notifications.module";
import { CrmAutomationsController, InternalCrmAutomationsController } from "./crm-automations.controller";
import { CrmAutomationsService } from "./crm-automations.service";
@Module({ imports: [WorkspacesModule, CrmLeadsModule, CrmNotificationsModule], controllers: [CrmAutomationsController, InternalCrmAutomationsController], providers: [CrmAutomationsService, InternalServiceGuard] }) export class CrmAutomationsModule {}
