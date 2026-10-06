import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { firmCalendar, loadHostAvailability, lockHostCalendars } from "../../booking/booking-store";
import { addDays, parseDateRange, validTimeZone, wallClock } from "../../booking/booking.domain";
import { DesignJourneyService } from "../../design/design-journey.service";
import { PreProjectsService } from "../../pre-projects/pre-projects.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { flowProgress } from "../flows/flow-interpreter";
import { OpportunityDiscoveryService } from "../opportunities/discovery.service";
import { loadFlowFacts } from "../opportunities/flow-facts";
import { IntroMeetingService } from "../opportunities/intro-meeting.service";
import { jointSlots, SITE_VISIT_MINUTES, siteVisitApplies, visitMinutes } from "./site-visit.domain";

/** No booking type: the visit has its own length and no daily cap (the engine counts per type). */
const NO_TYPE = "00000000-0000-0000-0000-000000000000";

export type BookSiteVisitInput = { designerMembershipId: string; startsAt: string; minutes?: number; timezone: string; address?: string | null; version: number };
type Job = { id: string; status: string; title: string; ownerMembershipId: string | null; ownerName: string | null; designerId: string | null; designerName: string | null };
type Stage = { caseId: string; status: string; version: number; startsAt: Date | null; endsAt: Date | null; location: unknown; completedAt: Date | null; kind: "design" | "site_and_materials" };

/**
 * PLM-080 / PLM-044: the joinery path's site visit. The salesperson (the job's owner, its Account Manager) and a
 * designer measure the walls together, so the visit is booked in time both have free on the booking slot engine,
 * and the Account Manager is invited. The visit itself — the appointment on both calendars, measurements, photos
 * and the question list, and the hand-off to the QS — is the design site visit (src/design): this service opens the
 * job's case and its site visit when needed, then, in one transaction, locks both people's calendars, re-checks the
 * time for both and writes the visit through the design site visit, so a booking for either of them can't slip in between.
 */
