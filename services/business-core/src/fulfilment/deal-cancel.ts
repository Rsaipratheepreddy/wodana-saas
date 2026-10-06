import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { releaseForDeal } from "./stock-reservations";

type Db = Pick<PoolClient, "query">;

/** A refund covers the whole deal when it is at least the deal's value in the deal's currency. */
export function refundsWholeDeal(refund: { total: string; currency: string }, deal: { amount: string | null; currency: string | null }) {
  return Boolean(deal.amount && deal.currency === refund.currency && Dec.of(deal.amount).cmp(0) > 0 && Dec.of(refund.total).cmp(deal.amount) >= 0);
}

/**
 * PLM-125 / PLM-109: Finance completing a refund of the whole deal cancels its order: the reservation is released and
 * the goods it took go back to stock. A part refund (a discount, one item) changes nothing here; the order is
 * cancelled on the deal for that. Idempotent: an order already cancelled stays as it is.
 */
export async function cancelDealOnFullRefund(db: Db, workspaceId: string, input: { opportunityId: string; total: string; currency: string; reference: string; actorUserId: string }) {
  const deal = (await db.query<{ amount: string | null; currency: string | null; status: string }>(
    `SELECT amount::text AS amount, currency_code AS currency, status::text AS status FROM crm_opportunities WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, input.opportunityId])).rows[0];
  if (!deal || deal.status !== "won" || !refundsWholeDeal(input, deal)) return false;
  await db.query(`INSERT INTO crm_deal_fulfilment (workspace_id, opportunity_id) VALUES ($1, $2) ON CONFLICT (workspace_id, opportunity_id) DO NOTHING`, [workspaceId, input.opportunityId]);
  const reason = `Refunded in full (${input.reference})`;
  const cancelled = await db.query(
    `UPDATE crm_deal_fulfilment SET cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND opportunity_id = $2 AND cancelled_at IS NULL`, [workspaceId, input.opportunityId, input.actorUserId, reason]);
  if (!cancelled.rowCount) return false;
  const lines = await releaseForDeal(db, workspaceId, { opportunityId: input.opportunityId, reason, actorUserId: input.actorUserId });
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "crm.deal.fulfilment.cancel", entityType: "crm_opportunity", entityId: input.opportunityId,
    after: { reason, refund: input.reference, stockLines: lines } });
  return true;
}
