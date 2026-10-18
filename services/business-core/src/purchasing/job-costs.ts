import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "./orders";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P8/P9, the supplier side of a job: what it has committed with suppliers (approved orders), what suppliers have
 * billed (approved bills) and what has been paid, exact to the currency's minor units. A bill shared with other jobs
 * is shown whole and kept apart (never split by an estimate), so every figure reconciles. Internal only: a client
 * never sees costs. Checks: a bill above what was ordered, and bills or payments not in the ledger for the same amount.
 */
export type JobCosts = {
  currency: string;
  committed: string; billed: string; paid: string; toPay: string;
  orders: Array<{ id: string; number: string; supplier: string; status: string; committed: string; billed: string }>;
  bills: Array<{ id: string; number: string; supplier: string; status: string; date: string; total: string; paid: string; remaining: string; shared: boolean }>;
  /** Orders or bills in another currency than the job's: listed by count, never added into its totals. */
  otherCurrency: number;
  checks: Array<{ kind: "billed_over_order"; orderNumber: string; description: string; ordered: string; billed: string }
    | { kind: "bill_not_posted" | "bill_posted_differently"; number: string; total: string; posted: string | null }
    | { kind: "payment_not_posted"; reference: string; amount: string }>;
};

/** Orders count as committed once approved; drafts, those waiting for approval and cancelled ones don't. */
const COMMITTED = ["approved", "sent", "confirmed", "partly_received", "received", "closed"];
/** Bills count once approved; a held bill is listed but not counted until it's released. */
const COUNTED_BILLS = ["approved", "partly_paid", "paid"];

