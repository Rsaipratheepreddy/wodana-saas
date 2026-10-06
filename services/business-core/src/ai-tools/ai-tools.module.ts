import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { CrmActivitiesModule } from "../crm/activities/crm-activities.module";
import { CrmActivitiesService } from "../crm/activities/crm-activities.service";
import { CrmConversationsModule } from "../crm/conversations/crm-conversations.module";
import { CrmConversationsService } from "../crm/conversations/crm-conversations.service";
import { CrmInboxService } from "../crm/conversations/crm-inbox.service";
import { CrmScheduledMessagesService } from "../crm/conversations/crm-scheduled-messages.service";
import { CrmIntakeModule } from "../crm/intake/crm-intake.module";
import { CrmIntakeService } from "../crm/intake/crm-intake.service";
import { CrmLeadsModule } from "../crm/leads/crm-leads.module";
import { CrmLeadsService } from "../crm/leads/crm-leads.service";
import { CrmOpportunitiesModule } from "../crm/opportunities/crm-opportunities.module";
import { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import { CrmPartiesModule } from "../crm/parties/crm-parties.module";
import { CrmPartiesService } from "../crm/parties/crm-parties.service";
import { InventoryModule } from "../inventory/inventory.module";
import { InventoryService } from "../inventory/inventory.service";
import { ProjectCoreModule } from "../project-core/project-core.module";
import { ProjectWorkService } from "../project-core/project-work.service";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { SuppliersService } from "../purchasing/suppliers.service";
import { QuotationModule } from "../quotation/quotation.module";
import { QuotationCollabService } from "../quotation/quotation-collab.service";
import { WorkspaceSearchModule } from "../search/workspace-search.module";
import { WorkspaceSearchService } from "../search/workspace-search.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiAgentService } from "./ai-agent.service";
import { AiToolCallsService } from "./ai-tool-calls.service";
import { AiToolsController } from "./ai-tools.controller";
import { AiToolRegistry } from "./ai-tools.registry";

/** Woddy's tools (W-1): the registry, the agent loop and the confirmation of proposed actions. */
@Module({
  imports: [WorkspacesModule, CrmLeadsModule, CrmIntakeModule, CrmOpportunitiesModule, CrmActivitiesModule, CrmPartiesModule, CrmConversationsModule, WorkspaceSearchModule, ProjectCoreModule, QuotationModule, CatalogModule, InventoryModule, PurchasingModule],
  controllers: [AiToolsController],
  providers: [
    {
      provide: AiToolRegistry,
      inject: [WorkspaceAccessService, WorkspaceSearchService, CrmLeadsService, CrmIntakeService, CrmOpportunitiesService, CrmActivitiesService, CrmPartiesService, CrmConversationsService, CrmInboxService, CrmScheduledMessagesService, ProjectWorkService, QuotationCollabService, CatalogV2Service, InventoryService, SuppliersService],
      useFactory: (access: WorkspaceAccessService, search: WorkspaceSearchService, leads: CrmLeadsService, intake: CrmIntakeService, opportunities: CrmOpportunitiesService, activities: CrmActivitiesService,
        parties: CrmPartiesService, conversations: CrmConversationsService, inbox: CrmInboxService, scheduled: CrmScheduledMessagesService, work: ProjectWorkService, quoteComments: QuotationCollabService,
        catalog: CatalogV2Service, inventory: InventoryService, suppliers: SuppliersService) =>
        AiToolRegistry.catalogue({ access, search, leads, intake, opportunities, activities, parties, conversations, inbox, scheduled, work, quoteComments, catalog, inventory, suppliers }),
    },
    AiToolCallsService,
    AiAgentService,
  ],
  exports: [AiToolRegistry, AiToolCallsService],
})
export class AiToolsModule {}
