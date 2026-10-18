import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { everythingMade, FINAL_PENDING, ORDER_TOTALS } from "./factory";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-063: a project's production status, read from its work orders (the factory updates it by working them: start,
 * report output, check quality). The steps are fixed kinds in this order; a firm keeps the ones it uses and names them
 * in its own words (Settings → Factory). A firm that doesn't check quality drops that step, and its work reads as in
 * production until it's ready.
 */
export const PRODUCTION_STEP_KINDS = ["scheduled", "in_production", "quality_check", "ready"] as const;
export type ProductionStepKind = (typeof PRODUCTION_STEP_KINDS)[number];
/** A step as the firm keeps it: its kind, and its own word for it (empty: the standard word). */
export type ProductionStep = { kind: ProductionStepKind; label: string };
export const DEFAULT_PRODUCTION_STEPS: ProductionStep[] = PRODUCTION_STEP_KINDS.map((kind) => ({ kind, label: "" }));

const rank = (kind: ProductionStepKind) => PRODUCTION_STEP_KINDS.indexOf(kind);

/** The stored steps, read leniently: known kinds, in their order, each once; the standard steps when nothing usable is stored. */
export function normaliseProductionSteps(value: unknown): ProductionStep[] {
  if (!Array.isArray(value)) return DEFAULT_PRODUCTION_STEPS;
  const seen = new Set<string>();
  const steps = value.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const kind = row.kind as ProductionStepKind;
    if (!PRODUCTION_STEP_KINDS.includes(kind) || seen.has(kind)) return [];
    seen.add(kind);
    return [{ kind, label: typeof row.label === "string" ? row.label.trim().slice(0, 40) : "" }];
  }).sort((a, b) => rank(a.kind) - rank(b.kind));
  return steps.length >= 2 && steps.at(-1)!.kind === "ready" ? steps : DEFAULT_PRODUCTION_STEPS;
}

/** Validates a change to the steps: at least two of the known kinds, in their order, each once, ending with Ready. */
export function parseProductionSteps(input: unknown): ProductionStep[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > PRODUCTION_STEP_KINDS.length) throw new BadRequestException("Keep between 2 and 4 production steps.");
  const steps = input.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (!PRODUCTION_STEP_KINDS.includes(row.kind as ProductionStepKind)) throw new BadRequestException("Unknown production step.");
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (label.length > 40) throw new BadRequestException("Keep each step's name under 40 characters.");
    return { kind: row.kind as ProductionStepKind, label };
  });
  if (new Set(steps.map((step) => step.kind)).size !== steps.length) throw new BadRequestException("Each production step appears once.");
  if (steps.some((step, index) => index > 0 && rank(step.kind) < rank(steps[index - 1].kind))) throw new BadRequestException("Keep the production steps in their order.");
  if (steps.at(-1)!.kind !== "ready") throw new BadRequestException("Production ends with Ready.");
  return steps;
}

/** The firm's internal production target in weeks (1–52), or none. */
export function parseProductionWeeks(input: unknown): number | null {
  if (input === null || input === "" || input === undefined) return null;
  const weeks = Number(input);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new BadRequestException("Set the production target from 1 to 52 weeks, or leave it empty.");
  return weeks;
}

export type OrderFacts = {
  status: "planned" | "released" | "in_production" | "ready" | "on_hold" | "cancelled" | "short_closed"; heldFrom: string | null;
  /** Output waiting for approval, approved output not checked yet, and what's still to make. */
  pending: string; toCheck: string; left: string;
  /** PLM-150: made and checked, but its last design inspection hasn't passed yet (it reads as the quality check until it has). */
  awaitingInspection?: boolean;
};

/**
 * Where one work order stands: scheduled until it starts; in production while there's output to make; quality check
 * once everything is made and waits for its approval or check, or (PLM-150) for its last design inspection; ready once
 * it passed (or was closed short). On hold stays where it was held.
 */
export function orderStep(order: OrderFacts): ProductionStepKind | null {
  const some = (value: string) => Dec.of(value).cmp(0) > 0;
  switch (order.status) {
    case "planned": case "released": return "scheduled";
    case "in_production": return !some(order.left) && (some(order.pending) || some(order.toCheck)) ? "quality_check" : "in_production";
    case "ready": case "short_closed": return order.awaitingInspection ? "quality_check" : "ready";
    case "on_hold": return order.heldFrom === "in_production" ? "in_production" : "scheduled";
    default: return null;
  }
}

