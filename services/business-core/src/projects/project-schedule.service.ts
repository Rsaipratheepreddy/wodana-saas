import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { noticeDecision } from "../notifications/notice-choices";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { HrmsAccessService, type HrmsContext } from "../hrms/hrms-access.service";
import {
  bookingSlots,
  calendarContainsSlot,
  fullCalendar,
  slotsClash,
  type BookingSlot,
  type WorkCalendar,
} from "./project-calendar";
import {
  capacityConfiguration,
  exceedsPooledCapacity,
  resourceAvailability,
  scheduleStatus,
  type CapacityBookingSlot,
  type ScheduleBookingStatus,
} from "./project-schedule-capacity";
import { day, get, obj, str } from "./execution.domain";
import type { ProjectData, ProjectResource, Task } from "./execution.types";
import type { ScheduleAvailabilityQueryDto } from "./projects.dto";

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  timezone: string;
  content: ProjectData;
};

type ResourceRow = ProjectResource & {
  capacityMode: "exclusive" | "pooled";
  capacity: number;
  timezone: string | null;
  version: number;
  businessUnitCode?: string | null;
  businessUnitName?: string | null;
  businessUnitColor?: string | null;
};

type EmployeeCalendarRow = {
  membership_id: string;
  enabled: boolean;
  active_from: string;
  active_to: string | null;
  working_days: number[];
  holidays: string[];
  day_start: string;
  day_end: string;
  half_day: string;
  timezone: string;
};

type ScheduleInput = {
  taskId: string;
  status: ScheduleBookingStatus;
  units: number;
  startTime?: string;
  endTime?: string;
  note: string;
  calendarOverride: boolean;
};

type Preview = {
  task: Task;
  resource: ResourceRow;
  timezone: string;
  slots: BookingSlot[];
  blockers: string[];
  warnings: string[];
  calendarSnapshot: Record<string, unknown>;
};

