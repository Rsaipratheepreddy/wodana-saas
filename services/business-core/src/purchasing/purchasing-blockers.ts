import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { raiseBlocker, resolveBlocker } from "../project-core/project-work";
import { linesNeededBy, readOrderLines } from "./orders";
import { outstanding } from "./receiving";

type Db = Pick<PoolClient, "query">;

export type LineBlocker = {
  workItemId: string; number: number; title: string; status: string; projectId: string; projectReference: string;
  orderId: string; orderNumber: string; orderLineId: string; description: string; blocks: number;
};

/** Open blockers raised for supplier lines: on one order, or one project's. */
export async function readLineBlockers(db: Db, workspaceId: string, filter: { orderId?: string; projectId?: string } = {}): Promise<LineBlocker[]> {
  return (await db.query<LineBlocker>(
    `SELECT work.id AS "workItemId", work.number, work.title, work.status, work.project_id AS "projectId", project.reference AS "projectReference",
            line.order_id AS "orderId", purchase.number AS "orderNumber", blocker.order_line_id AS "orderLineId", line.description,
            (SELECT count(*)::int FROM work_item_links link WHERE link.workspace_id = work.workspace_id AND link.predecessor_id = work.id) AS blocks
       FROM purchase_line_blockers blocker
       JOIN work_items work ON work.workspace_id = blocker.workspace_id AND work.id = blocker.work_item_id
       JOIN delivery_projects project ON project.workspace_id = work.workspace_id AND project.id = work.project_id
       JOIN purchase_order_lines line ON line.workspace_id = blocker.workspace_id AND line.id = blocker.order_line_id
       JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
      WHERE blocker.workspace_id = $1 AND blocker.closed_at IS NULL AND ($2::uuid IS NULL OR line.order_id = $2) AND ($3::uuid IS NULL OR work.project_id = $3)
      ORDER BY project.reference, work.number`, [workspaceId, filter.orderId ?? null, filter.projectId ?? null])).rows;
}

/**
 * Whether a line still to come holds up the work that needs it: it's due after that work needs it, or it's
 * late and the work needed it already. Dates are workspace dates (YYYY-MM-DD).
 */
export function holdsUpWork(due: string | null, neededBy: string | null, today: string) {
  if (!due || !neededBy) return false;
  return due > neededBy || (due < today && neededBy <= today);
}

/**
 * A late supplier doesn't only produce an email: a line still to come that arrives after the work needing
 * it should start raises one blocker on its project ("Waiting on PO-12 · veneer"), given to the buyer and
 * put before the open work that needs those materials (its package's, or the project's when it's for no
 * package in particular). The project's managers and the buyer hear. The blocker closes by itself once the
 * goods are in (see closeSettledBlockers). Returns how many were raised.
 */
