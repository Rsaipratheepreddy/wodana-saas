import { CommercialModule } from "./commercial/commercial.module";
import { ClientPortalModule } from "./client-portal/client-portal.module";
import { ChangeRequestsModule } from "./change-requests/change-requests.module";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { ReferenceModule } from "./reference/reference.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { ControlPlaneModule } from "./control-plane/control-plane.module";
import { validateRuntimeConfig } from "./config/runtime-config";
import { CrmPartiesModule } from "./crm/parties/crm-parties.module";
import { CrmSharedModule } from "./crm/shared/crm-shared.module";
import { CrmIntakeModule } from "./crm/intake/crm-intake.module";
import { CrmLeadsModule } from "./crm/leads/crm-leads.module";
import { CrmActivitiesModule } from "./crm/activities/crm-activities.module";
import { CrmConversationsModule } from "./crm/conversations/crm-conversations.module";
import { CrmOpportunitiesModule } from "./crm/opportunities/crm-opportunities.module";
import { CrmFlowsModule } from "./crm/flows/crm-flows.module";
import { FlowStepsModule } from "./crm/flow-steps/flow-steps.module";
import { CrmTodayModule } from "./crm/today/crm-today.module";
import { CrmReportingModule } from "./crm/reporting/crm-reporting.module";
import { ManagementReportsModule } from "./management-reports/management-reports.module";
import { CrmSettingsModule } from "./crm/settings/crm-settings.module";
import { CrmAutomationsModule } from "./crm/automations/crm-automations.module";
import { CrmNotificationsModule } from "./crm/notifications/crm-notifications.module";
import { EventingModule } from "./eventing/eventing.module";
import { PreProjectsModule } from "./pre-projects/pre-projects.module";
import { HrmsModule } from "./hrms/hrms.module";
import { CatalogModule } from "./catalog/catalog.module";
import { SourcingModule } from "./sourcing/sourcing.module";
import { ProductSourcingModule } from "./product-sourcing/product-sourcing.module";
import { JobsModule } from "./jobs/jobs.module";
import { WorkspaceSearchModule } from "./search/workspace-search.module";
import { AiSuggestionsModule } from "./ai-suggestions/ai-suggestions.module";
import { AiGatewayModule } from "./ai-gateway/ai-gateway.module";
import { AiToolsModule } from "./ai-tools/ai-tools.module";
import { McpModule } from "./mcp/mcp.module";
import { DesignModule } from "./design/design.module";
import { QuotationModule } from "./quotation/quotation.module";
import { ProposalsModule } from "./proposals/proposals.module";
import { GalleryModule } from "./gallery/gallery.module";
import { ProjectCoreModule } from "./project-core/project-core.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { FactoryModule } from "./factory/factory.module";
import { TeamCalendarsModule } from "./team-calendars/team-calendars.module";
import { LogisticsModule } from "./logistics/logistics.module";
import { ClientCallsModule } from "./client-calls/client-calls.module";
import { SiteModule } from "./site/site.module";
import { ReceivablesModule } from "./receivables/receivables.module";
import { AccountingModule } from "./accounting/accounting.module";
import { BooksModule } from "./books/books.module";
import { PettyCashModule } from "./petty-cash/petty-cash.module";
import { FinanceRequestsModule } from "./finance-requests/finance-requests.module";
import { FulfilmentModule } from "./fulfilment/fulfilment.module";
import { InventoryModule } from "./inventory/inventory.module";
import { LinkedImportsModule } from "./linked-imports/linked-imports.module";
import { ApprovalsModule } from "./approvals/approvals.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { BookingModule } from "./booking/booking.module";
import { GridSettingsModule } from "./grid-settings/grid-settings.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Local development keeps service-only credentials beside the service
      // and shared integration/security credentials at the monorepo root.
      // Deployed process environment variables still take precedence.
      envFilePath: [
        resolve(__dirname, "../.env"),
        resolve(__dirname, "../../../.env"),
      ],
      validate: validateRuntimeConfig,
    }),
    DatabaseModule,
    AuthModule,
    CrmSharedModule,
    CrmPartiesModule,
    CrmIntakeModule,
    BookingModule,
    GridSettingsModule,
    CrmLeadsModule,
    CrmActivitiesModule,
    CrmConversationsModule,
    CrmOpportunitiesModule,
    CrmFlowsModule,
    FlowStepsModule,
    CrmTodayModule,
    CrmReportingModule,
    ManagementReportsModule,
    CrmSettingsModule,
    CrmAutomationsModule,
    CrmNotificationsModule,
    EventingModule,
    HealthModule,
    IntegrationsModule,
    ReferenceModule,
    WorkspacesModule,
    ControlPlaneModule,
    PreProjectsModule,
    CommercialModule,
    ClientPortalModule,
    ChangeRequestsModule,
    CatalogModule,
    SourcingModule,
    ProductSourcingModule,
    JobsModule,
    WorkspaceSearchModule,
    AiSuggestionsModule,
    AiGatewayModule,
    AiToolsModule,
    McpModule,
    DesignModule,
    QuotationModule,
    ProposalsModule,
    GalleryModule,
    ProjectCoreModule,
    PurchasingModule,
    InventoryModule,
    LinkedImportsModule,
    FactoryModule,
    TeamCalendarsModule,
    LogisticsModule,
    ClientCallsModule,
    SiteModule,
    ReceivablesModule,
    AccountingModule,
    BooksModule,
    PettyCashModule,
    FinanceRequestsModule,
    FulfilmentModule,
    ApprovalsModule,
    HrmsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