@Injectable()
export class ProjectScheduleService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly events: CrmEventsService,
  ) {}

  availability(actor: RequestActor, workspaceId: string, query: ScheduleAvailabilityQueryDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage", "projects.schedule.view", "projects.schedule.manage");
      const { from, to } = this.range(query.from, query.to);
      const workspace = await ctx.client.query<{ timezone: string }>(
        "SELECT default_timezone AS timezone FROM workspaces WHERE id=$1",
        [workspaceId],
      );
      const visible = await this.visibleResourceScope(ctx);
      const resources = (await ctx.client.query<ResourceRow>(
        `SELECT resource.id,resource.name,resource.kind,resource.members,resource.active,resource.calendar,
                resource.business_unit_id AS "businessUnitId",resource.workspace_team_id AS "workspaceTeamId",
                resource.capacity_mode AS "capacityMode",resource.capacity::float8 AS capacity,
                resource.timezone,resource.version,unit.code AS "businessUnitCode",
                unit.name AS "businessUnitName",unit.color AS "businessUnitColor"
         FROM project_resources resource
         LEFT JOIN business_units unit
           ON unit.workspace_id=resource.workspace_id AND unit.id=resource.business_unit_id
         WHERE resource.workspace_id=$1 AND resource.active
           AND ($2::uuid IS NULL OR resource.business_unit_id=$2)
           AND ($3::uuid IS NULL OR resource.id=$3)
           AND ($4 OR resource.id=ANY($5::uuid[]))
         ORDER BY resource.name`,
        [workspaceId, query.businessUnitId ?? null, query.resourceId ?? null, visible.all, visible.resourceIds],
      )).rows;
      const memberIds = [...new Set(resources.flatMap((resource) => resource.members))];
      const employeeCalendars = memberIds.length ? (await ctx.client.query<EmployeeCalendarRow>(
        `SELECT employee.membership_id,employee.enabled,employee.active_from::text,employee.active_to::text,
                calendar.working_days,calendar.holidays::text[],calendar.day_start::text,
                calendar.day_end::text,calendar.half_day::text,calendar.timezone
         FROM hrms_employees employee
         JOIN hrms_calendars calendar
           ON calendar.workspace_id=employee.workspace_id AND calendar.id=employee.calendar_id
         WHERE employee.workspace_id=$1 AND employee.membership_id=ANY($2::uuid[])`,
        [workspaceId, memberIds],
      )).rows : [];
      const resolvedResources = resources.map((resource) => ({
        ...resource,
        calendar: resource.calendar ?? this.intersectEmployeeCalendars(
          employeeCalendars.filter((employee) => resource.members.includes(employee.membership_id)),
        ) ?? fullCalendar,
      }));
      const slots = resources.length ? (await ctx.client.query(
        `SELECT slot.booking_id AS "bookingId",slot.resource_id AS "resourceId",
                slot.local_date::text AS date,slot.end_date::text AS "endDate",
                to_char(slot.start_time,'HH24:MI') AS "startTime",
                to_char(slot.end_time,'HH24:MI') AS "endTime",
                booking.status,booking.units::float8 AS units
         FROM project_booking_slots slot
         JOIN project_bookings booking
           ON booking.workspace_id=slot.workspace_id AND booking.id=slot.booking_id
         WHERE slot.workspace_id=$1 AND slot.resource_id=ANY($2::uuid[])
           AND slot.local_date<=$4::date AND slot.end_date>=$3::date
           AND booking.status IN ('tentative','confirmed')
         ORDER BY slot.local_date,slot.start_time`,
        [workspaceId, resources.map((resource) => resource.id), from, to],
      )).rows as CapacityBookingSlot[] : [];
      const availability = resourceAvailability(resolvedResources, slots, from, to);
      const departments = new Map<string, {
        id: string;
        code: string;
        name: string;
        visibleName: string;
        color: string;
        resourceCount: number;
        totalCapacity: number;
        gapCount: number;
        gapMinutes: number;
        availableCapacityMinutes: number;
        conflictCount: number;
      }>();
      for (const resource of resources) {
        const id = resource.businessUnitId ?? "unassigned";
        const current = departments.get(id) ?? {
          id,
          code: resource.businessUnitCode ?? "UNASSIGNED",
          name: resource.businessUnitName ?? "Unassigned",
          visibleName: resource.businessUnitName ?? "Unassigned",
          color: resource.businessUnitColor ?? "#64748B",
          resourceCount: 0,
          totalCapacity: 0,
          gapCount: 0,
          gapMinutes: 0,
          availableCapacityMinutes: 0,
          conflictCount: 0,
        };
        const resourceAvailabilityRow = availability.find((row) => row.resourceId === resource.id)!;
        current.resourceCount++;
        current.totalCapacity += resource.capacity;
        current.gapCount += resourceAvailabilityRow.gapCount;
        current.gapMinutes += resourceAvailabilityRow.gapMinutes;
        current.availableCapacityMinutes += resourceAvailabilityRow.availableCapacityMinutes;
        current.conflictCount += resourceAvailabilityRow.conflictCount;
        departments.set(id, current);
      }
      return {
        range: { from, to, timezone: workspace.rows[0]?.timezone ?? "UTC" },
        resources: resources.map((resource) => ({
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
          businessUnitId: resource.businessUnitId ?? null,
          capacityMode: resource.capacityMode,
          capacity: resource.capacity,
          timezone: resource.timezone ?? workspace.rows[0]?.timezone ?? "UTC",
          version: resource.version,
        })),
        departments: [...departments.values()],
        availability: availability.map((row) => ({
          ...row,
          segments: row.segments.map(({ confirmedBookingIds: _confirmed, tentativeBookingIds: _tentative, ...segment }) => segment),
        })),
      };
    });
  }

  preview(actor: RequestActor, workspaceId: string, projectId: string, input: unknown) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const project = await this.project(ctx, projectId);
      const parsed = this.input(input);
      const preview = await this.previewIn(ctx, project, parsed, true);
      return this.publicPreview(preview, parsed.status);
    });
  }

  save(actor: RequestActor, workspaceId: string, projectId: string, input: unknown) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.lock(ctx);
      const body = obj(input);
      const requestId = this.requestId(body.requestId);
      const replay = await this.replayed(ctx.client, workspaceId, requestId);
      if (replay) return replay;
      const project = await this.project(ctx, projectId, true);
      const parsed = this.input(body);
      const preview = await this.previewIn(ctx, project, parsed, true);
      this.projectRevision(project, body.projectRevision);
      const existing = await ctx.client.query(
        `SELECT * FROM project_bookings
         WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3
           AND status IN ('draft','tentative','confirmed')
         FOR UPDATE`,
        [workspaceId, projectId, parsed.taskId],
      );
      const expectedVersion = this.version(body.bookingVersion);
      if (existing.rowCount ? Number(existing.rows[0].version) !== expectedVersion : expectedVersion !== 0)
        throw new ConflictException("This booking changed. Refresh and review before saving.");
      if (parsed.status === "confirmed" && preview.blockers.length)
        throw new ConflictException(preview.blockers.join(" "));
      const bookingId = existing.rows[0]?.id ?? randomUUID();
      const snapshot = {
        projectId,
        taskId: parsed.taskId,
        resourceId: preview.resource.id,
        status: parsed.status,
        units: parsed.units,
        timezone: preview.timezone,
        slots: preview.slots,
        memberIds: preview.resource.members,
        calendarOverride: preview.calendarSnapshot.override ?? null,
      };
      let saved;
      if (existing.rowCount) {
        saved = (await ctx.client.query(
          `UPDATE project_bookings SET resource_id=$4,starts_on=$5::date,ends_on=$6::date,
                  status=$7::varchar,acknowledgement=$8,member_ids=$9,slots=$10,units=$11,
                  timezone=$12,calendar_snapshot=$13,version=version+1,request_id=$14,
                  updated_by=$15,confirmed_at=CASE WHEN $7::text='confirmed' THEN coalesce(confirmed_at,now()) ELSE confirmed_at END,
                  cancellation_reason=NULL,cancelled_at=NULL
           WHERE workspace_id=$1 AND id=$2 AND project_id=$3 RETURNING *`,
          [workspaceId, bookingId, projectId, preview.resource.id, preview.task.start, preview.task.end,
            parsed.status, parsed.note, preview.resource.members, JSON.stringify(preview.slots), parsed.units,
            preview.timezone, JSON.stringify(preview.calendarSnapshot), requestId, ctx.userId],
        )).rows[0];
        await ctx.client.query(
          "DELETE FROM project_booking_slots WHERE workspace_id=$1 AND booking_id=$2",
          [workspaceId, bookingId],
        );
      } else {
        saved = (await ctx.client.query(
          `INSERT INTO project_bookings(
             id,workspace_id,project_id,task_id,resource_id,starts_on,ends_on,status,
             acknowledgement,member_ids,slots,units,timezone,calendar_snapshot,version,
             request_id,created_by,updated_by,confirmed_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::varchar,$9,$10,$11,$12,$13,$14,1,$15,$16,$16,
             CASE WHEN $8::text='confirmed' THEN now() ELSE NULL END) RETURNING *`,
          [bookingId, workspaceId, projectId, parsed.taskId, preview.resource.id, preview.task.start,
            preview.task.end, parsed.status, parsed.note, preview.resource.members,
            JSON.stringify(preview.slots), parsed.units, preview.timezone,
            JSON.stringify(preview.calendarSnapshot), requestId, ctx.userId],
        )).rows[0];
      }
      await this.insertSlots(ctx.client, workspaceId, bookingId, projectId, preview, parsed.units);
      await this.history(ctx, bookingId, existing.rows[0]?.status ?? null, parsed.status,
        existing.rowCount ? "status_changed" : "created", parsed.note, snapshot, requestId);
      await this.events.record(ctx.client, {
        workspaceId,
        actorUserId: ctx.userId,
        source: "user",
        action: `project.booking.${existing.rowCount ? "updated" : "created"}.v1`,
        entityType: "project_booking",
        entityId: bookingId,
        before: existing.rows[0] ?? undefined,
        after: snapshot,
      });
      await this.notify(ctx, project, preview.task, preview.resource, bookingId, parsed.status, requestId);
      return this.publicBooking(saved, preview.slots);
    });
  }

  cancel(actor: RequestActor, workspaceId: string, projectId: string, taskId: string, input: unknown) {
    return this.changeStatus(actor, workspaceId, projectId, taskId, input, "cancelled");
  }

  complete(actor: RequestActor, workspaceId: string, projectId: string, taskId: string, input: unknown) {
    return this.changeStatus(actor, workspaceId, projectId, taskId, input, "completed");
  }

  private changeStatus(
    actor: RequestActor,
    workspaceId: string,
    projectId: string,
    taskId: string,
    input: unknown,
    status: "cancelled" | "completed",
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.lock(ctx);
      const body = obj(input);
      const requestId = this.requestId(body.requestId);
      const replay = await this.replayed(ctx.client, workspaceId, requestId);
      if (replay) return replay;
      const project = await this.project(ctx, projectId, true);
      const task = get(project.content.tasks, taskId);
      const current = await ctx.client.query(
        `SELECT booking.*,resource.business_unit_id AS "businessUnitId",resource.members,
                resource.name AS "resourceName",resource.kind AS "resourceKind"
         FROM project_bookings booking
         JOIN project_resources resource ON resource.workspace_id=booking.workspace_id AND resource.id=booking.resource_id
         WHERE booking.workspace_id=$1 AND booking.project_id=$2 AND booking.task_id=$3
           AND booking.status IN ('draft','tentative','confirmed') FOR UPDATE`,
        [workspaceId, projectId, taskId],
      );
      if (!current.rowCount) throw new NotFoundException("Active booking not found.");
      await this.assertManage(ctx, projectId, current.rows[0].businessUnitId);
      if (Number(current.rows[0].version) !== this.version(body.bookingVersion))
        throw new ConflictException("This booking changed. Refresh and review before saving.");
      const reason = str(body.reason, 1000, true);
      if (status === "completed" && current.rows[0].status !== "confirmed")
        throw new ConflictException("Only a confirmed booking can be completed.");
      const saved = (await ctx.client.query(
        `UPDATE project_bookings SET status=$4::varchar,version=version+1,request_id=$5,updated_by=$6,
                cancellation_reason=CASE WHEN $4::text='cancelled' THEN $7 ELSE cancellation_reason END,
                cancelled_at=CASE WHEN $4::text='cancelled' THEN now() ELSE cancelled_at END,
                completed_at=CASE WHEN $4::text='completed' THEN now() ELSE completed_at END
         WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND id=$8 RETURNING *`,
        [workspaceId, projectId, taskId, status, requestId, ctx.userId, reason, current.rows[0].id],
      )).rows[0];
      const slots = this.slots(current.rows[0].slots);
      const snapshot = { projectId, taskId, status, reason, resourceId: saved.resource_id, slots };
      await this.history(ctx, saved.id, current.rows[0].status, status,
        status === "cancelled" ? "cancelled" : "completed", reason, snapshot, requestId);
      await this.events.record(ctx.client, {
        workspaceId,
        actorUserId: ctx.userId,
        source: "user",
        action: `project.booking.${status}.v1`,
        entityType: "project_booking",
        entityId: saved.id,
        before: current.rows[0],
        after: snapshot,
      });
      await this.notify(ctx, project, task, {
        id: saved.resource_id,
        name: current.rows[0].resourceName,
        kind: current.rows[0].resourceKind,
        members: current.rows[0].members,
        active: true,
        capacityMode: "exclusive",
        capacity: 1,
        timezone: saved.timezone,
        version: 1,
      }, saved.id, status, requestId);
      return this.publicBooking(saved, slots);
    });
  }

  private async previewIn(
    ctx: HrmsContext,
    project: ProjectRow,
    input: ScheduleInput,
    authorize = false,
  ): Promise<Preview> {
    const task = get(project.content.tasks, input.taskId);
    if (["completed", "cancelled"].includes(task.status))
      throw new ConflictException("Book only active planned work.");
    const resourceResult = await ctx.client.query<ResourceRow>(
      `SELECT id,name,kind,members,active,calendar,business_unit_id AS "businessUnitId",
              workspace_team_id AS "workspaceTeamId",capacity_mode AS "capacityMode",
              capacity::float8 AS capacity,timezone,version
       FROM project_resources WHERE workspace_id=$1 AND id=$2 AND active`,
      [ctx.workspaceId, task.resourceId],
    );
    if (!resourceResult.rowCount)
      throw new BadRequestException("Assign an active team, factory or vendor first.");
    const resource = resourceResult.rows[0];
    if (authorize)
      await this.assertManage(ctx, project.id, resource.businessUnitId);
    capacityConfiguration(resource.kind, resource.capacityMode, resource.capacity);
    if (resource.capacityMode === "exclusive" && input.units !== 1)
      throw new BadRequestException("Exclusive resources use one capacity unit.");
    if (input.units > resource.capacity)
      throw new BadRequestException("Requested units exceed the resource's total capacity.");
    const timezone = resource.timezone ?? project.timezone;
    await this.timezone(ctx.client, timezone);
    const employeeCalendars = resource.members.length ? (await ctx.client.query<EmployeeCalendarRow>(
      `SELECT employee.membership_id,employee.enabled,employee.active_from::text,employee.active_to::text,
              calendar.working_days,calendar.holidays::text[],calendar.day_start::text,
              calendar.day_end::text,calendar.half_day::text,calendar.timezone
       FROM hrms_employees employee
       JOIN hrms_calendars calendar ON calendar.workspace_id=employee.workspace_id AND calendar.id=employee.calendar_id
       WHERE employee.workspace_id=$1 AND employee.membership_id=ANY($2::uuid[])`,
      [ctx.workspaceId, resource.members],
    )).rows : [];
    const calendar = resource.calendar ?? this.intersectEmployeeCalendars(employeeCalendars) ?? fullCalendar;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const calendarExceptions = new Set<string>();
    const addConstraint = (message: string) => {
      if (input.status === "confirmed") blockers.push(message);
      else if (input.status === "tentative") warnings.push(message);
    };
    const addCalendarConstraint = (message: string) => {
      if (!input.calendarOverride) {
        addConstraint(message);
        return;
      }
      if (!ctx.permissions.has("projects.schedule.override") && !ctx.permissions.has("projects.manage"))
        blockers.push("You do not have permission to approve a calendar exception.");
      else if (!input.note)
        blockers.push("Record the approved calendar exception reason.");
      else {
        calendarExceptions.add(message);
        warnings.push(`Approved calendar exception recorded: ${message}`);
      }
    };
    let slots: BookingSlot[];
    try {
      slots = bookingSlots(task.start, task.end, calendar, input.startTime, input.endTime);
    } catch (error) {
      if (!input.calendarOverride) throw error;
      if (!ctx.permissions.has("projects.schedule.override") && !ctx.permissions.has("projects.manage"))
        throw new ForbiddenException("You do not have permission to approve a calendar exception.");
      if (!input.note)
        throw new BadRequestException("Record the approved calendar exception reason.");
      if (!input.startTime || !input.endTime)
        throw new BadRequestException("Choose explicit start and end times for a calendar exception.");
      slots = bookingSlots(task.start, task.end, fullCalendar, input.startTime, input.endTime);
      addCalendarConstraint("These hours are outside the resource working calendar.");
    }
    if (project.content.controls?.onHold && input.status === "confirmed")
      blockers.push("Release the project hold before confirming new bookings.");
    if (resource.kind === "vendor" && !input.note)
      addConstraint("Record the external vendor acknowledgement before confirmation.");
    if (resource.members.length) {
      const activeMembers = await ctx.client.query(
        `SELECT count(*)::int AS count FROM workspace_memberships
         WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='active'`,
        [ctx.workspaceId, resource.members],
      );
      if (Number(activeMembers.rows[0]?.count) !== resource.members.length)
        addConstraint("A resource member is no longer active in this workspace.");
    }
    for (const employee of employeeCalendars) {
      if (!employee.enabled || slots.some((slot) => slot.date < employee.active_from || (employee.active_to && slot.date > employee.active_to)))
        addConstraint("A resource member is not active for these working dates.");
      const employeeCalendar: WorkCalendar = {
        weekdays: employee.working_days,
        startTime: employee.day_start.slice(0, 5),
        endTime: employee.day_end.slice(0, 5),
        holidays: (employee.holidays as string[]).map((date) => ({ date, reason: "Employee non-working date" })),
      };
      const outside = employee.timezone !== timezone || slots.some((slot) => !calendarContainsSlot(employeeCalendar, slot));
      if (outside)
        addCalendarConstraint("These hours conflict with an employee calendar or timezone.");
    }
    const existing = await ctx.client.query(
      `SELECT booking.id,booking.resource_id AS "resourceId",booking.status,
              booking.units::float8 AS units,booking.member_ids AS "memberIds",booking.slots
       FROM project_bookings booking
       WHERE booking.workspace_id=$1 AND booking.status IN ('tentative','confirmed')
         AND booking.starts_on<=$3::date AND booking.ends_on>=$2::date
         AND NOT(booking.project_id=$4 AND booking.task_id=$5)`,
      [ctx.workspaceId, task.start, task.end, project.id, task.id],
    );
    const overlaps = existing.rows.filter((booking) => slotsClash(slots, this.slots(booking.slots)));
    const confirmed = overlaps.filter((booking) => booking.status === "confirmed");
    const tentative = overlaps.filter((booking) => booking.status === "tentative");
    if (confirmed.some((booking) => (booking.memberIds as string[]).some((member) => resource.members.includes(member))))
      addConstraint("A team member is already confirmed on overlapping work.");
    const sameResource = confirmed.filter((booking) => booking.resourceId === resource.id);
    if (resource.capacityMode === "exclusive" && sameResource.length)
      addConstraint("This resource is already confirmed on overlapping work.");
    if (
      resource.capacityMode === "pooled" &&
      exceedsPooledCapacity(
        slots,
        input.units,
        sameResource.map((booking) => ({
          units: Number(booking.units),
          slots: this.slots(booking.slots),
        })),
        resource.capacity,
      )
    )
      addConstraint("The resource does not have enough remaining capacity for this time.");
    if (tentative.some((booking) => booking.resourceId === resource.id
      || (booking.memberIds as string[]).some((member) => resource.members.includes(member))))
      warnings.push("Another tentative booking overlaps this resource or one of its members.");
    if (resource.members.length) {
      const leave = await ctx.client.query(
        `SELECT start_date::text AS start,end_date::text AS end,units,calendar_snapshot
         FROM hrms_leave_requests
         WHERE workspace_id=$1 AND membership_id=ANY($2::uuid[])
           AND status IN ('approved','cancellation_pending')
           AND start_date<=$4::date AND end_date>=$3::date`,
        [ctx.workspaceId, resource.members, task.start, task.end],
      );
      const leaveConflict = leave.rows.some((record) => slots.some((slot) =>
        Array.isArray(record.units) && record.units.length
          ? record.units.some((unit: { date: string; part: string }) => unit.date === slot.date &&
              (unit.part === "first_half"
                ? slot.startTime < (record.calendar_snapshot?.halfDay ?? "24:00").slice(0, 5)
                : slot.endTime > (record.calendar_snapshot?.halfDay ?? "00:00").slice(0, 5)))
          : slot.date >= record.start && slot.date <= record.end));
      if (leaveConflict)
        addCalendarConstraint("A team member has approved leave during this booking.");
    }
    return {
      task,
      resource,
      timezone,
      slots,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      calendarSnapshot: {
        source: resource.calendar ? "resource" : employeeCalendars.length ? "employees" : "workspace_default",
        timezone,
        calendar,
        employeeCalendarCount: employeeCalendars.length,
        exceptions: [...calendarExceptions],
        override: calendarExceptions.size
          ? { approvedBy: ctx.userId, reason: input.note }
          : null,
      },
    };
  }

  private input(value: unknown): ScheduleInput {
    const body = obj(value);
    const status = scheduleStatus(body.status ?? "confirmed");
    if (["completed", "cancelled"].includes(status))
      throw new BadRequestException("Use the complete or cancel action for this booking status.");
    const units = Number(body.units ?? 1);
    if (!Number.isFinite(units) || units <= 0 || units > 100000)
      throw new BadRequestException("Booking units must be greater than zero and no more than 100000.");
    return {
      taskId: str(body.taskId, 80, true),
      status,
      units,
      startTime: body.startTime ? str(body.startTime, 5, true) : undefined,
      endTime: body.endTime ? str(body.endTime, 5, true) : undefined,
      note: str(body.note, 1000),
      calendarOverride: body.calendarOverride === true,
    };
  }

  private async project(ctx: HrmsContext, projectId: string, lock = false): Promise<ProjectRow> {
    const result = await ctx.client.query<ProjectRow>(
      `SELECT project.id,project.name,project.status,workspace.default_timezone AS timezone,
              execution.content
       FROM delivery_projects project
       JOIN workspaces workspace ON workspace.id=project.workspace_id
       JOIN project_execution_view execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
       WHERE project.workspace_id=$1 AND project.id=$2 ${lock ? "FOR UPDATE OF project" : ""}`,
      [ctx.workspaceId, projectId],
    );
    if (!result.rowCount) throw new NotFoundException("Project not found.");
    if (result.rows[0].status === "archived") throw new ConflictException("Archived projects cannot be scheduled.");
    return result.rows[0];
  }

  private async assertManage(ctx: HrmsContext, projectId: string, businessUnitId?: string | null) {
    if (ctx.permissions.has("projects.manage") || ctx.permissions.has("projects.schedule.manage")) return;
    const permitted = await ctx.client.query(
      `SELECT 1 FROM project_assignments
       WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND is_manager
       UNION ALL
       SELECT 1 FROM workspace_team_members member
       JOIN workspace_teams team ON team.workspace_id=member.workspace_id AND team.id=member.team_id
       WHERE member.workspace_id=$1 AND member.membership_id=$3 AND member.is_lead
         AND team.status='active' AND team.business_unit_id=$4::uuid
       LIMIT 1`,
      [ctx.workspaceId, projectId, ctx.membershipId, businessUnitId ?? null],
    );
    if (!permitted.rowCount) throw new ForbiddenException("You cannot manage this project schedule.");
  }

  private async visibleResourceScope(ctx: HrmsContext): Promise<{ all: boolean; resourceIds: string[] }> {
    if (ctx.permissions.has("projects.manage") || ctx.permissions.has("projects.schedule.view")
      || ctx.permissions.has("projects.schedule.manage")) return { all: true, resourceIds: [] };
    const resources = await ctx.client.query<{ id: string }>(
      `SELECT DISTINCT resource.id
       FROM project_resources resource
       LEFT JOIN workspace_teams team ON team.workspace_id=resource.workspace_id AND team.business_unit_id=resource.business_unit_id
       LEFT JOIN workspace_team_members lead ON lead.workspace_id=team.workspace_id AND lead.team_id=team.id
         AND lead.membership_id=$2 AND lead.is_lead
       WHERE resource.workspace_id=$1 AND ($2=ANY(resource.members) OR lead.membership_id IS NOT NULL)`,
      [ctx.workspaceId, ctx.membershipId],
    );
    return { all: false, resourceIds: resources.rows.map((resource) => resource.id) };
  }

  private async insertSlots(
    client: PoolClient,
    workspaceId: string,
    bookingId: string,
    projectId: string,
    preview: Preview,
    units: number,
  ) {
    for (const slot of preview.slots) {
      const endDate = slot.endDate ?? slot.date;
      await client.query(
        `INSERT INTO project_booking_slots(
           workspace_id,booking_id,project_id,task_id,resource_id,local_date,end_date,
           start_time,end_time,starts_at,ends_at,timezone,units,member_ids,calendar_snapshot
         ) VALUES($1,$2,$3,$4,$5,$6::date,$7::date,$8::time,$9::time,
           ($6::date+$8::time) AT TIME ZONE $10,
           ($7::date+$9::time) AT TIME ZONE $10,$10,$11,$12,$13)`,
        [workspaceId, bookingId, projectId, preview.task.id, preview.resource.id, slot.date,
          endDate, slot.startTime, slot.endTime, preview.timezone, units, preview.resource.members,
          JSON.stringify(preview.calendarSnapshot)],
      );
    }
  }

  private async history(
    ctx: HrmsContext,
    bookingId: string,
    fromStatus: string | null,
    toStatus: string,
    action: string,
    reason: string,
    snapshot: Record<string, unknown>,
    requestId: string,
  ) {
    await ctx.client.query(
      `INSERT INTO project_booking_history(
         workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id,request_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.workspaceId, bookingId, action, fromStatus, toStatus, reason, JSON.stringify(snapshot), ctx.userId, requestId],
    );
  }

  private async notify(
    ctx: HrmsContext,
    project: ProjectRow,
    task: Task,
    resource: ProjectResource,
    bookingId: string,
    status: string,
    requestId: string,
  ) {
    if (!resource.members.length) return;
    const recipients = await ctx.client.query(
      `SELECT membership.id,membership.user_id
       FROM workspace_memberships membership
       WHERE membership.workspace_id=$1 AND membership.status='active'
         AND membership.id=ANY($2::uuid[]) AND membership.id<>$3`,
      [ctx.workspaceId, resource.members, ctx.membershipId],
    );
    for (const recipient of recipients.rows) {
      // The person's choices for project notices in the app (notice-choices.ts).
      const inApp = await noticeDecision(ctx.client, { workspaceId: ctx.workspaceId, userId: recipient.user_id, eventType: "project.booking.changed", channel: "in_app" });
      if (!inApp.send) continue;
      await ctx.client.query(
        `INSERT INTO notifications(
           workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,
           deep_link,idempotency_key,correlation_id,delivered_at,silent
         ) VALUES($1,'user',$2,'in_app','project.booking.changed','delivered',$3,$4,$5,$6,$7,now(),$8)
         ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
        [ctx.workspaceId, recipient.user_id, task.title,
          `${project.name} · booking ${status} · ${resource.name}`,
          `/workspace/projects/${project.id}/plan-teams?record=${encodeURIComponent(task.id)}`,
          `project-booking:${requestId}:${recipient.id}`, randomUUID(), inApp.silent],
      );
    }
  }

  private async replayed(client: PoolClient, workspaceId: string, requestId: string) {
    const result = await client.query(
      `SELECT booking.* FROM project_booking_history history
       JOIN project_bookings booking ON booking.workspace_id=history.workspace_id AND booking.id=history.booking_id
       WHERE history.workspace_id=$1 AND history.request_id=$2`,
      [workspaceId, requestId],
    );
    if (!result.rowCount) return null;
    return this.publicBooking(result.rows[0], this.slots(result.rows[0].slots));
  }

  private publicPreview(preview: Preview, status: ScheduleBookingStatus) {
    return {
      taskId: preview.task.id,
      resource: {
        id: preview.resource.id,
        name: preview.resource.name,
        kind: preview.resource.kind,
        capacityMode: preview.resource.capacityMode,
        capacity: preview.resource.capacity,
      },
      timezone: preview.timezone,
      status,
      slots: preview.slots,
      blockers: preview.blockers,
      warnings: preview.warnings,
      canConfirm: preview.blockers.length === 0,
    };
  }

  private publicBooking(row: Record<string, unknown>, slots: BookingSlot[]) {
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      resourceId: row.resource_id,
      status: row.status,
      start: String(row.starts_on).slice(0, 10),
      end: String(row.ends_on).slice(0, 10),
      units: Number(row.units),
      timezone: row.timezone,
      slots,
      acknowledgement: row.acknowledgement,
      cancellationReason: row.cancellation_reason,
      version: Number(row.version),
      confirmedAt: row.confirmed_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
    };
  }

  private slots(value: unknown): BookingSlot[] {
    return Array.isArray(value) ? value as BookingSlot[] : [];
  }

  private requestId(value: unknown) {
    const requestId = str(value, 80, true);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))
      throw new BadRequestException("Use a stable request identifier.");
    return requestId;
  }

  private version(value: unknown) {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 0)
      throw new BadRequestException("Provide the current booking version.");
    return version;
  }

  private projectRevision(project: ProjectRow, value: unknown) {
    if (Number(value) !== project.content.revision)
      throw new ConflictException("This project changed. Refresh and review before booking.");
  }

  private range(fromValue: unknown, toValue: unknown) {
    const from = day(fromValue, true), to = day(toValue, true);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0) throw new BadRequestException("The calendar end date must be on or after the start date.");
    if (days > 93) throw new BadRequestException("Choose a calendar range of 93 days or less.");
    return { from, to };
  }

  private async timezone(client: PoolClient, timezone: string) {
    if (!(await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [timezone])).rowCount)
      throw new BadRequestException("Choose a valid IANA timezone.");
  }

  private intersectEmployeeCalendars(employees: EmployeeCalendarRow[]): WorkCalendar | null {
    if (!employees.length) return null;
    const minutes = (time: string) => time.startsWith("24:")
      ? 1440
      : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const starts = employees.map((employee) => minutes(employee.day_start));
    const ends = employees.map((employee) => {
      const start = minutes(employee.day_start), end = minutes(employee.day_end);
      return end <= start ? end + 1440 : end;
    });
    const start = Math.max(...starts), end = Math.min(...ends);
    const clock = (value: number) => {
      if (value === 1440) return "24:00";
      const normalized = value % 1440;
      return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
    };
    return {
      weekdays: end > start
        ? fullCalendar.weekdays.filter((weekday) =>
            employees.every((employee) => employee.working_days.includes(weekday)))
        : [],
      startTime: end > start ? clock(start) : "00:00",
      endTime: end > start ? clock(end) : "24:00",
      holidays: [...new Set(employees.flatMap((employee) => employee.holidays))]
        .map((date) => ({ date, reason: "Employee non-working date" })),
    };
  }

  private async lock(ctx: HrmsContext) {
    await ctx.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`project-capacity:${ctx.workspaceId}`]);
  }
}
