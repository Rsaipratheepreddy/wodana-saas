import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { paymentHasFinanceVerifiedReceipt } from "../commercial/finance-ledger";
import { inWorkspaceCurrency } from "../inventory/stock";
import { claimNumber } from "../petty-cash/petty-cash";
import { currencyDecimals } from "../purchasing/orders";
import { orderUnitPrice } from "../purchasing/payables";
import type { CostEntry } from "./project-money";

/**
 * A project's cash (plan §6.21 "project wallet"): money in from the client and money out to suppliers, labour and site
 * expenses, by month in the workspace's time zone and cumulative, the cash the project holds (received − paid), what is
 * due in and out over the next 90 days, and the spending guard's state. Amounts are in the workspace's currency (other
 * currencies at the rate of their day); exact decimal text, never a float.
 */

type Db = Pick<PoolClient, "query">;
const fixed = (value: Dec) => value.toFixed(4);

export type CashKind = "client_receipt" | "supplier_payment" | "labour" | "petty_cash";
export type CashMove = { key: string; on: string; direction: "in" | "out"; kind: CashKind; amount: string; reference: string | null };

/** The calendar day an instant falls on in a time zone (YYYY-MM-DD). */
export function dayIn(at: string | Date, timeZone: string): string {
  const instant = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** The day `days` after a calendar day. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const nextMonth = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, "0")}`;
};

export type CashMonth = { month: string; in: string; out: string; net: string; cumulativeIn: string; cumulativeOut: string; balance: string };

/**
 * Money in and out per calendar month (the moves' days are already in the workspace's time zone), every month from the
 * first move (or `from`) to `to` with the empty ones too, and running totals; the last month's balance is the wallet.
 */
export function cashByMonth(moves: readonly CashMove[], range: { from?: string | null; to: string }): CashMonth[] {
  const sums = new Map<string, { in: Dec; out: Dec }>();
  for (const move of moves) {
    const month = move.on.slice(0, 7);
    const sum = sums.get(month) ?? { in: Dec.ZERO, out: Dec.ZERO };
    if (move.direction === "in") sum.in = sum.in.add(move.amount); else sum.out = sum.out.add(move.amount);
    sums.set(month, sum);
  }
  const months = [...sums.keys(), ...(range.from ? [range.from.slice(0, 7)] : [])].sort();
  const end = [range.to.slice(0, 7), ...months].sort().at(-1)!;
  if (!months.length) return [];
  const rows: CashMonth[] = [];
  let cumulativeIn = Dec.ZERO, cumulativeOut = Dec.ZERO;
  for (let month = months[0], guard = 0; month <= end && guard < 1200; month = nextMonth(month), guard += 1) {
    const sum = sums.get(month) ?? { in: Dec.ZERO, out: Dec.ZERO };
    cumulativeIn = cumulativeIn.add(sum.in);
    cumulativeOut = cumulativeOut.add(sum.out);
    rows.push({ month, in: fixed(sum.in), out: fixed(sum.out), net: fixed(sum.in.sub(sum.out)), cumulativeIn: fixed(cumulativeIn), cumulativeOut: fixed(cumulativeOut),
      balance: fixed(cumulativeIn.sub(cumulativeOut)) });
  }
  return rows;
}

export type UpcomingItem = { key: string; direction: "in" | "out"; kind: "milestone" | "bill" | "order" | "petty_cash"; label: string; due: string | null; amount: string };
export const UPCOMING_BUCKETS = ["overdue", "days_0_30", "days_31_60", "days_61_90"] as const;
export type UpcomingBucket = (typeof UPCOMING_BUCKETS)[number];
export type Upcoming = {
  buckets: Array<{ key: UpcomingBucket; from: string | null; to: string; in: string; out: string; net: string }>;
  /** Due in or out with no date to place it on. */
  undated: { in: string; out: string };
  items: UpcomingItem[];
};

/** Due money in four buckets from today: already overdue, then 0-30, 31-60 and 61-90 days; later than 90 days is left out. */
export function upcomingBuckets(items: readonly UpcomingItem[], today: string): Upcoming {
  const ranges: Array<{ key: UpcomingBucket; from: string | null; to: string }> = [
    { key: "overdue", from: null, to: addDays(today, -1) },
    { key: "days_0_30", from: today, to: addDays(today, 30) },
    { key: "days_31_60", from: addDays(today, 31), to: addDays(today, 60) },
    { key: "days_61_90", from: addDays(today, 61), to: addDays(today, 90) },
  ];
  const sums = ranges.map(() => ({ in: Dec.ZERO, out: Dec.ZERO }));
  const undated = { in: Dec.ZERO, out: Dec.ZERO };
  const kept: UpcomingItem[] = [];
  for (const item of items) {
    if (Dec.of(item.amount).cmp(0) <= 0) continue;
    if (!item.due) { undated[item.direction] = undated[item.direction].add(item.amount); kept.push(item); continue; }
    const index = ranges.findIndex((range) => (range.from === null || item.due! >= range.from) && item.due! <= range.to);
    if (index < 0) continue;
    sums[index][item.direction] = sums[index][item.direction].add(item.amount);
    kept.push(item);
  }
  kept.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.key.localeCompare(b.key));
  return {
    buckets: ranges.map((range, index) => ({ ...range, in: fixed(sums[index].in), out: fixed(sums[index].out), net: fixed(sums[index].in.sub(sums[index].out)) })),
    undated: { in: fixed(undated.in), out: fixed(undated.out) }, items: kept,
  };
}

export type SpendingGuard = "off" | "warn" | "strict";
export type SpendingLock = { guard: SpendingGuard; available: string | null; state: "off" | "clear" | "warn" | "locked" };

/** What the spending guard does with the next order: nothing (off), lets it through with a warning, or stops it. */
export function spendingLock(guard: SpendingGuard, available: string | null): SpendingLock {
  if (guard === "off" || available === null) return { guard, available, state: guard === "off" ? "off" : "clear" };
  if (Dec.of(available).cmp(0) > 0) return { guard, available, state: "clear" };
  return { guard, available, state: guard === "strict" ? "locked" : "warn" };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers

export type CashContext = { workspaceId: string; projectId: string; caseId: string; timeZone: string; today: string; home: string; projectCurrency: string };

/** The workspace's time zone, currency and today there. */
export async function cashContext(db: Db, workspaceId: string, project: { id: string; caseId: string; currency: string }): Promise<CashContext> {
  const row = (await db.query<{ timeZone: string; home: string }>(
    `SELECT coalesce(nullif(default_timezone, ''), 'UTC') AS "timeZone", default_currency AS home FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  return { workspaceId, projectId: project.id, caseId: project.caseId, timeZone: row.timeZone, home: row.home, projectCurrency: project.currency,
    today: dayIn(new Date(), row.timeZone) };
}

