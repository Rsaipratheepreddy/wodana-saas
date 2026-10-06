import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { caseFacts, formatDay, membersWithRole } from "../design/design-journey.store";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { BOOKING_LABEL, bookingDays, bookingProblem, isTeam, plusDays, pushPlan, rangeProblem, type BookingKind, type Pushed, type Team } from "./team-calendars.domain";
import { bookingDefaults, readEntries, readTargets } from "./team-calendars.store";
import { endOfWorkingDay, workspaceClock } from "./workspace-clock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Who reads each team's calendar, and who sets where it is pushed. */
const READ: Record<Team, string[]> = {
  design: ["pre_projects.view"],
  logistics: ["factory.view", "factory.manage", "projects.view", "projects.manage", "logistics.manage"],
};
const MANAGE: Record<Team, string[]> = {
  design: ["crm.settings.manage", "workspace.settings.manage"],
  logistics: ["factory.manage", "logistics.manage", "workspace.settings.manage"],
};
/** Who books on each team's calendar: designers their render and 2D time; the factory and logistics managers deliveries, installations, permits and production. */
const BOOK: Record<Team, string[]> = { design: ["pre_projects.edit"], logistics: ["logistics.manage", "factory.manage"] };
/** Push window: last week to three months ahead. */
const PUSH_BACK = 7, PUSH_AHEAD = 90;

export type BookInput = { caseId?: unknown; kind?: unknown; assigneeMembershipId?: unknown; startsOn?: unknown; days?: unknown; note?: unknown; commandId?: unknown };
export type TargetInput = { connectionId?: string | null; calendarId?: string | null; version?: number; renderDays?: number; drawingDays?: number };
export type PushResult = { entryKey: string; eventId?: string | null; etag?: string | null; fingerprint?: string | null; startsOn?: string | null; removed?: boolean };

type BookingRow = { id: string; caseId: string; kind: BookingKind; status: string; startsOn: string; dueOn: string; days: number; activityId: string | null; version: number; assigneeId: string };

/**
 * Team calendars (PLM-090, PLM-091). The design and the factory/logistics calendars read their teams' work from the
 * records; designers book render and 2D time (the work item is a task for the person tagged); each team can name one
 * Google calendar its work is pushed to. Commands are validated, idempotent (a command id), version-checked and audited.
 */
