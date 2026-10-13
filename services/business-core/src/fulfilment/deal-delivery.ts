import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { assertDeliveryCleared } from "../factory/factory-inspections";
import { assertPermitFor } from "../logistics/permits";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { permissionHolders } from "../project-core/project-release";
import { dealRule } from "./fulfilment-rules";

type Db = Pick<PoolClient, "query">;

/**
 * Books, moves or clears a won deal's delivery day (PLM-126), from the deal or the factory and logistics calendar. The
 * order must be won and not cancelled; a day needs a collected building permit covering it where the firm asks deals
 * for one (PLM-136). The drivers (else the people who keep stock) hear a new day. Returns the day before, or null when
 * nothing changed. The caller version-checks and audits.
 */
export async function writeDealDelivery(db: Db, input: { workspaceId: string; opportunityId: string; date: string | null; note: string; actorUserId: string; actorName: string }) {
  const { workspaceId, opportunityId, date, note } = input;
  const rule = await dealRule(db, workspaceId, opportunityId);
  if (!rule) throw new NotFoundException("Deal not found.");
  if (rule.status !== "won") throw new ConflictException("The deal is won first: attach the payment proof.");
  await db.query(`INSERT INTO crm_deal_fulfilment (workspace_id, opportunity_id) VALUES ($1, $2) ON CONFLICT (workspace_id, opportunity_id) DO NOTHING`, [workspaceId, opportunityId]);
  const current = (await db.query<{ deliveryOn: string | null; note: string; cancelledAt: Date | null }>(
    `SELECT delivery_on::text AS "deliveryOn", delivery_note AS note, cancelled_at AS "cancelledAt" FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2 FOR UPDATE`,
    [workspaceId, opportunityId])).rows[0];
  if (current.cancelledAt) throw new ConflictException("This order is cancelled.");
  if (current.deliveryOn === date && (date === null || current.note === note)) return null;
  // PLM-150: an order the factory makes is delivered once its items passed their last design inspection.
  if (date && date !== current.deliveryOn) await assertDeliveryCleared(db, workspaceId, { opportunityId });
  if (date && date !== current.deliveryOn) await assertPermitFor(db, workspaceId, { opportunityId }, date, "delivery");
  await db.query(
    `UPDATE crm_deal_fulfilment SET delivery_on = $3, delivery_note = $4, delivery_booked_by = CASE WHEN $3::date IS NULL THEN NULL ELSE $5::uuid END,
            delivery_booked_at = CASE WHEN $3::date IS NULL THEN NULL ELSE now() END, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId, date, date ? note : "", input.actorUserId]);
  if (date && date !== current.deliveryOn) {
    const deal = (await db.query<{ title: string }>(
      `SELECT concat_ws(' · ', opportunity.reference, coalesce(party.display_name, opportunity.title)) AS title
         FROM crm_opportunities opportunity LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0]?.title ?? "";
    let drivers = (await permissionHolders(db, workspaceId, ["fulfilment.deliver"])).map((row) => row.userId);
    if (!drivers.length) drivers = (await permissionHolders(db, workspaceId, ["stock.manage"])).map((row) => row.userId);
    for (const userId of new Set(drivers)) {
      if (userId === input.actorUserId) continue;
      const message = { workspaceId, recipientUserId: userId, code: "fulfilment.delivery_booked", eventType: "fulfilment.delivery_booked",
        variables: { deal, actor: input.actorName, date, note }, deepLink: `/workspace/crm/opportunities?record=${opportunityId}` };
      const idempotencyKey = `fulfilment.delivery_booked:${opportunityId}:delivery:${date}:${userId}`.slice(0, 200);
      await notifyUserInApp(db, { ...message, idempotencyKey });
      await queueUserEmail(db, { ...message, idempotencyKey: `${idempotencyKey}:email` });
    }
  }
  return { before: current.deliveryOn };
}
