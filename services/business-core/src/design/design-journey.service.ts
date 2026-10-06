import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { loadTypeById, recheckSlot, slotsFor } from "../booking/booking-store";
import { addDays as addCalendarDays, isDate } from "../booking/booking.domain";
import { assertMemberFree } from "../crm/shared/calendar-clash";
import { checkIntroSlot, meetingLocation, meetingWhen } from "../crm/opportunities/intro-meeting.domain";
import { confirmAppointment } from "../crm/conversations/inbox/client-followups";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { APPROVAL_METHODS, approvalProblem, normaliseSiteQuestions, siteChecklistProblem, siteEvidenceProblem, STAGE_LABELS, stageRevisions, type JourneyStage, type SiteQuestion } from "./design-journey.domain";
import { caseFacts, completeStage, event, formatDay, formatDue, journeyTimings, membersWithRole, recordProjectSiteVisit, salesAdminMembership, startJourney, workspaceToday } from "./design-journey.store";
import { lockLedger, readLedger } from "./design-ledger.store";
import { presentedRounds } from "./design-presentations.store";
import { isDeliverableStage, stageProgress, syncDesignStages } from "./design-stage-sync";

export type ScheduleInput = { startsAt: string; endsAt?: string | null; timezone: string; address?: string | null; version: number };
type AppointmentStage = "site_visit" | "material_selection";
const APPOINTMENT_CODE: Record<AppointmentStage, string> = { site_visit: "design.site_visit_booked", material_selection: "design.material_selection_booked" };
const APPOINTMENT_EVENT: Record<AppointmentStage, string> = { site_visit: "design.site_visit.booked", material_selection: "design.material_selection.booked" };
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

/**
 * PLM-047–053, 080/081, 128: the design journey on a case — inspiration, the site visit (measurements, photos and
 * the firm's question list), design stages with their deadlines and revision counters, the showroom appointment
 * on the booking slot engine, the material list, renders and the design approval that hands off to the estimate.
 */