export async function readJobCosts(db: Db, workspaceId: string, projectId: string): Promise<JobCosts> {
  const currency = (await db.query<{ currency: string }>(`SELECT trim(currency) AS currency FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId]))
    .rows[0]?.currency ?? "";
  const places = currencyDecimals(currency);
  const fixed = (value: Dec) => value.toFixed(places);
  // Order lines of the job, with what's left after cancelled quantities (pro rata, rounded once at the currency's places).
  const lines = (await db.query<{ id: string; orderId: string; number: string; supplier: string; status: string; currency: string; description: string; quantity: string; cancelled: string; total: string }>(
    `SELECT line.id, ord.id AS "orderId", ord.number, coalesce(vendor.display_name, vendor.legal_name, '') AS supplier, ord.status, trim(ord.currency) AS currency, line.description,
            line.quantity::text AS quantity, coalesce(line.cancelled_quantity, 0)::text AS cancelled, line.total::text AS total
       FROM purchase_order_lines line JOIN purchase_orders ord ON ord.workspace_id = line.workspace_id AND ord.id = line.order_id
       LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = ord.workspace_id AND vendor.id = ord.vendor_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND ord.status = ANY($3::text[]) ORDER BY ord.number, line.position`,
    [workspaceId, projectId, COMMITTED])).rows;
  const billLines = (await db.query<{ invoiceId: string; orderLineId: string | null; total: string; status: string; currency: string }>(
    `SELECT line.invoice_id AS "invoiceId", line.order_line_id AS "orderLineId", line.total::text AS total, invoice.status, trim(invoice.currency) AS currency
       FROM supplier_invoice_lines line JOIN supplier_invoices invoice ON invoice.workspace_id = line.workspace_id AND invoice.id = line.invoice_id
      WHERE line.workspace_id = $1 AND line.project_id = $2`, [workspaceId, projectId])).rows;
  const effective = (line: (typeof lines)[number]) => {
    const quantity = Dec.of(line.quantity);
    if (quantity.isZero()) return Dec.ZERO;
    const left = quantity.sub(line.cancelled);
    return left.cmp(quantity) === 0 ? Dec.of(line.total).round(places) : Dec.of(line.total).mul(left).div(quantity).round(places);
  };
  const ours = lines.filter((line) => line.currency === currency);
  const countedBillLines = billLines.filter((line) => line.currency === currency && COUNTED_BILLS.includes(line.status));
  const orders = [...new Map(ours.map((line) => [line.orderId, line])).values()].map((first) => {
    const mine = ours.filter((line) => line.orderId === first.orderId);
    const committed = mine.reduce((sum, line) => sum.add(effective(line)), Dec.ZERO);
    const billed = countedBillLines.filter((bill) => mine.some((line) => line.id === bill.orderLineId)).reduce((sum, bill) => sum.add(Dec.of(bill.total).round(places)), Dec.ZERO);
    return { id: first.orderId, number: first.number, supplier: first.supplier, status: first.status, committed: fixed(committed), billed: fixed(billed) };
  });
  const checks: JobCosts["checks"] = [];
  for (const line of ours) {
    const billed = countedBillLines.filter((bill) => bill.orderLineId === line.id).reduce((sum, bill) => sum.add(Dec.of(bill.total).round(places)), Dec.ZERO);
    const ordered = effective(line);
    if (billed.cmp(ordered) > 0) checks.push({ kind: "billed_over_order", orderNumber: line.number, description: line.description, ordered: fixed(ordered), billed: fixed(billed) });
  }
  const invoiceIds = [...new Set(billLines.map((line) => line.invoiceId))];
  const invoices = invoiceIds.length ? (await db.query<{ id: string; number: string; supplier: string; status: string; date: string; currency: string; total: string; paid: string;
    elsewhere: boolean; posted: string | null }>(
    `SELECT invoice.id, invoice.number, coalesce(vendor.display_name, vendor.legal_name, '') AS supplier, invoice.status, invoice.invoice_date::text AS date, trim(invoice.currency) AS currency, invoice.total::text AS total,
            coalesce((SELECT sum(allocation.amount) FROM supplier_payment_allocations allocation
                        JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                       WHERE allocation.workspace_id = invoice.workspace_id AND allocation.invoice_id = invoice.id), 0)::text AS paid,
            EXISTS (SELECT 1 FROM supplier_invoice_lines other WHERE other.workspace_id = invoice.workspace_id AND other.invoice_id = invoice.id
                     AND other.project_id IS DISTINCT FROM $2) AS elsewhere,
            (SELECT journal.total::text FROM books_journals journal WHERE journal.workspace_id = invoice.workspace_id AND journal.source_type = 'supplier_bill'
                AND journal.source_id = invoice.id::text AND journal.reverses_journal_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM books_journals reversal WHERE reversal.workspace_id = journal.workspace_id AND reversal.reverses_journal_id = journal.id)
              ORDER BY journal.posted_at DESC LIMIT 1) AS posted
       FROM supplier_invoices invoice LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = invoice.workspace_id AND vendor.id = invoice.vendor_id
      WHERE invoice.workspace_id = $1 AND invoice.id = ANY($3::uuid[]) ORDER BY invoice.invoice_date, invoice.number`, [workspaceId, projectId, invoiceIds])).rows : [];
  const bills = invoices.filter((invoice) => invoice.currency === currency).map((invoice) => {
    // The job's part of a bill: its own lines. A bill only for this job is paid as a whole; a shared one is shown whole.
    const part = billLines.filter((line) => line.invoiceId === invoice.id).reduce((sum, line) => sum.add(Dec.of(line.total).round(places)), Dec.ZERO);
    const paid = Dec.of(invoice.paid).round(places);
    const total = invoice.elsewhere ? Dec.of(invoice.total).round(places) : part;
    const remaining = total.sub(paid).cmp(0) > 0 ? total.sub(paid) : Dec.ZERO;
    if (COUNTED_BILLS.includes(invoice.status)) {
      if (invoice.posted === null) checks.push({ kind: "bill_not_posted", number: invoice.number, total: fixed(Dec.of(invoice.total).round(places)), posted: null });
      else if (Dec.of(invoice.posted).round(places).cmp(Dec.of(invoice.total).round(places)) !== 0)
        checks.push({ kind: "bill_posted_differently", number: invoice.number, total: fixed(Dec.of(invoice.total).round(places)), posted: fixed(Dec.of(invoice.posted).round(places)) });
    }
    return { id: invoice.id, number: invoice.number, supplier: invoice.supplier, status: invoice.status, date: invoice.date, total: fixed(total), paid: fixed(paid), remaining: fixed(remaining),
      shared: invoice.elsewhere };
  });
  // Payments against this job's bills that aren't in the ledger.
  const unposted = invoiceIds.length ? (await db.query<{ reference: string; amount: string }>(
    `SELECT DISTINCT payment.id, coalesce(nullif(payment.reference, ''), payment.paid_on::text) AS reference, payment.amount::text AS amount
       FROM supplier_payments payment JOIN supplier_payment_allocations allocation ON allocation.workspace_id = payment.workspace_id AND allocation.payment_id = payment.id
      WHERE payment.workspace_id = $1 AND allocation.invoice_id = ANY($2::uuid[]) AND payment.status = 'recorded' AND trim(payment.currency) = $3
        AND NOT EXISTS (SELECT 1 FROM books_journals journal WHERE journal.workspace_id = payment.workspace_id AND journal.source_type = 'supplier_payment' AND journal.source_id = payment.id::text)`,
    [workspaceId, invoiceIds, currency])).rows : [];
  for (const payment of unposted) checks.push({ kind: "payment_not_posted", reference: payment.reference, amount: fixed(Dec.of(payment.amount).round(places)) });
  const exclusive = bills.filter((bill) => !bill.shared && COUNTED_BILLS.includes(bill.status));
  const billed = countedBillLines.reduce((sum, line) => sum.add(Dec.of(line.total).round(places)), Dec.ZERO);
  const paid = exclusive.reduce((sum, bill) => sum.add(bill.paid), Dec.ZERO);
  return {
    currency,
    committed: fixed(orders.reduce((sum, order) => sum.add(order.committed), Dec.ZERO)), billed: fixed(billed), paid: fixed(paid),
    toPay: fixed(exclusive.reduce((sum, bill) => sum.add(bill.remaining), Dec.ZERO)),
    orders, bills,
    otherCurrency: new Set([...lines.filter((line) => line.currency !== currency).map((line) => line.orderId), ...invoices.filter((invoice) => invoice.currency !== currency).map((invoice) => invoice.id)]).size,
    checks,
  };
}
