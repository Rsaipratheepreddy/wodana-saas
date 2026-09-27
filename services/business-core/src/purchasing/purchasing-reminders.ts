import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { currencyDecimals, readOrderLines } from "./orders";
import { outstanding } from "./receiving";

type Db = Pick<PoolClient, "query">;

/**
 * The daily chase of late orders, run inside one workspace's tenant transaction: an order is late when
 * something still to come was due before today (its line's promise, else the order's promise, else when
 * it was needed). The buyer hears the first day it's late and then every week while it stays late, in
 * the app and by email. Keys make each reminder once only; a missed day catches up.
 */
export async function processPurchasingDeadlines(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, coalesce(default_locale, 'en') AS locale FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0];
  if (!today) return { sent: 0 };
  const orders = (await db.query<{ id: string; number: string; supplier: string; currency: string; total: string; buyer: string; submitter: string | null }>(
    `SELECT purchase.id, purchase.number, vendor.display_name AS supplier, purchase.currency, purchase.total::text AS total, purchase.created_by AS buyer, purchase.submitted_by AS submitter
       FROM purchase_orders purchase JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE purchase.workspace_id = $1 AND purchase.status IN ('sent', 'confirmed', 'partly_received')
        AND EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
                     AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) < $2::date)`, [workspaceId, today.today])).rows;
  let sent = 0;
  for (const order of orders) {
    const late = (await readOrderLines(db, workspaceId, order.id)).filter((line) => line.due && line.due < today.today && outstanding(line).cmp(0) > 0);
    if (!late.length) continue;
    const due = late.map((line) => line.due!).sort()[0];
    const days = Math.round((Date.parse(`${today.today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
    const week = Math.floor((days - 1) / 7);
    const day = (() => { try { return new Intl.DateTimeFormat(today.locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${due}T00:00:00Z`)); } catch { return due; } })();
    const items = late.slice(0, 5).map((line) => `${line.description} ${outstanding(line).toString()} ${line.unit}`.trim()).join(", ");
    const note = `due ${day}, ${days === 1 ? "1 day" : `${days} days`} late: ${items}${late.length > 5 ? ` and ${late.length - 5} more` : ""}.`;
    const variables = { order: order.number, supplier: order.supplier, amount: `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`, actor: "", note };
    for (const userId of new Set([order.buyer, order.submitter].filter((value): value is string => Boolean(value)))) {
      const message = { workspaceId, recipientUserId: userId, code: "purchasing.late", eventType: "purchasing.late", variables, deepLink: `/workspace/purchasing/orders?order=${order.id}` };
      const key = `purchasing.late:${order.id}:${due}:${week}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
