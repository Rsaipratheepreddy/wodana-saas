import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import type { TargetResult, Unit } from "./report-kit";
import type { ReportFilters } from "./report-scope";

type Db = Pick<PoolClient, "query">;

/**
 * KPI targets (PLM-134): one value per KPI per month, for the whole workspace or one Account Manager, entered by the
 * System Owner in Settings. Rates and averages (a %, hours, days) are a level to reach in that month; counts and money
 * are what the month should add up to.
 *
 * For a period, an additive target is each month's target times the share of that month's days the period covers; a
 * level is the day-weighted mean of the months' targets. A month in the period without a target means the period has
 * no target ("No target set") — never a partial one.
 */
export type TargetDefinition = { unit: Unit; direction: "higher" | "lower"; additive: boolean; perMember: boolean };

export const TARGET_KPIS: Record<string, TargetDefinition> = {
  sales_won_value: { unit: "money", direction: "higher", additive: true, perMember: true },
  sales_won_count: { unit: "count", direction: "higher", additive: true, perMember: true },
  revenue_collected: { unit: "money", direction: "higher", additive: true, perMember: false },
  deals_closed: { unit: "count", direction: "higher", additive: true, perMember: true },
  profit_margin: { unit: "percent", direction: "higher", additive: false, perMember: false },
  new_leads: { unit: "count", direction: "higher", additive: true, perMember: false },
  lead_to_won_rate: { unit: "percent", direction: "higher", additive: false, perMember: true },
  response_rate: { unit: "percent", direction: "higher", additive: false, perMember: true },
  first_response_hours: { unit: "hours", direction: "lower", additive: false, perMember: true },
  design_to_proposal2_rate: { unit: "percent", direction: "higher", additive: false, perMember: false },
  design_to_proposal2_days: { unit: "days", direction: "lower", additive: false, perMember: false },
};

export type TargetRow = { id: string; kpi: string; month: string; membershipId: string | null; target: string; version: number };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const daysIn = (month: string) => { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year, number, 0)).getUTCDate(); };