@Injectable()
export class TeamCalendarsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  entries(actor: RequestActor, workspaceId: string, team: string, from: string, to: string) {
    const which = this.team(team);
    const problem = rangeProblem(from, to);
    if (problem) throw new BadRequestException(problem);
    return this.access.withAnyPermission(actor, workspaceId, READ[which], async (client, user) => {
      const clock = await workspaceClock(client, workspaceId);
      const targets = await readTargets(client, workspaceId);
      return {
        team: which, today: clock.today, timeZone: clock.timeZone, entries: await readEntries(client, workspaceId, which, from, to, clock),
        canBook: await this.allowed(client, workspaceId, user.userId, BOOK[which]),
        canManage: await this.allowed(client, workspaceId, user.userId, MANAGE[which]),
        google: Boolean(targets[which].connectionId && targets[which].calendarId),
      };
    });
  }

  /** The two teams' Google targets and the days render and 2D time need by default. */
  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [...READ.design, ...READ.logistics], (client, user) => this.settingsView(client, workspaceId, user.userId));
  }

  /**
   * Where a team calendar is pushed (a connected Google calendar, or none to keep it in Wodana) and, for the design
   * team, the days a render and 2D drawings need by default. Version-checked; audited.
   */
  saveSettings(actor: RequestActor, workspaceId: string, team: string, input: TargetInput) {
    const which = this.team(team);
    const connectionId = input.connectionId || null, calendarId = input.calendarId?.trim() || null;
    if (Boolean(connectionId) !== Boolean(calendarId)) throw new UnprocessableEntityException("Choose a Google calendar, or none");
    if (connectionId && !UUID.test(connectionId)) throw new BadRequestException("Choose a Google calendar");
    if (calendarId && calendarId.length > 500) throw new BadRequestException("Choose a Google calendar");
    for (const days of [input.renderDays, input.drawingDays]) if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 60)) throw new UnprocessableEntityException("Days are between 1 and 60");
    if (which !== "design" && (input.renderDays !== undefined || input.drawingDays !== undefined)) throw new BadRequestException("Render days belong to the design team");
    return this.access.withAnyPermission(actor, workspaceId, MANAGE[which], async (client, user) => {
      const before = (await client.query<{ connectionId: string | null; calendarId: string | null; version: number }>(
        `SELECT connection_id AS "connectionId", calendar_id AS "calendarId", version FROM workspace_team_calendars WHERE workspace_id = $1 AND team = $2 FOR UPDATE`, [workspaceId, which])).rows[0];
      if ((before?.version ?? 0) !== (input.version ?? 0)) throw new ConflictException("Someone changed this calendar's settings. Reload and try again.");
      if (connectionId && !(await client.query(
        `SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND id = $2 AND provider = 'google_workspace' AND status IN ('connected', 'degraded')`, [workspaceId, connectionId])).rowCount)
        throw new UnprocessableEntityException("Connect that Google account first");
      if ((before?.connectionId ?? null) !== connectionId || (before?.calendarId ?? null) !== calendarId || !before) {
        await client.query(
          `INSERT INTO workspace_team_calendars (workspace_id, team, connection_id, calendar_id, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, team) DO UPDATE SET connection_id = excluded.connection_id, calendar_id = excluded.calendar_id, updated_by = excluded.updated_by,
             updated_at = now(), version = workspace_team_calendars.version + 1`, [workspaceId, which, connectionId, calendarId, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "team_calendar.target_changed.v1", entityType: "workspace_team_calendar", entityId: workspaceId,
          before: before ? { team: which, connectionId: before.connectionId, calendarId: before.calendarId } : null, after: { team: which, connectionId, calendarId } });
      }
      if (which === "design" && (input.renderDays !== undefined || input.drawingDays !== undefined)) {
        const defaults = await bookingDefaults(client, workspaceId);
        const renderDays = input.renderDays ?? defaults.renderDays, drawingDays = input.drawingDays ?? defaults.drawingDays;
        if (renderDays !== defaults.renderDays || drawingDays !== defaults.drawingDays) {
          await client.query(
            `INSERT INTO workspace_design_settings (workspace_id, render_days, drawing_days, updated_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id) DO UPDATE SET render_days = excluded.render_days, drawing_days = excluded.drawing_days, updated_by = excluded.updated_by,
               updated_at = now(), version = workspace_design_settings.version + 1`, [workspaceId, renderDays, drawingDays, user.userId]);
          await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.booking_days_changed.v1", entityType: "workspace_design_settings", entityId: workspaceId,
            before: { renderDays: defaults.renderDays, drawingDays: defaults.drawingDays }, after: { renderDays, drawingDays } });
        }
      }
      return this.settingsView(client, workspaceId, user.userId);
    });
  }

  /** The two teams' Google targets, the default days, and which team calendars this person reads and sets. */
  private async settingsView(client: PoolClient, workspaceId: string, userId: string) {
    const defaults = await bookingDefaults(client, workspaceId);
    const can = async (codes: Record<Team, string[]>) => ({ design: await this.allowed(client, workspaceId, userId, codes.design), logistics: await this.allowed(client, workspaceId, userId, codes.logistics) });
    return { targets: await readTargets(client, workspaceId), renderDays: defaults.renderDays, drawingDays: defaults.drawingDays, designVersion: defaults.version,
      canRead: await can(READ), canManage: await can(MANAGE) };
  }

  /** What a designer picks from to book render or 2D time: the open cases and the people (the Visualisers first). */
  bookingOptions(actor: RequestActor, workspaceId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client) => {
      const defaults = await bookingDefaults(client, workspaceId);
      const visualisers = new Set(await membersWithRole(client, workspaceId, defaults.visualiserRoleCode));
      const cases = (await client.query<{ id: string; title: string }>(
        `SELECT pre_case.id, concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title)) AS title
           FROM pre_project_cases pre_case
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE pre_case.workspace_id = $1 AND pre_case.status IN ('draft', 'active', 'on_hold', 'released')
          ORDER BY pre_case.updated_at DESC NULLS LAST, pre_case.id LIMIT 300`, [workspaceId])).rows;
      const members = (await client.query<{ id: string; name: string }>(
        `SELECT member.id, person.display_name AS name FROM workspace_memberships member JOIN users person ON person.id = member.user_id
          WHERE member.workspace_id = $1 AND member.status = 'active' ORDER BY person.display_name, member.id`, [workspaceId])).rows
        .map((member) => ({ ...member, visualiser: visualisers.has(member.id) }))
        .sort((a, b) => Number(b.visualiser) - Number(a.visualiser));
      return { cases, members, renderDays: defaults.renderDays, drawingDays: defaults.drawingDays };
    });
  }

  /**
   * A designer books render or 2D time on a case and tags the person who does it: the booking (the calendar entry) and
   * that person's task (the work item) are made together; they hear it. Runs the work calendar's working days from the
   * first working day on or after the day asked. Idempotent per command id.
   */
  book(actor: RequestActor, workspaceId: string, input: BookInput) {
    const problem = bookingProblem({ ...input, days: input.days ?? 1 });
    if (problem) throw new UnprocessableEntityException(problem);
    if (typeof input.caseId !== "string" || !UUID.test(input.caseId)) throw new BadRequestException("Choose the job");
    if (typeof input.assigneeMembershipId !== "string" || !UUID.test(input.assigneeMembershipId)) throw new UnprocessableEntityException("Tag who does the work");
    if (typeof input.commandId !== "string" || !UUID.test(input.commandId)) throw new BadRequestException("A command id is required");
    const caseId = input.caseId, assignee = input.assigneeMembershipId, commandId = input.commandId, kind = input.kind as BookingKind;
    const note = typeof input.note === "string" ? input.note.trim() : "";
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      const done = (await client.query<{ id: string }>(`SELECT id FROM design_work_bookings WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, commandId])).rows[0];
      if (done) return this.booking(client, workspaceId, done.id);
      const facts = await caseFacts(client, workspaceId, caseId);
      if (!facts) throw new NotFoundException("Job not found");
      const member = (await client.query<{ userId: string; name: string }>(
        `SELECT member.user_id AS "userId", person.display_name AS name FROM workspace_memberships member JOIN users person ON person.id = member.user_id
          WHERE member.workspace_id = $1 AND member.id = $2 AND member.status = 'active'`, [workspaceId, assignee])).rows[0];
      if (!member) throw new UnprocessableEntityException("Tag an active member of the team");
      const defaults = await bookingDefaults(client, workspaceId);
      const days = input.days === undefined || input.days === null ? (kind === "render" ? defaults.renderDays : defaults.drawingDays) : Number(input.days);
      const clock = await workspaceClock(client, workspaceId);
      const span = bookingDays(String(input.startsOn), days, clock);
      const activity = (await client.query<{ id: string }>(
        `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, description, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
         VALUES ($1, $2, $3, $4, 'task'::crm_activity_type, 'internal', $5, $6, $7, 'high', $8, false, false, $9) RETURNING id`,
        [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, `${BOOKING_LABEL[kind]} · ${facts.clientName}`.slice(0, 240), note || null, assignee,
          endOfWorkingDay(span.dueOn, clock), user.userId])).rows[0];
      const row = (await client.query<{ id: string }>(
        `INSERT INTO design_work_bookings (workspace_id, case_id, kind, note, assignee_membership_id, starts_on, days, due_on, activity_id, command_id, booked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [workspaceId, caseId, kind, note, assignee, span.startsOn, days, span.dueOn, activity.id, commandId, user.userId])).rows[0];
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.work_booked.v1", entityType: "design_work_booking", entityId: row.id,
        after: { caseId, kind, assignee, startsOn: span.startsOn, days, dueOn: span.dueOn, activityId: activity.id } });
      if (member.userId !== user.userId) {
        const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
        const variables = { kind: BOOKING_LABEL[kind], clientName: facts.clientName, actor: actorName, date: formatDay(span.startsOn, clock.locale), due: formatDay(span.dueOn, clock.locale),
          days: days === 1 ? "1 day" : `${days} days`, note };
        const message = { workspaceId, recipientUserId: member.userId, code: "design.work_booked", eventType: "design.work_booked", variables, deepLink: `/workspace/pre-projects/cases/${caseId}/overview` };
        await notifyUserInApp(client, { ...message, idempotencyKey: `design-work:${row.id}:booked:${member.userId}` });
        await queueUserEmail(client, { ...message, idempotencyKey: `design-work:${row.id}:booked:${member.userId}:email` });
      }
      return this.booking(client, workspaceId, row.id);
    });
  }

  /** Marks booked time done (its task with it), cancels it, or moves it (start day and days). Version-checked; audited. */
  changeBooking(actor: RequestActor, workspaceId: string, bookingId: string, action: string, input: { version?: number; startsOn?: unknown; days?: unknown; reason?: unknown }) {
    if (!["complete", "cancel", "move"].includes(action)) throw new BadRequestException("Unknown change");
    if (action === "move") { const problem = bookingProblem({ kind: "render", startsOn: input.startsOn, days: input.days }); if (problem) throw new UnprocessableEntityException(problem); }
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      const before = (await client.query<BookingRow>(
        `SELECT id, case_id AS "caseId", kind, status, starts_on::text AS "startsOn", due_on::text AS "dueOn", days, activity_id AS "activityId", version, assignee_membership_id AS "assigneeId"
           FROM design_work_bookings WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, bookingId])).rows[0];
      if (!before) throw new NotFoundException("Booking not found");
      if (before.version !== input.version) throw new ConflictException("This booking changed. Reload and try again.");
      if (before.status !== "booked") throw new ConflictException(before.status === "done" ? "This work is already done." : "This booking is cancelled.");
      let after: Record<string, unknown>;
      if (action === "complete") {
        await client.query(`UPDATE design_work_bookings SET status = 'done', done_by = $3, done_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, bookingId, user.userId]);
        if (before.activityId) await client.query(`UPDATE crm_activities SET status = 'completed', completed_at = now(), completion_outcome = 'Done', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`,
          [workspaceId, before.activityId]);
        after = { status: "done" };
      } else if (action === "cancel") {
        const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
        await client.query(`UPDATE design_work_bookings SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, bookingId, user.userId]);
        if (before.activityId) await client.query(`UPDATE crm_activities SET status = 'cancelled', completion_outcome = 'Booking cancelled', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`,
          [workspaceId, before.activityId]);
        after = { status: "cancelled", reason };
      } else {
        const clock = await workspaceClock(client, workspaceId);
        const days = Number(input.days);
        const span = bookingDays(String(input.startsOn), days, clock);
        await client.query(`UPDATE design_work_bookings SET starts_on = $3, days = $4, due_on = $5, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, bookingId, span.startsOn, days, span.dueOn]);
        if (before.activityId) await client.query(`UPDATE crm_activities SET due_at = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'pending'`,
          [workspaceId, before.activityId, endOfWorkingDay(span.dueOn, clock)]);
        after = { startsOn: span.startsOn, days, dueOn: span.dueOn };
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `design.work_${action === "complete" ? "done" : action === "cancel" ? "cancelled" : "moved"}.v1`, entityType: "design_work_booking", entityId: bookingId,
        before: { status: before.status, startsOn: before.startsOn, days: before.days, dueOn: before.dueOn }, after });
      return this.booking(client, workspaceId, bookingId);
    });
  }

  /**
   * What to send to the team's Google calendar now (created, updated, cancelled), for last week to three months
   * ahead. The browser sends it through the person's Google connection and records what Google returned.
   */
  pushPlan(actor: RequestActor, workspaceId: string, team: string) {
    const which = this.team(team);
    return this.access.withAnyPermission(actor, workspaceId, MANAGE[which], async (client) => {
      const target = (await readTargets(client, workspaceId))[which];
      if (!target.connectionId || !target.calendarId) throw new ConflictException("Choose the Google calendar for this team first");
      const clock = await workspaceClock(client, workspaceId);
      const window = { from: plusDays(clock.today, -PUSH_BACK), to: plusDays(clock.today, PUSH_AHEAD) };
      const entries = await readEntries(client, workspaceId, which, window.from, window.to, clock);
      const pushed = await this.pushed(client, workspaceId, which, target.connectionId, target.calendarId);
      return { team: which, connectionId: target.connectionId, calendarId: target.calendarId, timeZone: clock.timeZone, workingHours: { start: clock.start, end: clock.end },
        ...pushPlan(entries, pushed, window, clock.timeZone) };
    });
  }

  /** Records what Google returned for a push: the event that holds each entry, or that an entry's event was cancelled. */
  recordPushes(actor: RequestActor, workspaceId: string, team: string, input: { connectionId?: string; calendarId?: string; results?: PushResult[] }) {
    const which = this.team(team);
    const results = Array.isArray(input.results) ? input.results : [];
    if (results.length > 500) throw new BadRequestException("Send at most 500 results at once");
    for (const result of results) {
      if (typeof result?.entryKey !== "string" || !/^[a-z-]+:[0-9a-z:_-]{1,110}$/i.test(result.entryKey)) throw new BadRequestException("Unknown entry");
      if (!result.removed && (typeof result.eventId !== "string" || !result.eventId || result.eventId.length > 200 || typeof result.etag !== "string" || !result.etag || result.etag.length > 500
        || typeof result.fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(result.fingerprint) || typeof result.startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.startsOn)))
        throw new BadRequestException("Incomplete push result");
    }
    return this.access.withAnyPermission(actor, workspaceId, MANAGE[which], async (client, user) => {
      const target = (await readTargets(client, workspaceId))[which];
      if (!target.connectionId || target.connectionId !== input.connectionId || target.calendarId !== input.calendarId) throw new ConflictException("The team's Google calendar changed. Send again.");
      let saved = 0, removed = 0;
      for (const result of results) {
        if (result.removed) {
          removed += (await client.query(`DELETE FROM team_calendar_pushes WHERE workspace_id = $1 AND team = $2 AND connection_id = $3 AND calendar_id = $4 AND entry_key = $5`,
            [workspaceId, which, target.connectionId, target.calendarId, result.entryKey])).rowCount ?? 0;
          continue;
        }
        await client.query(
          `INSERT INTO team_calendar_pushes (workspace_id, team, connection_id, calendar_id, entry_key, event_id, etag, fingerprint, starts_on, pushed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (workspace_id, team, connection_id, calendar_id, entry_key) DO UPDATE SET event_id = excluded.event_id, etag = excluded.etag,
             fingerprint = excluded.fingerprint, starts_on = excluded.starts_on, pushed_by = excluded.pushed_by, pushed_at = now()`,
          [workspaceId, which, target.connectionId, target.calendarId, result.entryKey, result.eventId, result.etag, result.fingerprint, result.startsOn, user.userId]);
        saved++;
      }
      if (saved || removed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "team_calendar.pushed.v1", entityType: "workspace_team_calendar", entityId: workspaceId,
        after: { team: which, saved, removed } });
      return { saved, removed };
    });
  }

  private async pushed(client: PoolClient, workspaceId: string, team: Team, connectionId: string, calendarId: string): Promise<Pushed[]> {
    return (await client.query<Pushed>(
      `SELECT entry_key AS "entryKey", event_id AS "eventId", etag, fingerprint, starts_on::text AS "startsOn" FROM team_calendar_pushes
        WHERE workspace_id = $1 AND team = $2 AND connection_id = $3 AND calendar_id = $4 ORDER BY entry_key`, [workspaceId, team, connectionId, calendarId])).rows;
  }

  private async booking(client: PoolClient, workspaceId: string, id: string) {
    return (await client.query(
      `SELECT id, case_id AS "caseId", kind, note, assignee_membership_id AS "assigneeMembershipId", starts_on::text AS "startsOn", days, due_on::text AS "dueOn", status,
              activity_id AS "activityId", version FROM design_work_bookings WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  }

  private async allowed(client: PoolClient, workspaceId: string, userId: string, codes: string[]) {
    for (const code of codes) if (await this.access.hasPermission(client, workspaceId, userId, code)) return true;
    return false;
  }

  private team(value: string): Team {
    if (!isTeam(value)) throw new NotFoundException("Unknown team calendar");
    return value;
  }
}
