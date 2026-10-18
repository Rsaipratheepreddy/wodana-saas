import { Module } from "@nestjs/common";
import { DesignJourneyService } from "../../design/design-journey.service";
import { PreProjectsService } from "../../pre-projects/pre-projects.service";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmOpportunitiesModule } from "../opportunities/crm-opportunities.module";
import { IntroMeetingService } from "../opportunities/intro-meeting.service";
import { FlowMigrationService } from "./flow-migration.service";
import { FlowStepsController } from "./flow-steps.controller";
import { SiteVisitBookingService } from "./site-visit-booking.service";
import { StepSkipsService } from "./step-skips.service";

/**
 * A job's steps (plan §5a, §6.9a; §7a E2-1…E2-5; PLM-044/080/081). The design site visit, the case and the dedicated
 * designer are called through their own services as they are (provided here, not changed).
 */
@Module({
  imports: [WorkspacesModule, CrmOpportunitiesModule],
  controllers: [FlowStepsController],
  providers: [StepSkipsService, FlowMigrationService, SiteVisitBookingService, DesignJourneyService, PreProjectsService, IntroMeetingService],
})
export class FlowStepsModule {}
