import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RequestActor } from "../auth/actor";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";
import { TimeDecisionDto, TimeWeekDto, VersionDto } from "./hrms.dto";
import { addDays, Calendar, dateOnly, dateRange, formatDates, LeaveUnit, localDate } from "./hrms-domain";

type Entry = { id: string; workDate: string; projectId: string | null; projectName: string | null; stageId: string | null; stageName: string | null; minutes: number; note: string };

const minutesBetween = (from: string, to: string) => {
  const [a, b] = [from, to].map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
  return b - a;
};
/** Minutes a calendar expects on a day: its working hours on working days, nothing on days off. */
export function scheduledMinutes(calendar: Calendar, date: string) {
  const working = calendar.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) && !calendar.holidays.includes(date);
  return working ? minutesBetween(calendar.dayStart, calendar.dayEnd) : 0;
}
const formatHours = (minutes: number) => {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
};

/**
 * Studio timesheets (plan §6.28, H4): people log hours per day against a project and its stage, or
 * internal work, week by week; their manager (never themself) approves the week. Approved hours give
 * each project its hours by person and stage, and each person their utilisation (project hours over
 * the hours their calendar expects, less leave).
 */
@Injectable()
export class HrmsTimeService {
  constructor(private readonly access: HrmsAccessService) {}

  private async weekStart(ctx: HrmsContext, date: string) {
    dateOnly(date);
    const first = (await ctx.client.query<{ day: number | null }>(`SELECT week_starts_on AS day FROM workspaces WHERE id=$1`, [ctx.workspaceId])).rows[0]?.day ?? 1;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return addDays(date, -((weekday - first + 7) % 7));
  }

  /** Projects the person can log hours to: the running ones they're on (all of them for people who run projects), with their stages. */
  private async options(ctx: HrmsContext) {
    const all = ctx.permissions.has("projects.manage");
    const projects = (await ctx.client.query<{ id: string; name: string }>(
      `SELECT project.id, coalesce(project.reference || ' · ', '') || project.name AS name FROM delivery_projects project
        WHERE project.workspace_id=$1 AND project.status IN ('active', 'on_hold')
          AND ($3 OR EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id
                                AND assignment.membership_id = $2 AND assignment.active))
        ORDER BY project.reference NULLS LAST, project.name`,
      [ctx.workspaceId, ctx.membershipId, all],
    )).rows;
    const stages = (await ctx.client.query<{ id: string; projectId: string; name: string }>(
      `SELECT id, project_id AS "projectId", name FROM project_stages WHERE workspace_id=$1 AND project_id = ANY($2::uuid[]) ORDER BY project_id, position`,
      [ctx.workspaceId, projects.map((project) => project.id)],
    )).rows;
    return projects.map((project) => ({ ...project, stages: stages.filter((stage) => stage.projectId === project.id).map(({ id, name }) => ({ id, name })) }));
  }

  private async entries(ctx: HrmsContext, timesheetId: string): Promise<Entry[]> {
    return (await ctx.client.query<Entry>(
      `SELECT entry.id, entry.work_date::text AS "workDate", entry.project_id AS "projectId", coalesce(project.reference || ' · ', '') || project.name AS "projectName",
              entry.stage_id AS "stageId", stage.name AS "stageName", entry.minutes, entry.note
         FROM hrms_time_entries entry
         LEFT JOIN delivery_projects project ON project.workspace_id = entry.workspace_id AND project.id = entry.project_id
         LEFT JOIN project_stages stage ON stage.workspace_id = entry.workspace_id AND stage.id = entry.stage_id
        WHERE entry.workspace_id=$1 AND entry.timesheet_id=$2 ORDER BY entry.work_date, entry.id`,
      [ctx.workspaceId, timesheetId],
    )).rows;
  }

  private async sheet(ctx: HrmsContext, membershipId: string, weekStart: string) {
    return (await ctx.client.query<{ id: string; status: string; version: number; submittedAt: string | null; decidedByName: string | null; decisionNote: string }>(
      `SELECT sheet.id, sheet.status, sheet.version, sheet.submitted_at AS "submittedAt", decider.display_name AS "decidedByName", sheet.decision_note AS "decisionNote"
         FROM hrms_timesheets sheet LEFT JOIN users decider ON decider.id = sheet.decided_by
        WHERE sheet.workspace_id=$1 AND sheet.membership_id=$2 AND sheet.week_start=$3`,
      [ctx.workspaceId, membershipId, weekStart],
    )).rows[0] ?? null;
  }