type Converter = { convert: (amount: Dec, currency: string, on: string) => Promise<Dec | null>; unconverted: number };
function converter(db: Db, context: CashContext): Converter {
  const state: Converter = {
    unconverted: 0,
    convert: async (amount, currency, on) => {
      const value = await inWorkspaceCurrency(db, context.workspaceId, amount, currency, on);
      if (!value) { state.unconverted += 1; return null; }
      return value.amount.round(currencyDecimals(context.home));
    },
  };
  return state;
}

/** The project's payment milestones (on its sealed quotations) and what the client paid on each. */
async function clientSide(db: Db, context: CashContext) {
  const quotes = new Set((await db.query<{ quoteId: string }>(`SELECT quote_id AS "quoteId" FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2`,
    [context.workspaceId, context.projectId])).rows.map((row) => row.quoteId));
  const loaded = await commercialRepository.load(db as PoolClient, context.workspaceId, context.caseId);
  const data = loaded ? ({ ...(loaded.content as CommercialData), revision: loaded.revision } as CommercialData) : null;
  const payments = (data?.payments ?? []).filter((payment) => payment.sourceQuoteId && quotes.has(payment.sourceQuoteId));
  return { data, payments };
}

/**
 * Money in: each finance-verified receipt allocated to one of the project's milestones, on the day it was verified (a
 * reversed allocation never counts). A deal kept before receipts were recorded counts its verified milestones.
 */
