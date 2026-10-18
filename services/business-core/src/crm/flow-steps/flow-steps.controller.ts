import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { BookSiteVisitDto, MigrateJobsDto, SkipStepDto, UnskipStepDto } from "./dto";
import { FlowMigrationService } from "./flow-migration.service";
import { SiteVisitBookingService } from "./site-visit-booking.service";
import { StepSkipsService } from "./step-skips.service";

const STEP_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** A job's steps (plan §5a, §7a E2): skip with a reason, the joinery site visit, and moving jobs to new steps. */
@ApiTags("crm-flows")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class FlowStepsController {
  constructor(private readonly skips: StepSkipsService, private readonly migration: FlowMigrationService, private readonly siteVisits: SiteVisitBookingService) {}

  @Post("opportunities/:opportunityId/steps/:stepKey/skip")
  skip(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Param("stepKey") stepKey: string, @Body() input: SkipStepDto) {
    return this.skips.skip(actor, workspaceId, opportunityId, this.key(stepKey), input);
  }

  @Post("opportunities/:opportunityId/steps/:stepKey/unskip")
  unskip(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Param("stepKey") stepKey: string, @Body() input: UnskipStepDto) {
    return this.skips.unskip(actor, workspaceId, opportunityId, this.key(stepKey), input);
  }

  @Get("opportunities/:opportunityId/site-visit")
  siteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.siteVisits.view(actor, workspaceId, opportunityId);
  }

  @Get("opportunities/:opportunityId/site-visit/slots")
  siteVisitSlots(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Query() query: { designerMembershipId?: string; from?: string; to?: string; minutes?: string }) {
    return this.siteVisits.slots(actor, workspaceId, opportunityId, query);
  }

  @Post("opportunities/:opportunityId/site-visit")
  bookSiteVisit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Body() input: BookSiteVisitDto) {
    return this.siteVisits.book(actor, workspaceId, opportunityId, input);
  }

  @Get("flows/:flowId/migration")
  migrationPreview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string) {
    return this.migration.preview(actor, workspaceId, flowId);
  }

  @Post("flows/:flowId/migration")
  migrate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string, @Body() input: MigrateJobsDto) {
    return this.migration.migrate(actor, workspaceId, flowId, input);
  }

  private key(stepKey: string) {
    if (!STEP_KEY.test(stepKey)) throw new BadRequestException("Unknown step");
    return stepKey;
  }
}