  /** A person's week: each day's expected minutes and leave, the week's status and hours, and where they can log. */
  private async week(ctx: HrmsContext, membershipId: string, weekStart: string) {
    const employee = await this.access.employee(ctx, membershipId);
    const dates = dateRange(weekStart, addDays(weekStart, 6), 7);
    const leave = (await ctx.client.query<{ units: LeaveUnit[] }>(
      `SELECT units FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND status IN ('approved', 'cancellation_pending')
          AND start_date <= $4 AND end_date >= $3`,
      [ctx.workspaceId, membershipId, weekStart, addDays(weekStart, 6)],
    )).rows.flatMap((row) => row.units);
    const days = dates.map((date) => {
      const away = leave.filter((unit) => unit.date === date).reduce((sum, unit) => sum + unit.days, 0);
      const expected = scheduledMinutes(employee.calendar, date);
      return { date, scheduledMinutes: Math.round(expected * (1 - Math.min(1, away))), leaveDays: away };
    });
    const sheet = await this.sheet(ctx, membershipId, weekStart);
    const entries = sheet ? await this.entries(ctx, sheet.id) : [];
    return { membershipId, name: employee.name, weekStart, days, timesheet: sheet, entries, totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0) };
  }

  mine(actor: RequestActor, workspaceId: string, date: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.access.self(ctx);
      const weekStart = await this.weekStart(ctx, date);
      return { ...(await this.week(ctx, ctx.membershipId, weekStart)), options: await this.options(ctx) };
    });
  }

  /** A person's hours for the week, as a whole: the entries replace what was there. Only while it's a draft or sent back. */
  saveWeek(actor: RequestActor, workspaceId: string, weekStartInput: string, input: TimeWeekDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const employee = await this.access.self(ctx);
      const weekStart = await this.weekStart(ctx, weekStartInput);
      if (weekStart !== weekStartInput) throw new BadRequestException("Choose the first day of a week.");
      await this.access.lock(ctx);
      const today = localDate(new Date(), employee.calendar.timezone);
      const sheet = await this.sheet(ctx, ctx.membershipId, weekStart);
      this.access.version(sheet?.version, input.version);
      if (sheet && !["draft", "returned"].includes(sheet.status)) throw new ConflictException("This week was already submitted.");
      const options = await this.options(ctx);
      const perDay = new Map<string, number>();
      for (const entry of input.entries) {
        dateOnly(entry.workDate);
        if (entry.workDate < weekStart || entry.workDate > addDays(weekStart, 6)) throw new BadRequestException("Every entry is within the week.");
        if (entry.workDate > today) throw new BadRequestException("Hours are logged for days that have happened.");
        if (entry.workDate < employee.activeFrom) throw new BadRequestException("Hours start from the day you joined.");
        if (entry.projectId) {
          const project = options.find((option) => option.id === entry.projectId);
          if (!project) throw new BadRequestException("Choose a project you're on.");
          if (entry.stageId && !project.stages.some((stage) => stage.id === entry.stageId)) throw new BadRequestException("Choose a stage of that project.");
        } else if (entry.stageId) throw new BadRequestException("A stage belongs to a project.");
        perDay.set(entry.workDate, (perDay.get(entry.workDate) ?? 0) + entry.minutes);
      }
      if ([...perDay.values()].some((minutes) => minutes > 1440)) throw new BadRequestException("A day has at most 24 hours.");
      let id = sheet?.id;
      if (!id)
        id = (await ctx.client.query<{ id: string }>(
          `INSERT INTO hrms_timesheets(workspace_id,membership_id,owner_user_id,week_start) VALUES($1,$2,$3,$4) RETURNING id`,
          [workspaceId, ctx.membershipId, ctx.userId, weekStart],
        )).rows[0].id;
      else await ctx.client.query(`UPDATE hrms_timesheets SET status='draft',version=version+1 WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      await ctx.client.query(`DELETE FROM hrms_time_entries WHERE workspace_id=$1 AND timesheet_id=$2`, [workspaceId, id]);
      for (const entry of input.entries)
        await ctx.client.query(
          `INSERT INTO hrms_time_entries(workspace_id,timesheet_id,work_date,project_id,stage_id,minutes,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [workspaceId, id, entry.workDate, entry.projectId ?? null, entry.stageId ?? null, entry.minutes, entry.note.trim()],
        );
      await this.access.audit(ctx, "timesheet_saved", id, { weekStart, entries: input.entries.length, minutes: [...perDay.values()].reduce((a, b) => a + b, 0) });
      return { ...(await this.week(ctx, ctx.membershipId, weekStart)), options };
    });
  }

  submit(actor: RequestActor, workspaceId: string, id: string, input: VersionDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.access.self(ctx);
      await this.access.lock(ctx);
      const sheet = (await ctx.client.query<{ membershipId: string; weekStart: string; status: string; version: number }>(
        `SELECT membership_id AS "membershipId", week_start::text AS "weekStart", status, version FROM hrms_timesheets WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspaceId, id],
      )).rows[0];
      if (!sheet || sheet.membershipId !== ctx.membershipId) throw new NotFoundException("Timesheet not found.");
      this.access.version(sheet.version, input.version);
      if (!["draft", "returned"].includes(sheet.status)) throw new ConflictException("This week was already submitted.");
      const minutes = (await this.entries(ctx, id)).reduce((sum, entry) => sum + entry.minutes, 0);
      if (!minutes) throw new BadRequestException("Log some hours before submitting the week.");
      await ctx.client.query(`UPDATE hrms_timesheets SET status='submitted',submitted_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      await this.access.audit(ctx, "timesheet_submitted", id, { weekStart: sheet.weekStart, minutes });
      const locale = await this.access.locale(ctx);
      await this.access.notify(ctx, [{
        code: "hrms.timesheet_submitted", users: await this.access.approvers(ctx, ctx.membershipId),
        variables: { person: await this.access.nameOf(ctx, ctx.membershipId), dates: formatDates(sheet.weekStart, addDays(sheet.weekStart, 6), locale), days: formatHours(minutes) },
        deepLink: `/workspace/hrms/team?timesheet=${id}`, key: `hrms.timesheet_submitted:${id}:${sheet.version + 1}`,
      }]);
      return this.week(ctx, ctx.membershipId, sheet.weekStart);
    });
  }

  decide(actor: RequestActor, workspaceId: string, id: string, input: TimeDecisionDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const found = (await ctx.client.query<{ membershipId: string }>(`SELECT membership_id AS "membershipId" FROM hrms_timesheets WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
      if (!found) throw new NotFoundException("Timesheet not found.");
      await this.access.assertReviewer(ctx, found.membershipId);
      await this.access.lock(ctx, found.membershipId);
      const sheet = (await ctx.client.query<{ weekStart: string; status: string; version: number }>(
        `SELECT week_start::text AS "weekStart", status, version FROM hrms_timesheets WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id])).rows[0];
      this.access.version(sheet.version, input.version);
      if (sheet.status !== "submitted") throw new ConflictException("This week isn't waiting for approval.");
      const note = input.note.trim();
      if (input.decision === "return" && note.length < 3) throw new BadRequestException("Say what to change.");
      await ctx.client.query(
        `UPDATE hrms_timesheets SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, input.decision === "approve" ? "approved" : "returned", ctx.userId, note],
      );
      await this.access.audit(ctx, "timesheet_decided", id, { decision: input.decision, note, membershipId: found.membershipId });
      const code = input.decision === "approve" ? "hrms.timesheet_approved" : "hrms.timesheet_returned";
      await this.access.notify(ctx, [{
        code, users: await this.access.userOf(ctx, found.membershipId),
        variables: { dates: formatDates(sheet.weekStart, addDays(sheet.weekStart, 6), await this.access.locale(ctx)), note },
        deepLink: `/workspace/hrms/time?week=${sheet.weekStart}`, key: `${code}:${id}:${sheet.version + 1}`,
      }]);
      return this.week(ctx, found.membershipId, sheet.weekStart);
    });
  }

  /** The week for everyone in the person's scope: logged hours, expected hours and where their timesheet is. */
  team(actor: RequestActor, workspaceId: string, date: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.team", "hrms.manage");
      const weekStart = await this.weekStart(ctx, date);
      const members = (await ctx.client.query<{ membershipId: string }>(
        `SELECT e.membership_id AS "membershipId" FROM hrms_employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.membership_id AND m.status='active'
          WHERE e.workspace_id=$1 AND e.enabled AND e.active_from <= $2::date + 6 AND (e.active_to IS NULL OR e.active_to >= $2::date)`,
        [workspaceId, weekStart],
      )).rows;
      const rows = [];
      for (const { membershipId } of members) {
        if (membershipId === ctx.membershipId || !(await this.access.canManageEmployee(ctx, membershipId))) continue;
        const week = await this.week(ctx, membershipId, weekStart);
        rows.push({ ...week, scheduledMinutes: week.days.reduce((sum, day) => sum + day.scheduledMinutes, 0),
          canDecide: week.timesheet?.status === "submitted" });
      }
      return { weekStart, people: rows.sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }

  /** A project's approved hours by person and stage, for people who run it or see its costs. */
  projectHours(actor: RequestActor, workspaceId: string, projectId: string, from?: string, to?: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      if (from) dateOnly(from);
      if (to) dateOnly(to);
      if (!["hrms.manage", "projects.manage", "commercial.costs.view"].some((code) => ctx.permissions.has(code))) {
        const manager = await ctx.client.query(`SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND is_manager`,
          [workspaceId, projectId, ctx.membershipId]);
        if (!manager.rowCount) throw new ForbiddenException("Only the project's managers see its hours.");
      }
      const rows = (await ctx.client.query<{ membershipId: string; name: string; stageId: string | null; stageName: string | null; minutes: number }>(
        `SELECT sheet.membership_id AS "membershipId", person.display_name AS name, entry.stage_id AS "stageId", stage.name AS "stageName", sum(entry.minutes)::int AS minutes
           FROM hrms_time_entries entry
           JOIN hrms_timesheets sheet ON sheet.workspace_id = entry.workspace_id AND sheet.id = entry.timesheet_id AND sheet.status = 'approved'
           JOIN workspace_memberships member ON member.workspace_id = sheet.workspace_id AND member.id = sheet.membership_id
           JOIN users person ON person.id = member.user_id
           LEFT JOIN project_stages stage ON stage.workspace_id = entry.workspace_id AND stage.id = entry.stage_id
          WHERE entry.workspace_id=$1 AND entry.project_id=$2 AND ($3::date IS NULL OR entry.work_date >= $3) AND ($4::date IS NULL OR entry.work_date <= $4)
          GROUP BY sheet.membership_id, person.display_name, entry.stage_id, stage.name, stage.position
          ORDER BY person.display_name, stage.position NULLS LAST`,
        [workspaceId, projectId, from ?? null, to ?? null],
      )).rows;
      return { projectId, from: from ?? null, to: to ?? null, rows, totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0) };
    });
  }

  /**
   * Utilisation over a period for the people in scope: approved project hours over the hours their
   * calendar expects (working days, less leave); internal hours shown apart.
   */
  utilisation(actor: RequestActor, workspaceId: string, from: string, to: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.team", "hrms.manage");
      const dates = dateRange(from, to, 93);
      const members = (await ctx.client.query<{ membershipId: string }>(
        `SELECT e.membership_id AS "membershipId" FROM hrms_employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.membership_id AND m.status='active'
          WHERE e.workspace_id=$1 AND e.enabled`, [workspaceId])).rows;
      const people = [];
      for (const { membershipId } of members) {
        if (!(await this.access.canManageEmployee(ctx, membershipId))) continue;
        const employee = await this.access.employee(ctx, membershipId);
        const leave = (await ctx.client.query<{ units: LeaveUnit[] }>(
          `SELECT units FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND status IN ('approved','cancellation_pending') AND start_date <= $4 AND end_date >= $3`,
          [workspaceId, membershipId, from, to])).rows.flatMap((row) => row.units);
        const scheduled = dates.filter((date) => date >= employee.activeFrom && (!employee.activeTo || date <= employee.activeTo)).reduce((sum, date) => {
          const away = Math.min(1, leave.filter((unit) => unit.date === date).reduce((total, unit) => total + unit.days, 0));
          return sum + Math.round(scheduledMinutes(employee.calendar, date) * (1 - away));
        }, 0);
        const logged = (await ctx.client.query<{ project: number; internal: number }>(
          `SELECT coalesce(sum(entry.minutes) FILTER (WHERE entry.project_id IS NOT NULL), 0)::int AS project, coalesce(sum(entry.minutes) FILTER (WHERE entry.project_id IS NULL), 0)::int AS internal
             FROM hrms_time_entries entry JOIN hrms_timesheets sheet ON sheet.workspace_id = entry.workspace_id AND sheet.id = entry.timesheet_id AND sheet.status = 'approved'
            WHERE entry.workspace_id=$1 AND sheet.membership_id=$2 AND entry.work_date BETWEEN $3 AND $4`,
          [workspaceId, membershipId, from, to])).rows[0];
        people.push({ membershipId, name: employee.name, scheduledMinutes: scheduled, projectMinutes: logged.project, internalMinutes: logged.internal,
          utilisation: scheduled ? Math.round((logged.project / scheduled) * 1000) / 10 : null });
      }
      return { from, to, people: people.sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }
}
