import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestActor } from "../auth/actor";
import { currentViewAs } from "../auth/view-as/view-as.context";
import { leaveReasonsRemoved } from "../auth/view-as/view-as.domain";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";
import {
  AllowanceDto,
  CancelLeaveDto,
  DecisionDto,
  LeaveDto,
  LeaveQueryDto,
  LeaveTypeDto,
} from "./hrms.dto";
import {
  Calendar,
  fingerprint,
  formatDates,
  formatDays,
  LeaveUnit,
  leaveUnits,
  localDate,
  zonedInstant,
} from "./hrms-domain";

const unitDays = (units: LeaveUnit[]) =>
  units.reduce((sum, unit) => sum + unit.days, 0);

@Injectable()
export class HrmsLeaveService {
  constructor(private readonly access: HrmsAccessService) {}
  types(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.self", "hrms.team", "hrms.manage");
      return (
        await ctx.client.query(
          `SELECT id,name,limited,annual_days::float AS "annualDays",allow_half_day AS "allowHalfDay",paid,active,version FROM hrms_leave_types WHERE workspace_id=$1 ORDER BY name`,
          [workspaceId],
        )
      ).rows;
    });
  }
  saveType(actor: RequestActor, workspaceId: string, input: LeaveTypeDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      if (
        !input.name.trim() ||
        input.annualDays * 2 !== Math.floor(input.annualDays * 2)
      )
        throw new BadRequestException(
          "Enter a leave name and allowance in half-day increments.",
        );
      // Unlimited leave (sick, unpaid) has no yearly allowance.
      const annualDays = input.limited ? input.annualDays : 0;
      const id = input.id ?? randomUUID();
      await ctx.client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`leave-types:${workspaceId}`],
      );
      const row = await ctx.client.query(
        `SELECT * FROM hrms_leave_types WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      this.access.version(row.rows[0]?.version, input.version);
      const sameName = await ctx.client.query(
        `SELECT 1 FROM hrms_leave_types WHERE workspace_id=$1 AND lower(name)=lower($2) AND id<>$3`,
        [workspaceId, input.name.trim(), id],
      );
      if (sameName.rowCount)
        throw new ConflictException("A leave type with this name exists.");
      const result = await ctx.client.query(
        `INSERT INTO hrms_leave_types(id,workspace_id,name,limited,annual_days,allow_half_day,paid,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,limited=EXCLUDED.limited,annual_days=EXCLUDED.annual_days,allow_half_day=EXCLUDED.allow_half_day,paid=EXCLUDED.paid,active=EXCLUDED.active,version=hrms_leave_types.version+1 WHERE hrms_leave_types.workspace_id=EXCLUDED.workspace_id RETURNING version`,
        [
          id,
          workspaceId,
          input.name.trim(),
          input.limited,
          annualDays,
          input.allowHalfDay,
          input.paid,
          input.active,
        ],
      );
      if (!result.rowCount)
        throw new ConflictException("Leave type could not be saved.");
      await this.access.audit(
        ctx,
        "leave_type_updated",
        id,
        { ...input, annualDays },
        row.rows[0],
      );
      return { ...input, annualDays, id, version: result.rows[0].version };
    });
  }
  balances(actor: RequestActor, workspaceId: string, input: LeaveQueryDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      let members: string[];
      if (input.scope === "team") {
        this.access.require(ctx, "hrms.team", "hrms.manage");
        members = [];
        for (const row of (
          await ctx.client.query(
            `SELECT membership_id FROM hrms_employees WHERE workspace_id=$1`,
            [workspaceId],
          )
        ).rows)
          if (await this.access.canManageEmployee(ctx, row.membership_id))
            members.push(row.membership_id);
      } else {
        this.access.require(ctx, "hrms.self", "hrms.manage");
        await this.access.employee(ctx);
        members = [ctx.membershipId];
      }
      const types = (
        await ctx.client.query(
          `SELECT id,name,limited,annual_days::float AS days FROM hrms_leave_types WHERE workspace_id=$1 AND active ORDER BY name`,
          [workspaceId],
        )
      ).rows;
      const result = [];
      for (const member of members) {
        const e = await this.access.employee(ctx, member);
        const year =
          input.year ??
          Number(localDate(new Date(), e.calendar.timezone).slice(0, 4));
        for (const type of types) {
          const row = (
            await ctx.client.query(
              `SELECT days::float AS days,version FROM hrms_leave_allowances WHERE workspace_id=$1 AND membership_id=$2 AND leave_type_id=$3 AND year=$4`,
              [workspaceId, member, type.id, year],
            )
          ).rows[0];
          const usage = await this.usage(ctx, member, type.id, year);
          const allowance = type.limited ? (row?.days ?? type.days) : null;
          result.push({
            membershipId: member,
            name: e.name,
            leaveTypeId: type.id,
            leaveTypeName: type.name,
            year,
            limited: type.limited,
            allowance,
            used: usage.used,
            pending: usage.pending,
            available:
              allowance === null ? null : allowance - usage.used - usage.pending,
            version: row?.version ?? 0,
          });
        }
      }
      return result;
    });
  }
  saveAllowance(actor: RequestActor, workspaceId: string, input: AllowanceDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      await this.access.employee(ctx, input.membershipId);
      await this.access.lock(ctx, input.membershipId);
      if (input.days * 2 !== Math.floor(input.days * 2))
        throw new BadRequestException("Allowances use half-day increments.");
      const type = await ctx.client.query<{ limited: boolean }>(
        `SELECT limited FROM hrms_leave_types WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, input.leaveTypeId],
      );
      if (!type.rowCount) throw new NotFoundException("Leave type not found.");
      if (!type.rows[0].limited)
        throw new BadRequestException("This leave type has no allowance.");
      const before = (
        await ctx.client.query(
          `SELECT * FROM hrms_leave_allowances WHERE workspace_id=$1 AND membership_id=$2 AND leave_type_id=$3 AND year=$4`,
          [workspaceId, input.membershipId, input.leaveTypeId, input.year],
        )
      ).rows[0];
      this.access.version(before?.version, input.version);
      const usage = await this.usage(
        ctx,
        input.membershipId,
        input.leaveTypeId,
        input.year,
      );
      if (input.days < usage.used + usage.pending)
        throw new BadRequestException(
          "Allowance cannot be lower than approved and pending leave.",
        );
      const result = await ctx.client.query(
        `INSERT INTO hrms_leave_allowances(workspace_id,membership_id,leave_type_id,year,days) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,membership_id,leave_type_id,year) DO UPDATE SET days=EXCLUDED.days,version=hrms_leave_allowances.version+1 RETURNING version`,
        [
          workspaceId,
          input.membershipId,
          input.leaveTypeId,
          input.year,
          input.days,
        ],
      );
      await this.access.audit(
        ctx,
        "leave_allowance_updated",
        input.membershipId,
        { ...input },
        before,
      );
      return { ...input, version: result.rows[0].version };
    });
  }
  /** The words a notice about one leave request uses. */
  private async detail(ctx: HrmsContext, id: string) {
    const row = (
      await ctx.client.query<{
        person: string;
        leaveType: string;
        startDate: string;
        endDate: string;
        units: LeaveUnit[];
      }>(
        `SELECT u.display_name AS person,t.name AS "leaveType",l.start_date::text AS "startDate",l.end_date::text AS "endDate",l.units
           FROM hrms_leave_requests l JOIN hrms_leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id
           JOIN workspace_memberships m ON m.workspace_id=l.workspace_id AND m.id=l.membership_id JOIN users u ON u.id=m.user_id
          WHERE l.workspace_id=$1 AND l.id=$2`,
        [ctx.workspaceId, id],
      )
    ).rows[0];
    const locale = await this.access.locale(ctx);
    return {
      person: row.person,
      leaveType: row.leaveType,
      dates: formatDates(row.startDate, row.endDate, locale),
      days: formatDays(unitDays(row.units)),
    };
  }
  private async usage(
    ctx: HrmsContext,
    member: string,
    type: string,
    year: number,
  ) {
    const rows = await ctx.client.query(
      `SELECT status,units FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND leave_type_id=$3 AND status IN ('pending','approved','cancellation_pending')`,
      [ctx.workspaceId, member, type],
    );
    let used = 0,
      pending = 0;
    for (const row of rows.rows)
      for (const unit of row.units as LeaveUnit[])
        if (Number(unit.date.slice(0, 4)) === year) {
          if (row.status === "pending") pending += unit.days;
          else used += unit.days;
        }
    return { used, pending };
  }
  request(actor: RequestActor, workspaceId: string, input: LeaveDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const employee = await this.access.self(ctx);
      await this.access.lock(ctx);
      const hash = fingerprint(input);
      const prior = await ctx.client.query(
        `SELECT id,status,request_hash FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND action_id=$3`,
        [workspaceId, ctx.membershipId, input.actionId],
      );
      if (prior.rowCount) {
        if (prior.rows[0].request_hash !== hash)
          throw new ConflictException("This request ID has already been used.");
        return {
          id: prior.rows[0].id,
          status: prior.rows[0].status,
          replayed: true,
        };
      }
      if (input.reason.trim().length < 3)
        throw new BadRequestException("Give a reason for your leave.");
      const type = await ctx.client.query<{
        id: string;
        name: string;
        days: number;
        limited: boolean;
        allow_half_day: boolean;
      }>(
        `SELECT id,name,annual_days::float AS days,limited,allow_half_day FROM hrms_leave_types WHERE workspace_id=$1 AND id=$2 AND active FOR SHARE`,
        [workspaceId, input.leaveTypeId],
      );
      if (!type.rowCount)
        throw new BadRequestException("Choose an active leave type.");
      if (input.dayPart !== "full" && !type.rows[0].allow_half_day)
        throw new BadRequestException(
          "This leave type does not allow half days.",
        );
      const units = leaveUnits(
        input.startDate,
        input.endDate,
        input.dayPart,
        employee.calendar,
      );
      if (
        input.startDate < employee.activeFrom ||
        (employee.activeTo && input.endDate > employee.activeTo)
      )
        throw new BadRequestException(
          "Leave must fall within your employment dates.",
        );
      const existing = await ctx.client.query(
        `SELECT units FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND status IN ('pending','approved','cancellation_pending') AND start_date<=$4 AND end_date>=$3`,
        [workspaceId, ctx.membershipId, input.startDate, input.endDate],
      );
      const keys = new Set(
        existing.rows.flatMap((row) =>
          row.units.map((unit: LeaveUnit) => `${unit.date}:${unit.part}`),
        ),
      );
      if (units.some((unit) => keys.has(`${unit.date}:${unit.part}`)))
        throw new ConflictException("This leave overlaps an existing request.");
      for (const year of new Set(
        units.map((unit) => Number(unit.date.slice(0, 4))),
      )) {
        if (year < 2000 || year > 2200)
          throw new BadRequestException("Choose a supported leave year.");
        if (!type.rows[0].limited) continue;
        await ctx.client.query(
          `INSERT INTO hrms_leave_allowances(workspace_id,membership_id,leave_type_id,year,days) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            ctx.membershipId,
            input.leaveTypeId,
            year,
            type.rows[0].days,
          ],
        );
        const balance = await ctx.client.query(
          `SELECT days::float AS days FROM hrms_leave_allowances WHERE workspace_id=$1 AND membership_id=$2 AND leave_type_id=$3 AND year=$4`,
          [workspaceId, ctx.membershipId, input.leaveTypeId, year],
        );
        const usage = await this.usage(
          ctx,
          ctx.membershipId,
          input.leaveTypeId,
          year,
        );
        const requested = units
          .filter((unit) => Number(unit.date.slice(0, 4)) === year)
          .reduce((sum, unit) => sum + unit.days, 0);
        if (usage.pending + usage.used + requested > balance.rows[0].days)
          throw new BadRequestException(
            `Insufficient leave allowance for ${year}.`,
          );
      }
      const result = await ctx.client.query(
        `INSERT INTO hrms_leave_requests(workspace_id,membership_id,leave_type_id,action_id,request_hash,start_date,end_date,day_part,units,calendar_snapshot,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status`,
        [
          workspaceId,
          ctx.membershipId,
          input.leaveTypeId,
          input.actionId,
          hash,
          input.startDate,
          input.endDate,
          input.dayPart,
          JSON.stringify(units),
          employee.calendar,
          input.reason.trim(),
        ],
      );
      await this.access.audit(ctx, "leave_requested", result.rows[0].id, {
        ...input,
        units,
      });
      const locale = await this.access.locale(ctx);
      await this.access.notify(ctx, [
        {
          code: "hrms.leave_requested",
          users: await this.access.approvers(ctx, ctx.membershipId),
          variables: {
            person: employee.name,
            leaveType: type.rows[0].name,
            dates: formatDates(input.startDate, input.endDate, locale),
            days: formatDays(unitDays(units)),
            note: input.reason.trim(),
          },
          deepLink: `/workspace/hrms/team?leave=${result.rows[0].id}`,
          key: `hrms.leave_requested:${result.rows[0].id}`,
          email: true,
        },
      ]);
      return result.rows[0];
    });
  }
  list(actor: RequestActor, workspaceId: string, input: LeaveQueryDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const team = input.scope === "team";
      this.access.require(
        ctx,
        ...(team ? ["hrms.team", "hrms.manage"] : ["hrms.self", "hrms.manage"]),
      );
      const rows = await ctx.client.query(
        `SELECT l.id,l.membership_id AS "membershipId",u.display_name AS name,l.leave_type_id AS "leaveTypeId",t.name AS "leaveTypeName",l.start_date::text AS "startDate",l.end_date::text AS "endDate",l.day_part AS "dayPart",l.units,l.reason,l.status,l.decision_reason AS "decisionReason",l.cancellation_reason AS "cancellationReason",l.created_at AS "createdAt",l.version FROM hrms_leave_requests l JOIN workspace_memberships m ON m.workspace_id=l.workspace_id AND m.id=l.membership_id JOIN users u ON u.id=m.user_id JOIN hrms_leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id WHERE l.workspace_id=$1 AND ($2 OR l.membership_id=$3) AND ($4::integer IS NULL OR (extract(year FROM l.start_date)<=$4 AND extract(year FROM l.end_date)>=$4)) ORDER BY l.created_at DESC`,
        [workspaceId, team, ctx.membershipId, input.year ?? null],
      );
      const result = [];
      for (const row of rows.rows)
        if (
          !team ||
          (await this.access.canManageEmployee(ctx, row.membershipId))
        )
          result.push({
            ...row,
            days: row.units.reduce(
              (sum: number, u: LeaveUnit) => sum + u.days,
              0,
            ),
            canDecide:
              ["pending", "cancellation_pending"].includes(row.status) &&
              row.membershipId !== ctx.membershipId &&
              (await this.access.canManageEmployee(ctx, row.membershipId)),
          });
      // Leave reasons stay private while an owner views as someone.
      return currentViewAs() ? leaveReasonsRemoved(result) : result;
    });
  }
  cancel(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: CancelLeaveDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.self", "hrms.manage");
      await this.access.lock(ctx);
      if (input.reason.trim().length < 3)
        throw new BadRequestException("Explain the cancellation.");
      const row = (
        await ctx.client.query(
          `SELECT * FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND id=$3 FOR UPDATE`,
          [workspaceId, ctx.membershipId, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException("Leave request not found.");
      if (
        ["withdrawn", "cancelled", "cancellation_pending"].includes(row.status)
      )
        return { id, status: row.status };
      if (!["pending", "approved"].includes(row.status))
        throw new ConflictException("This leave request cannot be cancelled.");
      const status =
        row.status === "pending" ? "withdrawn" : "cancellation_pending";
      await ctx.client.query(
        `UPDATE hrms_leave_requests SET status=$3,cancellation_reason=$4,version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, status, input.reason.trim()],
      );
      await this.access.audit(
        ctx,
        "leave_cancellation_requested",
        id,
        { status, reason: input.reason },
        row,
      );
      if (status === "cancellation_pending") {
        const detail = await this.detail(ctx, id);
        await this.access.notify(ctx, [
          {
            code: "hrms.leave_cancellation_requested",
            users: await this.access.approvers(ctx, ctx.membershipId),
            variables: { ...detail, note: input.reason.trim() },
            deepLink: `/workspace/hrms/team?leave=${id}`,
            key: `hrms.leave_cancellation_requested:${id}`,
          },
        ]);
      }
      return { id, status };
    });
  }
  decide(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: DecisionDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const found = (
        await ctx.client.query(
          `SELECT membership_id FROM hrms_leave_requests WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, id],
        )
      ).rows[0];
      if (!found) throw new NotFoundException("Leave request not found.");
      await this.access.assertReviewer(ctx, found.membership_id);
      await this.access.lock(ctx, found.membership_id);
      const row = (
        await ctx.client.query(
          `SELECT * FROM hrms_leave_requests WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
          [workspaceId, id],
        )
      ).rows[0];
      if (!["pending", "cancellation_pending"].includes(row.status))
        throw new ConflictException("This request has already been decided.");
      if (input.reason.trim().length < 3)
        throw new BadRequestException("Explain your decision.");
      if (input.decision === "approve" && row.status === "pending") {
        const calendar = row.calendar_snapshot as Calendar;
        for (const unit of row.units as LeaveUnit[]) {
          const start = zonedInstant(
              unit.date,
              unit.part === "first_half" ? calendar.dayStart : calendar.halfDay,
              calendar.timezone,
            ),
            end = zonedInstant(
              unit.date,
              unit.part === "first_half" ? calendar.halfDay : calendar.dayEnd,
              calendar.timezone,
            );
          const attendance = await ctx.client.query(
            // A session still open (no check-out yet) counts up to now: it can't overlap leave that starts later.
            `SELECT 1 FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND started_at<$4 AND COALESCE(ended_at, now())>$3`,
            [workspaceId, row.membership_id, start, end],
          );
          if (attendance.rowCount)
            throw new ConflictException(
              "Attendance overlaps the requested leave. Resolve the attendance or request the appropriate half day.",
            );
        }
      }
      const status =
        row.status === "cancellation_pending"
          ? input.decision === "approve"
            ? "cancelled"
            : "approved"
          : input.decision === "approve"
            ? "approved"
            : "rejected";
      await ctx.client.query(
        `UPDATE hrms_leave_requests SET status=$3,decided_by=$4,decision_reason=$5,decided_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, status, ctx.userId, input.reason.trim()],
      );
      await this.access.audit(
        ctx,
        "leave_decided",
        id,
        { status, reason: input.reason },
        row,
      );
      const code =
        row.status === "cancellation_pending"
          ? status === "cancelled"
            ? "hrms.leave_cancelled"
            : "hrms.leave_cancellation_refused"
          : status === "approved"
            ? "hrms.leave_approved"
            : "hrms.leave_rejected";
      await this.access.notify(ctx, [
        {
          code,
          users: await this.access.userOf(ctx, row.membership_id),
          variables: {
            ...(await this.detail(ctx, id)),
            note: input.reason.trim(),
          },
          deepLink: `/workspace/hrms/leave?request=${id}`,
          key: `${code}:${id}`,
          email: code === "hrms.leave_approved" || code === "hrms.leave_rejected",
        },
      ]);
      return { id, status };
    });
  }
}
