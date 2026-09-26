import { OpportunityDiscoveryService } from "./discovery.service";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmOpportunitiesController } from "./crm-opportunities.controller";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { CrmLeadsModule } from "../leads/crm-leads.module";

@Module({ imports: [WorkspacesModule, CrmLeadsModule], controllers: [CrmOpportunitiesController], providers: [CrmOpportunitiesService, OpportunityDiscoveryService], exports: [CrmOpportunitiesService, OpportunityDiscoveryService] })
export class CrmOpportunitiesModule {}