export async function raiseLateBlockers(db: Db, workspaceId: string, today: string) {
  const lines = (await db.query<{ id: string; orderId: string; orderNumber: string; supplier: string; description: string; unit: string; projectId: string;
    materialItemId: string | null; boqLineId: string | null; buyer: string; buyerMembership: string | null; eta: string | null }>(
    `SELECT line.id, line.order_id AS "orderId", purchase.number AS "orderNumber", vendor.display_name AS supplier, line.description, line.unit, line.project_id AS "projectId",
            line.material_item_id AS "materialItemId", line.boq_line_id AS "boqLineId", purchase.created_by AS buyer, membership.id AS "buyerMembership", shipment.eta::text AS eta
       FROM purchase_order_lines line
       JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id AND purchase.status IN ('sent', 'confirmed', 'partly_received')
       JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id AND project.status = 'active'
       LEFT JOIN workspace_memberships membership ON membership.workspace_id = purchase.workspace_id AND membership.user_id = purchase.created_by AND membership.status = 'active'
       LEFT JOIN LATERAL (SELECT max(tracked.eta) AS eta FROM purchase_order_shipments tracked
                           WHERE tracked.workspace_id = purchase.workspace_id AND tracked.order_id = purchase.id AND tracked.status IN ('booked', 'in_transit', 'delayed')) shipment ON true
      WHERE line.workspace_id = $1 AND line.source IN ('material', 'line')
        AND NOT EXISTS (SELECT 1 FROM purchase_line_blockers open WHERE open.workspace_id = line.workspace_id AND open.order_line_id = line.id AND open.closed_at IS NULL)`,
    [workspaceId])).rows;
  if (!lines.length) return 0;
  const owed = new Map<string, { left: Dec; due: string | null }>();
  for (const orderId of new Set(lines.map((line) => line.orderId)))
    for (const line of await readOrderLines(db, workspaceId, orderId)) owed.set(line.id, { left: outstanding(line), due: line.due });
  const needed = await linesNeededBy(db, workspaceId, lines);
  let raised = 0;
  for (const line of lines) {
    const state = owed.get(line.id);
    if (!state || state.left.cmp(0) <= 0) continue;
    // A shipment expected later than the supplier's promise is the better date.
    const due = [state.due, line.eta].filter((value): value is string => Boolean(value)).sort().pop() ?? null;
    const neededBy = needed[line.id] ?? null;
    if (!holdsUpWork(due, neededBy, today)) continue;
    const packages = (await db.query<{ id: string }>(
      line.materialItemId
        ? `SELECT DISTINCT scope.package_id AS id FROM project_material_items item JOIN project_boq_lines scope ON scope.workspace_id = item.workspace_id AND scope.id = ANY(item.boq_line_ids)
            WHERE item.workspace_id = $1 AND item.id = $2 AND scope.package_id IS NOT NULL`
        : `SELECT package_id AS id FROM project_boq_lines WHERE workspace_id = $1 AND id = $2 AND package_id IS NOT NULL`,
      [workspaceId, line.materialItemId ?? line.boqLineId])).rows.map((row) => row.id);
    const work = (await db.query<{ id: string }>(
      `SELECT id FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND type = 'task' AND needs_materials AND status NOT IN ('done', 'cancelled')
          AND (cardinality($3::uuid[]) = 0 OR package_id = ANY($3::uuid[]))`, [workspaceId, line.projectId, packages])).rows.map((row) => row.id);
    if (!work.length) continue;
    const left = `${state.left.toString()} ${line.unit}`.trim();
    const blocker = await raiseBlocker(db, workspaceId, {
      projectId: line.projectId, title: `Waiting on ${line.orderNumber} · ${line.description}`,
      description: `${line.supplier}: ${left} still to come, due ${due}; the work needs it by ${neededBy}. It closes by itself when the goods are in.`,
      packageId: packages.length === 1 ? packages[0] : null, boqLineId: line.boqLineId, assigneeMembershipId: line.buyerMembership, blocks: work, actorId: line.buyer,
    });
    await db.query(`INSERT INTO purchase_line_blockers (workspace_id, order_line_id, work_item_id) VALUES ($1, $2, $3)`, [workspaceId, line.id, blocker.id]);
    const managers = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, line.projectId])).rows.map((row) => row.userId);
    const note = `${line.description}: ${left} due ${due}, needed ${neededBy}. ${work.length === 1 ? "1 task waits" : `${work.length} tasks wait`}.`;
    for (const userId of new Set([line.buyer, ...managers]))
      await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "purchasing.blocking_work", eventType: "purchasing.blocking_work",
        variables: { order: line.orderNumber, supplier: line.supplier, amount: "", actor: "", note: note.slice(0, 480) },
        deepLink: `/workspace/purchasing/orders?order=${line.orderId}`, idempotencyKey: `purchasing.blocking_work:${blocker.id}:${userId}` });
    raised += 1;
  }
  return raised;
}

/**
 * Closes the blockers whose line no longer holds anything up: everything still to come arrived and was
 * accepted (or credited, or cancelled), its order was closed or cancelled, or its project ended. The work
 * it held up can start. Returns how many closed.
 */
export async function closeSettledBlockers(db: Db, workspaceId: string, filter: { orderId?: string }, actorId: string | null) {
  const open = (await db.query<{ workItemId: string; orderLineId: string; orderId: string; orderStatus: string; projectStatus: string; buyer: string }>(
    `SELECT blocker.work_item_id AS "workItemId", blocker.order_line_id AS "orderLineId", line.order_id AS "orderId", purchase.status AS "orderStatus",
            project.status AS "projectStatus", purchase.created_by AS buyer
       FROM purchase_line_blockers blocker
       JOIN purchase_order_lines line ON line.workspace_id = blocker.workspace_id AND line.id = blocker.order_line_id
       JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
       JOIN work_items work ON work.workspace_id = blocker.workspace_id AND work.id = blocker.work_item_id
       JOIN delivery_projects project ON project.workspace_id = work.workspace_id AND project.id = work.project_id
      WHERE blocker.workspace_id = $1 AND blocker.closed_at IS NULL AND ($2::uuid IS NULL OR line.order_id = $2)`, [workspaceId, filter.orderId ?? null])).rows;
  let closed = 0;
  const left = new Map<string, Dec>();
  for (const orderId of new Set(open.map((row) => row.orderId)))
    for (const line of await readOrderLines(db, workspaceId, orderId)) left.set(line.id, outstanding(line));
  for (const row of open) {
    const why = row.orderStatus === "cancelled" ? "The order was cancelled."
      : row.orderStatus === "closed" ? "The order was closed."
      : !["active", "on_hold"].includes(row.projectStatus) ? "The project isn't running."
      : (left.get(row.orderLineId) ?? Dec.ZERO).cmp(0) <= 0 ? "The goods are in." : null;
    if (!why) continue;
    await resolveBlocker(db, workspaceId, row.workItemId, actorId ?? row.buyer, why);
    await db.query(`UPDATE purchase_line_blockers SET closed_at = now() WHERE workspace_id = $1 AND work_item_id = $2`, [workspaceId, row.workItemId]);
    closed += 1;
  }
  return closed;
}
