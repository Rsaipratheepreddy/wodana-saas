import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { inWorkspaceCurrency } from "../inventory/stock";
import { readProject } from "../project-core/project-core.store";
import { readProjectCommitted, readProjectCosts, readProjectIncome } from "../project-core/project-money";
import { currencyDecimals } from "./orders";

type Db = Pick<PoolClient, "query">;

/** A project an order would take beyond its money in hand, in the workspace's currency. */
export type FundsShort = { projectId: string; reference: string; currency: string; needed: string; available: string };

/**
 * The projects an order (not yet placed) would take beyond the money in hand for them: what the client
 * paid, less what's spent and already committed. The order's lines for each project are counted at their
 * net price in the workspace's currency today. Projects kept in another currency than the workspace
 * aren't compared, and neither are lines for general stock.
 */
export async function fundsShort(db: Db, workspaceId: string, orderId: string): Promise<FundsShort[]> {
  const order = (await db.query<{ currency: string; today: string; home: string }>(
    `SELECT purchase.currency, (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today, workspace.default_currency AS home
       FROM purchase_orders purchase JOIN workspaces workspace ON workspace.id = purchase.workspace_id WHERE purchase.workspace_id = $1 AND purchase.id = $2`,
    [workspaceId, orderId])).rows[0];
  if (!order) return [];
  const byProject = (await db.query<{ projectId: string; net: string }>(
    `SELECT project_id AS "projectId", sum(net)::text AS net FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2 AND project_id IS NOT NULL GROUP BY project_id`,
    [workspaceId, orderId])).rows;
  const short: FundsShort[] = [];
  for (const row of byProject) {
    const project = await readProject(db as PoolClient, workspaceId, row.projectId);
    if (!project || project.currency !== order.home) continue;
    const needed = await inWorkspaceCurrency(db, workspaceId, Dec.of(row.net), order.currency, order.today);
    // Without a rate the order can't be compared; the guard says so rather than letting it through silently.
    const income = await readProjectIncome(db, workspaceId, project);
    const available = Dec.of(income.received).sub((await readProjectCosts(db, workspaceId, project.id)).total).sub((await readProjectCommitted(db, workspaceId, project.id)).total);
    const places = currencyDecimals(order.home);
    if (!needed || needed.amount.cmp(available) > 0)
      short.push({ projectId: project.id, reference: project.reference, currency: order.home, needed: needed ? needed.amount.round(places).toFixed(4) : "",
        available: available.round(places).toFixed(4) });
  }
  return short;
}

/** "PRJ-0007: AED 1,000.00 in hand, this order needs AED 1,500.00". */
export function describeShort(short: FundsShort[]) {
  const money = (currency: string, value: string) => `${currency} ${Dec.of(value).toFixed(currencyDecimals(currency))}`;
  return short.map((item) => item.needed
    ? `${item.reference}: ${money(item.currency, item.available)} in hand, this order needs ${money(item.currency, item.needed)}`
    : `${item.reference}: no exchange rate to compare this order with its ${money(item.currency, item.available)} in hand`).join("; ");
}
