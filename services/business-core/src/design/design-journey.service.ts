import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { loadTypeById, recheckSlot, slotsFor } from "../booking/booking-store";
import { addDays as addCalendarDays, isDate } from "../booking/booking.domain";
import { assertMemberFree } from "../crm/shared/calendar-clash";
import { workspaceHours } from "../crm/conversations/inbox/auto-replies";
import { endOfWorkingDay } from "../team-calendars/workspace-clock";
import { checkIntroSlot, meetingLocation, meetingWhen } from "../crm/opportunities/intro-meeting.domain";
import { confirmAppointment } from "../crm/conversations/inbox/client-followups";
import { setDedicatedDesigner } from "../crm/opportunities/dedicated-designer";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { markNotApplicable, notApplicableRoles } from "../project-core/project-team";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  APPROVAL_METHODS, approvalProblem, isCalendarDay, isCheckStatus, kickoffProblem, MATERIAL_STAGES, normaliseSiteQuestions, renderSignOffProblem,
  samplesProblem, scopeKey, siteChecklistProblem, siteEvidenceProblem, STAGE_LABELS, stageRevisions, TASK_LABELS, type CheckStatus, type JourneyStage, type JourneyTask,
} from "./design-journey.domain";
import { jobPending, readJobChecklist } from "./design-checklists";
import {
  caseFacts, caseRoleHolder, completeStage, completeTask, designTeamConfig, dueText, event, formatDay, formatDue, holdsRole, journeyTimings, leadDesigner, membersWithRole,
  readTasks, recordProjectSiteVisit, roleLabels, salesAdminMembership, startJourney, tellMembers, tellRenderTag, workspaceToday,
} from "./design-journey.store";
import { allocationMissing, DESIGNER_SLOTS, designerPairProblem, settableSlots, TEAM_SLOTS, type DesignTeamConfig, type TeamSlot } from "./design-team.domain";
import { lockLedger, readLedger } from "./design-ledger.store";
import { startClientCalls } from "../client-calls/client-calls.store";
import { presentedRounds } from "./design-presentations.store";
import { completeConceptIfReady, isDeliverableStage, stageProgress, syncDesignStages } from "./design-stage-sync";
import { casePlan } from "../pre-projects/case-plan";

/** `atClientHome`: a sample meeting at the client's home instead of the showroom (no showroom slot, an address instead). */
export type ScheduleInput = { startsAt: string; endsAt?: string | null; timezone: string; address?: string | null; version: number; atClientHome?: boolean | null };
type AppointmentStage = "site_visit" | "material_selection" | "kickoff" | "samples";
const APPOINTMENT_CODE: Record<AppointmentStage, string> = {
  site_visit: "design.site_visit_booked", material_selection: "design.material_selection_booked", kickoff: "design.kickoff_booked", samples: "design.sample_meeting_booked",
};
const APPOINTMENT_TITLE: Record<AppointmentStage, string> = {
  site_visit: "Site visit: measurements, photos and the question list", material_selection: "Material selection appointment", kickoff: "Kick-off meeting", samples: "Sample meeting",
};
const NOT_REQUIRED = "Not required for this order";

/**
 * The commercial API the estimate hand-off calls, as it is (PLM-053): read the case's commercial revision and run
 * its "create" command. Provided by the design module from CommercialService; the design flow never edits quotes.
 */
export const DESIGN_COMMERCIAL_API = "DESIGN_COMMERCIAL_API";
export type DesignCommercialApi = {
  load(client: PoolClient, workspaceId: string, caseId: string): Promise<{ revision: number }>;
  command(actor: RequestActor, workspaceId: string, caseId: string, input: unknown): Promise<unknown>;
};

export type SignOffInput = { version: number; note?: string | null; approvedOn?: string | null; assetId?: string | null; signer?: string | null; method?: string | null };
export type TeamInput = { roles: Array<{ slot: string; membershipId?: string | null; notApplicable?: boolean | null }>; reason?: string | null; version: number };

/** Where the site visit stands: the old order's stage, or the current order's site measure inside the concept (PLM-141). */
type SiteVisitTarget = { kind: "stage" | "task"; activityId: string | null; owner: string | null };

/**
 * PLM-047–053, 080/081, 128 and the order of 13 Oct 2026 (PLM-140–145, 151, 154): the design journey on a case —
 * inspiration, the design team allocated once the fee is paid, the kick-off meeting, the concept with the design site
 * measure inside it (measurements, photos and the firm's question list grouped by scope), renders and their client
 * sign-off, samples (collection, the sample meeting, the material list with outsourced materials signed off) and the
 * design approval that hands off to the estimate. Journeys started in the old order keep their stages.
 */