@Injectable()
export class SiteVisitBookingService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly discovery: OpportunityDiscoveryService,
    private readonly preProjects: PreProjectsService,
    private readonly journey: DesignJourneyService,
    private readonly intro: IntroMeetingService,
  ) {}

  view(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", (client, user) => this.read(client, workspaceId, opportunityId, user.userId));
  }

  /** Free times for the salesperson and the designer together, in the firm's time zone, between two firm-local dates. */
  slots(actor: RequestActor, workspaceId: string, opportunityId: string, query: { designerMembershipId?: string; from?: string; to?: string; minutes?: string }) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client) => {
      const job = await this.job(client, workspaceId, opportunityId, false);
      const minutes = visitMinutes(query.minutes);
      if (minutes === null) throw new BadRequestException("A visit lasts 30 minutes to 8 hours, in half hours");
      const people = await this.people(client, workspaceId, job, query.designerMembershipId);
      const calendar = await firmCalendar(client, workspaceId);
      const today = wallClock(Date.now(), calendar.timeZone).date;
      const range = parseDateRange(query.from ?? today, query.to ?? addDays(query.from ?? today, 13));
      if (!range) throw new BadRequestException("Choose up to two months of dates");
      const hosts = await loadHostAvailability(client, workspaceId, { calendar, typeId: NO_TYPE, hostIds: people, from: range.from, to: range.to });
      const slots = jointSlots({ calendar, hosts, people, from: range.from, to: range.to, minutes, now: new Date() });
      return { timezone: calendar.timeZone, minutes, slots: slots.map(({ start, end, date }) => ({ start, end, date })) };
    });
  }

  /**
   * Books the visit (idempotent: the same time booked again changes nothing; version-checked against the site visit
   * the person saw). The time is checked for both people up front and again, under lock, in the transaction that
   * writes the visit; a taken time is refused with the next free ones. A job without a dedicated designer gets the
   * chosen designer as its designer (PLM-088).
   */
  async book(actor: RequestActor, workspaceId: string, opportunityId: string, input: BookSiteVisitInput) {
    const minutes = visitMinutes(input.minutes);
    if (minutes === null) throw new BadRequestException("A visit lasts 30 minutes to 8 hours, in half hours");
    const start = new Date(input.startsAt);
    if (Number.isNaN(start.getTime())) throw new BadRequestException("Choose a time");
    if (!validTimeZone(input.timezone)) throw new BadRequestException("Choose a valid time zone");
    const end = new Date(start.getTime() + minutes * 60_000);
    const plan = await this.access.withPermissions(actor, workspaceId, ["crm.opportunities.manage", "crm.activities.manage"], async (client, user) => {
      const job = await this.job(client, workspaceId, opportunityId, true);
      if (job.status !== "open") throw new ConflictException("Reopen the opportunity before booking the site visit");
      const facts = await loadFlowFacts(client, workspaceId, opportunityId, this.discovery, { actorUserId: user.userId });
      if (!siteVisitApplies(facts.flowDefinition.definition)) throw new UnprocessableEntityException("This job's steps have no site visit");
      const people = await this.people(client, workspaceId, job, input.designerMembershipId);
      const stage = await this.stage(client, workspaceId, opportunityId);
      // The same time booked again (a replay): nothing to do.
      if (stage?.startsAt && stage.endsAt && stage.startsAt.getTime() === start.getTime() && stage.endsAt.getTime() === end.getTime()) return { done: true as const };
      if ((stage?.version ?? 0) !== input.version) throw new ConflictException("The site visit changed in another window. Reload and try again.");
      if (stage?.completedAt) throw new ConflictException("The site visit is already recorded");
      if (stage && stage.kind === "design" && stage.status !== "active") throw new ConflictException("The site visit is one of the design stages. Book it from the case when it starts.");
      await this.assertFree(client, workspaceId, people, start, minutes);
      return { done: false as const, needsDesigner: !job.designerId, caseId: stage?.caseId ?? await this.caseOf(client, workspaceId, opportunityId), people };
    });
    let caseId: string | null = null;
    if (!plan.done) {
      // PLM-088: the chosen designer becomes the job's designer, so the design site visit invites them.
      if (plan.needsDesigner) await this.intro.changeDesigner(actor, workspaceId, opportunityId, { membershipId: input.designerMembershipId, reason: "Joinery site visit", version: 0 });
      caseId = plan.caseId ?? String((await this.preProjects.start(actor, workspaceId, opportunityId) as { id: string }).id);
      await this.journey.start(actor, workspaceId, caseId).catch((error: unknown) => { if (!(error instanceof ConflictException)) throw error; });
    }
    // One transaction: lock both people's calendars, re-check the time for both, write the visit and its audit.
    return this.access.withPermissions(actor, workspaceId, ["crm.opportunities.manage", "crm.activities.manage", "pre_projects.view", "pre_projects.edit"], async (client, user) => {
      if (caseId) {
        await this.job(client, workspaceId, opportunityId, true);
        await lockHostCalendars(client, workspaceId, plan.people ?? []);
        const stage = await this.stage(client, workspaceId, opportunityId);
        const replay = stage?.startsAt && stage.endsAt && stage.startsAt.getTime() === start.getTime() && stage.endsAt.getTime() === end.getTime();
        if (!replay) {
          if (!stage || stage.status !== "active") throw new ConflictException("The site visit is one of the design stages. Book it from the case when it starts.");
          await this.assertFree(client, workspaceId, plan.people ?? [], start, minutes);
          await this.journey.scheduleSiteVisitIn(client, workspaceId, caseId, { startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: input.timezone, address: input.address ?? null, version: stage.version }, user.userId);
          await recordAudit(client, {
            workspaceId, actorUserId: user.userId, action: "crm.opportunity.site_visit_booked.v1", entityType: "crm_opportunity", entityId: opportunityId,
            after: { caseId, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: input.timezone, measuredBy: plan.people, invited: "account_manager" },
          });
        }
      }
      return this.read(client, workspaceId, opportunityId, user.userId);
    });
  }

  /** Refuses a start that isn't a free slot for both people now, offering the next free ones. */
  private async assertFree(client: PoolClient, workspaceId: string, people: string[], start: Date, minutes: number) {
    const calendar = await firmCalendar(client, workspaceId);
    const date = wallClock(start.getTime(), calendar.timeZone).date;
    const hosts = await loadHostAvailability(client, workspaceId, { calendar, typeId: NO_TYPE, hostIds: people, from: date, to: addDays(date, 14) });
    const free = jointSlots({ calendar, hosts, people, from: date, to: addDays(date, 14), minutes, now: new Date() });
    if (!free.some((slot) => Date.parse(slot.start) === start.getTime()))
      throw new ConflictException({ statusCode: 409, error: "Conflict", message: "That time isn't free for both of them any more. Choose another time.",
        next: free.filter((slot) => Date.parse(slot.start) > start.getTime()).slice(0, 3).map(({ start: from, end: to }) => ({ start: from, end: to })) });
  }

  private async read(client: PoolClient, workspaceId: string, opportunityId: string, userId: string) {
    const job = await this.job(client, workspaceId, opportunityId, false);
    const facts = await loadFlowFacts(client, workspaceId, opportunityId, this.discovery, { actorUserId: userId });
    const definition = facts.flowDefinition.definition;
    const step = flowProgress(definition, facts).line.find((item) => item.check === "site_visit_recorded") ?? null;
    const stage = await this.stage(client, workspaceId, opportunityId);
    const measurements = stage ? Number((await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pre_project_site_records WHERE workspace_id = $1 AND case_id = $2 AND kind = 'measurement'`, [workspaceId, stage.caseId])).rows[0]?.count ?? 0) : 0;
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    return {
      applies: siteVisitApplies(definition),
      step: step ? { key: step.key, name: step.name, state: step.state } : null,
      salesperson: job.ownerMembershipId ? { membershipId: job.ownerMembershipId, name: job.ownerName } : null,
      designer: job.designerId ? { membershipId: job.designerId, name: job.designerName } : null,
      caseId: stage?.caseId ?? await this.caseOf(client, workspaceId, opportunityId),
      visit: stage ? { status: stage.status, version: stage.version, startsAt: stage.startsAt, endsAt: stage.endsAt, location: stage.location, completedAt: stage.completedAt, kind: stage.kind, measurements } : null,
      version: stage?.version ?? 0,
      timezone, minutes: SITE_VISIT_MINUTES.default,
    };
  }

  /** The salesperson (the job's owner) and the designer, both active members; a dedicated designer is the one who goes. */
  private async people(client: PoolClient, workspaceId: string, job: Job, designerId: string | undefined) {
    if (!job.ownerMembershipId) throw new UnprocessableEntityException("Assign a sales owner first");
    if (!designerId) throw new BadRequestException("Choose the designer");
    if (job.designerId && job.designerId !== designerId) throw new UnprocessableEntityException(`The site visit is with the dedicated designer, ${job.designerName ?? ""}. Change the designer first.`.replace(", .", "."));
    if (designerId === job.ownerMembershipId) throw new UnprocessableEntityException("Choose a designer other than the salesperson");
    const active = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, designerId]);
    if (!active.rowCount) throw new UnprocessableEntityException("Choose an active team member as the designer");
    return [job.ownerMembershipId, designerId];
  }

  private async job(client: PoolClient, workspaceId: string, opportunityId: string, lock: boolean): Promise<Job> {
    const row = (await client.query<Job>(
      `SELECT job.id, job.status::text AS status, job.title, job.owner_membership_id AS "ownerMembershipId", owner.display_name AS "ownerName",
              designer.membership_id AS "designerId", designer_user.display_name AS "designerName"
         FROM crm_opportunities job
         LEFT JOIN workspace_memberships owner_member ON owner_member.id = job.owner_membership_id LEFT JOIN users owner ON owner.id = owner_member.user_id
         LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = job.workspace_id AND designer.opportunity_id = job.id
         LEFT JOIN workspace_memberships designer_member ON designer_member.id = designer.membership_id LEFT JOIN users designer_user ON designer_user.id = designer_member.user_id
        WHERE job.workspace_id = $1 AND job.id = $2${lock ? " FOR UPDATE OF job" : ""}`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }

  private async caseOf(client: PoolClient, workspaceId: string, opportunityId: string) {
    return (await client.query<{ id: string }>(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId])).rows[0]?.id ?? null;
  }

  /** The job's site visit on its case (read only: the design site visit owns it). */
  private async stage(client: PoolClient, workspaceId: string, opportunityId: string): Promise<Stage | null> {
    return (await client.query<Stage>(
      `SELECT pre_case.id AS "caseId", stage.status, stage.version, appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt", appointment.location,
              stage.completed_at AS "completedAt", CASE WHEN journey.package_id IS NOT NULL OR journey.package_name IS NOT NULL THEN 'design' ELSE 'site_and_materials' END AS kind
         FROM pre_project_cases pre_case
         JOIN design_journeys journey ON journey.workspace_id = pre_case.workspace_id AND journey.case_id = pre_case.id
         JOIN design_journey_stages stage ON stage.workspace_id = pre_case.workspace_id AND stage.case_id = pre_case.id AND stage.stage = 'site_visit'
         LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.opportunity_id = $2`, [workspaceId, opportunityId])).rows[0] ?? null;
  }
}
