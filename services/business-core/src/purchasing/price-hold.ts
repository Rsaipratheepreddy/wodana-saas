import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { changeReference } from "../change-requests/change-request.domain";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-169: a scope line held until the client approves its price. Where the firm asks (Settings › Purchasing, "Client
 * approves a revised price"), a line waits while:
 *   - a change request on the project that names the line is still open (a price correction or a scope change the client
 *     hasn't decided), or
 *   - the cost ordered for it (its purchase order lines, placed or in draft, not cancelled) is above its agreed amount and
 *     no price correction naming the line is approved.
 * The hold clears only with the client's approved decision (the change request's); the QS approving the BOQ never clears
 * it. Worked out from the records, never a flag. Pure decision here; the readers below gather the facts.
 */
export type PriceHoldFacts = {
  title: string; agreed: string; ordered: string; currency: string;
  /** The newest open change request naming the line, if any. */
  pending: { reference: string; kind: string } | null;
  /** A price correction naming the line that the client approved. */
  corrected: boolean;
};

export function priceHoldReason(facts: PriceHoldFacts): string | null {
  if (facts.pending) return facts.pending.kind === "price_correction"
    ? `${facts.title}: price correction ${facts.pending.reference} waits for the client's approval`
    : `${facts.title}: change ${facts.pending.reference} waits for the client's decision`;
  if (!facts.corrected && Dec.of(facts.ordered).cmp(facts.agreed) > 0)
    return `${facts.title}: ${facts.currency} ${Dec.of(facts.ordered).toFixed(2)} ordered against ${facts.currency} ${Dec.of(facts.agreed).toFixed(2)} agreed; the client approves the price correction first`;
  return null;
}

export type PriceHoldScope = { projectId: string } | { orderId: string } | { lineIds: string[] };

/** Each held live-scope line in the scope (a project, an order's lines, or named lines) with why, as the client reads it. */
export async function priceHolds(db: Db, workspaceId: string, scope: PriceHoldScope): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  if ("lineIds" in scope && !scope.lineIds.length) return held;
  const where = "projectId" in scope ? "line.project_id = $2"
    : "lineIds" in scope ? "line.id = ANY($2::uuid[])"
    : `line.id IN (SELECT ordered.boq_line_id FROM purchase_order_lines ordered WHERE ordered.workspace_id = $1 AND ordered.order_id = $2 AND ordered.boq_line_id IS NOT NULL
                   UNION SELECT unnest(item.boq_line_ids) FROM purchase_order_lines ordered JOIN project_material_items item ON item.workspace_id = ordered.workspace_id AND item.id = ordered.material_item_id
                   WHERE ordered.workspace_id = $1 AND ordered.order_id = $2)`;
  const value = "projectId" in scope ? scope.projectId : "lineIds" in scope ? scope.lineIds : scope.orderId;
  const rows = (await db.query<{ id: string; title: string; agreed: string; ordered: string; currency: string; pendingNumber: number | null; pendingKind: string | null; corrected: boolean }>(
    `SELECT line.id, line.title, line.net::text AS agreed, project.currency,
            coalesce((SELECT sum(ordered.net) FROM purchase_order_lines ordered JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
                       WHERE ordered.workspace_id = line.workspace_id AND ordered.boq_line_id = line.id AND purchase.status <> 'cancelled'), 0)::text AS ordered,
            pending.number AS "pendingNumber", pending.kind AS "pendingKind",
            EXISTS (SELECT 1 FROM change_requests change JOIN change_request_lines named ON named.workspace_id = change.workspace_id AND named.change_request_id = change.id
                     WHERE change.workspace_id = line.workspace_id AND change.project_id = line.project_id AND change.kind = 'price_correction'
                       AND change.status IN ('approved', 'applied') AND named.boq_line_id = line.id) AS corrected
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN LATERAL (SELECT change.number, change.kind FROM change_requests change JOIN change_request_lines named ON named.workspace_id = change.workspace_id AND named.change_request_id = change.id
                           WHERE change.workspace_id = line.workspace_id AND change.project_id = line.project_id AND named.boq_line_id = line.id
                             AND change.status NOT IN ('approved', 'applied', 'declined', 'withdrawn')
                           ORDER BY change.kind <> 'price_correction', change.number DESC LIMIT 1) pending ON true
      WHERE line.workspace_id = $1 AND line.status = 'active' AND ${where}
      ORDER BY line.position`, [workspaceId, value])).rows;
  for (const row of rows) {
    const reason = priceHoldReason({ title: row.title, agreed: row.agreed, ordered: row.ordered, currency: row.currency,
      pending: row.pendingNumber ? { reference: changeReference(Number(row.pendingNumber)), kind: row.pendingKind ?? "" } : null, corrected: row.corrected });
    if (reason) held.set(row.id, reason);
  }
  return held;
}
