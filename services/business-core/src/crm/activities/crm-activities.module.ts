import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmActivitiesController } from "./crm-activities.controller";
import { CrmActivitiesService } from "./crm-activities.service";
import { CrmLeadsModule } from "../leads/crm-leads.module";

@Module({ imports: [WorkspacesModule, CrmLeadsModule], controllers: [CrmActivitiesController], providers: [CrmActivitiesService], exports: [CrmActivitiesService] })
export class CrmActivitiesModule {}
