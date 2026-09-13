import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmOpportunitiesController } from "./crm-opportunities.controller";
import { CrmOpportunitiesService } from "./crm-opportunities.service";

@Module({ imports: [WorkspacesModule], controllers: [CrmOpportunitiesController], providers: [CrmOpportunitiesService], exports: [CrmOpportunitiesService] })
export class CrmOpportunitiesModule {}
