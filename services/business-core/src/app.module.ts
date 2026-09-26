import { CommercialModule } from "./commercial/commercial.module";
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
import { validateRuntimeConfig } from "./config/runtime-config";
import { CrmPartiesModule } from "./crm/parties/crm-parties.module";
import { CrmSharedModule } from "./crm/shared/crm-shared.module";
import { CrmIntakeModule } from "./crm/intake/crm-intake.module";
import { CrmLeadsModule } from "./crm/leads/crm-leads.module";
import { CrmActivitiesModule } from "./crm/activities/crm-activities.module";
import { CrmConversationsModule } from "./crm/conversations/crm-conversations.module";
import { CrmOpportunitiesModule } from "./crm/opportunities/crm-opportunities.module";
import { CrmTodayModule } from "./crm/today/crm-today.module";
import { CrmReportingModule } from "./crm/reporting/crm-reporting.module";
import { CrmSettingsModule } from "./crm/settings/crm-settings.module";
import { CrmAutomationsModule } from "./crm/automations/crm-automations.module";
import { CrmNotificationsModule } from "./crm/notifications/crm-notifications.module";
import { EventingModule } from "./eventing/eventing.module";
import { PreProjectsModule } from "./pre-projects/pre-projects.module";
import { HrmsModule } from "./hrms/hrms.module";
import { CatalogModule } from "./catalog/catalog.module";
import { SourcingModule } from "./sourcing/sourcing.module";
import { JobsModule } from "./jobs/jobs.module";
import { WorkspaceSearchModule } from "./search/workspace-search.module";
import { AiSuggestionsModule } from "./ai-suggestions/ai-suggestions.module";
import { AiGatewayModule } from "./ai-gateway/ai-gateway.module";
import { DesignModule } from "./design/design.module";
import { QuotationModule } from "./quotation/quotation.module";
import { GalleryModule } from "./gallery/gallery.module";

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
    CrmLeadsModule,
    CrmActivitiesModule,
    CrmConversationsModule,
    CrmOpportunitiesModule,
    CrmTodayModule,
    CrmReportingModule,
    CrmSettingsModule,
    CrmAutomationsModule,
    CrmNotificationsModule,
    EventingModule,
    HealthModule,
    IntegrationsModule,
    ReferenceModule,
    WorkspacesModule,
    PreProjectsModule,
    CommercialModule,
    CatalogModule,
    SourcingModule,
    JobsModule,
    WorkspaceSearchModule,
    AiSuggestionsModule,
    AiGatewayModule,
    DesignModule,
    QuotationModule,
    GalleryModule,
    HrmsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
