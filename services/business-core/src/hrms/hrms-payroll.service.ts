import { BadRequestException, Injectable } from "@nestjs/common";
import { RequestActor } from "../auth/actor";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { HrmsAccessService } from "./hrms-access.service";
import { HrmsAttendanceService } from "./hrms-attendance.service";
import { addDays, csvCell, LeaveUnit, localDate } from "./hrms-domain";
import { scheduledMinutes } from "./hrms-time.service";

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/**
 * The month's payroll inputs (plan §6.28, H5) for an outside payroll provider: per employee the days
 * expected and worked, hours worked and beyond their calendar's day, paid and unpaid leave, and days
 * away without leave; per crew worker the days present on approved crew days, overtime and what those
 * days come to at their fixed rates. Nothing here pays anyone.
 */
@Injectable()
export class HrmsPayrollService {
  constructor(private readonly access: HrmsAccessService, private readonly attendance: HrmsAttendanceService) {}

  month(actor: RequestActor, workspaceId: string, month: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("Choose a month.");
      const [year, number] = month.split("-").map(Number);
      const from = `${month}-01`;
      const to = addDays(number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`, -1);
      const history = await this.attendance.historyIn(ctx, { from, to, scope: "team" });
      // Days away count only once they're over: a month run part-way through doesn't count what's ahead.
      const zone = (await ctx.client.query<{ zone: string | null }>(`SELECT default_timezone AS zone FROM workspaces WHERE id=$1`, [workspaceId])).rows[0]?.zone || "UTC";
      const today = localDate(new Date(), zone);
      const employees = (await ctx.client.query<{ membershipId: string; name: string; employeeCode: string; designation: string; department: string }>(
        `SELECT e.membership_id AS "membershipId", u.display_name AS name, e.employee_code AS "employeeCode", e.designation, e.department
           FROM hrms_employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.membership_id JOIN users u ON u.id=m.user_id
          WHERE e.workspace_id=$1 AND e.enabled AND e.active_from <= $3 AND (e.active_to IS NULL OR e.active_to >= $2)
          ORDER BY u.display_name`,
        [workspaceId, from, to],
      )).rows;
      const leave = (await ctx.client.query<{ membershipId: string; units: LeaveUnit[]; paid: boolean }>(
        `SELECT l.membership_id AS "membershipId", l.units, t.paid FROM hrms_leave_requests l JOIN hrms_leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id
          WHERE l.workspace_id=$1 AND l.status IN ('approved','cancellation_pending') AND l.start_date <= $3 AND l.end_date >= $2`,
        [workspaceId, from, to],
      )).rows;
      const people = [];
      for (const employee of employees) {
        const person = await this.access.employee(ctx, employee.membershipId);
        const days = history.days.filter((day) => day.membershipId === employee.membershipId);
        const units = leave.filter((row) => row.membershipId === employee.membershipId).flatMap((row) => row.units.map((unit) => ({ ...unit, paid: row.paid })))
          .filter((unit) => unit.date >= from && unit.date <= to);
        let scheduledDays = 0, workedDays = 0, workedMinutes = 0, beyondMinutes = 0, absentDays = 0;
        for (const day of days) {
          const expected = scheduledMinutes(person.calendar, day.date);
          const away = Math.min(1, units.filter((unit) => unit.date === day.date).reduce((sum, unit) => sum + unit.days, 0));
          if (expected) scheduledDays += 1;
          if (day.workedMinutes > 0) workedDays += 1;
          workedMinutes += day.workedMinutes;
          beyondMinutes += Math.max(0, day.workedMinutes - Math.round(expected * (1 - away)));
          if (expected && day.date < today && day.workedMinutes === 0 && day.status !== "checked_in" && day.status !== "missing_checkout") absentDays += Math.max(0, 1 - away);
        }
        people.push({
          ...employee, scheduledDays, workedDays, workedHours: hours(workedMinutes), overtimeHours: hours(beyondMinutes),
          paidLeaveDays: units.filter((unit) => unit.paid).reduce((sum, unit) => sum + unit.days, 0),
          unpaidLeaveDays: units.filter((unit) => !unit.paid).reduce((sum, unit) => sum + unit.days, 0),
          absentDays, toReview: days.reduce((sum, day) => sum + day.reviewCount, 0) + days.filter((day) => day.stale).length,
        });
      }
      const workerRows = (await ctx.client.query<{ workerId: string; name: string; workerCode: string; trade: string; crew: string | null; presence: string; overtime: string; rate: string | null; currency: string | null }>(
        `SELECT worker.id AS "workerId", worker.name, worker.worker_code AS "workerCode", worker.trade, crew.name AS crew, line.presence, line.overtime_hours::text AS overtime,
                line.day_rate::text AS rate, line.currency
           FROM hrms_crew_day_workers line
           JOIN hrms_crew_days day ON day.workspace_id = line.workspace_id AND day.id = line.crew_day_id AND day.status = 'approved' AND day.work_date BETWEEN $2 AND $3
           JOIN hrms_workers worker ON worker.workspace_id = line.workspace_id AND worker.id = line.worker_id
           LEFT JOIN hrms_crews crew ON crew.workspace_id = worker.workspace_id AND crew.id = worker.crew_id
          WHERE line.workspace_id=$1 AND line.presence <> 'absent' ORDER BY worker.name`,
        [workspaceId, from, to],
      )).rows;
      const workers = new Map<string, { workerId: string; name: string; workerCode: string; trade: string; crew: string | null; days: number; overtimeHours: number; amounts: Record<string, Dec>; uncosted: number }>();
      for (const row of workerRows) {
        const entry = workers.get(row.workerId) ?? { workerId: row.workerId, name: row.name, workerCode: row.workerCode, trade: row.trade, crew: row.crew, days: 0, overtimeHours: 0, amounts: {}, uncosted: 0 };
        workers.set(row.workerId, entry);
        const share = row.presence === "half_day" ? "0.5" : "1";
        entry.days += Number(share);
        entry.overtimeHours += Number(row.overtime);
        if (row.rate && row.currency) entry.amounts[row.currency] = (entry.amounts[row.currency] ?? Dec.ZERO).add(Dec.of(row.rate).mul(share));
        else entry.uncosted += 1;
      }
      return {
        month, from, to, people,
        workers: [...workers.values()].map(({ amounts, ...worker }) => ({
          ...worker, overtimeHours: Math.round(worker.overtimeHours * 100) / 100,
          amounts: Object.entries(amounts).map(([currency, amount]) => ({ currency, amount: amount.round(currencyDecimals(currency)).toFixed(currencyDecimals(currency)) })),
        })),
      };
    });
  }

  /** The month as CSV (UTF-8, dates as YYYY-MM-DD, decimals with a point), employees or crew workers. */
  async export(actor: RequestActor, workspaceId: string, month: string, kind: "employees" | "workers") {
    const data = await this.month(actor, workspaceId, month);
    const lines: unknown[][] = kind === "employees"
      ? [["Employee", "Code", "Designation", "Department", "Month", "Scheduled days", "Days worked", "Hours worked", "Hours beyond the day", "Paid leave days", "Unpaid leave days", "Days away without leave", "To review"],
        ...data.people.map((row) => [row.name, row.employeeCode, row.designation, row.department, data.month, row.scheduledDays, row.workedDays, row.workedHours, row.overtimeHours,
          row.paidLeaveDays, row.unpaidLeaveDays, row.absentDays, row.toReview])]
      : [["Worker", "Code", "Trade", "Crew", "Month", "Days", "Overtime hours", "Amount", "Currency", "Days without a rate"],
        ...data.workers.flatMap((row) => (row.amounts.length ? row.amounts : [{ amount: "", currency: "" }]).map((amount) =>
          [row.name, row.workerCode, row.trade, row.crew ?? "", data.month, row.days, row.overtimeHours, amount.amount, amount.currency, row.uncosted]))];
    return "﻿" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  }
}