export async function readCashIn(db: Db, context: CashContext, convert: Converter) {
  const { data, payments } = await clientSide(db, context);
  const moves: CashMove[] = [];
  const paid = new Map<string, Dec>();
  if (!data) return { moves, paid, payments };
  const exact = (value: number, currency: string) => Dec.of(value).round(currencyDecimals(currency));
  const ids = new Set(payments.map((payment) => payment.id));
  if (data.financeContext) {
    for (const allocation of data.allocations ?? []) {
      if (!ids.has(allocation.paymentId) || allocation.reversedAt) continue;
      const receipt = data.receipts?.find((item) => item.id === allocation.receiptId);
      if (!receipt || receipt.status !== "finance_verified") continue;
      const amount = exact(allocation.amount, allocation.currency);
      paid.set(allocation.paymentId, (paid.get(allocation.paymentId) ?? Dec.ZERO).add(amount));
      const on = dayIn(receipt.verifiedAt ?? receipt.reportedAt, context.timeZone);
      const value = await convert.convert(amount, allocation.currency, on);
      if (value) moves.push({ key: `receipt:${allocation.id}`, on, direction: "in", kind: "client_receipt", amount: fixed(value), reference: receipt.reference || null });
    }
  } else {
    for (const payment of payments) {
      if (!paymentHasFinanceVerifiedReceipt(data, payment) || !payment.verifiedAt) continue;
      const currency = payment.currency ?? context.projectCurrency;
      const amount = exact(payment.amount, currency);
      paid.set(payment.id, amount);
      const on = dayIn(payment.verifiedAt, context.timeZone);
      const value = await convert.convert(amount, currency, on);
      if (value) moves.push({ key: `payment:${payment.id}`, on, direction: "in", kind: "client_receipt", amount: fixed(value), reference: payment.reference || null });
    }
  }
  return { moves, paid, payments };
}

/** The project's share of each approved supplier bill: its lines (on an order for the project, or charged to it) over the bill's total. */
const BILL_SHARE = `SELECT line.invoice_id,
        sum(line.total) FILTER (WHERE coalesce(ordered.project_id, line.project_id) = $2) AS mine, sum(line.total) AS whole
   FROM supplier_invoice_lines line
   LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
  WHERE line.workspace_id = $1
  GROUP BY line.invoice_id
 HAVING coalesce(sum(line.total) FILTER (WHERE coalesce(ordered.project_id, line.project_id) = $2), 0) > 0`;

const share = (amount: string, mine: string, whole: string, places: number) =>
  Dec.of(whole).isZero() ? Dec.ZERO : Dec.of(amount).mul(mine).div(whole).round(places);

/**
 * Money out: supplier payments (the project's share of each payment allocated to a bill, and of advances paid on its
 * orders and not yet allocated), labour on the day it was worked (Wodana keeps no labour payouts, so labour counts as
 * paid when it is costed), and petty cash on the day it was reimbursed.
 */
export async function readCashOut(db: Db, context: CashContext, convert: Converter, costs: { entries: CostEntry[] }) {
  const moves: CashMove[] = [];
  const allocations = (await db.query<{ id: string; on: string; currency: string; amount: string; mine: string; whole: string; number: string; supplier: string }>(
    `WITH share AS (${BILL_SHARE})
     SELECT allocation.id, payment.paid_on::text AS on, payment.currency, allocation.amount::text AS amount, share.mine::text AS mine, share.whole::text AS whole,
            bill.number, vendor.display_name AS supplier
       FROM supplier_payment_allocations allocation
       JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
       JOIN supplier_invoices bill ON bill.workspace_id = allocation.workspace_id AND bill.id = allocation.invoice_id
       JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
       JOIN share ON share.invoice_id = allocation.invoice_id
      WHERE allocation.workspace_id = $1
      ORDER BY payment.paid_on, allocation.id`, [context.workspaceId, context.projectId])).rows;
  for (const row of allocations) {
    const amount = share(row.amount, row.mine, row.whole, currencyDecimals(row.currency));
    const value = amount.isZero() ? null : await convert.convert(amount, row.currency, row.on);
    if (value) moves.push({ key: `supplier:${row.id}`, on: row.on, direction: "out", kind: "supplier_payment", amount: fixed(value), reference: `${row.supplier} ${row.number}` });
  }
  const advances = (await db.query<{ id: string; on: string; currency: string; unallocated: string; mine: string | null; whole: string | null; number: string }>(
    `SELECT payment.id, payment.paid_on::text AS on, payment.currency, purchase.number,
            (payment.amount - coalesce((SELECT sum(used.amount) FROM supplier_payment_allocations used WHERE used.workspace_id = payment.workspace_id AND used.payment_id = payment.id), 0))::text AS unallocated,
            (SELECT sum(ordered.net) FILTER (WHERE ordered.project_id = $2) FROM purchase_order_lines ordered WHERE ordered.workspace_id = payment.workspace_id AND ordered.order_id = payment.order_id)::text AS mine,
            (SELECT sum(ordered.net) FROM purchase_order_lines ordered WHERE ordered.workspace_id = payment.workspace_id AND ordered.order_id = payment.order_id)::text AS whole
       FROM supplier_payments payment
       JOIN purchase_orders purchase ON purchase.workspace_id = payment.workspace_id AND purchase.id = payment.order_id
      WHERE payment.workspace_id = $1 AND payment.status = 'recorded' AND payment.order_id IS NOT NULL
      ORDER BY payment.paid_on, payment.id`, [context.workspaceId, context.projectId])).rows;
  const advancePaid = new Map<string, Dec>();
  for (const row of advances) {
    if (!row.mine || !row.whole || Dec.of(row.unallocated).cmp(0) <= 0) continue;
    const amount = share(row.unallocated, row.mine, row.whole, currencyDecimals(row.currency));
    if (amount.cmp(0) <= 0) continue;
    advancePaid.set(row.number, (advancePaid.get(row.number) ?? Dec.ZERO).add(amount));
    const value = await convert.convert(amount, row.currency, row.on);
    if (value) moves.push({ key: `advance:${row.id}`, on: row.on, direction: "out", kind: "supplier_payment", amount: fixed(value), reference: row.number });
  }
  for (const entry of costs.entries)
    if (entry.source === "labour") moves.push({ key: entry.key, on: entry.on, direction: "out", kind: "labour", amount: entry.amount, reference: entry.reference });
  const claims = (await db.query<{ id: string; reimbursedAt: string; amount: string; currency: string; number: number }>(
    `SELECT id, reimbursed_at AS "reimbursedAt", amount::text AS amount, currency, number FROM petty_cash_claims
      WHERE workspace_id = $1 AND project_id = $2 AND status = 'reimbursed' ORDER BY reimbursed_at, id`, [context.workspaceId, context.projectId])).rows;
  for (const claim of claims) {
    const on = dayIn(claim.reimbursedAt, context.timeZone);
    const value = await convert.convert(Dec.of(claim.amount), claim.currency, on);
    if (value) moves.push({ key: `petty_cash:${claim.id}`, on, direction: "out", kind: "petty_cash", amount: fixed(value), reference: claimNumber(claim.number) });
  }
  return { moves, advancePaid };
}

