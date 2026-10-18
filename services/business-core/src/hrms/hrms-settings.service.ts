import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RequestActor } from "../auth/actor";
import {
  CalendarDto,
  CalendarUpdateDto,
  EmployeeDto,
  HolidayDto,
  HolidayUpdateDto,
  SettingsDto,
  VersionDto,
} from "./hrms.dto";
import {
  Calendar,
  dateOnly,
  formatDates,
  formatDays,
  holidayDates,
  LeaveUnit,
  validateCalendar,
} from "./hrms-domain";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";

const CALENDAR_COLUMNS = `c.id,c.name,c.timezone,c.working_days AS "workingDays",c.holidays::text[] AS holidays,to_char(c.day_start,'HH24:MI') AS "dayStart",to_char(c.half_day,'HH24:MI') AS "halfDay",to_char(c.day_end,'HH24:MI') AS "dayEnd",c.version`;
type Holiday = { id: string; calendarId: string; name: string; startsOn: string; endsOn: string; version: number };

@Injectable()
export class HrmsSettingsService {
  constructor(private readonly access: HrmsAccessService) {}
  bootstrap(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.self", "hrms.team", "hrms.manage");
      const settings = await ctx.client.query(
        `SELECT default_calendar_id AS "defaultCalendarId",fallback_approver_id AS "fallbackApproverId",max_gps_accuracy_m AS "maxGpsAccuracyM",max_capture_age_seconds AS "maxCaptureAgeSeconds",media_retention_days AS "mediaRetentionDays",site_documents::text[] AS "siteDocuments",version FROM hrms_settings WHERE workspace_id=$1`,
        [workspaceId],
      );
      const mine = await ctx.client.query(
        `SELECT e.membership_id FROM hrms_employees e WHERE e.workspace_id=$1 AND e.membership_id=$2`,
        [workspaceId, ctx.membershipId],
      );
      const employee = mine.rowCount ? await this.access.employee(ctx) : null;
      const calendars = await ctx.client.query(
        `SELECT ${CALENDAR_COLUMNS} FROM hrms_calendars c WHERE c.workspace_id=$1 ORDER BY c.created_at DESC`,
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
          // Crews: people who run HR or projects, crew leads, and the managers and site supervisors of a running project.
          crews: ctx.permissions.has("hrms.manage") || ctx.permissions.has("projects.manage") || Boolean((await ctx.client.query(
            `SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND lead_membership_id=$2
             UNION ALL SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND membership_id=$2 AND active AND (is_manager OR 'site_supervisor' = ANY(role_keys)) LIMIT 1`,
            [workspaceId, ctx.membershipId])).rowCount),
        },
      };
    });
  }
  /** Every calendar with its named holidays and how many tracked people follow it. */
  calendars(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, (ctx) => {
      this.access.require(ctx, "hrms.manage");
      return this.calendarRows(ctx);
    });
  }
  private async calendarRows(ctx: HrmsContext, id?: string) {
    const rows = await ctx.client.query(
      `SELECT ${CALENDAR_COLUMNS},(c.id=s.default_calendar_id) AS "isDefault",
              (SELECT count(*)::int FROM hrms_employees e WHERE e.workspace_id=c.workspace_id AND e.calendar_id=c.id AND e.enabled) AS people,
              coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'calendarId',h.calendar_id,'name',h.name,'startsOn',h.starts_on::text,'endsOn',h.ends_on::text,'days',h.ends_on-h.starts_on+1,'version',h.version) ORDER BY h.starts_on)
                          FROM hrms_holidays h WHERE h.workspace_id=c.workspace_id AND h.calendar_id=c.id),'[]'::jsonb) AS "holidayList"
         FROM hrms_calendars c LEFT JOIN hrms_settings s ON s.workspace_id=c.workspace_id
        WHERE c.workspace_id=$1 AND ($2::uuid IS NULL OR c.id=$2)
        ORDER BY (c.id=s.default_calendar_id) DESC,c.name,c.id`,
      [ctx.workspaceId, id ?? null],
    );
    return rows.rows;
  }
  createCalendar(actor: RequestActor, workspaceId: string, input: CalendarDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      validateCalendar(input);
      const result = await ctx.client.query<{ id: string }>(
        `INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days,day_start,half_day,day_end) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          workspaceId,
          input.name.trim(),
          input.timezone,
          [...new Set(input.workingDays)].sort(),
          input.dayStart,
          input.halfDay,
          input.dayEnd,
        ],
      );
      await this.access.audit(ctx, "calendar_created", result.rows[0].id, {
        ...input,
      });
      return (await this.calendarRows(ctx, result.rows[0].id))[0];
    });
  }
  /**
   * A calendar's name, time zone, week and hours change from now on: sessions and leave keep the
   * calendar they were made with, and plans read the new week.
   */
  updateCalendar(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: CalendarUpdateDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const before = await ctx.client.query(
        `SELECT ${CALENDAR_COLUMNS} FROM hrms_calendars c WHERE c.workspace_id=$1 AND c.id=$2 FOR UPDATE`,
        [workspaceId, id],
      );
      if (!before.rowCount) throw new NotFoundException("Calendar not found.");
      this.access.version(before.rows[0].version, input.version);
      validateCalendar(input);
      await ctx.client.query(
        `UPDATE hrms_calendars SET name=$3,timezone=$4,working_days=$5,day_start=$6,half_day=$7,day_end=$8,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
        [
          workspaceId,
          id,
          input.name.trim(),
          input.timezone,
          [...new Set(input.workingDays)].sort(),
          input.dayStart,
          input.halfDay,
          input.dayEnd,
        ],
      );
      await this.access.audit(
        ctx,
        "calendar_updated",
        id,
        { ...input },
        before.rows[0],
      );
      return (await this.calendarRows(ctx, id))[0];
    });
  }
  addHoliday(
    actor: RequestActor,
    workspaceId: string,
    calendarId: string,
    input: HolidayDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      await this.calendarExists(ctx, calendarId);
      const holiday = await this.checkHoliday(ctx, calendarId, input);
      const row = await ctx.client.query<Holiday>(
        `INSERT INTO hrms_holidays(workspace_id,calendar_id,name,starts_on,ends_on,created_by) VALUES($1,$2,$3,$4,$5,$6)
         RETURNING id,calendar_id AS "calendarId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",version`,
        [workspaceId, calendarId, holiday.name, holiday.startsOn, holiday.endsOn, ctx.userId],
      );
      await this.access.audit(ctx, "holiday_added", row.rows[0].id, {
        ...row.rows[0],
      });
      await this.reconcileLeave(ctx, row.rows[0]);
      return withDays(row.rows[0]);
    });
  }
  updateHoliday(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: HolidayUpdateDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const before = await this.holidayRow(ctx, id);
      this.access.version(before.version, input.version);
      const holiday = await this.checkHoliday(ctx, before.calendarId, input, id);
      const row = await ctx.client.query<Holiday>(
        `UPDATE hrms_holidays SET name=$3,starts_on=$4,ends_on=$5,version=version+1 WHERE workspace_id=$1 AND id=$2
         RETURNING id,calendar_id AS "calendarId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",version`,
        [workspaceId, id, holiday.name, holiday.startsOn, holiday.endsOn],
      );
      await this.access.audit(
        ctx,
        "holiday_updated",
        id,
        { ...row.rows[0] },
        { ...before },
      );
      await this.reconcileLeave(ctx, row.rows[0]);
      return withDays(row.rows[0]);
    });
  }
  /** A holiday taken off the calendar: those days are worked again. Leave already booked isn't lengthened. */
  removeHoliday(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: VersionDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const before = await this.holidayRow(ctx, id);
      this.access.version(before.version, input.version);
      await ctx.client.query(
        `DELETE FROM hrms_holidays WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      await this.access.audit(ctx, "holiday_removed", id, {}, { ...before });
      return { id };
    });
  }
  private async holidayRow(ctx: HrmsContext, id: string) {
    const row = await ctx.client.query<Holiday>(
      `SELECT id,calendar_id AS "calendarId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",version FROM hrms_holidays WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
      [ctx.workspaceId, id],
    );
    if (!row.rowCount) throw new NotFoundException("Holiday not found.");
    return row.rows[0];
  }
  /** Valid dates, a name, and no other holiday on the calendar on those days (under the calendar's holiday lock). */
  private async checkHoliday(
    ctx: HrmsContext,
    calendarId: string,
    input: HolidayDto,
    id?: string,
  ) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Name the holiday.");
    holidayDates(input.startsOn, input.endsOn);
    await ctx.client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`hrms-holidays:${calendarId}`],
    );
    const clash = await ctx.client.query<{ name: string }>(
      `SELECT name FROM hrms_holidays WHERE workspace_id=$1 AND calendar_id=$2 AND ($3::uuid IS NULL OR id<>$3) AND starts_on<=$5 AND ends_on>=$4 LIMIT 1`,
      [ctx.workspaceId, calendarId, id ?? null, input.startsOn, input.endsOn],
    );
    if (clash.rowCount)
      throw new ConflictException(
        `These days are already a holiday: ${clash.rows[0].name}.`,
      );
    return { name, startsOn: input.startsOn, endsOn: input.endsOn };
  }
  /**
   * Leave booked on a calendar's new holiday stops counting those days (a public holiday announced
   * after leave was approved gives the days back). Leave left with no days is withdrawn (still
   * pending) or cancelled; the person is told either way.
   */
  private async reconcileLeave(ctx: HrmsContext, holiday: Holiday) {
    const dates = holidayDates(holiday.startsOn, holiday.endsOn);
    const rows = await ctx.client.query<{
      id: string;
      membershipId: string;
      status: string;
      units: LeaveUnit[];
      calendar: Calendar;
      startDate: string;
      endDate: string;
      leaveType: string;
    }>(
      `SELECT l.id,l.membership_id AS "membershipId",l.status,l.units,l.calendar_snapshot AS calendar,l.start_date::text AS "startDate",l.end_date::text AS "endDate",t.name AS "leaveType"
         FROM hrms_leave_requests l JOIN hrms_leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id
        WHERE l.workspace_id=$1 AND l.calendar_snapshot->>'id'=$2 AND l.status IN ('pending','approved','cancellation_pending')
          AND l.start_date<=$4 AND l.end_date>=$3
        ORDER BY l.id FOR UPDATE OF l`,
      [ctx.workspaceId, holiday.calendarId, holiday.startsOn, holiday.endsOn],
    );
    if (!rows.rowCount) return;
    const locale = await this.access.locale(ctx);
    for (const leave of rows.rows) {
      const kept = leave.units.filter((unit) => !dates.includes(unit.date));
      if (kept.length === leave.units.length) continue;
      const status = kept.length
        ? leave.status
        : leave.status === "pending"
          ? "withdrawn"
          : "cancelled";
      const calendar = {
        ...leave.calendar,
        holidays: [...new Set([...(leave.calendar.holidays ?? []), ...dates])].sort(),
      };
      await ctx.client.query(
        `UPDATE hrms_leave_requests SET units=$3,calendar_snapshot=$4,status=$5::varchar,
                cancellation_reason=CASE WHEN $5::varchar<>status THEN $6 ELSE cancellation_reason END,version=version+1
          WHERE workspace_id=$1 AND id=$2`,
        [
          ctx.workspaceId,
          leave.id,
          JSON.stringify(kept),
          calendar,
          status,
          `${holiday.name} is a holiday.`,
        ],
      );
      const days = kept.reduce((sum, unit) => sum + unit.days, 0);
      await this.access.audit(
        ctx,
        "leave_adjusted_for_holiday",
        leave.id,
        { holidayId: holiday.id, units: kept, status },
        { units: leave.units, status: leave.status },
      );
      await this.access.notify(ctx, [
        {
          code: "hrms.leave_holiday",
          users: await this.access.userOf(ctx, leave.membershipId),
          variables: {
            leaveType: leave.leaveType,
            dates: formatDates(leave.startDate, leave.endDate, locale),
            days: formatDays(days),
            note: holiday.name,
          },
          deepLink: `/workspace/hrms/leave?request=${leave.id}`,
          key: `hrms.leave_holiday:${leave.id}:${holiday.id}:${holiday.startsOn}:${holiday.endsOn}`,
        },
      ]);
    }
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
        `INSERT INTO hrms_settings(workspace_id,default_calendar_id,fallback_approver_id,max_gps_accuracy_m,max_capture_age_seconds,media_retention_days,site_documents) VALUES($1,$2,$3,$4,$5,$6,coalesce($7::varchar(24)[],'{}'))
   ON CONFLICT(workspace_id) DO UPDATE SET default_calendar_id=EXCLUDED.default_calendar_id,fallback_approver_id=EXCLUDED.fallback_approver_id,max_gps_accuracy_m=EXCLUDED.max_gps_accuracy_m,max_capture_age_seconds=EXCLUDED.max_capture_age_seconds,media_retention_days=EXCLUDED.media_retention_days,site_documents=coalesce($7::varchar(24)[],hrms_settings.site_documents),version=hrms_settings.version+1 RETURNING version`,
        [
          workspaceId,
          input.defaultCalendarId,
          input.fallbackApproverId ?? null,
          input.maxGpsAccuracyM,
          input.maxCaptureAgeSeconds,
          input.mediaRetentionDays,
          input.siteDocuments ?? null,
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
        `SELECT m.id AS "membershipId",u.display_name AS name,coalesce(u.primary_email::text,'') AS email,m.status,e.enabled,coalesce(e.employee_code,'') AS "employeeCode",coalesce(e.designation,'') AS designation,coalesce(e.department,'') AS department,e.manager_id AS "managerId",e.calendar_id AS "calendarId",e.remote_allowed AS "remoteAllowed",e.active_from::text AS "activeFrom",e.active_to::text AS "activeTo",coalesce(e.version,0) AS version FROM workspace_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN hrms_employees e ON e.workspace_id=m.workspace_id AND e.membership_id=m.id WHERE m.workspace_id=$1 ORDER BY u.display_name`,
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

function withDays(holiday: Holiday) {
  return {
    ...holiday,
    days: holidayDates(holiday.startsOn, holiday.endsOn).length,
  };
}