@Injectable()
export class DesignJourneyService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() @Inject(DESIGN_COMMERCIAL_API) private readonly commercial?: DesignCommercialApi) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => ({
      ...await this.view(client, workspaceId, caseId),
      ...await this.rights(client, workspaceId, user.userId),
    }));
  }

  start(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.manage_lifecycle"], async (client, user) => {
      await this.lockCase(client, workspaceId, caseId);
      if (!(await startJourney(client, workspaceId, caseId, user.userId))) throw new ConflictException("The design stages have already started");
      return this.view(client, workspaceId, caseId);
    });
  }

  /** The client or the designer can end the inspiration week early (PLM-047). */
  closeInspiration(actor: RequestActor, workspaceId: string, caseId: string, input: { note?: string | null; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const stage = await this.activeStage(client, workspaceId, caseId, "inspiration", input.version);
      await completeStage(client, workspaceId, caseId, stage, userId, input.note?.trim() || null, "closed_early");
      return this.view(client, workspaceId, caseId);
    });
  }

  /** PLM-044/048/080: the designer (or Sales) books the visit; the designer and the Account Manager are both invited. */
  scheduleSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleInput) {
    return this.scheduleAppointment(actor, workspaceId, caseId, "site_visit", input);
  }

  /**
   * PLM-050: the showroom appointment, booked by the designer or by Sales inviting the design team. With a showroom
   * booking type in Settings › Design, the time must be a free slot of the firm's booking engine (same hours, leave,
   * buffers and calendars as the public booking pages) and its length and place come from the type.
   */
  scheduleMaterialSelection(actor: RequestActor, workspaceId: string, caseId: string, input: ScheduleInput) {
    return this.scheduleAppointment(actor, workspaceId, caseId, "material_selection", input);
  }

  /** The free showroom slots for the stage's owner between two firm-local dates (the booking slot engine). */
  materialSlots(actor: RequestActor, workspaceId: string, caseId: string, query: { from?: string; to?: string }) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      const type = await this.showroomType(client, workspaceId);
      if (!type) return { configured: false as const, slots: [], timezone: null, durationMinutes: null, location: null };
      const owner = await this.stageOwner(client, workspaceId, caseId, "material_selection");
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
    await this.activeStage(client, workspaceId, caseId, stageName, input.version);
    const facts = await caseFacts(client, workspaceId, caseId);
    const stage = (await client.query<{ activityId: string | null; owner: string | null }>(
      `SELECT activity_id AS "activityId", owner_membership_id AS owner FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stageName])).rows[0];
    if (!facts || !stage?.activityId || !stage.owner) throw new UnprocessableEntityException("Choose the dedicated designer on the opportunity first");
    let endsAt = input.endsAt ?? null;
    let address = input.address ?? null;
    const type = stageName === "material_selection" ? await this.showroomType(client, workspaceId) : null;
    if (type) {
      // The firm's booking engine decides: a slot free for the designer now, with the type's length and showroom.
      const start = new Date(input.startsAt);
      if (Number.isNaN(start.getTime())) throw new BadRequestException("Choose a time.");
      const { slot } = await recheckSlot(client, workspaceId, type, start, { hostIds: [stage.owner] });
      if (!slot) throw new ConflictException("That time isn't free any more. Choose another slot.");
      endsAt = slot.end;
      address = address?.trim() || type.locationDetail;
    }
    if (!endsAt) throw new BadRequestException("Choose how long the appointment is.");
    const problem = checkIntroSlot({ startsAt: input.startsAt, endsAt, timezone: input.timezone, mode: "in_person" });
    if (problem) throw new UnprocessableEntityException(problem);
    if (!type) await assertMemberFree(client, workspaceId, stage.owner, input.startsAt, endsAt, "The designer", stage.activityId);
    const attendees = [...new Set([stage.owner, facts.designerId, facts.accountManagerId].filter((id): id is string => Boolean(id)))];
    const location = meetingLocation("in_person", address);
    await client.query(
      `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, location, attendee_party_ids, attendee_membership_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workspace_id, activity_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
         location = excluded.location, attendee_membership_ids = excluded.attendee_membership_ids, version = crm_appointments.version + 1`,
      [workspaceId, stage.activityId, input.startsAt, endsAt, input.timezone, location, JSON.stringify([facts.partyId]), JSON.stringify(attendees)]);
    await client.query(`UPDATE crm_activities SET type = 'meeting', title = $3, due_at = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, stage.activityId, stageName === "material_selection" ? "Material selection appointment" : "Site visit: measurements, photos and the question list", input.startsAt]);
    // The booking stops the daily "book it" reminder (PLM-050).
    await client.query(`UPDATE design_journey_stages SET booking_reminder_at = NULL, version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = $3`, [workspaceId, caseId, stageName]);
    // The client gets the appointment's confirmation on WhatsApp, with its address (when the firm has it on).
    await confirmAppointment(client, workspaceId, stage.activityId, { actorUserId: userId });
    await event(client, workspaceId, caseId, stageName, "scheduled", null, userId);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: `design.${stageName}_scheduled.v1`, entityType: "pre_project_case", entityId: caseId,
      after: { startsAt: input.startsAt, endsAt, timezone: input.timezone, attendees, bookingTypeId: type?.id ?? null } });

    const locale = (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
    const bookedBy = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
    const variables = { clientName: facts.clientName, when: meetingWhen(input.startsAt, endsAt, input.timezone, locale), place: location.address ?? (stageName === "site_visit" ? "Site" : "Showroom"), bookedBy };
    const recipients = (await client.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, attendees])).rows;
    const at = Date.parse(input.startsAt);
    for (const recipient of recipients) {
      if (recipient.userId === userId) continue;
      const key = `design:${caseId}:${stageName}:${at}:${recipient.userId}`;
      const deepLink = `/workspace/pre-projects/cases/${caseId}/overview`;
      await notifyUserInApp(client, { workspaceId, recipientUserId: recipient.userId, code: APPOINTMENT_CODE[stageName], eventType: APPOINTMENT_EVENT[stageName], variables, deepLink, idempotencyKey: key });
      await queueUserEmail(client, { workspaceId, recipientUserId: recipient.userId, code: APPOINTMENT_CODE[stageName], eventType: APPOINTMENT_EVENT[stageName], variables, deepLink, idempotencyKey: `${key}:email` });
    }
    return this.view(client, workspaceId, caseId);
  }

  /** PLM-128: the designer's answers to the site visit question list; each answer keeps who gave it and when. */
  answerSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: { answers: Array<{ key: string; answer: string }>; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "site_visit", input.version);
      const questions = await this.questions(client, workspaceId, caseId);
      for (const item of input.answers) {
        const question = questions.find((entry) => entry.key === item.key);
        if (!question) throw new UnprocessableEntityException("That question is not on this visit's list");
        const answer = item.answer.trim();
        if (!answer) await client.query(`DELETE FROM design_site_visit_answers WHERE workspace_id = $1 AND case_id = $2 AND question_key = $3`, [workspaceId, caseId, item.key]);
        else await client.query(
          `INSERT INTO design_site_visit_answers (workspace_id, case_id, question_key, question, answer, answered_by) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, case_id, question_key) DO UPDATE SET answer = excluded.answer, answered_by = excluded.answered_by, answered_at = now(), version = design_site_visit_answers.version + 1
           WHERE design_site_visit_answers.answer IS DISTINCT FROM excluded.answer`, [workspaceId, caseId, item.key, question.question, answer, userId]);
      }
      await client.query(`UPDATE design_journey_stages SET version = version + 1 WHERE workspace_id = $1 AND case_id = $2 AND stage = 'site_visit'`, [workspaceId, caseId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.site_visit_answered.v1", entityType: "pre_project_case", entityId: caseId, after: { keys: input.answers.map((item) => item.key) } });
      return this.view(client, workspaceId, caseId);
    });
  }

  /** PLM-048/128/080: done only with every wall measured and photographed and every question answered; the QS is told on a joinery order. */
  completeSiteVisit(actor: RequestActor, workspaceId: string, caseId: string, input: { summary: string; version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "site_visit", input.version);
      if (!input.summary?.trim()) throw new UnprocessableEntityException("Summarise what was found on site");
      const measurements = await this.measurements(client, workspaceId, caseId);
      const problem = siteEvidenceProblem(measurements) ?? siteChecklistProblem(await this.questions(client, workspaceId, caseId), (await this.answers(client, workspaceId, caseId)).map((row) => row.key));
      if (problem) throw new UnprocessableEntityException(problem);
      const files = measurements.reduce((sum, item) => sum + item.files, 0);
      const summary = input.summary.trim();
      await completeStage(client, workspaceId, caseId, "site_visit", userId, summary);
      await recordProjectSiteVisit(client, workspaceId, caseId, summary, `${measurements.length} measurement sets, ${files} files`, userId);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.site_visit_completed.v1", entityType: "pre_project_case", entityId: caseId, after: { measurements: measurements.length, files } });
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
      return this.view(client, workspaceId, caseId);
    });
  }

  /**
   * PLM-050: the material list is confirmed when it has materials and the client confirmed every one (the
   * ledger's current versions). Renders unlock next (PLM-051).
   */
  confirmMaterialList(actor: RequestActor, workspaceId: string, caseId: string, input: { version: number }) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await this.activeStage(client, workspaceId, caseId, "material_selection", input.version);
      const ledger = await readLedger(client, workspaceId, caseId);
      const materials = ledger.entries.filter((entry) => !entry.archivedAt && entry.kind === "material");
      if (!materials.length) throw new UnprocessableEntityException("Add the materials to the list first");
      const waiting = materials.filter((entry) => entry.current?.status !== "confirmed");
      if (waiting.length) throw new ConflictException(`Waiting for the client's confirmation: ${waiting.slice(0, 3).map((entry) => entry.title).join(", ")}${waiting.length > 3 ? ` and ${waiting.length - 3} more` : ""}`);
      await completeStage(client, workspaceId, caseId, "material_selection", userId, `${materials.length} materials confirmed`, "material_list_confirmed");
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "design.material_list_confirmed.v1", entityType: "pre_project_case", entityId: caseId, after: { materials: materials.length } });
      return this.view(client, workspaceId, caseId);
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
      return this.view(client, workspaceId, caseId);
    });
  }

  /** PLM-051: the reviewer assigns a stage's owner (the Visualiser for renders, when nobody holds the role yet). */
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
      return this.view(client, workspaceId, caseId);
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
      return this.view(client, workspaceId, caseId);
    });
  }

  /**
   * PLM-053: the client's sign-off of the final design, with its date, who signed, how, and the signed file. Every
   * design stage is done, every current design approved, no blocking comment open, and every material and design
   * choice confirmed by the client — the ledger is locked here (PLM-054). The Account Manager and the Sales Admin
   * are told and the estimate's week starts; then the Proposal 2 estimate is prepared (best effort, see handOff).
   */
  async signOff(actor: RequestActor, workspaceId: string, caseId: string, input: SignOffInput) {
    const view = await this.review(actor, workspaceId, caseId, async (client, userId) => {
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
        const members = [...new Set([facts.accountManagerId, await salesAdminMembership(client, workspaceId)].filter((id): id is string => Boolean(id)))];
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
      return this.view(client, workspaceId, caseId);
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

  private async view(client: PoolClient, workspaceId: string, caseId: string) {
    const journey = (await client.query<{ packageId: string | null; packageName: string | null; includedRevisions: number; questions: unknown; approvedOn: string | null; approvalAssetId: string | null; approvalAssetName: string | null; estimateDueAt: Date | null; version: number } & Record<string, unknown>>(
      `SELECT journey.package_id AS "packageId", journey.package_name AS "packageName", journey.included_revisions AS "includedRevisions", journey.includes_space_planning AS "includesSpacePlanning", journey.includes_renders AS "includesRenders",
              journey.reviewer_role_code AS "reviewerRoleCode", journey.inspiration_days AS "inspirationDays", journey.site_visit_hours AS "siteVisitHours", journey.started_at AS "startedAt",
              journey.design_internal_days AS "designInternalDays", journey.design_client_days AS "designClientDays", journey.material_selection_days AS "materialSelectionDays", journey.estimate_days AS "estimateDays",
              journey.site_visit_questions AS questions, to_char(journey.approved_on, 'YYYY-MM-DD') AS "approvedOn", journey.approval_asset_id AS "approvalAssetId", asset.original_name AS "approvalAssetName",
              journey.approval_signer AS "approvalSigner", journey.approval_method AS "approvalMethod", journey.estimate_due_at AS "estimateDueAt", journey.estimate_quote_id AS "estimateQuoteId", journey.version
         FROM design_journeys journey LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = journey.workspace_id AND asset.id = journey.approval_asset_id
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
                  AND ev.action IN ('completed', 'approved', 'chosen', 'skipped', 'not_required', 'material_list_confirmed', 'timer_ended', 'closed_early', 'signed_off') ORDER BY ev.occurred_at DESC LIMIT 1) AS outcome
         FROM design_journey_stages stage
         LEFT JOIN workspace_memberships member ON member.id = stage.owner_membership_id LEFT JOIN users account ON account.id = member.user_id
         LEFT JOIN users completer ON completer.id = stage.completed_by
         LEFT JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
        WHERE stage.workspace_id = $1 AND stage.case_id = $2 ORDER BY stage.position`, [workspaceId, caseId])).rows
      .map((row) => ({ ...row, label: STAGE_LABELS[row.stage], overdue: row.status === "active" && row.dueAt instanceof Date && row.dueAt.getTime() < Date.now(),
        revisions: isDeliverableStage(row.stage) ? stageRevisions(roundsOf(row.stage), journey.includedRevisions) : null })) : [];
    const measurements = journey ? await this.measurements(client, workspaceId, caseId) : [];
    const questions = journey ? normaliseSiteQuestions(journey.questions) : [];
    const answers = journey ? await this.answers(client, workspaceId, caseId) : [];
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    const progress = journey ? await stageProgress(client, workspaceId, caseId) : [];
    const ledger = journey ? await readLedger(client, workspaceId, caseId) : null;
    const { questions: _questions, ...journeyView } = journey ?? { questions: null };
    void _questions;
    // Before the journey starts: what it will be, so the button says "Start design" or "Start site visit".
    const startsAs = journey ? null : (await client.query<{ packaged: boolean }>(
      `SELECT discovery.design_package_id IS NOT NULL AS packaged FROM pre_project_cases pre_case
         LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.packaged ? "design" : "site_and_materials";
    return {
      journey: journey ? { ...journeyView, kind: journey.packageId || journey.packageName ? "design" : "site_and_materials" } : null, startsAs,
      stages: stages.map((stage) => ({ ...stage, progress: progress.find((item) => item.stage === stage.stage) ?? null })),
      measurements, siteEvidenceProblem: journey ? siteEvidenceProblem(measurements) : null,
      checklist: questions.map((question) => ({ ...question, ...(answers.find((answer) => answer.key === question.key) ?? { answer: null, answeredByName: null, answeredAt: null }) })),
      siteChecklistProblem: journey ? siteChecklistProblem(questions, answers.map((answer) => answer.key)) : null,
      ledger: ledger ? { state: ledger.state, lockProblem: ledger.lockProblem, lock: ledger.lock, materials: ledger.entries.filter((entry) => !entry.archivedAt && entry.kind === "material").length,
        waiting: ledger.entries.filter((entry) => !entry.archivedAt && entry.current?.status !== "confirmed").length } : null,
      showroomBooking: Boolean(await this.showroomType(client, workspaceId)),
      timezone,
    };
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

  private async questions(client: PoolClient, workspaceId: string, caseId: string): Promise<SiteQuestion[]> {
    return normaliseSiteQuestions((await client.query<{ questions: unknown }>(`SELECT site_visit_questions AS questions FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.questions);
  }

  private async answers(client: PoolClient, workspaceId: string, caseId: string) {
    return (await client.query<{ key: string; answer: string; answeredByName: string | null; answeredAt: Date }>(
      `SELECT answer.question_key AS key, answer.answer, account.display_name AS "answeredByName", answer.answered_at AS "answeredAt"
         FROM design_site_visit_answers answer LEFT JOIN users account ON account.id = answer.answered_by WHERE answer.workspace_id = $1 AND answer.case_id = $2`, [workspaceId, caseId])).rows;
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

  /** Stage decisions are the design reviewer's (the Creative Director role). */
  private review<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.review_designs"], async (client, user) => {
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