/** Each month the period touches, with how many of its days the period covers. */
export function periodMonths(from: string, to: string): Array<{ month: string; days: number; daysInMonth: number }> {
  const out: Array<{ month: string; days: number; daysInMonth: number }> = [];
  let cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const start = new Date(`${from}T00:00:00Z`);
  while (cursor <= end) {
    const month = cursor.toISOString().slice(0, 7);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const first = cursor < start ? start : cursor;
    const last = monthEnd > end ? end : monthEnd;
    out.push({ month, days: Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1, daysInMonth: daysIn(month) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

/** The target for a period from monthly targets (see the module comment); null when a month has none. */
export function periodTarget(definition: TargetDefinition, from: string, to: string, monthly: Map<string, string>): string | null {
  const months = periodMonths(from, to);
  if (!months.length || months.some((item) => !monthly.has(item.month))) return null;
  if (definition.additive) {
    return months.reduce((total, item) => total.add(Dec.of(monthly.get(item.month)!).mul(item.days).div(item.daysInMonth)), Dec.ZERO).toFixed(4);
  }
  const days = months.reduce((total, item) => total + item.days, 0);
  return months.reduce((total, item) => total.add(Dec.of(monthly.get(item.month)!).mul(item.days)), Dec.ZERO).div(days).toFixed(4);
}

/**
 * Actual against target: % achieved = actual ÷ target (target ÷ actual when lower is better), gap = target − actual
 * (actual − target when lower is better), green at 100 % or more, amber 80–99.9 %, red under 80 %.
 */
export function achievement(definition: TargetDefinition, actual: string, target: string): TargetResult {
  const a = Dec.of(actual), goal = Dec.of(target);
  const lower = definition.direction === "lower";
  let ratio: Dec | null;
  if (lower) ratio = a.isZero() ? null : goal.mul(100).div(a);
  else ratio = goal.isZero() ? null : a.mul(100).div(goal);
  // Lower is better and nothing happened (0 hours) or a zero target that is met: on target.
  const reached = ratio === null ? (lower ? true : a.cmp(0) >= 0) : ratio.cmp(100) >= 0;
  const tone = reached ? "success" : ratio !== null && ratio.cmp(80) >= 0 ? "warning" : "danger";
  return { target: goal.toFixed(4), percent: ratio === null ? null : ratio.toFixed(1), gap: (lower ? a.sub(goal) : goal.sub(a)).toFixed(4), tone };
}

/** Targets are compared only when nothing but the period and the Account Manager is filtered (they are set for all records). */
export function targetsComparable(filters: ReportFilters) {
  return !filters.enquiryType && !filters.package && !filters.clientType && !filters.source && !filters.channel && !filters.region && !filters.entity;
}

/** The monthly targets of the months a period touches, for the workspace (membershipId null) or one member. */
export async function loadTargets(db: Db, workspaceId: string, from: string, to: string) {
  const rows = (await db.query<{ kpi: string; month: string; membershipId: string | null; target: string }>(
    `SELECT kpi_code AS kpi, to_char(month, 'YYYY-MM') AS month, membership_id AS "membershipId", target::text AS target
       FROM management_report_targets
      WHERE workspace_id = $1 AND month >= date_trunc('month', $2::date)::date AND month <= $3::date`, [workspaceId, from, to])).rows;
  return (kpi: string, membershipId: string | null) => new Map(rows.filter((row) => row.kpi === kpi && row.membershipId === membershipId).map((row) => [row.month, row.target]));
}

/** What a KPI's target is for this period and filter, measured against its actual (undefined: none). */
export function targetFor(
  lookup: Awaited<ReturnType<typeof loadTargets>>, kpi: string, filters: ReportFilters, actual: string | null, membershipId: string | null = filters.accountManager,
): { target?: TargetResult | null; targetHidden?: boolean } {
  const definition = TARGET_KPIS[kpi];
  if (!definition) return {};
  if (!targetsComparable(filters)) return { target: null, targetHidden: true };
  if (membershipId && !definition.perMember) return { target: null, targetHidden: true };
  const goal = periodTarget(definition, filters.from, filters.to, lookup(kpi, membershipId));
  if (goal === null || actual === null) return {};
  return { target: achievement(definition, actual, goal) };
}

// ------------------------------------------------------------------ Settings: read and save

export async function readTargets(db: Db, workspaceId: string, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Choose a valid year");
  const rows = (await db.query<TargetRow>(
    `SELECT id, kpi_code AS kpi, to_char(month, 'YYYY-MM') AS month, membership_id AS "membershipId", target::text AS target, version
       FROM management_report_targets WHERE workspace_id = $1 AND month >= make_date($2, 1, 1) AND month < make_date($2 + 1, 1, 1)
      ORDER BY kpi_code, month, membership_id NULLS FIRST`, [workspaceId, year])).rows;
  return { year, kpis: Object.entries(TARGET_KPIS).map(([code, definition]) => ({ code, ...definition })), targets: rows.map((row) => ({ ...row, target: trimAmount(row.target) })) };
}

const trimAmount = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

export type TargetChange = { kpi: string; month: string; membershipId: string | null; target: string | null; version: number | null };

/** Validates a save: known KPIs, months, members of this workspace, positive decimals; a % at most 100. */
export function parseTargetChanges(body: unknown): { commandId: string; changes: TargetChange[] } {
  const input = (body ?? {}) as { commandId?: unknown; changes?: unknown };
  if (typeof input.commandId !== "string" || !UUID.test(input.commandId)) throw new BadRequestException("A command id is required");
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 400) throw new BadRequestException("Send between 1 and 400 target changes");
  const seen = new Set<string>();
  const changes = input.changes.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const kpi = typeof item.kpi === "string" ? item.kpi : "";
    const definition = TARGET_KPIS[kpi];
    if (!definition) throw new BadRequestException("Unknown KPI");
    const month = typeof item.month === "string" ? item.month : "";
    if (!MONTH.test(month)) throw new BadRequestException("Choose a valid month");
    const membershipId = item.membershipId === null || item.membershipId === undefined || item.membershipId === "" ? null : String(item.membershipId);
    if (membershipId && !UUID.test(membershipId)) throw new BadRequestException("Choose a valid Account Manager");
    if (membershipId && !definition.perMember) throw new BadRequestException("This KPI has one target for the whole company");
    const value = item.target === null || item.target === undefined || item.target === "" ? null : String(item.target).trim();
    if (value !== null) {
      if (!AMOUNT.test(value) || Dec.of(value).isZero()) throw new BadRequestException("Enter a target above zero");
      if (definition.unit === "percent" && Dec.of(value).cmp(100) > 0) throw new BadRequestException("A percentage target is at most 100");
    }
    const version = item.version === null || item.version === undefined ? null : Number(item.version);
    if (version !== null && (!Number.isInteger(version) || version < 1)) throw new BadRequestException("Invalid version");
    const key = `${kpi}|${month}|${membershipId ?? ""}`;
    if (seen.has(key)) throw new BadRequestException("Each target can change once per save");
    seen.add(key);
    return { kpi, month, membershipId, target: value, version };
  });
  return { commandId: input.commandId, changes };
}

/**
 * Saves targets in one command: idempotent by command id (a repeat returns without changing anything), every change
 * version-checked (a new target expects no row; an edit or a clear expects the version it read), and audited.
 */
export async function saveTargets(db: Db, workspaceId: string, actorUserId: string, body: unknown) {
  const { commandId, changes } = parseTargetChanges(body);
  const first = await db.query(
    `INSERT INTO management_report_target_commands (workspace_id, id, actor_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [workspaceId, commandId, actorUserId]);
  if (!first.rowCount) return { applied: false, changed: 0 };
  const members = [...new Set(changes.map((change) => change.membershipId).filter((id): id is string => Boolean(id)))];
  if (members.length) {
    const found = await db.query(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, members]);
    if (found.rowCount !== members.length) throw new BadRequestException("Choose a member of this workspace");
  }
  let changed = 0;
  for (const change of changes) {
    const current = (await db.query<{ id: string; target: string; version: number }>(
      `SELECT id, target::text AS target, version FROM management_report_targets
        WHERE workspace_id = $1 AND kpi_code = $2 AND month = to_date($3, 'YYYY-MM') AND membership_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE`,
      [workspaceId, change.kpi, change.month, change.membershipId])).rows[0];
    if ((current?.version ?? null) !== change.version) throw new ConflictException("Someone changed these targets. Reload and try again.");
    const before = current ? { kpi: change.kpi, month: change.month, membershipId: change.membershipId, target: trimAmount(current.target) } : null;
    let entityId: string;
    if (!current && change.target === null) continue;
    if (!current) {
      entityId = randomUUID();
      await db.query(
        `INSERT INTO management_report_targets (id, workspace_id, kpi_code, month, membership_id, target, created_by, updated_by)
         VALUES ($1, $2, $3, to_date($4, 'YYYY-MM'), $5, $6::numeric, $7, $7)`,
        [entityId, workspaceId, change.kpi, change.month, change.membershipId, change.target, actorUserId]);
    } else if (change.target === null) {
      entityId = current.id;
      await db.query(`DELETE FROM management_report_targets WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.id]);
    } else {
      entityId = current.id;
      if (Dec.of(current.target).cmp(change.target) === 0) continue;
      await db.query(
        `UPDATE management_report_targets SET target = $3::numeric, updated_by = $4, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, current.id, change.target, actorUserId]);
    }
    changed += 1;
    await recordAudit(db, {
      workspaceId, actorUserId, action: change.target === null ? "reports.target.cleared" : current ? "reports.target.changed" : "reports.target.set",
      entityType: "management_report_target", entityId, before,
      after: change.target === null ? null : { kpi: change.kpi, month: change.month, membershipId: change.membershipId, target: change.target },
    });
  }
  return { applied: true, changed };
}
