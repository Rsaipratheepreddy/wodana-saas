import { IntroMeetingService } from "./intro-meeting.service";
import { OpportunityDiscoveryService } from "./discovery.service";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { CrmOpportunitiesController } from "./crm-opportunities.controller";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { OpportunityFlowController } from "./opportunity-flow.controller";
import { OpportunityFlowService } from "./opportunity-flow.service";
import { CrmLeadsModule } from "../leads/crm-leads.module";

@Module({ imports: [WorkspacesModule, CrmLeadsModule], controllers: [CrmOpportunitiesController, OpportunityFlowController], providers: [CrmOpportunitiesService, OpportunityDiscoveryService, IntroMeetingService, OpportunityFlowService, BrandAssetStorageService], exports: [CrmOpportunitiesService, OpportunityDiscoveryService] })
export class CrmOpportunitiesModule {}
