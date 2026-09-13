import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { RequestActor } from "../auth/actor";
import { CalendarDto, EmployeeDto, SettingsDto } from "./hrms.dto";
import { dateOnly, validateCalendar } from "./hrms-domain";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";

@Injectable()
export class HrmsSettingsService {
  constructor(private readonly access: HrmsAccessService) {}
  bootstrap(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.self", "hrms.team", "hrms.manage");
      const settings = await ctx.client.query(
        `SELECT default_calendar_id AS "defaultCalendarId",fallback_approver_id AS "fallbackApproverId",max_gps_accuracy_m AS "maxGpsAccuracyM",max_capture_age_seconds AS "maxCaptureAgeSeconds",media_retention_days AS "mediaRetentionDays",version FROM hrms_settings WHERE workspace_id=$1`,
        [workspaceId],
      );
      const mine = await ctx.client.query(
        `SELECT e.membership_id FROM hrms_employees e WHERE e.workspace_id=$1 AND e.membership_id=$2`,
        [workspaceId, ctx.membershipId],
      );
      const employee = mine.rowCount ? await this.access.employee(ctx) : null;
      const calendars = await ctx.client.query(
        `SELECT id,name,timezone,working_days AS "workingDays",holidays,day_start::text AS "dayStart",half_day::text AS "halfDay",day_end::text AS "dayEnd" FROM hrms_calendars WHERE workspace_id=$1 ORDER BY created_at DESC`,
        [workspaceId],
      );
      const workspace = await ctx.client.query(
        `SELECT default_timezone AS timezone,name FROM workspaces WHERE id=$1`,
        [workspaceId],
      );
      return {
        membershipId: ctx.membershipId,
        employee,
        settings: settings.rows[0] ?? null,
        calendars: calendars.rows,
        workspace: workspace.rows[0],
        permissions: {
          self:
            ctx.permissions.has("hrms.self") ||
            ctx.permissions.has("hrms.manage"),
          team:
            ctx.permissions.has("hrms.team") ||
            ctx.permissions.has("hrms.manage"),
          manage: ctx.permissions.has("hrms.manage"),
          evidence: ctx.permissions.has("hrms.evidence"),
          manageProjects: ctx.permissions.has("projects.manage"),
        },
      };
    });
  }
  createCalendar(actor: RequestActor, workspaceId: string, input: CalendarDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      validateCalendar(input);
      const result = await ctx.client.query(
        `INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days,holidays,day_start,half_day,day_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          workspaceId,
          input.name.trim(),
          input.timezone,
          input.workingDays,
          input.holidays,
          input.dayStart,
          input.halfDay,
          input.dayEnd,
        ],
      );
      await this.access.audit(ctx, "calendar_created", result.rows[0].id, {
        ...input,
      });
      return { ...input, id: result.rows[0].id };
    });
  }
  saveSettings(actor: RequestActor, workspaceId: string, input: SettingsDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      await ctx.client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`hrms-settings:${workspaceId}`],
      );
      const before = await ctx.client.query(
        `SELECT * FROM hrms_settings WHERE workspace_id=$1`,
        [workspaceId],
      );
      this.access.version(before.rows[0]?.version, input.version);
      await this.calendarExists(ctx, input.defaultCalendarId);
      if (input.fallbackApproverId)
        await this.access.memberExists(ctx, input.fallbackApproverId);
      const row = await ctx.client.query(
        `INSERT INTO hrms_settings(workspace_id,default_calendar_id,fallback_approver_id,max_gps_accuracy_m,max_capture_age_seconds,media_retention_days) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(workspace_id) DO UPDATE SET default_calendar_id=EXCLUDED.default_calendar_id,fallback_approver_id=EXCLUDED.fallback_approver_id,max_gps_accuracy_m=EXCLUDED.max_gps_accuracy_m,max_capture_age_seconds=EXCLUDED.max_capture_age_seconds,media_retention_days=EXCLUDED.media_retention_days,version=hrms_settings.version+1 RETURNING version`,
        [
          workspaceId,
          input.defaultCalendarId,
          input.fallbackApproverId ?? null,
          input.maxGpsAccuracyM,
          input.maxCaptureAgeSeconds,
          input.mediaRetentionDays,
        ],
      );
      await this.access.audit(
        ctx,
        "settings_updated",
        workspaceId,
        { ...input, version: row.rows[0].version },
        before.rows[0],
      );
      return { ...input, version: row.rows[0].version };
    });
  }
  people(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage", "hrms.team");
      const result = await ctx.client.query(
        `SELECT m.id AS "membershipId",u.display_name AS name,m.status,e.enabled,coalesce(e.employee_code,'') AS "employeeCode",coalesce(e.designation,'') AS designation,coalesce(e.department,'') AS department,e.manager_id AS "managerId",e.calendar_id AS "calendarId",e.remote_allowed AS "remoteAllowed",e.active_from::text AS "activeFrom",e.active_to::text AS "activeTo",coalesce(e.version,0) AS version FROM workspace_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN hrms_employees e ON e.workspace_id=m.workspace_id AND e.membership_id=m.id WHERE m.workspace_id=$1 ORDER BY u.display_name`,
        [workspaceId],
      );
      if (ctx.permissions.has("hrms.manage")) return result.rows;
      const scoped = [];
      for (const row of result.rows)
        if (await this.access.canManageEmployee(ctx, row.membershipId))
          scoped.push(row);
      return scoped;
    });
  }
  saveEmployee(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: EmployeeDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      await this.access.settings(ctx);
      await ctx.client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`hrms-members:${workspaceId}`],
      );
      await this.access.lock(ctx, id);
      await this.access.memberExists(ctx, id);
      await this.calendarExists(ctx, input.calendarId);
      dateOnly(input.activeFrom);
      if (input.activeTo && dateOnly(input.activeTo) < input.activeFrom)
        throw new BadRequestException(
          "The last working date precedes the first.",
        );
      if (input.managerId === id)
        throw new BadRequestException(
          "An employee cannot report to themselves.",
        );
      if (input.managerId) {
        await this.access.memberExists(ctx, input.managerId);
        const cycle = await ctx.client.query(
          `WITH RECURSIVE chain AS (SELECT membership_id,manager_id FROM hrms_employees WHERE workspace_id=$1 AND membership_id=$2 UNION SELECT e.membership_id,e.manager_id FROM hrms_employees e JOIN chain c ON e.membership_id=c.manager_id WHERE e.workspace_id=$1) SELECT 1 FROM chain WHERE membership_id=$3`,
          [workspaceId, input.managerId, id],
        );
        if (cycle.rowCount)
          throw new BadRequestException(
            "Reporting relationships cannot form a cycle.",
          );
      }
      const current = await ctx.client.query(
        `SELECT * FROM hrms_employees WHERE workspace_id=$1 AND membership_id=$2`,
        [workspaceId, id],
      );
      this.access.version(current.rows[0]?.version, input.version);
      const open = await ctx.client.query(
        `SELECT id FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND ended_at IS NULL`,
        [workspaceId, id],
      );
      if (
        open.rowCount &&
        (!input.enabled ||
          input.calendarId !== current.rows[0]?.calendar_id ||
          input.activeTo)
      )
        throw new ConflictException(
          "Resolve the open attendance session before disabling attendance or changing its calendar/end date.",
        );
      if (input.employeeCode.trim()) {
        const duplicate = await ctx.client.query(
          `SELECT 1 FROM hrms_employees WHERE workspace_id=$1 AND lower(employee_code)=lower($2) AND membership_id<>$3`,
          [workspaceId, input.employeeCode.trim(), id],
        );
        if (duplicate.rowCount)
          throw new ConflictException("That employee code is already in use.");
      }
      const row = await ctx.client.query(
        `INSERT INTO hrms_employees(workspace_id,membership_id,enabled,employee_code,designation,department,manager_id,calendar_id,remote_allowed,active_from,active_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
   ON CONFLICT(workspace_id,membership_id) DO UPDATE SET enabled=EXCLUDED.enabled,employee_code=EXCLUDED.employee_code,designation=EXCLUDED.designation,department=EXCLUDED.department,manager_id=EXCLUDED.manager_id,calendar_id=EXCLUDED.calendar_id,remote_allowed=EXCLUDED.remote_allowed,active_from=EXCLUDED.active_from,active_to=EXCLUDED.active_to,version=hrms_employees.version+1 RETURNING version`,
        [
          workspaceId,
          id,
          input.enabled,
          input.employeeCode.trim(),
          input.designation.trim(),
          input.department.trim(),
          input.managerId ?? null,
          input.calendarId,
          input.remoteAllowed,
          input.activeFrom,
          input.activeTo ?? null,
        ],
      );
      await this.access.audit(
        ctx,
        "employee_updated",
        id,
        { ...input, version: row.rows[0].version },
        current.rows[0],
      );
      return { ...input, membershipId: id, version: row.rows[0].version };
    });
  }
  private async calendarExists(ctx: HrmsContext, id: string) {
    const row = await ctx.client.query(
      `SELECT 1 FROM hrms_calendars WHERE workspace_id=$1 AND id=$2`,
      [ctx.workspaceId, id],
    );
    if (!row.rowCount)
      throw new BadRequestException(
        "Choose a work calendar from this workspace.",
      );
  }
}