/** The firm's step a kind reads as: the last step it keeps at or before that kind (its first step when none is). */
export function visibleStep(kind: ProductionStepKind, steps: ProductionStep[]): ProductionStep {
  return [...steps].reverse().find((step) => rank(step.kind) <= rank(kind)) ?? steps[0];
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
const earliest = (values: Array<string | null>) => values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
const latest = (values: Array<string | null>) => values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

export type ProjectOrder = OrderFacts & { plannedStart: string | null; plannedEnd: string | null; startedOn: string | null; readyOn: string | null };
export type Window = { start: string | null; end: string | null; days: number | null };
export type ProductionSummary = {
  /** The project's step (its least advanced work order; Ready only once everything it makes passed); null before any work order. */
  step: ProductionStep | null;
  /** Planned: the work orders' dates (the factory slot when none has dates yet). Actual: from the first start to the last ready day (today while running). */
  planned: Window; actual: Window;
  /** Past its planned finish, or finished after it. */
  late: boolean;
  /** Longer than the firm's internal target. */
  overTarget: boolean;
  orders: number; ready: number; held: boolean;
};

/** A project's production from its work orders (cancelled ones left out). */
export function projectProduction(orders: ProjectOrder[], input: { steps: ProductionStep[]; today: string; slotOn: string | null; allMade: boolean; targetWeeks: number | null }): ProductionSummary {
  const live = orders.filter((order) => order.status !== "cancelled");
  const kinds = live.map(orderStep).filter((kind): kind is ProductionStepKind => kind !== null);
  let kind = kinds.length ? kinds.reduce((least, next) => (rank(next) < rank(least) ? next : least)) : null;
  // Ready means everything the project makes passed its checks: something still to plan keeps it a step before.
  if (kind === "ready" && !input.allMade) kind = "quality_check";
  const plannedStart = earliest(live.map((order) => order.plannedStart)) ?? input.slotOn;
  const plannedEnd = latest(live.map((order) => order.plannedEnd));
  const actualStart = earliest(live.map((order) => order.startedOn));
  const done = kind === "ready";
  const actualEnd = done ? latest(live.map((order) => order.readyOn)) : null;
  const actualDays = actualStart ? days(actualStart, actualEnd ?? input.today) : null;
  return {
    step: kind ? visibleStep(kind, input.steps) : null,
    planned: { start: plannedStart, end: plannedEnd, days: plannedStart && plannedEnd && plannedEnd >= plannedStart ? days(plannedStart, plannedEnd) : null },
    actual: { start: actualStart, end: actualEnd, days: actualDays },
    late: Boolean(plannedEnd && (done ? actualEnd && actualEnd > plannedEnd : plannedEnd < input.today)),
    overTarget: Boolean(input.targetWeeks && actualDays && actualDays > input.targetWeeks * 7),
    orders: live.length, ready: live.filter((order) => orderStep(order) === "ready").length, held: live.some((order) => order.status === "on_hold"),
  };
}

export type ProductionRow = ProductionSummary & { projectId: string; reference: string; name: string; clientName: string; projectStatus: string };

/**
 * The production schedule: each running project the factory makes for (it has work orders, or scope made in the
 * factory) with its status and planned against actual dates; or one project, whatever its state.
 */
export async function readProduction(db: Db, workspaceId: string, projectId: string | null = null): Promise<{ steps: ProductionStep[]; targetWeeks: number | null; today: string; projects: ProductionRow[] }> {
  const settings = (await db.query<{ steps: unknown; weeks: number | null; today: string }>(
    `SELECT settings.production_steps AS steps, settings.production_weeks AS weeks,
            (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM workspaces workspace LEFT JOIN workspace_factory_settings settings ON settings.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
  const steps = normaliseProductionSteps(settings?.steps ?? DEFAULT_PRODUCTION_STEPS);
  const today = settings?.today ?? new Date().toISOString().slice(0, 10);
  const projects = (await db.query<{ projectId: string; reference: string; name: string; clientName: string; projectStatus: string; slotOn: string | null }>(
    `SELECT project.id AS "projectId", project.reference, project.name, coalesce(party.display_name, opportunity.title) AS "clientName", project.status AS "projectStatus",
            project.factory_slot_on::text AS "slotOn"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.started_at IS NOT NULL
        AND (CASE WHEN $2::uuid IS NULL THEN project.status IN ('active', 'on_hold') ELSE project.id = $2::uuid END)
        AND (EXISTS (SELECT 1 FROM work_orders wo WHERE wo.workspace_id = project.workspace_id AND wo.project_id = project.id AND wo.status <> 'cancelled')
             OR EXISTS (SELECT 1 FROM project_boq_lines line JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id AND package.supply = 'make'
                         WHERE line.workspace_id = project.workspace_id AND line.project_id = project.id AND line.status = 'active'))
      ORDER BY project.reference`, [workspaceId, projectId])).rows;
  if (!projects.length) return { steps, targetWeeks: settings?.weeks ?? null, today, projects: [] };
  const orders = (await db.query<ProjectOrder & { projectId: string }>(
    `SELECT wo.project_id AS "projectId", wo.status, wo.held_from AS "heldFrom", wo.planned_start::text AS "plannedStart", wo.planned_end::text AS "plannedEnd",
            (wo.started_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "startedOn",
            coalesce(wo.ready_on, (wo.closed_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date)::text AS "readyOn",
            reported.pending::text AS pending, greatest(reported.made - quality.passed - quality.failed, 0)::text AS "toCheck",
            greatest(wo.quantity - (quality.passed - reworked.quantity) - greatest(reported.made - quality.passed - quality.failed, 0) - reported.pending, 0)::text AS "left",
            ${FINAL_PENDING("wo")} AS "awaitingInspection"
       FROM work_orders wo JOIN workspaces workspace ON workspace.id = wo.workspace_id
       ${ORDER_TOTALS}
      WHERE wo.workspace_id = $1 AND wo.project_id = ANY($2::uuid[]) AND wo.status <> 'cancelled'`, [workspaceId, projects.map((project) => project.projectId)])).rows;
  const rows: ProductionRow[] = [];
  for (const project of projects) {
    const mine = orders.filter((order) => order.projectId === project.projectId);
    const allMade = mine.length > 0 && await everythingMade(db, workspaceId, project.projectId);
    const { slotOn, ...facts } = project;
    rows.push({ ...facts, ...projectProduction(mine, { steps, today, slotOn, allMade, targetWeeks: settings?.weeks ?? null }) });
  }
  return { steps, targetWeeks: settings?.weeks ?? null, today, projects: rows };
}