/**
 * What is due in the coming days: each milestone's unpaid rest (on its live invoice's due date, else the milestone's),
 * the project's share of approved bills not yet paid (due date, else the bill's date), the rest of each open order on
 * the day its terms make it payable (credit days after the promised or expected date; upfront now), less advances
 * already paid on it, and approved petty cash waiting to be reimbursed (now).
 */
export async function readUpcoming(db: Db, context: CashContext, convert: Converter, client: Awaited<ReturnType<typeof readCashIn>>, advancePaid: Map<string, Dec>) {
  const items: UpcomingItem[] = [];
  const invoices = (await db.query<{ paymentId: string; due: string }>(
    `SELECT payment_id AS "paymentId", due_date::text AS due FROM client_invoices WHERE workspace_id = $1 AND project_id = $2 AND status = 'issued'`,
    [context.workspaceId, context.projectId])).rows;
  for (const payment of client.payments) {
    const currency = payment.currency ?? context.projectCurrency;
    const left = Dec.of(payment.amount).round(currencyDecimals(currency)).sub(client.paid.get(payment.id) ?? Dec.ZERO);
    if (left.cmp(0) <= 0) continue;
    const due = invoices.find((invoice) => invoice.paymentId === payment.id)?.due ?? (payment.dueDate || null);
    const value = await convert.convert(left, currency, context.today);
    if (value) items.push({ key: `milestone:${payment.id}`, direction: "in", kind: "milestone", label: payment.title, due, amount: fixed(value) });
  }
  const bills = (await db.query<{ id: string; due: string; currency: string; total: string; paid: string; mine: string; whole: string; number: string; supplier: string }>(
    `WITH share AS (${BILL_SHARE})
     SELECT bill.id, coalesce(bill.due_date, bill.invoice_date)::text AS due, bill.currency, bill.total::text AS total, bill.number, vendor.display_name AS supplier,
            share.mine::text AS mine, share.whole::text AS whole,
            coalesce((SELECT sum(allocation.amount) FROM supplier_payment_allocations allocation
                        JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                       WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id), 0)::text AS paid
       FROM supplier_invoices bill
       JOIN share ON share.invoice_id = bill.id
       JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
      WHERE bill.workspace_id = $1 AND bill.status = 'approved'`, [context.workspaceId, context.projectId])).rows;
  for (const bill of bills) {
    const left = Dec.of(bill.total).sub(bill.paid);
    if (left.cmp(0) <= 0) continue;
    const value = await convert.convert(share(fixed(left), bill.mine, bill.whole, currencyDecimals(bill.currency)), bill.currency, context.today);
    if (value) items.push({ key: `bill:${bill.id}`, direction: "out", kind: "bill", label: `${bill.supplier} ${bill.number}`, due: bill.due, amount: fixed(value) });
  }
  const orders = (await db.query<{ number: string; supplier: string; currency: string; terms: string; creditDays: number | null; expected: string | null; quantity: string; cancelled: string;
    credited: string; accepted: string; unitPrice: string; discountPercent: string }>(
    `SELECT purchase.number, vendor.display_name AS supplier, purchase.currency, purchase.payment_terms AS terms, purchase.credit_days AS "creditDays",
            coalesce(purchase.promised_date, purchase.expected_date)::text AS expected, ordered.quantity::text AS quantity, ordered.cancelled_quantity::text AS cancelled,
            ordered.unit_price::text AS "unitPrice", ordered.discount_percent::text AS "discountPercent",
            coalesce(back.credited, 0)::text AS credited, (coalesce(got.accepted, 0) - coalesce(back.returned_accepted, 0))::text AS accepted
       FROM purchase_order_lines ordered
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
       -- The same rest as the Money tab's committed (readProjectCommitted).
       LEFT JOIN LATERAL (SELECT sum(item.accepted) AS accepted FROM goods_receipt_lines item
                            JOIN goods_receipts receipt ON receipt.workspace_id = item.workspace_id AND receipt.id = item.receipt_id AND receipt.reversed_at IS NULL
                           WHERE item.workspace_id = ordered.workspace_id AND item.order_line_id = ordered.id) got ON true
       LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE item.source = 'accepted' AND sent.status = 'sent') AS returned_accepted,
                                 sum(item.quantity) FILTER (WHERE sent.outcome = 'credit' AND (sent.status = 'sent' OR (sent.status = 'open' AND item.source = 'rejected'))) AS credited
                            FROM supplier_return_lines item JOIN supplier_returns sent ON sent.workspace_id = item.workspace_id AND sent.id = item.return_id
                           WHERE item.workspace_id = ordered.workspace_id AND item.order_line_id = ordered.id) back ON true
      WHERE ordered.workspace_id = $1 AND ordered.project_id = $2 AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received')`,
    [context.workspaceId, context.projectId])).rows;
  const byOrder = new Map<string, { supplier: string; currency: string; due: string | null; amount: Dec }>();
  for (const line of orders) {
    const left = Dec.of(line.quantity).sub(line.cancelled).sub(line.credited).sub(line.accepted);
    if (left.cmp(0) <= 0) continue;
    const price = orderUnitPrice(line);
    const due = line.terms === "upfront" ? context.today : line.expected ? (line.terms === "credit" ? addDays(line.expected, line.creditDays ?? 0) : line.expected) : null;
    const order = byOrder.get(line.number) ?? { supplier: line.supplier, currency: line.currency, due, amount: Dec.ZERO };
    order.amount = order.amount.add(left.mul(price).round(currencyDecimals(line.currency)));
    byOrder.set(line.number, order);
  }
  for (const [number, order] of byOrder) {
    const rest = order.amount.sub(advancePaid.get(number) ?? Dec.ZERO);
    if (rest.cmp(0) <= 0) continue;
    const value = await convert.convert(rest, order.currency, context.today);
    if (value) items.push({ key: `order:${number}`, direction: "out", kind: "order", label: `${order.supplier} ${number}`, due: order.due, amount: fixed(value) });
  }
  const claims = (await db.query<{ id: string; amount: string; currency: string; number: number }>(
    `SELECT id, amount::text AS amount, currency, number FROM petty_cash_claims WHERE workspace_id = $1 AND project_id = $2 AND status = 'approved'`,
    [context.workspaceId, context.projectId])).rows;
  for (const claim of claims) {
    const value = await convert.convert(Dec.of(claim.amount), claim.currency, context.today);
    if (value) items.push({ key: `petty_cash:${claim.id}`, direction: "out", kind: "petty_cash", label: claimNumber(claim.number), due: context.today, amount: fixed(value) });
  }
  return upcomingBuckets(items, context.today);
}

export async function readSpendingGuard(db: Db, workspaceId: string): Promise<SpendingGuard> {
  const value = (await db.query<{ guard: string }>(`SELECT spending_guard AS guard FROM workspace_purchasing_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.guard;
  return value === "warn" || value === "strict" ? value : "off";
}

export { converter as cashConverter };
