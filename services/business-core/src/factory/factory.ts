import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";

type Db = Pick<PoolClient, "query">;

export const WORK_ORDER_STATUSES = ["planned", "released", "in_production", "ready", "on_hold", "cancelled", "short_closed"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export type FactorySettings = { requireDrawing: boolean; requirePayment: boolean; requireMaterials: boolean; requireCheck: boolean; version: number };
export type Workcenter = { id: string; name: string; hoursPerDay: string | null; active: boolean };

/** A scope line made in our factory: how much of it is on work orders and what's left to plan. */
export type MakeLine = {
  lineId: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  title: string; specification: string; unit: string; quantity: string; planned: string; left: string;
  /** When the package's work that needs its materials is planned: a work order's default dates. */
  suggestedStart: string | null; suggestedEnd: string | null;
};

export type WorkOrderRow = {
  id: string; number: number; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null; boqLineId: string;
  title: string; specification: string; quantity: string; unit: string; status: WorkOrderStatus; workcenterId: string | null; workcenterName: string | null;
  plannedStart: string | null; plannedEnd: string | null; notes: string; version: number;
  /** Good output approved; waiting for approval; passed its check (ready); approved but not checked yet; still to make. */
  made: string; pending: string; passed: string; toCheck: string; left: string; scrapped: string;
};

const TOTALS = `
  LEFT JOIN LATERAL (SELECT coalesce(sum(report.good) FILTER (WHERE report.status = 'approved'), 0) AS made,
                            coalesce(sum(report.good) FILTER (WHERE report.status = 'pending'), 0) AS pending,
                            coalesce(sum(report.scrap) FILTER (WHERE report.status = 'approved'), 0) AS scrapped
                       FROM work_order_reports report WHERE report.workspace_id = wo.workspace_id AND report.work_order_id = wo.id) reported ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(checked.passed), 0) AS passed, coalesce(sum(checked.failed), 0) AS failed
                       FROM work_order_checks checked WHERE checked.workspace_id = wo.workspace_id AND checked.work_order_id = wo.id) quality ON true`;

const ORDER_SELECT = `SELECT wo.id, wo.number, wo.project_id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", wo.package_id AS "packageId",
  package.name AS "packageName", wo.boq_line_id AS "boqLineId", wo.title, wo.specification, wo.quantity::text AS quantity, wo.unit, wo.status, wo.workcenter_id AS "workcenterId",
  center.name AS "workcenterName", wo.planned_start::text AS "plannedStart", wo.planned_end::text AS "plannedEnd", wo.notes, wo.version,
  reported.made::text AS made, reported.pending::text AS pending, reported.scrapped::text AS scrapped, quality.passed::text AS passed,
  -- Approved good output that hasn't been checked yet (what failed is made again, so it isn't counted).
  greatest(reported.made - quality.passed - quality.failed, 0)::text AS "toCheck",
  greatest(wo.quantity - quality.passed - greatest(reported.made - quality.passed - quality.failed, 0) - reported.pending, 0)::text AS "left"
  FROM work_orders wo
  JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
  LEFT JOIN project_packages package ON package.workspace_id = wo.workspace_id AND package.id = wo.package_id
  LEFT JOIN workcenters center ON center.workspace_id = wo.workspace_id AND center.id = wo.workcenter_id
  ${TOTALS}`;

export async function readWorkOrders(db: Db, workspaceId: string, filter: { id?: string; lineId?: string } = {}): Promise<WorkOrderRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["wo.workspace_id = $1"];
  if (filter.id) { values.push(filter.id); where.push(`wo.id = $${values.length}`); }
  if (filter.lineId) { values.push(filter.lineId); where.push(`wo.boq_line_id = $${values.length}`); }
  return (await db.query<WorkOrderRow>(`${ORDER_SELECT} WHERE ${where.join(" AND ")} ORDER BY wo.number DESC LIMIT 500`, values)).rows;
}

/**
 * What the factory makes: the scope lines of packages made in our factory, in running projects. A line's
 * quantity on work orders counts every work order that isn't cancelled — a short-closed one only for
 * what passed — so what wasn't made comes back to be planned.
 */
export async function readToMake(db: Db, workspaceId: string, lineId: string | null = null): Promise<MakeLine[]> {
  return (await db.query<MakeLine>(
    `SELECT line.id AS "lineId", project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", package.id AS "packageId",
            package.name AS "packageName", line.title, coalesce(line.description, '') AS specification, line.unit, line.quantity::text AS quantity,
            coalesce(planned.quantity, 0)::text AS planned, (line.quantity - coalesce(planned.quantity, 0))::text AS "left",
            needed.start::text AS "suggestedStart", needed.due::text AS "suggestedEnd"
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
       LEFT JOIN LATERAL (SELECT sum(CASE WHEN wo.status = 'short_closed' THEN quality.passed ELSE wo.quantity END) AS quantity
                            FROM work_orders wo ${TOTALS}
                           WHERE wo.workspace_id = line.workspace_id AND wo.boq_line_id = line.id AND wo.status <> 'cancelled') planned ON true
       LEFT JOIN LATERAL (SELECT coalesce(work.start_date, work.due_date) AS start, coalesce(work.due_date, work.start_date) AS due
                            FROM work_items work
                           WHERE work.workspace_id = line.workspace_id AND work.package_id = package.id AND work.needs_materials AND work.status NOT IN ('done', 'cancelled')
                             AND coalesce(work.start_date, work.due_date) IS NOT NULL
                           ORDER BY coalesce(work.start_date, work.due_date) LIMIT 1) needed ON true
      WHERE line.workspace_id = $1 AND line.status = 'active' AND package.supply = 'make' AND project.started_at IS NOT NULL AND project.status IN ('active', 'on_hold')
        AND ($2::uuid IS NULL OR line.id = $2)
      ORDER BY project.reference, line.position`, [workspaceId, lineId])).rows;
}

export async function ensureFactorySettings(db: Db, workspaceId: string): Promise<FactorySettings> {
  await db.query(`INSERT INTO workspace_factory_settings (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`, [workspaceId]);
  return (await db.query<FactorySettings>(
    `SELECT require_drawing AS "requireDrawing", require_payment AS "requirePayment", require_materials AS "requireMaterials", require_check AS "requireCheck", version
       FROM workspace_factory_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
}

export async function readWorkcenters(db: Db, workspaceId: string, all = false): Promise<Workcenter[]> {
  return (await db.query<Workcenter>(
    `SELECT id, name, hours_per_day::text AS "hoursPerDay", active FROM workcenters WHERE workspace_id = $1 AND ($2 OR active) ORDER BY position, lower(name)`,
    [workspaceId, all])).rows;
}

/** Whole-number text for a quantity ("12.0000" → "12"). */
export const plain = (value: string) => Dec.of(value).toString();
