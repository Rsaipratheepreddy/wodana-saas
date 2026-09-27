import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

/**
 * Labour rates apply from a date until the next one: the day rate of a trade on site, the hourly rate of
 * a workcenter. A day's work costs the rate in force that day, however late its report is approved.
 *
 * Why dates rather than copying the rate onto each report when it's approved: the cost of a day is the
 * price of that day's work, so a rise agreed from the 1st doesn't reach a report of the 28th approved on
 * the 2nd; a rate set late (a trade nobody priced yet) can be set from the day the work started and costs
 * the reports already approved, instead of leaving them uncosted for good; and the cost stays read from
 * the records that caused it — the report and the rate history — with no amounts copied around. Changing
 * a rate from a later date never touches the days before it; correcting the rate from the same date does,
 * on purpose, and is audited.
 */
export type RateRow = { id: string; key: string; from: string; rate: string; currency: string; version: number };

/** How a trade is matched: trimmed, single-spaced and case-insensitive ("  tile  Fixers" is "tile fixers"). */
export const tradeKey = (trade: string) => trade.trim().replace(/\s+/g, " ").toLowerCase();

/** The trade as it's kept: trimmed and single-spaced. */
export const tradeName = (trade: string) => trade.trim().replace(/\s+/g, " ");

/** The rate in force on a day: the one set from the latest date on or before it; null when none was set yet. */
export function rateOn<T extends { key: string; from: string }>(rates: T[], key: string, day: string): T | null {
  let found: T | null = null;
  for (const rate of rates) if (rate.key === key && rate.from <= day && (!found || rate.from > found.from)) found = rate;
  return found;
}

/** People or hours at a rate, exactly, to the rate currency's minor units. */
export const labourCost = (quantity: string | number, rate: string, currency: string) => Dec.of(quantity).mul(rate).round(currencyDecimals(currency));

/** Every trade's day rates, oldest first. */
export async function readTradeRates(db: Db, workspaceId: string): Promise<Array<RateRow & { trade: string; updatedByName: string; updatedAt: string }>> {
  const rows = (await db.query<Omit<RateRow, "key"> & { trade: string; updatedByName: string; updatedAt: string }>(
    `SELECT rate.id, rate.trade, rate.effective_from::text AS "from", rate.day_rate::text AS rate, rate.currency, rate.version, person.display_name AS "updatedByName",
            rate.updated_at AS "updatedAt"
       FROM workspace_labour_rates rate JOIN users person ON person.id = rate.updated_by
      WHERE rate.workspace_id = $1 ORDER BY lower(rate.trade), rate.effective_from`, [workspaceId])).rows;
  return rows.map((row) => ({ ...row, key: tradeKey(row.trade) }));
}

/** Every workcenter's hourly rates, oldest first; keyed by the workcenter. */
export async function readWorkcenterRates(db: Db, workspaceId: string): Promise<RateRow[]> {
  return (await db.query<RateRow>(
    `SELECT id, workcenter_id AS key, effective_from::text AS "from", hourly_rate::text AS rate, currency, version
       FROM workcenter_rates WHERE workspace_id = $1 ORDER BY workcenter_id, effective_from`, [workspaceId])).rows;
}
