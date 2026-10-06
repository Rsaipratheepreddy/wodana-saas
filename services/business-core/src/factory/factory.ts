import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { workdays, type WorkCalendar } from "../project-core/work-calendar";

type Db = Pick<PoolClient, "query">;

export const WORK_ORDER_STATUSES = ["planned", "released", "in_production", "ready", "on_hold", "cancelled", "short_closed"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export type FactorySettings = {
  requireDrawing: boolean; requirePayment: boolean; requireMaterials: boolean; requireCheck: boolean; version: number;
  /** PLM-063: the production steps the firm keeps (stored as configuration; read leniently by production-status), and its internal target in weeks. */
  productionSteps: unknown; productionWeeks: number | null;
  /** PLM-067: days before the latest planned ready date of a payment stage's work orders that the client is reminded to pay. */
  balanceReminderDays: number;
};
export type Workcenter = { id: string; name: string; hoursPerDay: string | null; active: boolean };

/** A scope line made in our factory: how much of it is on work orders and what's left to plan. */
export type MakeLine = {
  lineId: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  title: string; specification: string; unit: string; quantity: string; planned: string; left: string;
  /** When the package's work that needs its materials is planned: a work order's default dates. */
  suggestedStart: string | null; suggestedEnd: string | null;
  /** The project is running, or on hold (its work orders can be planned but not released). */
  projectStatus: "active" | "on_hold";
};

export type WorkOrderRow = {
  id: string; number: number; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null; boqLineId: string;
  title: string; specification: string; quantity: string; unit: string; status: WorkOrderStatus; workcenterId: string | null; workcenterName: string | null;
  plannedStart: string | null; plannedEnd: string | null; notes: string; version: number;
  /** Good output approved; waiting for approval; passed its check (ready); approved but not checked yet; still to make. */
  made: string; pending: string; passed: string; toCheck: string; left: string; scrapped: string;
  /** Sent back to be made again (rejected at site): it no longer counts as passed. */
  reworked: string;
  /** The design revision picked as its approved drawing, and a newer revision of that design when one exists. */
  drawingVersionId: string | null; drawingNewer: number | null;
  /** Its scope line now: removed by a variation, or how much more its work orders hold than the line needs. */
  lineStatus: "active" | "omitted"; lineQuantity: string; scopeOver: string;
  holdKind: "manual" | "drawing" | null;
  /** The hours it takes, spread over its working days on its workcenter; the run it's part of. */
  plannedHours: string | null; batchId: string | null; batchNumber: number | null; batchName: string | null;
};

export const ORDER_TOTALS = `
  LEFT JOIN LATERAL (SELECT coalesce(sum(report.good) FILTER (WHERE report.status = 'approved'), 0) AS made,
                            coalesce(sum(report.good) FILTER (WHERE report.status = 'pending'), 0) AS pending,
                            coalesce(sum(report.scrap) FILTER (WHERE report.status = 'approved'), 0) AS scrapped
                       FROM work_order_reports report WHERE report.workspace_id = wo.workspace_id AND report.work_order_id = wo.id) reported ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(checked.passed), 0) AS passed, coalesce(sum(checked.failed), 0) AS failed
                       FROM work_order_checks checked WHERE checked.workspace_id = wo.workspace_id AND checked.work_order_id = wo.id) quality ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(rework.quantity), 0) AS quantity
                       FROM work_order_reworks rework WHERE rework.workspace_id = wo.workspace_id AND rework.work_order_id = wo.id) reworked ON true`;

/** What a work order's checks passed, less what came back to be made again (SQL over `checked`/`rework` for work order `other`). */
const PASSED_NET = (alias: string) => `(coalesce((SELECT sum(checked.passed) FROM work_order_checks checked WHERE checked.workspace_id = ${alias}.workspace_id AND checked.work_order_id = ${alias}.id), 0)
  - coalesce((SELECT sum(rework.quantity) FROM work_order_reworks rework WHERE rework.workspace_id = ${alias}.workspace_id AND rework.work_order_id = ${alias}.id), 0))`;

const ORDER_SELECT = `SELECT wo.id, wo.number, wo.project_id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", wo.package_id AS "packageId",
  package.name AS "packageName", wo.boq_line_id AS "boqLineId", wo.title, wo.specification, wo.quantity::text AS quantity, wo.unit, wo.status, wo.workcenter_id AS "workcenterId",
  center.name AS "workcenterName", wo.planned_start::text AS "plannedStart", wo.planned_end::text AS "plannedEnd", wo.notes, wo.version,
  reported.made::text AS made, reported.pending::text AS pending, reported.scrapped::text AS scrapped,
  -- What passed its checks and is still good: anything sent back to be made again (rework) no longer counts.
  (quality.passed - reworked.quantity)::text AS passed, reworked.quantity::text AS reworked,
  -- Approved good output that hasn't been checked yet (what failed is made again, so it isn't counted).
  greatest(reported.made - quality.passed - quality.failed, 0)::text AS "toCheck",
  greatest(wo.quantity - (quality.passed - reworked.quantity) - greatest(reported.made - quality.passed - quality.failed, 0) - reported.pending, 0)::text AS "left",
  line.status AS "lineStatus", line.quantity::text AS "lineQuantity",
  greatest(coalesce(on_line.quantity, 0) - CASE WHEN line.status = 'active' THEN line.quantity ELSE 0 END, 0)::text AS "scopeOver", wo.hold_kind AS "holdKind",
  wo.planned_hours::text AS "plannedHours", wo.batch_id AS "batchId", batch.number AS "batchNumber", batch.name AS "batchName",
  wo.drawing_version_id AS "drawingVersionId",
  (SELECT newer.number FROM pre_project_design_versions newer JOIN pre_project_design_versions picked ON picked.id = wo.drawing_version_id
    WHERE newer.workspace_id = wo.workspace_id AND newer.design_id = wo.drawing_design_id AND newer.number > picked.number AND newer.status NOT IN ('draft', 'rejected')
    ORDER BY newer.number DESC LIMIT 1) AS "drawingNewer"
  FROM work_orders wo
  LEFT JOIN production_batches batch ON batch.workspace_id = wo.workspace_id AND batch.id = wo.batch_id
  JOIN project_boq_lines line ON line.workspace_id = wo.workspace_id AND line.id = wo.boq_line_id
  LEFT JOIN LATERAL (SELECT sum(CASE WHEN other.status = 'short_closed' THEN ${PASSED_NET("other")} ELSE other.quantity END) AS quantity
                       FROM work_orders other WHERE other.workspace_id = wo.workspace_id AND other.boq_line_id = wo.boq_line_id AND other.status <> 'cancelled') on_line ON true
  JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
  LEFT JOIN project_packages package ON package.workspace_id = wo.workspace_id AND package.id = wo.package_id
  LEFT JOIN workcenters center ON center.workspace_id = wo.workspace_id AND center.id = wo.workcenter_id
  ${ORDER_TOTALS}`;

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
            needed.start::text AS "suggestedStart", needed.due::text AS "suggestedEnd", project.status AS "projectStatus"
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
       LEFT JOIN LATERAL (SELECT sum(CASE WHEN wo.status = 'short_closed' THEN quality.passed - reworked.quantity ELSE wo.quantity END) AS quantity
                            FROM work_orders wo ${ORDER_TOTALS}
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
    `SELECT require_drawing AS "requireDrawing", require_payment AS "requirePayment", require_materials AS "requireMaterials", require_check AS "requireCheck", version,
            production_steps AS "productionSteps", production_weeks AS "productionWeeks", balance_reminder_days AS "balanceReminderDays"
       FROM workspace_factory_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
}

export async function readWorkcenters(db: Db, workspaceId: string, all = false): Promise<Workcenter[]> {
  return (await db.query<Workcenter>(
    `SELECT id, name, hours_per_day::text AS "hoursPerDay", active FROM workcenters WHERE workspace_id = $1 AND ($2 OR active) ORDER BY position, lower(name)`,
    [workspaceId, all])).rows;
}

/** Whole-number text for a quantity ("12.0000" → "12"). */
export const plain = (value: string) => Dec.of(value).toString();

export type WorkOrderMaterial = {
  id: string; itemId: string; itemName: string; unit: string; materialItemId: string | null; quantity: string; status: "active" | "pending" | "replaced" | "refused" | "removed";
  replacesId: string | null; replacesName: string | null; reason: string; requestedBy: string; requestedByName: string; decidedByName: string | null; decisionNote: string;
  /** Issued to the work order, less what came back; its value at the cost it left stock with. */
  issued: string; issuedValue: string;
  /** On hand now: the project's own stock of the item, and free stock. */
  projectOnHand: string; freeOnHand: string;
};

export async function readWorkOrderMaterials(db: Db, workspaceId: string, orderId: string): Promise<WorkOrderMaterial[]> {
  return (await db.query<WorkOrderMaterial>(
    `SELECT material.id, material.item_id AS "itemId", item.name AS "itemName", item.unit, material.material_item_id AS "materialItemId", material.quantity::text AS quantity,
            material.status, material.replaces_id AS "replacesId", replaced_item.name AS "replacesName", material.reason, material.requested_by AS "requestedBy",
            requester.display_name AS "requestedByName", decider.display_name AS "decidedByName", material.decision_note AS "decisionNote",
            coalesce(-issued.quantity, 0)::numeric(18, 4)::text AS issued, coalesce(-issued.value, 0)::numeric(18, 4)::text AS "issuedValue",
            coalesce(own.on_hand, 0)::numeric(18, 4)::text AS "projectOnHand", coalesce(free.on_hand, 0)::numeric(18, 4)::text AS "freeOnHand"
       FROM work_order_materials material
       JOIN work_orders wo ON wo.workspace_id = material.workspace_id AND wo.id = material.work_order_id
       JOIN stock_items item ON item.workspace_id = material.workspace_id AND item.id = material.item_id
       JOIN users requester ON requester.id = material.requested_by
       LEFT JOIN users decider ON decider.id = material.decided_by
       LEFT JOIN work_order_materials replaced ON replaced.workspace_id = material.workspace_id AND replaced.id = material.replaces_id
       LEFT JOIN stock_items replaced_item ON replaced_item.workspace_id = replaced.workspace_id AND replaced_item.id = replaced.item_id
       LEFT JOIN LATERAL (SELECT sum(movement.quantity) AS quantity, sum(round(movement.quantity * coalesce(movement.unit_cost, 0), 4)) AS value
                            FROM stock_movements movement WHERE movement.workspace_id = material.workspace_id AND movement.work_order_material_id = material.id) issued ON true
       LEFT JOIN LATERAL (SELECT sum(balance.on_hand) AS on_hand FROM stock_balances balance
                           WHERE balance.workspace_id = material.workspace_id AND balance.item_id = material.item_id AND balance.project_id = wo.project_id) own ON true
       LEFT JOIN LATERAL (SELECT sum(balance.on_hand) AS on_hand FROM stock_balances balance
                           WHERE balance.workspace_id = material.workspace_id AND balance.item_id = material.item_id AND balance.project_id IS NULL) free ON true
      WHERE material.workspace_id = $1 AND material.work_order_id = $2
      ORDER BY material.position, material.requested_at`, [workspaceId, orderId])).rows;
}

/**
 * What a work order's materials are still short of: each active material is covered when it's issued, or
 * when the project's own stock of it is enough after what the project's other running work orders still
 * need of it (they came first). Empty when everything is covered.
 */
export async function materialsShort(db: Db, workspaceId: string, orderId: string, materials: WorkOrderMaterial[]) {
  const short: Array<{ itemName: string; unit: string; short: string }> = [];
  for (const material of materials.filter((row) => row.status === "active")) {
    const remaining = Dec.of(material.quantity).sub(material.issued);
    if (remaining.cmp(0) <= 0) continue;
    const claimed = (await db.query<{ quantity: string | null }>(
      `SELECT sum(greatest(other.quantity + coalesce((SELECT sum(movement.quantity) FROM stock_movements movement
                                                       WHERE movement.workspace_id = other.workspace_id AND movement.work_order_material_id = other.id), 0), 0))::text AS quantity
         FROM work_order_materials other
         JOIN work_orders wo ON wo.workspace_id = other.workspace_id AND wo.id = other.work_order_id
         JOIN work_orders mine ON mine.workspace_id = wo.workspace_id AND mine.id = $2
        WHERE other.workspace_id = $1 AND other.item_id = $3 AND other.status = 'active' AND wo.id <> mine.id AND wo.project_id = mine.project_id
          AND (wo.status IN ('released', 'in_production') OR (wo.status = 'on_hold' AND wo.held_from IN ('released', 'in_production')))`,
      [workspaceId, orderId, material.itemId])).rows[0]?.quantity ?? "0";
    const available = Dec.of(material.projectOnHand).sub(claimed);
    if (available.cmp(remaining) < 0) short.push({ itemName: material.itemName, unit: material.unit, short: remaining.sub(available.cmp(0) > 0 ? available : Dec.ZERO).toString() });
  }
  return short;
}

export type Batch = { id: string; number: number; name: string; workcenterId: string | null; workcenterName: string | null; plannedOn: string | null; status: "open" | "started" | "closed";
  orders: number; projects: string[]; version: number };

export async function readBatches(db: Db, workspaceId: string): Promise<Batch[]> {
  return (await db.query<Batch>(
    `SELECT batch.id, batch.number, batch.name, batch.workcenter_id AS "workcenterId", center.name AS "workcenterName", batch.planned_on::text AS "plannedOn", batch.status, batch.version,
            (SELECT count(*)::int FROM work_orders wo WHERE wo.workspace_id = batch.workspace_id AND wo.batch_id = batch.id) AS orders,
            coalesce((SELECT array_agg(DISTINCT project.reference ORDER BY project.reference) FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
                       WHERE wo.workspace_id = batch.workspace_id AND wo.batch_id = batch.id), '{}') AS projects
       FROM production_batches batch LEFT JOIN workcenters center ON center.workspace_id = batch.workspace_id AND center.id = batch.workcenter_id
      WHERE batch.workspace_id = $1 ORDER BY batch.status = 'closed', batch.number DESC LIMIT 200`, [workspaceId])).rows;
}

const OPEN_STATUSES = ["planned", "released", "in_production", "on_hold"];

/**
 * The hours booked on each workcenter each working day: each open work order with a workcenter, dates and
 * hours spreads its hours evenly over its working days. A day is over capacity when its hours pass the
 * workcenter's hours a day. Hours are rounded to a tenth for display; the comparison uses them unrounded.
 */
export function capacity(orders: WorkOrderRow[], workcenters: Workcenter[], calendar: WorkCalendar, from: string, to: string) {
  const math = workdays(calendar);
  const days: string[] = [];
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(day);
  const load = new Map<string, Map<string, { hours: number; orders: string[] }>>();
  for (const order of [...orders].sort((a, b) => a.number - b.number)) {
    if (!OPEN_STATUSES.includes(order.status) || !order.workcenterId || !order.plannedStart || !order.plannedEnd || !order.plannedHours) continue;
    const worked = [];
    for (let day = order.plannedStart; day <= order.plannedEnd; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) if (math.isWorking(day)) worked.push(day);
    if (!worked.length) continue;
    const share = Number(order.plannedHours) / worked.length;
    const center = load.get(order.workcenterId) ?? new Map();
    for (const day of worked) {
      if (day < from || day > to) continue;
      const cell = center.get(day) ?? { hours: 0, orders: [] };
      cell.hours += share;
      cell.orders.push(order.id);
      center.set(day, cell);
    }
    load.set(order.workcenterId, center);
  }
  const conflicts = workcenters.flatMap((center) => !center.hoursPerDay ? [] : [...(load.get(center.id) ?? new Map()).entries()]
    .filter(([, cell]) => cell.hours > Number(center.hoursPerDay) + 1e-9)
    .map(([date, cell]) => ({ workcenterId: center.id, workcenterName: center.name, date, hours: Math.round(cell.hours * 10) / 10, capacity: Number(center.hoursPerDay), orders: cell.orders })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.workcenterName.localeCompare(b.workcenterName));
  return {
    days: days.filter((day) => math.isWorking(day)),
    load: Object.fromEntries([...load].map(([id, center]) => [id, Object.fromEntries([...center].map(([date, cell]) => [date, Math.round(cell.hours * 10) / 10]))])),
    conflicts,
  };
}

/** A work order's hours when none are given: the workcenter's hours a day over its working days (null without both). */
export function defaultHours(hoursPerDay: string | null, start: string | null, end: string | null, calendar: WorkCalendar) {
  if (!hoursPerDay || !start || !end || Dec.of(hoursPerDay).cmp(0) <= 0) return null;
  return Dec.of(hoursPerDay).mul(workdays(calendar).span(start, end)).toString();
}

export type WorkOrderNext = "fix" | "release" | "start" | "approve" | "check" | "report" | "send" | "resume" | "decide_drawing" | null;

/**
 * The one next step on a work order, and whether it's the viewer's to take: fix what blocks its release,
 * release, start, approve reported output, check what was approved, report more, send what's ready to site,
 * or resume it (someone else decides on a changed drawing).
 */
export function workOrderNext(order: Pick<WorkOrderRow, "status" | "pending" | "toCheck" | "left" | "holdKind">, context: {
  blocked: boolean; atFactory: string; requireCheck: boolean; canManage: boolean; canReport: boolean; canApprove: boolean; canSend: boolean;
}): { step: WorkOrderNext; mine: boolean } {
  const some = (value: string) => Dec.of(value).cmp(0) > 0;
  switch (order.status) {
    case "planned": return context.blocked ? { step: "fix", mine: context.canManage } : { step: "release", mine: context.canManage };
    case "released": return { step: "start", mine: context.canManage };
    case "in_production":
      if (some(order.pending)) return { step: "approve", mine: context.canApprove };
      if (context.requireCheck && some(order.toCheck)) return { step: "check", mine: context.canApprove };
      if (some(order.left)) return { step: "report", mine: context.canReport };
      return some(context.atFactory) ? { step: "send", mine: context.canSend } : { step: null, mine: false };
    case "ready": return some(context.atFactory) ? { step: "send", mine: context.canSend } : { step: null, mine: false };
    case "on_hold": return order.holdKind === "drawing" ? { step: "decide_drawing", mine: context.canApprove } : { step: "resume", mine: context.canManage };
    default: return { step: null, mine: false };
  }
}

/** Every active scope line of the project's packages made in the factory has passed its checks in full (true when there are none). */
export async function everythingMade(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ done: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM project_boq_lines line
         JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id AND package.supply = 'make'
        WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'
          AND coalesce((SELECT sum(${PASSED_NET("wo")}) FROM work_orders wo
                         WHERE wo.workspace_id = line.workspace_id AND wo.boq_line_id = line.id AND wo.status <> 'cancelled'), 0) < line.quantity) AS done`,
    [workspaceId, projectId])).rows[0].done;
}