@Injectable()
export class DesignJourneyService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() @Inject(DESIGN_COMMERCIAL_API) private readonly commercial?: DesignCommercialApi) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      const view = await this.view(client, workspaceId, caseId, user.userId);
      const rights = await this.rights(client, workspaceId, user.userId);
      // A case whose path has no site visit and no design (stock or supplier goods, PLM-121/126) has nothing to start.
      return { ...view, ...rights, canStart: rights.canStart && Boolean(view.journey || view.startsAs) };
    });
  }

  start(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.manage_lifecycle"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      const plan = await casePlan(client, workspaceId, caseId);
      if (!plan.siteVisit && !plan.design) throw new UnprocessableEntityException("This order goes straight to the quotation: its path has no site visit or design stages");
      if (!(await startJourney(client, workspaceId, caseId, user.userId))) throw new ConflictException("The design stages have already started");
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  /** The client or the designer can end the inspiration week early (PLM-047). */
  closeInspiration(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const stage = await this.activeStage(client, workspaceId, caseId, "inspiration", input.version);
      await completeStage(client, workspaceId, caseId, stage, userId, input.note?.trim() || null, "closed_early");
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-151: the design team of this job, slot by slot (the lead and junior designers and the Sales Admin once the fee
   * is paid; the Visualiser and the Draftsman for the renders; the Material Coordinator for samples). Each slot is set by
   * its own people (the Account Manager; the reviewer chooses the lead on a reviewed package; the lead designer tags the
   * Visualiser; the technical lead tags the Draftsman). Changing an allocated designer needs a reason, kept in the
   * history. The allocation step is done once every slot it asks for is settled.
   */
  setTeam(actor: RequestActor, workspaceId: string, caseId: string, input: TeamInput) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      const journey = (await client.query<{ version: number; reviewRole: string | null }>(
        `SELECT version, reviewer_role_code AS "reviewRole" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2 FOR UPDATE`, [workspaceId, caseId])).rows[0];
      if (!journey) throw new ConflictException("Start the design stages first");
      if (journey.version !== input.version) throw new ConflictException("The design team changed in another window. Reload and try again.");
      if (!input.roles?.length) throw new BadRequestException("Choose who is on the team.");
      const config = await designTeamConfig(client, workspaceId);
      const allowed = await this.settable(client, workspaceId, caseId, user.userId, config, journey.reviewRole);
      const labels = await roleLabels(client, workspaceId);
      const reason = input.reason?.replace(/\s+/g, " ").trim() || null;
      if (reason && reason.length > 500) throw new UnprocessableEntityException("Keep the reason under 500 characters");
      const facts = await caseFacts(client, workspaceId, caseId);
      const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      const notApplicable = new Set(await notApplicableRoles(client, workspaceId, { caseId }));
      // PLM-151: the lead and the junior designer are two people, as they will be once this change is saved.
      const designerAfter = async (slot: TeamSlot) => {
        const entry = input.roles.find((role) => role.slot === slot);
        return entry ? entry.membershipId?.trim() || null : caseRoleHolder(client, workspaceId, caseId, config[slot]);
      };
      const slotLabel = (slot: TeamSlot) => (config[slot] ? labels.get(config[slot]!) ?? config[slot]!.replace(/_/g, " ") : slot.replace(/_/g, " "));
      // Only a change to either designer is checked (a team that already had one person in both still saves its other parts).
      const pair = config.lead_designer && config.junior_designer && input.roles.some((role) => DESIGNER_SLOTS.includes(role.slot as TeamSlot))
        ? designerPairProblem(await designerAfter("lead_designer"), await designerAfter("junior_designer"), { lead: slotLabel("lead_designer"), junior: slotLabel("junior_designer") }) : null;
      if (pair) throw new UnprocessableEntityException(pair);
      const changes: Array<{ slot: TeamSlot; role: string; from: string | null; to: string | null; notApplicable: boolean }> = [];
      for (const entry of input.roles) {
        if (!(TEAM_SLOTS as readonly string[]).includes(entry.slot)) throw new BadRequestException("Choose a part of the design team.");
        const slot = entry.slot as TeamSlot;
        const role = config[slot];
        if (!role) throw new UnprocessableEntityException("This workspace doesn't use that part of the design team");
        const label = labels.get(role) ?? role.replace(/_/g, " ");
        if (!allowed.includes(slot)) throw new ForbiddenException(`You can't set the ${label} on this job`);
        const membershipId = entry.membershipId?.trim() || null;
        const marked = Boolean(entry.notApplicable) && !membershipId;
        if (slot === "lead_designer" && !membershipId) throw new UnprocessableEntityException(`Choose the ${label}`);
        if (membershipId && !(await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId])).rowCount)
          throw new UnprocessableEntityException(`Choose an active team member as the ${label}`);
        const current = await caseRoleHolder(client, workspaceId, caseId, role);
        if (current === membershipId && marked === notApplicable.has(role)) continue;
        // PLM-151: changing who holds an allocated designer slot needs a reason (the history keeps it).
        if (DESIGNER_SLOTS.includes(slot) && current && current !== membershipId && !reason) throw new UnprocessableEntityException("Give a reason for changing the designer");
        await this.setCaseRole(client, workspaceId, caseId, role, membershipId);
        await markNotApplicable(client, workspaceId, { caseId }, role, marked, user.userId);
        changes.push({ slot, role, from: current, to: membershipId, notApplicable: marked });
        if (slot === "lead_designer" && membershipId && facts) {
          await setDedicatedDesigner(client, workspaceId, facts.opportunityId, membershipId, reason ?? "Allocated as the lead designer", user.userId);
          await this.followLead(client, workspaceId, caseId, current, membershipId);
        }
        const names = await this.names(client, workspaceId, [current, membershipId]);
        const line = marked ? `${label}: not needed on this job` : `${label}: ${names.get(membershipId!) ?? ""}${current ? ` (was ${names.get(current) ?? ""})` : ""}`;
        await event(client, workspaceId, caseId, "team", current ? "team_changed" : "team_allocated", reason ? `${line}. ${reason}` : line, user.userId);
        if (membershipId && facts) {
          // Someone tagged on renders already running hears about the renders (with their sign-off date); everyone else that they're on the team.
          const rendering = (slot === "visualiser" || slot === "draftsman") && (await client.query(
            `SELECT 1 FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'renders' AND status = 'active'`, [workspaceId, caseId])).rowCount;
          if (rendering) await tellRenderTag(client, workspaceId, caseId, membershipId, label, user.userId);
          else await tellMembers(client, workspaceId, [membershipId], "design.team_allocated", { clientName: facts.clientName, role: label, actor: actorName, note: reason ?? "" },
            `/workspace/pre-projects/cases/${caseId}/overview`, `design:${caseId}:team:${role}:${membershipId}:${journey.version}`, true, user.userId);
        }
      }
      if (!changes.length) return this.view(client, workspaceId, caseId, user.userId);
      await client.query(`UPDATE design_journeys SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.team_set.v1", entityType: "pre_project_case", entityId: caseId,
        after: { changes, reason } });
      const settled = new Map<string, { membershipId: string | null; notApplicable: boolean }>();
      for (const slot of TEAM_SLOTS) {
        const role = config[slot];
        if (!role) continue;
        const holder = await caseRoleHolder(client, workspaceId, caseId, role);
        const na = (await notApplicableRoles(client, workspaceId, { caseId })).includes(role);
        if (holder || na) settled.set(role, { membershipId: holder, notApplicable: !holder && na });
      }
      if (!allocationMissing(config, settled).length) await completeTask(client, workspaceId, caseId, "team_allocation", user.userId, null);
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  /** PLM-044/048/080: the designer (or Sales) books the visit; the designer and the Account Manager are both invited. */
  scheduleSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleInput) {
    return this.scheduleAppointment(actor, workspaceId, caseId, "site_visit", input);
  }

  /**
   * PLM-050: the showroom appointment, booked by the designer or by Sales inviting the design team. With a showroom
   * booking type in Settings › Design, the time must be a free slot of the firm's booking engine (same hours, leave,
   * buffers and calendars as the public booking pages) and its length and place come from the type. In the current order
   * this books the sample meeting (PLM-144), at the showroom or at the client's home.
   */
  scheduleMaterialSelection(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleInput) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) =>
      this.writeAppointment(client, workspaceId, caseId, await this.materialStage(client, workspaceId, caseId), input, userId));
  }

  /** PLM-140: the kick-off meeting with the client and the allocated designer, booked in the design calendar. */
  scheduleKickoff(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleInput) {
    return this.scheduleAppointment(actor, workspaceId, caseId, "kickoff", input);
  }

  /**
   * PLM-140: the kick-off is done once its meeting has taken place; the render sign-off date agreed with the client there
   * is recorded with it (when the package has renders) and becomes the renders' client-facing date. The concept and the
   * design site measure count from the meeting.
   */
  completeKickoff(actor: RequestActor, workspaceId: string, caseId: string, input: { renderSignoffOn?: string | null; note?: string | null; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "kickoff", input.version);
      const timings = await journeyTimings(client, workspaceId, caseId);
      const scheduled = (await client.query<{ at: Date | null }>(
        `SELECT appointment.starts_at AS at FROM design_journey_stages stage LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
          WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = 'kickoff'`, [workspaceId, caseId])).rows[0]?.at ?? null;
      const problem = kickoffProblem({ scheduledAt: scheduled ? new Date(scheduled) : null, now: new Date(), includesRenders: timings.includesRenders, renderSignoffOn: input.renderSignoffOn ?? null,
        today: await workspaceToday(client, workspaceId) });
      if (problem) throw new UnprocessableEntityException(problem);
      const renderOn = timings.includesRenders ? input.renderSignoffOn! : null;
      await client.query(`UPDATE design_journeys SET render_signoff_due_on = $3, version = version + 1 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, renderOn]);
      const note = [renderOn ? `Render sign-off agreed for ${formatDay(renderOn, "en")}` : null, input.note?.trim() || null].filter(Boolean).join(". ") || null;
      await completeStage(client, workspaceId, caseId, "kickoff", userId, note, "held");
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.kickoff_held.v1", entityType: "pre_project_case", entityId: caseId, after: { renderSignoffOn: renderOn, note: input.note?.trim() || null } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-142/143: the lead designer sets the concept's or the renders' internal deadline for this job (render time is set
   * per project, by its scope). A day from today on, in the firm's time zone; the deadline is the end of that day.
   */
  setDeadline(actor: RequestActor, workspaceId: string, caseId: string, stage: string, input: { dueOn: string; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (stage !== "concepts" && stage !== "renders") throw new BadRequestException("Only the concept's and the renders' deadlines are set per job.");
      if (!isCalendarDay(input.dueOn)) throw new BadRequestException("Choose a day.");
      if (input.dueOn < await workspaceToday(client, workspaceId)) throw new UnprocessableEntityException("Choose today or a later day");
      await this.activeStage(client, workspaceId, caseId, stage, input.version);
      const before = (await client.query<{ dueAt: Date | null; activityId: string | null }>(`SELECT due_at AS "dueAt", activity_id AS "activityId" FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`,
        [workspaceId, caseId, stage])).rows[0];
      // Due at the end of that working day (the firm's hours, in its time zone), as the steps' own deadlines are.
      const dueAt = endOfWorkingDay(input.dueOn, await workspaceHours(client, workspaceId));
      const due = (await client.query<{ dueAt: Date }>(
        `UPDATE design_journey_stages SET due_at = $3, overdue_notified_at = NULL, version = version + 1
          WHERE workspace_id = $1 AND case_id = $2 AND stage = $4 RETURNING due_at AS "dueAt"`,
        [workspaceId, caseId, dueAt, stage])).rows[0];
      if (before?.activityId) await client.query(`UPDATE crm_activities SET due_at = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, before.activityId, due.dueAt]);
      await event(client, workspaceId, caseId, stage, "deadline_set", `Due ${formatDay(input.dueOn, "en")}`, userId);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.deadline_set.v1", entityType: "pre_project_case", entityId: caseId,
        before: { stage, dueAt: before?.dueAt ?? null }, after: { stage, dueOn: input.dueOn } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-143: the client's render sign-off (the day they signed, who signed and the signed file) ends the renders; samples
   * start only after it. The Account Manager, the lead designer and whoever collects the samples are told.
   */
  recordRenderSignOff(actor: RequestActor, workspaceId: string, caseId: string, input: { signedOn: string; assetId: string; signer: string; note?: string | null; version: number }) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.record_client_design_decisions"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      await this.activeStage(client, workspaceId, caseId, "renders", input.version);
      if ((await journeyTimings(client, workspaceId, caseId)).flowVersion !== 2) throw new ConflictException("The renders of this job end when their files are approved");
      const invalid = renderSignOffProblem(input, await workspaceToday(client, workspaceId));
      if (invalid) throw new UnprocessableEntityException(invalid);
      if (!(await client.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, input.assetId])).rowCount)
        throw new UnprocessableEntityException("Attach the client's render sign-off");
      const signer = input.signer.trim();
      await client.query(
        `UPDATE design_journeys SET render_signed_on = $3, render_signoff_asset_id = $4, render_signoff_signer = $5, render_signoff_recorded_by = $6, render_signoff_recorded_at = now(), version = version + 1
          WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, input.signedOn, input.assetId, signer, user.userId]);
      await completeStage(client, workspaceId, caseId, "renders", user.userId, input.note?.trim() || `Signed ${formatDay(input.signedOn, "en")} by ${signer}`, "render_signed_off");
      const facts = await caseFacts(client, workspaceId, caseId);
      if (facts) await tellMembers(client, workspaceId, [facts.accountManagerId, await leadDesigner(client, workspaceId, caseId)], "design.render_signed_off",
        { clientName: facts.clientName, signedOn: formatDay(input.signedOn, (await this.locale(client, workspaceId))), signer }, `/workspace/pre-projects/cases/${caseId}/overview`,
        `design:${caseId}:renders:signed`, false, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.renders_signed_off.v1", entityType: "pre_project_case", entityId: caseId,
        after: { signedOn: input.signedOn, signer, assetId: input.assetId } });
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  /**
   * PLM-144: the Material Coordinator records the samples collected (who and when); the lead designer then books the
   * sample meeting. The person collecting them, or anyone who edits the case, records it.
   */
  completeSampleCollection(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null; version: number }) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      const task = (await client.query<{ status: string; version: number; owner: string | null }>(
        `SELECT status, version, owner_membership_id AS owner FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'sample_collection' FOR UPDATE`, [workspaceId, caseId])).rows[0];
      if (!task) throw new ConflictException("Samples haven't started on this job");
      if (task.version !== input.version) throw new ConflictException("The samples changed in another window. Reload and try again.");
      if (task.status === "done") throw new ConflictException("The samples are already collected");
      const membership = await this.membership(client, workspaceId, user.userId);
      if (task.owner !== membership && !(await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit")))
        throw new ForbiddenException("The person collecting the samples records them");
      const note = input.note?.trim().slice(0, 2000) || null;
      await completeTask(client, workspaceId, caseId, "sample_collection", user.userId, note);
      const facts = await caseFacts(client, workspaceId, caseId);
      if (facts) await tellMembers(client, workspaceId, [await leadDesigner(client, workspaceId, caseId)], "design.samples_collected", { clientName: facts.clientName, note: note ?? "" },
        `/workspace/pre-projects/cases/${caseId}/overview`, `design:${caseId}:samples:collected`, false, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.samples_collected.v1", entityType: "pre_project_case", entityId: caseId, after: { note } });
      return this.view(client, workspaceId, caseId, user.userId);
    });
  }

  /**
   * PLM-144: samples are approved once collected, the sample meeting has taken place, the client confirmed every material
   * and every outsourced one is signed off. This is the "samples approved" fact the later steps read.
   */
  approveSamples(actor: RequestActor, workspaceId: string, caseId: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "samples", input.version);
      const collected = (await client.query(`SELECT 1 FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'sample_collection' AND status = 'done'`, [workspaceId, caseId])).rowCount;
      const meeting = (await client.query<{ at: Date | null }>(
        `SELECT appointment.starts_at AS at FROM design_journey_stages stage LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
          WHERE stage.workspace_id = $1 AND stage.case_id = $2 AND stage.stage = 'samples'`, [workspaceId, caseId])).rows[0]?.at ?? null;
      const ledger = await readLedger(client, workspaceId, caseId);
      const materials = ledger.entries.filter((entry) => !entry.archivedAt && entry.kind === "material");
      const problem = samplesProblem({ collected: Boolean(collected), meetingAt: meeting ? new Date(meeting) : null, now: new Date(), materials: materials.length,
        waiting: materials.filter((entry) => entry.current?.status !== "confirmed").map((entry) => entry.title),
        outsourcedWaiting: materials.filter((entry) => entry.current?.outsourced && entry.current.signOff !== "approved").map((entry) => entry.title) });
      if (problem) throw new UnprocessableEntityException(problem);
      await completeStage(client, workspaceId, caseId, "samples", userId, `${materials.length} materials confirmed`, "samples_approved");
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.samples_approved.v1", entityType: "pre_project_case", entityId: caseId, after: { materials: materials.length } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** The free showroom slots for the stage's owner between two firm-local dates (the booking slot engine). */
  materialSlots(actor: RequestActor, workspaceId: string, caseId: string, query: { from?: string; to?: string }) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      const type = await this.showroomType(client, workspaceId);
      if (!type) return { configured: false as const, slots: [], timezone: null, durationMinutes: null, location: null };
      const owner = await this.stageOwner(client, workspaceId, caseId, await this.materialStage(client, workspaceId, caseId, false));
      const today = await workspaceToday(client, workspaceId);
      const from = isDate(query.from) ? query.from : today;
      const to = isDate(query.to) && query.to >= from && query.to <= addCalendarDays(from, 31) ? query.to : addCalendarDays(from, 13);
      const { calendar, slots } = await slotsFor(client, workspaceId, type, { from, to, hostIds: owner ? [owner] : undefined, staff: true });
      return { configured: true as const, slots: slots.map((slot) => ({ start: slot.start, end: slot.end, date: slot.date })), timezone: calendar.timeZone,
        durationMinutes: type.durationMinutes, location: type.locationDetail };
    });
  }

  /**
   * PLM-080: the site visit written in the caller's transaction, for a caller that has already checked the
   * permissions (pre_projects.view and pre_projects.edit) and re-checked the people's calendars under lock there.
   */
  async scheduleSiteVisitIn(client: PoolClient, workspaceId: string, caseId: string, input: ScheduleInput, userId: string) {
    await this.lockCase(client, workspaceId, caseId);
    return this.writeAppointment(client, workspaceId, caseId, "site_visit", input, userId);
  }

  private scheduleAppointment(actor: RequestActor, workspaceId: string, caseId: string, stageName: AppointmentStage, input: ScheduleInput) {
    return this.edit(actor, workspaceId, caseId, (client, userId) => this.writeAppointment(client, workspaceId, caseId, stageName, input, userId));
  }

  private async writeAppointment(client: PoolClient, workspaceId: string, caseId: string, stageName: AppointmentStage, input: ScheduleInput, userId: string) {
    const target = stageName === "site_visit" ? await this.siteVisitTarget(client, workspaceId, caseId, input.version) : await this.stageTarget(client, workspaceId, caseId, stageName, input.version);
    const facts = await caseFacts(client, workspaceId, caseId);
    if (stageName === "kickoff" && !(await caseRoleHolder(client, workspaceId, caseId, (await designTeamConfig(client, workspaceId)).lead_designer)))
      throw new UnprocessableEntityException("Allocate the lead designer first");
    if (!facts || !target.activityId || !target.owner) throw new UnprocessableEntityException("Choose the dedicated designer on the opportunity first");
    let endsAt = input.endsAt ?? null;
    let address = input.address ?? null;
    const type = MATERIAL_STAGES.includes(stageName) && !input.atClientHome ? await this.showroomType(client, workspaceId) : null;
    if (input.atClientHome && !address?.trim()) throw new UnprocessableEntityException("Enter the client's address");
    if (type) {
      // The firm's booking engine decides: a slot free for the designer now, with the type's length and showroom.
      const start = new Date(input.startsAt);
      if (Number.isNaN(start.getTime())) throw new BadRequestException("Choose a time.");
      const { slot } = await recheckSlot(client, workspaceId, type, start, { hostIds: [target.owner] });
      if (!slot) throw new ConflictException("That time isn't free any more. Choose another slot.");
      endsAt = slot.end;
      address = address?.trim() || type.locationDetail;
    }
    if (!endsAt) throw new BadRequestException("Choose how long the appointment is.");
    const problem = checkIntroSlot({ startsAt: input.startsAt, endsAt, timezone: input.timezone, mode: "in_person" });
    if (problem) throw new UnprocessableEntityException(problem);
    if (!type) await assertMemberFree(client, workspaceId, target.owner, input.startsAt, endsAt, "The designer", target.activityId);
    const config = await designTeamConfig(client, workspaceId);
    // The junior designer joins the kick-off, the site measure and the sample meeting; whoever collected the samples joins that meeting.
    const collector = stageName === "samples" ? (await client.query<{ owner: string | null }>(
      `SELECT owner_membership_id AS owner FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'sample_collection'`, [workspaceId, caseId])).rows[0]?.owner ?? null : null;
    const extra = stageName === "kickoff" || stageName === "samples" || target.kind === "task"
      ? [await caseRoleHolder(client, workspaceId, caseId, config.junior_designer), collector] : [];
    const attendees = [...new Set([target.owner, facts.designerId, facts.accountManagerId, ...extra].filter((id): id is string => Boolean(id)))];
    const location = meetingLocation("in_person", address);
    await client.query(
      `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workspace_id, activity_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
         location = excluded.location, attendee_membership_ids = excluded.attendee_membership_ids, version = crm_appointments.version + 1`,
      [workspaceId, target.activityId, input.startsAt, endsAt, input.timezone, location, JSON.stringify([facts.partyId]), JSON.stringify(attendees)]);
    await client.query(`UPDATE crm_activities SET type = 'meeting', title = $3, due_at = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, target.activityId, target.kind === "task" ? "Design site measure: measurements, photos and the question list" : APPOINTMENT_TITLE[stageName], input.startsAt]);
    // The booking stops the daily "book it" reminder (PLM-050, PLM-144).
    if (target.kind === "stage") await client.query(`UPDATE design_journey_stages SET booking_reminder_at = NULL, version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stageName]);
    else await client.query(`UPDATE design_journey_tasks SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure'`, [workspaceId, caseId]);
    // The client gets the appointment's confirmation on WhatsApp, with its address (when the firm has it on).
    await confirmAppointment(client, workspaceId, target.activityId, { actorUserId: userId });
    await event(client, workspaceId, caseId, target.kind === "task" ? "concepts" : stageName, target.kind === "task" ? "site_measure_scheduled" : "scheduled", null, userId);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: `design.${stageName}_scheduled.v1`, entityType: "pre_project_case", entityId: caseId,
      after: { startsAt: input.startsAt, endsAt, timezone: input.timezone, attendees, bookingTypeId: type?.id ?? null, atClientHome: Boolean(input.atClientHome) } });

    const locale = await this.locale(client, workspaceId);
    const bookedBy = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
    const variables = { clientName: facts.clientName, when: meetingWhen(input.startsAt, endsAt, input.timezone, locale), place: location.address ?? (stageName === "site_visit" ? "Site" : "Showroom"), bookedBy };
    const recipients = (await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, attendees])).rows;
    const at = Date.parse(input.startsAt);
    for (const recipient of recipients) {
      if (recipient.userId === userId) continue;
      const key = `design:${caseId}:${stageName}:${at}:${recipient.userId}`;
      const deepLink = `/workspace/pre-projects/cases/${caseId}/overview`;
      const eventType = APPOINTMENT_CODE[stageName].replace(/_booked$/, ".booked");
      await notifyUserInApp(client, { workspaceId, recipientUserId: recipient.userId, code: APPOINTMENT_CODE[stageName], eventType, variables, deepLink, idempotencyKey: key });
      await queueUserEmail(client, { workspaceId, recipientUserId: recipient.userId, code: APPOINTMENT_CODE[stageName], eventType, variables, deepLink, idempotencyKey: `${key}:email` });
    }
    return this.view(client, workspaceId, caseId, userId);
  }

  /**
   * PLM-128/154: the designer's answers to the site visit question list; each answer keeps who gave it and when. The list
   * is used at the kick-off meeting too (PLM-154): while the kick-off is the current step, its answers are recorded
   * against it (the kick-off's version), and the site measure carries on from them.
   */
  answerSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: { answers: Array<{ key: string; answer?: string | null; status?: CheckStatus | null }>; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const questions = normaliseSiteQuestions((await client.query<{ questions: unknown }>(
        `SELECT site_visit_questions AS questions FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.questions);
      const asked = input.answers.map((item) => {
        const question = questions.find((entry) => entry.key === item.key);
        if (!question) throw new UnprocessableEntityException("That question is not on this visit's list");
        if (question.kind !== "check" && item.status) throw new UnprocessableEntityException("Only a checklist line takes a status");
        if (item.status && !isCheckStatus(item.status)) throw new UnprocessableEntityException("Mark a check confirmed, pending or not applicable");
        return { question, answer: (item.answer ?? "").trim(), status: question.kind === "check" ? item.status ?? null : null };
      });
      const kickoff = (await client.query<{ status: string }>(`SELECT status FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'kickoff'`,
        [workspaceId, caseId])).rows[0];
      // A checklist line stays open to change after the visit (a pending item gets confirmed later); questions don't.
      const checksOnly = asked.length > 0 && asked.every((item) => item.question.kind === "check");
      const target: SiteVisitTarget | { kind: "kickoff" } = kickoff?.status === "active"
        ? (await this.activeStage(client, workspaceId, caseId, "kickoff", input.version), { kind: "kickoff" as const })
        : await this.siteVisitTarget(client, workspaceId, caseId, input.version, checksOnly);
      for (const { question, answer, status } of asked) {
        if (question.kind === "check" && !status && answer) throw new UnprocessableEntityException(`Mark "${question.question.slice(0, 60)}" confirmed, pending or not applicable`);
        if (!answer && !status) await client.query(`DELETE FROM design_site_visit_answers WHERE workspace_id = $1 AND case_id = $2 AND question_key = $3`, [workspaceId, caseId, question.key]);
        else await client.query(
          `INSERT INTO design_site_visit_answers (workspace_id, case_id, question_key, question, answer, status, answered_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, case_id, question_key) DO UPDATE SET answer = excluded.answer, status = excluded.status, answered_by = excluded.answered_by, answered_at = now(),
             version = design_site_visit_answers.version + 1
           WHERE design_site_visit_answers.answer IS DISTINCT FROM excluded.answer OR design_site_visit_answers.status IS DISTINCT FROM excluded.status`,
          [workspaceId, caseId, question.key, question.question, answer, status, userId]);
      }
      if (target.kind === "kickoff") await client.query(`UPDATE design_journey_stages SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = 'kickoff'`, [workspaceId, caseId]);
      else if (target.kind === "stage") await client.query(`UPDATE design_journey_stages SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit'`, [workspaceId, caseId]);
      else await client.query(`UPDATE design_journey_tasks SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure'`, [workspaceId, caseId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.site_visit_answered.v1", entityType: "pre_project_case", entityId: caseId,
        after: { keys: input.answers.map((item) => item.key), checks: Object.fromEntries(asked.filter((item) => item.status).map((item) => [item.question.key, item.status])),
          at: target.kind === "kickoff" ? "kickoff" : "site_visit" } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * "Applies to this job": the designer switches a scope's checklist on or off for the job (pre-set from the matching).
   * Recorded with who and when; the same choice twice changes nothing. Its version guards against two people at once.
   */
  setChecklistApplies(actor: RequestActor, workspaceId: string, caseId: string, input: { scope: string; applies: boolean; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const job = await readJobChecklist(client, workspaceId, caseId);
      if (!job) throw new ConflictException("Start the design first");
      const key = scopeKey(input.scope ?? "");
      const group = job.groups.find((entry) => entry.scope && scopeKey(entry.scope) === key);
      if (!group) throw new UnprocessableEntityException("That checklist is not on this job's list");
      const before = (await client.query<{ applies: boolean; version: number }>(
        `SELECT applies, version FROM design_checklist_choices WHERE workspace_id = $1 AND case_id = $2 AND scope_key = $3 FOR UPDATE`, [workspaceId, caseId, key])).rows[0];
      if ((before?.version ?? 0) !== input.version) throw new ConflictException("This checklist changed in another window. Reload and try again.");
      if (before?.applies === input.applies) return this.view(client, workspaceId, caseId, userId);
      await client.query(
        `INSERT INTO design_checklist_choices (workspace_id, case_id, scope_key, scope, applies, chosen_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, case_id, scope_key) DO UPDATE SET applies = excluded.applies, chosen_by = excluded.chosen_by, chosen_at = now(), version = design_checklist_choices.version + 1`,
        [workspaceId, caseId, key, group.scope, input.applies, userId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.checklist_applies_changed.v1", entityType: "pre_project_case", entityId: caseId,
        before: { scope: group.scope, applies: before?.applies ?? group.applies, chosen: Boolean(before) }, after: { scope: group.scope, applies: input.applies } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-048/128/080/141: done only with every wall measured and photographed and every question the job needs answered;
   * the QS is told on a joinery order. In the current order this is the design site measure inside the concept, done by
   * whichever designer is free, and a concept the client already chose completes once it is done.
   */
  completeSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: { summary: string; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const target = await this.siteVisitTarget(client, workspaceId, caseId, input.version);
      if (!input.summary?.trim()) throw new UnprocessableEntityException("Summarise what was found on site");
      const measurements = await this.measurements(client, workspaceId, caseId);
      // The general questions and the checklists that apply: every question answered, every line marked (pending counts).
      const job = await readJobChecklist(client, workspaceId, caseId);
      const required = job ? job.groups.filter((group) => group.required).flatMap((group) => group.questions) : [];
      const problem = siteEvidenceProblem(measurements) ?? siteChecklistProblem(required, (job?.answers ?? []).map((row) => row.key));
      if (problem) throw new UnprocessableEntityException(problem);
      const files = measurements.reduce((sum, item) => sum + item.files, 0);
      const summary = input.summary.trim();
      if (target.kind === "stage") await completeStage(client, workspaceId, caseId, "site_visit", userId, summary);
      else {
        await completeTask(client, workspaceId, caseId, "site_measure", userId, summary);
        if (target.activityId) await client.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = 'Site measured', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`,
          [workspaceId, target.activityId]);
      }
      await recordProjectSiteVisit(client, workspaceId, caseId, summary, `${measurements.length} measurement sets, ${files} files`, userId);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.site_visit_completed.v1", entityType: "pre_project_case", entityId: caseId, after: { measurements: measurements.length, files, within: target.kind } });
      if (target.kind === "task") await completeConceptIfReady(client, workspaceId, caseId, userId);
      const timings = await journeyTimings(client, workspaceId, caseId);
      if (timings.kind === "site_and_materials") {
        // PLM-080: the measurements and photos go to the QS for pricing.
        const facts = await caseFacts(client, workspaceId, caseId);
        const surveyors = await membersWithRole(client, workspaceId, "quantity_surveyor");
        const recipients = (await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, surveyors])).rows;
        for (const recipient of recipients) {
          const message = { workspaceId, recipientUserId: recipient.userId, code: "design.site_measured", eventType: "design.site_measured", variables: { clientName: facts?.clientName ?? "", summary: `${measurements.length} measurement sets, ${files} files. ${summary}`.slice(0, 600) }, deepLink: `/workspace/pre-projects/cases/${caseId}/site` };
          await notifyUserInApp(client, { ...message, idempotencyKey: `design:${caseId}:site_measured:${recipient.userId}` });
          await queueUserEmail(client, { ...message, idempotencyKey: `design:${caseId}:site_measured:${recipient.userId}:email` });
        }
      }
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-050: the material list is confirmed when it has materials and the client confirmed every one (the
   * ledger's current versions). Renders unlock next (PLM-051) in the old order.
   */
  confirmMaterialList(actor: RequestActor, workspaceId: string, caseId: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      if (await this.materialStage(client, workspaceId, caseId, false) === "samples") throw new ConflictException("Approve the samples instead");
      await this.activeStage(client, workspaceId, caseId, "material_selection", input.version);
      const ledger = await readLedger(client, workspaceId, caseId);
      const materials = ledger.entries.filter((entry) => !entry.archivedAt && entry.kind === "material");
      if (!materials.length) throw new UnprocessableEntityException("Add the materials to the list first");
      const waiting = materials.filter((entry) => entry.current?.status !== "confirmed");
      if (waiting.length) throw new ConflictException(`Waiting for the client's confirmation: ${waiting.slice(0, 3).map((entry) => entry.title).join(", ")}${waiting.length > 3 ? ` and ${waiting.length - 3} more` : ""}`);
      const unsigned = materials.filter((entry) => entry.current?.outsourced && entry.current.signOff !== "approved");
      if (unsigned.length) throw new ConflictException(`Waiting for the sign-off of the outsourced ${unsigned.length === 1 ? "material" : "materials"}: ${unsigned.slice(0, 3).map((entry) => entry.title).join(", ")}`);
      await completeStage(client, workspaceId, caseId, "material_selection", userId, `${materials.length} materials confirmed`, "material_list_confirmed");
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.material_list_confirmed.v1", entityType: "pre_project_case", entityId: caseId, after: { materials: materials.length } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** PLM-081: material selection is always a step; it is only skipped as "Not required for this order", recorded with who and when. */
  materialsNotRequired(actor: RequestActor, workspaceId: string, caseId: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "material_selection", input.version);
      const progress = (await stageProgress(client, workspaceId, caseId)).find((item) => item.stage === "material_selection")!;
      const ledger = await readLedger(client, workspaceId, caseId);
      if (progress.total > 0 || ledger.entries.some((entry) => !entry.archivedAt && entry.kind === "material")) throw new ConflictException("Material selection has a material list. Confirm it instead");
      await completeStage(client, workspaceId, caseId, "material_selection", userId, NOT_REQUIRED, "not_required");
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.materials_not_required.v1", entityType: "pre_project_case", entityId: caseId, after: { note: NOT_REQUIRED } });
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** PLM-051 (the old order): the reviewer assigns a stage's owner (the Visualiser for renders, when nobody holds the role yet). */
  assignStage(actor: RequestActor, workspaceId: string, caseId: string, stage: string, input: { membershipId: string; version: number }) {
    return this.review(actor, workspaceId, caseId, async (client, userId) => {
      const row = (await client.query<{ status: string; version: number; activityId: string | null }>(
        `SELECT status, version, activity_id AS "activityId" FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 FOR UPDATE`, [workspaceId, caseId, stage])).rows[0];
      if (!row) throw new NotFoundException("This design stage is not part of the package");
      if (row.version !== input.version) throw new ConflictException("The design stage changed in another window. Reload and try again.");
      if (row.status === "done") throw new ConflictException("This stage is done");
      const member = (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.membershipId])).rows[0];
      if (!member) throw new BadRequestException("Choose an active team member.");
      await client.query(`UPDATE design_journey_stages SET owner_membership_id = $4, version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage, input.membershipId]);
      if (row.activityId) await client.query(`UPDATE crm_activities SET owner_membership_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`, [workspaceId, row.activityId, input.membershipId]);
      await event(client, workspaceId, caseId, stage, "assigned", null, userId);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.stage_assigned.v1", entityType: "pre_project_case", entityId: caseId, after: { stage, membershipId: input.membershipId } });
      if (member.userId !== userId) {
        const facts = await caseFacts(client, workspaceId, caseId);
        await notifyUserInApp(client, { workspaceId, recipientUserId: member.userId, code: "design.stage_started", eventType: "design.stage.started",
          variables: { stage: STAGE_LABELS[stage as JourneyStage] ?? stage, clientName: facts?.clientName ?? "", due: "" }, deepLink: `/workspace/pre-projects/cases/${caseId}/designs?stage=${stage}`,
          idempotencyKey: `design:${caseId}:${stage}:assigned:${input.membershipId}:${row.version}` });
      }
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /** A stage the package includes but this home doesn't need (no deliverables): the reviewer skips it with a reason. */
  skipStage(actor: RequestActor, workspaceId: string, caseId: string, stage: string, input: { note: string; version: number }) {
    return this.review(actor, workspaceId, caseId, async (client, userId) => {
      if (!isDeliverableStage(stage)) throw new UnprocessableEntityException("Only a design stage can be skipped");
      await this.activeStage(client, workspaceId, caseId, stage, input.version);
      if (!input.note?.trim()) throw new UnprocessableEntityException("Say why this stage isn't needed");
      const progress = (await stageProgress(client, workspaceId, caseId)).find((item) => item.stage === stage)!;
      if (progress.total > 0) throw new ConflictException(`${STAGE_LABELS[stage]} has designs. Approve or archive them instead of skipping`);
      await completeStage(client, workspaceId, caseId, stage, userId, input.note.trim(), "skipped");
      await syncDesignStages(client, workspaceId, caseId, userId);
      return this.view(client, workspaceId, caseId, userId);
    });
  }

  /**
   * PLM-053: the client's sign-off of the final design, with its date, who signed, how, and the signed file. Every
   * design stage is done, every current design approved, no blocking comment open, and every material and design
   * choice confirmed by the client — the ledger is locked here (PLM-054). The Account Manager and the Sales Admin
   * are told and the estimate's week starts; then the Proposal 2 estimate is prepared (best effort, see handOff).
   */
  async signOff(actor: RequestActor, workspaceId: string, caseId: string, input: SignOffInput) {
    const view = await this.clientDecision(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "approval", input.version);
      const invalid = approvalProblem(input, await workspaceToday(client, workspaceId));
      if (invalid) throw new UnprocessableEntityException(invalid);
      const method = input.method ?? "signed_document";
      if (!(APPROVAL_METHODS as readonly string[]).includes(method)) throw new BadRequestException("Say how the client approved.");
      const asset = await client.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, input.assetId]);
      if (!asset.rowCount) throw new UnprocessableEntityException("Attach the client's signed approval");
      const open = (await client.query<{ stage: JourneyStage }>(
        `SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage <> 'approval' AND status <> 'done' ORDER BY position`, [workspaceId, caseId])).rows;
      if (open.length) throw new ConflictException(`Finish ${open.map((row) => STAGE_LABELS[row.stage]).join(", ")} first`);
      const unapproved = (await client.query<{ title: string }>(
        `SELECT design.title FROM pre_project_designs design
           JOIN LATERAL (SELECT status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) latest ON true
          WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL AND design.stage IS NOT NULL AND design.stage <> 'concepts' AND latest.status <> 'approved' ORDER BY design.title LIMIT 5`, [workspaceId, caseId])).rows;
      if (unapproved.length) throw new ConflictException(`Waiting for approval: ${unapproved.map((row) => row.title).join(", ")}`);
      const blocking = (await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pre_project_design_threads thread JOIN pre_project_designs design ON design.workspace_id = thread.workspace_id AND design.id = thread.design_id
          WHERE thread.workspace_id = $1 AND thread.case_id = $2 AND design.archived_at IS NULL AND thread.blocking AND thread.status = 'open'`, [workspaceId, caseId])).rows[0].count;
      if (blocking) throw new ConflictException(blocking === 1 ? "Resolve the open blocking comment first" : `Resolve the ${blocking} open blocking comments first`);
      // The materials and decisions ledger locks with the approval: procurement can order from it from now on.
      const ledger = await readLedger(client, workspaceId, caseId);
      const lockNumber = ledger.entries.some((entry) => !entry.archivedAt) ? await lockLedger(client, workspaceId, caseId, userId, "design_sign_off", input.note?.trim() || null) : null;
      await completeStage(client, workspaceId, caseId, "approval", userId, input.note?.trim() || null, "signed_off");
      const journey = (await client.query<{ estimateDueAt: Date }>(
        `UPDATE design_journeys SET approved_on = $3, approval_asset_id = $4, approval_signer = $5, approval_method = $6, estimate_due_at = now() + make_interval(days => estimate_days), version = version + 1
          WHERE workspace_id = $1 AND case_id = $2 RETURNING estimate_due_at AS "estimateDueAt"`, [workspaceId, caseId, input.approvedOn, input.assetId, input.signer!.trim(), method])).rows[0];
      const facts = await caseFacts(client, workspaceId, caseId);
      if (facts) {
        const workspace = (await client.query<{ timezone: string; locale: string }>(`SELECT default_timezone AS timezone, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
        const members = [...new Set([facts.accountManagerId, await salesAdminMembership(client, workspaceId, caseId)].filter((id): id is string => Boolean(id)))];
        const recipients = (await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, members])).rows;
        const variables = { clientName: facts.clientName, approvedOn: formatDay(input.approvedOn!, workspace?.locale ?? "en"), due: formatDue(journey.estimateDueAt, workspace?.timezone ?? "UTC", workspace?.locale ?? "en") };
        for (const recipient of recipients) {
          const message = { workspaceId, recipientUserId: recipient.userId, code: "design.approved_estimate", eventType: "design.signed_off", variables, deepLink: `/workspace/pre-projects/cases/${caseId}/quotations` };
          await notifyUserInApp(client, { ...message, idempotencyKey: `design-signed-off:${caseId}:${recipient.userId}` });
          await queueUserEmail(client, { ...message, idempotencyKey: `design-signed-off:${caseId}:${recipient.userId}:email` });
        }
      }
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.signed_off.v1", entityType: "pre_project_case", entityId: caseId,
        after: { note: input.note?.trim() || null, approvedOn: input.approvedOn, signer: input.signer!.trim(), method, assetId: input.assetId, estimateDueAt: journey.estimateDueAt, ledgerLock: lockNumber } });
      // PLM-046: from the design approval the Account Manager's weekly client update call is booked (changed or declined on the case).
      await startClientCalls(client, workspaceId, caseId, "design_approval", userId);
      return this.view(client, workspaceId, caseId, userId);
    });
    const handoff = await this.handOff(actor, workspaceId, caseId).catch((error: unknown) => ({ quoteId: null, problem: error instanceof Error ? error.message : "The estimate could not be prepared." }));
    return { ...view, handoff };
  }

  /**
   * PLM-053: the hand-off to the Proposal 2 estimate. Links the case's main quotation when there is one, else
   * creates it through the commercial API (Sales/QS then price it). Idempotent: a linked estimate is kept.
   */
  async handOff(actor: RequestActor, workspaceId: string, caseId: string): Promise<{ quoteId: string | null; problem: string | null }> {
    const state = await this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client) => {
      const journey = (await client.query<{ approvedOn: string | null; quoteId: string | null }>(
        `SELECT approved_on AS "approvedOn", estimate_quote_id AS "quoteId" FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
      if (!journey?.approvedOn) throw new ConflictException("Record the design approval first");
      const existing = await this.mainQuote(client, workspaceId, caseId);
      if (journey.quoteId && existing === journey.quoteId) return { linked: journey.quoteId, revision: null };
      if (existing) return { linked: existing, revision: null };
      if (!this.commercial) return { linked: null, revision: null };
      return { linked: null, revision: (await this.commercial.load(client, workspaceId, caseId)).revision };
    });
    let quoteId = state.linked;
    if (!quoteId && state.revision !== null && this.commercial) {
      await this.commercial.command(actor, workspaceId, caseId, { action: "create", revision: state.revision });
    }
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      quoteId = quoteId ?? await this.mainQuote(client, workspaceId, caseId);
      if (!quoteId) return { quoteId: null, problem: "Prepare the estimate from Quotations." };
      const linked = await client.query(`UPDATE design_journeys SET estimate_quote_id = $3, estimate_linked_at = now(), version = version + 1
                                          WHERE workspace_id = $1 AND case_id = $2 AND estimate_quote_id IS DISTINCT FROM $3`, [workspaceId, caseId, quoteId]);
      if (linked.rowCount) {
        await event(client, workspaceId, caseId, "approval", "estimate_linked", quoteId, user.userId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.estimate_linked.v1", entityType: "pre_project_case", entityId: caseId, after: { quoteId } });
      }
      return { quoteId, problem: null };
    });
  }

  /** The estimate after the design: the main-round quotation, else the newest quotation that isn't the design fee. */
  private async mainQuote(client: PoolClient, workspaceId: string, caseId: string) {
    return (await client.query<{ id: string }>(
      `SELECT id FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND kind = 'quotation' AND round IS DISTINCT FROM 'design'
          AND status NOT IN ('superseded', 'withdrawn') AND (round = 'main' OR created_at >= COALESCE((SELECT completed_at FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'approval'), now()))
        ORDER BY (round = 'main') DESC, number DESC LIMIT 1`, [workspaceId, caseId])).rows[0]?.id ?? null;
  }

  private async rights(client: PoolClient, workspaceId: string, userId: string) {
    const has = (permission: string) => this.access.hasPermission(client, workspaceId, userId, permission);
    const canManage = await has("pre_projects.manage_lifecycle");
    return { canStart: canManage, canManage, canEdit: await has("pre_projects.edit"), canReview: await has("pre_projects.review_designs"), canRecordClient: await has("pre_projects.record_client_design_decisions") };
  }

  private async view(client: PoolClient, workspaceId: string, caseId: string, userId?: string) {
    const journey = (await client.query<{ packageId: string | null; packageName: string | null; includedRevisions: number; questions: unknown; approvedOn: string | null; approvalAssetId: string | null;
      approvalAssetName: string | null; estimateDueAt: Date | null; version: number; flowVersion: number; reviewerRoleCode: string | null } & Record<string, unknown>>(
      `SELECT journey.package_id AS "packageId", journey.package_name AS "packageName", journey.included_revisions AS "includedRevisions", journey.includes_space_planning AS "includesSpacePlanning", journey.includes_renders AS "includesRenders",
              journey.reviewer_role_code AS "reviewerRoleCode", journey.inspiration_days AS "inspirationDays", journey.site_visit_hours AS "siteVisitHours", journey.started_at AS "startedAt",
              journey.design_internal_days AS "designInternalDays", journey.design_client_days AS "designClientDays", journey.material_selection_days AS "materialSelectionDays", journey.estimate_days AS "estimateDays",
              journey.render_internal_days AS "renderInternalDays", journey.render_client_days AS "renderClientDays", journey.flow_version AS "flowVersion",
              journey.concept_options_max AS "conceptOptionsMax", to_char(journey.render_signoff_due_on, 'YYYY-MM-DD') AS "renderSignoffDueOn",
              to_char(journey.render_signed_on, 'YYYY-MM-DD') AS "renderSignedOn", journey.render_signoff_signer AS "renderSignoffSigner", render_asset.original_name AS "renderSignoffAssetName",
              journey.site_visit_questions AS questions, to_char(journey.approved_on, 'YYYY-MM-DD') AS "approvedOn", journey.approval_asset_id AS "approvalAssetId", asset.original_name AS "approvalAssetName",
              journey.approval_signer AS "approvalSigner", journey.approval_method AS "approvalMethod", journey.estimate_due_at AS "estimateDueAt", journey.estimate_quote_id AS "estimateQuoteId", journey.version
         FROM design_journeys journey LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = journey.workspace_id AND asset.id = journey.approval_asset_id
         LEFT JOIN pre_project_brief_assets render_asset ON render_asset.workspace_id = journey.workspace_id AND render_asset.id = journey.render_signoff_asset_id
        WHERE journey.workspace_id = $1 AND journey.case_id = $2`, [workspaceId, caseId])).rows[0] ?? null;
    // Rounds per stage: concepts count their presentations; other stages the client rounds of their files.
    const presented = journey ? await presentedRounds(client, workspaceId, caseId) : [];
    const fileRounds = journey ? (await client.query<{ stage: string; rounds: number }>(
      `SELECT design.stage, max(rounds.count)::int AS rounds FROM pre_project_designs design
         JOIN LATERAL (SELECT count(DISTINCT activity.version_id) AS count FROM pre_project_design_activity activity
                        WHERE activity.workspace_id = design.workspace_id AND activity.design_id = design.id AND activity.action = 'client_review') rounds ON true
        WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL AND design.stage IS NOT NULL GROUP BY design.stage`, [workspaceId, caseId])).rows : [];
    const roundsOf = (stage: string) => Math.max(presented.find((item) => item.stage === stage)?.rounds ?? 0, fileRounds.find((item) => item.stage === stage)?.rounds ?? 0);
    const stages = journey ? (await client.query<{ stage: JourneyStage; outcome: string | null; dueAt: Date | null } & Record<string, unknown>>(
      `SELECT stage.stage, stage.position, stage.status, stage.owner_membership_id AS "ownerId", account.display_name AS "ownerName", stage.started_at AS "startedAt",
              stage.due_at AS "dueAt", stage.client_due_at AS "clientDueAt", stage.completed_at AS "completedAt", completer.display_name AS "completedByName", stage.note, stage.version, stage.activity_id AS "activityId",
              stage.booking_reminder_at IS NOT NULL AS "bookingReminder",
              appointment.starts_at AS "scheduledAt", appointment.ends_at AS "scheduledEnd", appointment.timezone AS "scheduledTimezone", appointment.location AS "scheduledLocation",
              (SELECT action FROM design_journey_events ev WHERE ev.workspace_id = stage.workspace_id AND ev.case_id = stage.case_id AND ev.stage = stage.stage
                  AND ev.action IN ('completed', 'approved', 'chosen', 'skipped', 'not_required', 'material_list_confirmed', 'timer_ended', 'closed_early', 'signed_off', 'held',
                                    'render_signed_off', 'samples_approved') ORDER BY ev.occurred_at DESC LIMIT 1) AS outcome
         FROM design_journey_stages stage
         LEFT JOIN workspace_memberships member ON member.id = stage.owner_membership_id LEFT JOIN users account ON account.id = member.user_id
         LEFT JOIN users completer ON completer.id = stage.completed_by
         LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
        WHERE stage.workspace_id = $1 AND stage.case_id = $2 ORDER BY stage.position`, [workspaceId, caseId])).rows
      .map((row) => ({ ...row, label: STAGE_LABELS[row.stage], overdue: row.status === "active" && row.dueAt instanceof Date && row.dueAt.getTime() < Date.now(),
        revisions: isDeliverableStage(row.stage) ? stageRevisions(roundsOf(row.stage), journey.includedRevisions) : null })) : [];
    const measurements = journey ? await this.measurements(client, workspaceId, caseId) : [];
    const job = journey ? await readJobChecklist(client, workspaceId, caseId) : null;
    const questions = job?.questions ?? [];
    const answers = job?.answers ?? [];
    const groups = job?.groups ?? [];
    const required = groups.filter((group) => group.required).flatMap((group) => group.questions);
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    const progress = journey ? await stageProgress(client, workspaceId, caseId) : [];
    const ledger = journey ? await readLedger(client, workspaceId, caseId) : null;
    const { questions: _questions, ...journeyView } = journey ?? { questions: null };
    void _questions;
    // Before the journey starts: what it will be, so the button says "Start design" or "Start site visit".
    const plan = journey ? null : await casePlan(client, workspaceId, caseId);
    const startsAs = journey || !(plan!.siteVisit || plan!.design) ? null : (await client.query<{ packaged: boolean }>(
      `SELECT discovery.design_package_id IS NOT NULL AS packaged FROM pre_project_cases pre_case
         LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.packaged ? "design" : "site_and_materials";
    // Where the site is, for the visit's header: the property's address and position from the opportunity.
    const site = (await client.query<{ address: string | null; latitude: number | null; longitude: number | null }>(
      `SELECT discovery.property_location AS address, discovery.latitude::float8 AS latitude, discovery.longitude::float8 AS longitude FROM pre_project_cases pre_case
         JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0] ?? null;
    const tasks = journey ? (await readTasks(client, workspaceId, caseId)).map((task) => ({ ...task, label: TASK_LABELS[task.task as JourneyTask],
      overdue: task.status === "open" && task.dueAt instanceof Date && task.dueAt.getTime() < Date.now() })) : [];
    const answeredKeys = answers.map((answer) => answer.key);
    const checklist = questions.map((question) => {
      const found = answers.find((answer) => answer.key === question.key);
      return { ...question, kind: question.kind ?? "answer", required: required.some((entry) => entry.key === question.key),
        answer: found?.answer || null, status: found?.status ?? null, answeredByName: found?.answeredByName ?? null, answeredAt: found?.answeredAt ?? null };
    });
    return {
      site: site && (site.address || site.latitude !== null) ? site : null,
      journey: journey ? { ...journeyView, flowVersion: Number(journey.flowVersion), kind: journey.packageId || journey.packageName ? "design" : "site_and_materials" } : null, startsAs,
      stages: stages.map((stage) => ({ ...stage, progress: progress.find((item) => item.stage === stage.stage) ?? null })),
      tasks,
      siteVisit: journey ? await this.siteVisitState(client, workspaceId, caseId, stages, tasks) : null,
      measurements, siteEvidenceProblem: journey ? siteEvidenceProblem(measurements) : null,
      checklist,
      // PLM-154: the general questions by section, then the checklists that apply to the job; the rest aren't asked. Each
      // checklist carries the designer's "Applies to this job" choice (its version for the next change).
      checklistGroups: groups.map((group) => {
        const choice = group.scope ? job?.choices.find((entry) => entry.scopeKey === scopeKey(group.scope!)) : undefined;
        return { scope: group.scope, section: group.section, everyJob: group.everyJob, matches: group.matches, chosen: group.chosen, applies: group.applies, required: group.required,
          choiceVersion: choice?.version ?? 0, keys: group.questions.map((question) => question.key),
          pending: group.questions.filter((question) => question.kind === "check" && answers.find((answer) => answer.key === question.key)?.status === "pending").length };
      }),
      siteChecklistProblem: journey ? siteChecklistProblem(required, answeredKeys) : null,
      // The open items: pending lines of the checklists that apply.
      pendingChecks: job ? jobPending(job) : 0,
      ledger: ledger ? { state: ledger.state, lockProblem: ledger.lockProblem, lock: ledger.lock, materials: ledger.entries.filter((entry) => !entry.archivedAt && entry.kind === "material").length,
        waiting: ledger.entries.filter((entry) => !entry.archivedAt && entry.current?.status !== "confirmed").length,
        outsourcedWaiting: ledger.entries.filter((entry) => !entry.archivedAt && entry.current?.outsourced && entry.current.signOff !== "approved").length } : null,
      team: journey ? await this.teamView(client, workspaceId, caseId, userId, journey.reviewerRoleCode, journey.includesRenders !== false) : null,
      showroomBooking: Boolean(await this.showroomType(client, workspaceId)),
      timezone,
    };
  }

  /** The design team on the case, slot by slot, with what this person may set (PLM-151). */
  private async teamView(client: PoolClient, workspaceId: string, caseId: string, userId: string | undefined, reviewRole: string | null, rendered = true) {
    const config = await designTeamConfig(client, workspaceId);
    const labels = await roleLabels(client, workspaceId);
    const allowed = userId ? await this.settable(client, workspaceId, caseId, userId, config, reviewRole) : [];
    const marked = new Set(await notApplicableRoles(client, workspaceId, { caseId }));
    const settled = new Map<string, { membershipId: string | null; notApplicable: boolean }>();
    const slots = [];
    for (const slot of TEAM_SLOTS) {
      const role = config[slot];
      if (!role) continue;
      // A package without renders (Palm's Concept Package) has no Visualiser or Draftsman to tag.
      if (!rendered && (slot === "visualiser" || slot === "draftsman")) continue;
      const holder = await caseRoleHolder(client, workspaceId, caseId, role);
      if (holder || marked.has(role)) settled.set(role, { membershipId: holder, notApplicable: !holder && marked.has(role) });
      const name = holder ? (await this.names(client, workspaceId, [holder])).get(holder) ?? null : null;
      slots.push({ slot, role, label: labels.get(role) ?? null, member: holder ? { membershipId: holder, name } : null, notApplicable: !holder && marked.has(role), canSet: allowed.includes(slot) });
    }
    // Whoever sets a part of the team (the Account Manager, the lead designer, the reviewer, the technical lead) picks from
    // the workspace's active people here: they don't need the People module's permission to see who they can choose.
    const candidates = allowed.length ? (await client.query<{ id: string; displayName: string }>(
      `SELECT membership.id, account.display_name AS "displayName" FROM workspace_memberships membership
         JOIN users account ON account.id = membership.user_id AND account.status = 'active'
        WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY account.display_name, membership.id`, [workspaceId])).rows : [];
    return { slots, candidates, missing: allocationMissing(config, settled), reviewRole, version: (await client.query<{ version: number }>(`SELECT version FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.version ?? 0 };
  }

  /** The slots a person may set on this job: from being its Account Manager, lead designer, the package's reviewer, a technical lead or an admin. */
  private async settable(client: PoolClient, workspaceId: string, caseId: string, userId: string, config: DesignTeamConfig, reviewRole: string | null) {
    const membership = await this.membership(client, workspaceId, userId);
    const facts = await caseFacts(client, workspaceId, caseId);
    const admin = await this.access.hasPermission(client, workspaceId, userId, "pre_projects.manage_lifecycle");
    const accountManager = Boolean(membership) && (facts?.accountManagerId === membership || (await caseRoleHolder(client, workspaceId, caseId, "account_manager")) === membership);
    const lead = Boolean(membership) && (await leadDesigner(client, workspaceId, caseId)) === membership;
    // A package whose review role nobody holds leaves the lead designer's choice with the Account Manager (as the allocation asked).
    const reviewed = Boolean(reviewRole) && (await membersWithRole(client, workspaceId, reviewRole)).length > 0;
    return settableSlots({ admin, accountManager, reviewer: await holdsRole(client, workspaceId, membership, reviewRole), leadDesigner: lead,
      technicalLead: await holdsRole(client, workspaceId, membership, config.technicalLeadRoleCode) }, reviewed);
  }

  /** Names a person for a team role on the case (replacing whoever held it), or clears it. */
  private async setCaseRole(client: PoolClient, workspaceId: string, caseId: string, role: string, membershipId: string | null) {
    await client.query(
      `UPDATE project_assignments SET role_keys = array_remove(role_keys, $3::varchar)
        WHERE workspace_id = $1 AND case_id = $2 AND $3::varchar = ANY(role_keys) AND membership_id IS DISTINCT FROM $4::uuid`, [workspaceId, caseId, role, membershipId]);
    if (membershipId)
      await client.query(
        `INSERT INTO project_assignments (workspace_id, case_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY[$4::varchar])
         ON CONFLICT (workspace_id, case_id, membership_id) WHERE case_id IS NOT NULL
         DO UPDATE SET active = true, role_keys = CASE WHEN $4::varchar = ANY(project_assignments.role_keys) THEN project_assignments.role_keys ELSE array_append(project_assignments.role_keys, $4::varchar) END`,
        [workspaceId, caseId, membershipId, role]);
  }

  /** A new lead designer takes over the steps and the site measure the previous lead (or nobody) owned. */
  private async followLead(client: PoolClient, workspaceId: string, caseId: string, previous: string | null, lead: string) {
    const facts = await caseFacts(client, workspaceId, caseId);
    const from = [previous, facts?.accountManagerId].filter((id): id is string => Boolean(id));
    const stages = (await client.query<{ stage: string; activityId: string | null }>(
      `UPDATE design_journey_stages SET owner_membership_id = $3, version = version + 1
        WHERE workspace_id = $1 AND case_id = $2 AND status <> 'done' AND (owner_membership_id IS NULL OR owner_membership_id = ANY($4::uuid[])) AND stage <> 'renders'
        RETURNING stage, activity_id AS "activityId"`, [workspaceId, caseId, lead, from])).rows;
    const tasks = (await client.query<{ activityId: string | null }>(
      `UPDATE design_journey_tasks SET owner_membership_id = $3, version = version + 1
        WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure' AND status = 'open' AND (owner_membership_id IS NULL OR owner_membership_id = ANY($4::uuid[]))
        RETURNING activity_id AS "activityId"`, [workspaceId, caseId, lead, from])).rows;
    const activities = [...stages, ...tasks].map((row) => row.activityId).filter((id): id is string => Boolean(id));
    if (activities.length) await client.query(`UPDATE crm_activities SET owner_membership_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'pending'`,
      [workspaceId, activities, lead]);
  }

  /** The site visit as one thing, whichever order the journey runs in. */
  private async siteVisitState(client: PoolClient, workspaceId: string, caseId: string, stages: Array<Record<string, unknown> & { stage: JourneyStage }>, tasks: Array<{ task: string; status: string; version: number; dueAt: Date | null; ownerName: string | null; completedAt: Date | null; overdue: boolean }>) {
    const stage = stages.find((row) => row.stage === "site_visit");
    if (stage) return { within: "stage" as const, open: stage.status === "active", done: stage.status === "done", version: stage.version as number, dueAt: stage.dueAt ?? null,
      ownerName: stage.ownerName ?? null, scheduledAt: stage.scheduledAt ?? null, completedAt: stage.completedAt ?? null, overdue: Boolean(stage.overdue) };
    const task = tasks.find((row) => row.task === "site_measure");
    if (!task) return null;
    const appointment = (await client.query<{ at: Date | null }>(
      `SELECT appointment.starts_at AS at FROM design_journey_tasks task JOIN crm_appointments appointment ON appointment.workspace_id = task.workspace_id AND appointment.activity_id = task.activity_id
        WHERE task.workspace_id = $1 AND task.case_id = $2 AND task.task = 'site_measure'`, [workspaceId, caseId])).rows[0]?.at ?? null;
    return { within: "task" as const, open: task.status === "open", done: task.status === "done", version: task.version, dueAt: task.dueAt, ownerName: task.ownerName, scheduledAt: appointment,
      completedAt: task.completedAt, overdue: task.overdue };
  }

  /** The site visit to write to: the old order's stage when it is the current one, else the open site measure (PLM-141). */
  /** `afterDone`: a visit already done is written to as well (a checklist line changed after the visit). */
  private async siteVisitTarget(client: PoolClient, workspaceId: string, caseId: string, version: number, afterDone = false): Promise<SiteVisitTarget> {
    const stage = (await client.query<{ status: string; version: number; activityId: string | null; owner: string | null }>(
      `SELECT status, version, activity_id AS "activityId", owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit' FOR UPDATE`, [workspaceId, caseId])).rows[0];
    if (stage) {
      if (stage.version !== version) throw new ConflictException("The design stage changed in another window. Reload and try again.");
      if (stage.status !== "active" && !(afterDone && stage.status === "done")) throw new ConflictException(`${STAGE_LABELS.site_visit} is not the current stage`);
      return { kind: "stage", activityId: stage.activityId, owner: stage.owner };
    }
    const task = (await client.query<{ status: string; version: number; activityId: string | null; owner: string | null }>(
      `SELECT status, version, activity_id AS "activityId", owner_membership_id AS owner FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure' FOR UPDATE`, [workspaceId, caseId])).rows[0];
    if (!task) throw new ConflictException("The design site measure starts after the kick-off meeting");
    if (task.version !== version) throw new ConflictException("The site measure changed in another window. Reload and try again.");
    if (task.status !== "open" && !(afterDone && task.status === "done")) throw new ConflictException("The design site measure is done");
    return { kind: "task", activityId: task.activityId, owner: task.owner };
  }

  private async stageTarget(client: PoolClient, workspaceId: string, caseId: string, stageName: JourneyStage, version: number): Promise<SiteVisitTarget> {
    await this.activeStage(client, workspaceId, caseId, stageName, version);
    const stage = (await client.query<{ activityId: string | null; owner: string | null }>(
      `SELECT activity_id AS "activityId", owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stageName])).rows[0];
    return { kind: "stage", activityId: stage?.activityId ?? null, owner: stage?.owner ?? null };
  }

  /** The stage holding the material list on this journey: samples in the current order, else material selection. */
  private async materialStage(client: PoolClient, workspaceId: string, caseId: string, strict = true): Promise<"material_selection" | "samples"> {
    const rows = (await client.query<{ stage: "material_selection" | "samples" }>(
      `SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage IN ('material_selection', 'samples')`, [workspaceId, caseId])).rows;
    if (strict && !rows.length) throw new NotFoundException("This design stage is not part of the package");
    return rows.some((row) => row.stage === "samples") ? "samples" : "material_selection";
  }

  private async showroomType(client: PoolClient, workspaceId: string) {
    const id = (await client.query<{ id: string | null }>(`SELECT showroom_booking_type_id AS id FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.id;
    if (!id) return null;
    const type = await loadTypeById(client, workspaceId, id);
    return type?.active ? type : null;
  }

  private async stageOwner(client: PoolClient, workspaceId: string, caseId: string, stage: JourneyStage) {
    return (await client.query<{ owner: string | null }>(`SELECT owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stage])).rows[0]?.owner ?? null;
  }


  private async measurements(client: PoolClient, workspaceId: string, caseId: string) {
    return (await client.query<{ title: string; status: string; files: number; roomId: string | null }>(
      `SELECT COALESCE(NULLIF(record.title, ''), room.name, 'Measurement') AS title, record.status,
              -- The measurement's own evidence, and the photos filed to the same room on the Site page.
              (COALESCE(jsonb_array_length(record.content->'assetIds'), 0)
               + (SELECT count(*) FROM pre_project_brief_entries entry JOIN pre_project_entry_assets link ON link.workspace_id = entry.workspace_id AND link.entry_id = entry.id
                   WHERE entry.workspace_id = record.workspace_id AND entry.case_id = record.case_id AND entry.kind = 'file' AND entry.archived_at IS NULL
                     AND record.room_id IS NOT NULL AND entry.room_id = record.room_id))::int AS files, record.room_id AS "roomId"
         FROM pre_project_site_records record LEFT JOIN pre_project_rooms room ON room.workspace_id = record.workspace_id AND room.case_id = record.case_id AND room.id = record.room_id
        WHERE record.workspace_id = $1 AND record.case_id = $2 AND record.kind = 'measurement' ORDER BY title`, [workspaceId, caseId])).rows;
  }

  private async activeStage(client: PoolClient, workspaceId: string, caseId: string, stage: JourneyStage, version: number) {
    const row = (await client.query<{ status: string; version: number }>(
      `SELECT status, version FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 FOR UPDATE`, [workspaceId, caseId, stage])).rows[0];
    if (!row) throw new NotFoundException("This design stage is not part of the package");
    if (row.version !== version) throw new ConflictException("The design stage changed in another window. Reload and try again.");
    if (row.status !== "active") throw new ConflictException(`${STAGE_LABELS[stage]} is not the current stage`);
    return stage;
  }

  private async lockCase(client: PoolClient, workspaceId: string, caseId: string) {
    const found = await client.query(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
    if (!found.rowCount) throw new NotFoundException("Case not found");
    if (found.rows[0].status !== "active") throw new ConflictException("Reactivate the case first");
  }

  private async membership(client: PoolClient, workspaceId: string, userId: string) {
    return (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id ?? null;
  }

  private async names(client: PoolClient, workspaceId: string, memberships: Array<string | null>) {
    const ids = [...new Set(memberships.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map<string, string>();
    return new Map((await client.query<{ id: string; name: string }>(
      `SELECT member.id, coalesce(person.display_name, person.primary_email) AS name FROM workspace_memberships member JOIN users person ON person.id = member.user_id
        WHERE member.workspace_id = $1 AND member.id = ANY($2::uuid[])`, [workspaceId, ids])).rows.map((row) => [row.id, row.name]));
  }

  private async locale(client: PoolClient, workspaceId: string) {
    return (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
  }

  /** Stage decisions are the design reviewer's (the Creative Director role). */
  private review<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.review_designs"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      return work(client, user.userId);
    });
  }

  /**
   * The client's decisions recorded by staff (the design approval). PLM-145: on every package the design team records
   * them; the reviewer's part is approving rounds before the client sees them, on the packages that have one.
   */
  private clientDecision<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.record_client_design_decisions"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      return work(client, user.userId);
    });
  }

  private edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      return work(client, user.userId);
    });
  }
}
