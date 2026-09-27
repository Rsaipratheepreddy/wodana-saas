import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals, priceLine } from "./orders";

type Db = Pick<PoolClient, "query">;

export type BillStatus = "draft" | "held" | "approved" | "cancelled";
export type BillRow = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; number: string; invoiceDate: string; dueDate: string | null; currency: string;
  net: string; tax: string; total: string; statedTotal: string | null; status: BillStatus; holdReasons: string; approvedByName: string | null; approvedAt: string | null; approvalNote: string;
  cancelReason: string | null; fileName: string | null; createdBy: string; createdByName: string; createdAt: string; version: number;
  /** Paid on it so far (by payments that weren't reversed), and what's left. */
  paid: string; balance: string;
  orders: string[];
};
export type BillLine = {
  id: string; position: number; orderLineId: string | null; orderId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null;
  description: string; unit: string | null; quantity: string; unitPrice: string; taxRate: string; net: string; tax: string; total: string;
};

/** Today in the workspace's own time zone. */
const TODAY = `(now() AT TIME ZONE coalesce((SELECT nullif(default_timezone, '') FROM workspaces WHERE id = $1), 'UTC'))::date`;

const BILL_SELECT = `SELECT bill.id, bill.vendor_id AS "vendorId", vendor.display_name AS "supplierName", bill.legal_entity_id AS "legalEntityId", company.display_name AS "companyName",
  bill.number, bill.invoice_date::text AS "invoiceDate", bill.due_date::text AS "dueDate", bill.currency, bill.net::text AS net, bill.tax::text AS tax, bill.total::text AS total,
  bill.stated_total::text AS "statedTotal", bill.status, bill.hold_reasons AS "holdReasons", approver.display_name AS "approvedByName", bill.approved_at AS "approvedAt",
  bill.approval_note AS "approvalNote", bill.cancel_reason AS "cancelReason", bill.file_name AS "fileName", bill.created_by AS "createdBy", creator.display_name AS "createdByName",
  bill.created_at AS "createdAt", bill.version,
  coalesce(paid.amount, 0)::numeric(18, 4)::text AS paid, (bill.total - coalesce(paid.amount, 0))::numeric(18, 4)::text AS balance,
  coalesce((SELECT array_agg(DISTINCT purchase.number ORDER BY purchase.number) FROM supplier_invoice_lines line
              JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
              JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
             WHERE line.workspace_id = bill.workspace_id AND line.invoice_id = bill.id), '{}') AS orders
  FROM supplier_invoices bill
  JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
  JOIN legal_entities company ON company.workspace_id = bill.workspace_id AND company.id = bill.legal_entity_id
  JOIN users creator ON creator.id = bill.created_by
  LEFT JOIN users approver ON approver.id = bill.approved_by
  LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                       JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                      WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true`;

export async function readBills(db: Db, workspaceId: string, filter: { id?: string; vendorId?: string; orderId?: string } = {}): Promise<BillRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["bill.workspace_id = $1"];
  if (filter.id) { values.push(filter.id); where.push(`bill.id = $${values.length}`); }
  if (filter.vendorId) { values.push(filter.vendorId); where.push(`bill.vendor_id = $${values.length}`); }
  if (filter.orderId) {
    values.push(filter.orderId);
    where.push(`EXISTS (SELECT 1 FROM supplier_invoice_lines line JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
                         WHERE line.workspace_id = bill.workspace_id AND line.invoice_id = bill.id AND ordered.order_id = $${values.length})`);
  }
  return (await db.query<BillRow>(`${BILL_SELECT} WHERE ${where.join(" AND ")} ORDER BY bill.invoice_date DESC, bill.created_at DESC LIMIT 1000`, values)).rows;
}

export async function readBillLines(db: Db, workspaceId: string, billId: string): Promise<BillLine[]> {
  return (await db.query<BillLine>(
    `SELECT line.id, line.position, line.order_line_id AS "orderLineId", ordered.order_id AS "orderId", purchase.number AS "orderNumber", line.project_id AS "projectId",
            project.reference AS "projectReference", line.description, ordered.unit, line.quantity::text AS quantity, line.unit_price::text AS "unitPrice", line.tax_rate::text AS "taxRate",
            line.net::text AS net, line.tax::text AS tax, line.total::text AS total
       FROM supplier_invoice_lines line
       LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
       LEFT JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.invoice_id = $2 ORDER BY line.position, line.id`, [workspaceId, billId])).rows;
}

/**
 * An order line as the supplier may invoice it: what was accepted (less accepted goods sent back), what
 * the supplier credited, and what's on invoices. `billed` counts held and approved invoices (and the one
 * being checked); drafts don't hold quantity. `approvedBilled` counts approved invoices only.
 */
export type InvoiceableLine = {
  orderLineId: string; orderId: string; orderNumber: string; vendorId: string; legalEntityId: string; currency: string; projectId: string | null; projectReference: string | null;
  description: string; unit: string; ordered: string; unitPrice: string; discountPercent: string; taxRate: string;
  accepted: string; credited: string; creditValue: string; billed: string; approvedBilled: string;
};

async function readInvoiceableLines(db: Db, workspaceId: string, filter: { orderId?: string; orderLineIds?: string[]; vendorId?: string | null; creditedOnly?: boolean }, includeBill: string | null) {
  const values: unknown[] = [workspaceId, includeBill];
  const where = ["line.workspace_id = $1"];
  if (filter.orderId) { values.push(filter.orderId); where.push(`line.order_id = $${values.length}`); }
  if (filter.orderLineIds) { values.push(filter.orderLineIds); where.push(`line.id = ANY($${values.length}::uuid[])`); }
  if (filter.vendorId) { values.push(filter.vendorId); where.push(`purchase.vendor_id = $${values.length}`); }
  if (filter.creditedOnly) where.push(`coalesce(back.credited, 0) > 0`);
  return (await db.query<InvoiceableLine>(
    `SELECT line.id AS "orderLineId", line.order_id AS "orderId", purchase.number AS "orderNumber", purchase.vendor_id AS "vendorId", purchase.legal_entity_id AS "legalEntityId",
            purchase.currency, line.project_id AS "projectId", project.reference AS "projectReference", line.description, line.unit, line.quantity::text AS ordered,
            line.unit_price::text AS "unitPrice", line.discount_percent::text AS "discountPercent", line.tax_rate::text AS "taxRate",
            (coalesce(got.accepted, 0) - coalesce(back.returned_accepted, 0))::numeric(18, 4)::text AS accepted,
            coalesce(back.credited, 0)::numeric(18, 4)::text AS credited, coalesce(back.value, 0)::numeric(18, 4)::text AS "creditValue",
            coalesce(billed.quantity, 0)::numeric(18, 4)::text AS billed, coalesce(billed.approved, 0)::numeric(18, 4)::text AS "approvedBilled"
       FROM purchase_order_lines line
       JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN LATERAL (SELECT sum(item.accepted) AS accepted FROM goods_receipt_lines item
                            JOIN goods_receipts receipt ON receipt.workspace_id = item.workspace_id AND receipt.id = item.receipt_id AND receipt.reversed_at IS NULL
                           WHERE item.workspace_id = line.workspace_id AND item.order_line_id = line.id) got ON true
       LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE item.source = 'accepted' AND sent.status = 'sent') AS returned_accepted,
                                 sum(item.quantity) FILTER (WHERE sent.outcome = 'credit' AND (sent.status = 'sent' OR (sent.status = 'open' AND item.source = 'rejected'))) AS credited,
                                 sum(coalesce(item.credit_amount, 0) + coalesce(item.credit_tax, 0))
                                   FILTER (WHERE sent.outcome = 'credit' AND (sent.status = 'sent' OR (sent.status = 'open' AND item.source = 'rejected'))) AS value
                            FROM supplier_return_lines item JOIN supplier_returns sent ON sent.workspace_id = item.workspace_id AND sent.id = item.return_id
                           WHERE item.workspace_id = line.workspace_id AND item.order_line_id = line.id) back ON true
       LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE bill.status IN ('held', 'approved') OR bill.id = $2::uuid) AS quantity,
                                 sum(item.quantity) FILTER (WHERE bill.status = 'approved') AS approved
                            FROM supplier_invoice_lines item JOIN supplier_invoices bill ON bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id
                           WHERE item.workspace_id = line.workspace_id AND item.order_line_id = line.id) billed ON true
      WHERE ${where.join(" AND ")} ORDER BY purchase.number, line.position, line.id`, values)).rows;
}

/** The order's price for one unit, after its discount and before tax. */
export function orderUnitPrice(line: Pick<InvoiceableLine, "unitPrice" | "discountPercent">) {
  return Dec.of(line.unitPrice).mul(Dec.of(100).sub(line.discountPercent)).div(100);
}

/**
 * What the supplier can still invoice for a line: what was accepted, plus what they credited (a credit
 * after invoicing is settled by a debit note), less what's on held or approved invoices already.
 */
export function invoiceable(line: Pick<InvoiceableLine, "accepted" | "credited" | "billed">) {
  const left = Dec.of(line.accepted).add(line.credited).sub(line.billed);
  return left.isNegative() ? Dec.ZERO : left;
}

/**
 * The part of a line's credit that settles invoiced goods — a debit note: the approved invoiced quantity
 * beyond what was kept, up to what was credited. Nothing when the supplier invoiced only what was kept.
 */
export function debitNote(line: Pick<InvoiceableLine, "accepted" | "credited" | "creditValue" | "approvedBilled" | "currency">) {
  const credited = Dec.of(line.credited);
  const beyond = Dec.of(line.approvedBilled).sub(line.accepted);
  if (credited.cmp(0) <= 0 || beyond.cmp(0) <= 0) return { quantity: Dec.ZERO, amount: Dec.ZERO };
  const quantity = beyond.cmp(credited) < 0 ? beyond : credited;
  const amount = quantity.cmp(credited) === 0 ? Dec.of(line.creditValue) : Dec.of(line.creditValue).mul(quantity).div(credited).round(currencyDecimals(line.currency));
  return { quantity, amount };
}

/** An order's lines as the supplier may still invoice them, at the order's price and tax. */
export async function readInvoiceable(db: Db, workspaceId: string, orderId: string) {
  return (await readInvoiceableLines(db, workspaceId, { orderId }, null)).map((line) => ({
    ...line, left: invoiceable(line).toString(), netUnitPrice: orderUnitPrice(line).round(4).toString(),
  }));
}

/**
 * The three-way match of an invoice: each order line invoiced no more than was accepted (plus what the
 * supplier credited), at the order's price within the tolerance and at the order's tax rate. Lines not on
 * an order, goods not received yet, and a stated total the lines don't add up to all need approval.
 * Returns why it's held — empty when it matches.
 */
export async function matchBill(db: Db, workspaceId: string, bill: { id: string; total: string; statedTotal: string | null; currency: string }, tolerancePercent: string) {
  const lines = await readBillLines(db, workspaceId, bill.id);
  const reasons: string[] = [];
  const ordered = new Map((await readInvoiceableLines(db, workspaceId, { orderLineIds: lines.flatMap((line) => line.orderLineId ? [line.orderLineId] : []) }, bill.id))
    .map((line) => [line.orderLineId, line]));
  const seen = new Set<string>();
  for (const line of lines) {
    const order = line.orderLineId ? ordered.get(line.orderLineId) : undefined;
    if (!order) { reasons.push(`${line.description}: not on an order`); continue; }
    const quantity = (value: Dec | string) => `${Dec.of(value).toString()} ${order.unit}`.trim();
    if (!seen.has(order.orderLineId)) {
      seen.add(order.orderLineId);
      const ceiling = Dec.of(order.accepted).add(order.credited);
      if (ceiling.isZero()) reasons.push(`${line.description}: nothing received yet`);
      else if (Dec.of(order.billed).cmp(ceiling) > 0) reasons.push(`${line.description}: invoiced ${quantity(order.billed)}, received ${quantity(ceiling)}`);
    }
    const price = orderUnitPrice(order);
    if (Dec.of(line.unitPrice).cmp(price.mul(Dec.of(100).add(tolerancePercent)).div(100)) > 0)
      reasons.push(`${line.description}: ${Dec.of(line.unitPrice).toString()} a unit, ordered at ${price.round(4).toString()}`);
    if (Dec.of(line.taxRate).cmp(order.taxRate) !== 0) reasons.push(`${line.description}: tax ${Dec.of(line.taxRate).toString()}%, ordered at ${Dec.of(order.taxRate).toString()}%`);
  }
  if (bill.statedTotal !== null && Dec.of(bill.statedTotal).cmp(bill.total) !== 0) {
    const places = currencyDecimals(bill.currency);
    reasons.push(`Invoice total ${Dec.of(bill.statedTotal).toFixed(places)}, lines add up to ${Dec.of(bill.total).toFixed(places)}`);
  }
  return reasons;
}

/** A line's amounts on a supplier's invoice (no discount; the invoice's own net price). */
export function priceBillLine(line: { quantity: string; unitPrice: string; taxRate: string }, currency: string) {
  const { net, tax, total } = priceLine({ ...line, discountPercent: "0" }, currencyDecimals(currency));
  return { net, tax, total };
}

/** Debit notes: a supplier's credits for goods they had already invoiced, per order line. */
export async function readDebitNotes(db: Db, workspaceId: string, vendorId: string | null = null) {
  return (await readInvoiceableLines(db, workspaceId, { vendorId, creditedOnly: true }, null)).flatMap((line) => {
    const note = debitNote(line);
    return note.amount.cmp(0) > 0 ? [{ ...line, quantity: note.quantity.toString(), amount: note.amount.toFixed(4) }] : [];
  });
}

export type SupplierBalance = {
  vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string;
  invoiced: string; paid: string; debited: string; owed: string; overdue: string; held: string;
};

/**
 * What each supplier is owed, per buying company and currency: approved invoices, less payments that
 * weren't reversed, less debit notes. Payments not yet on an invoice (advances) show as owed below zero;
 * overdue is what's still open on invoices past their due date, never more than is owed.
 */
export async function readSupplierBalances(db: Db, workspaceId: string, vendorId: string | null = null): Promise<SupplierBalance[]> {
  const rows = (await db.query<Omit<SupplierBalance, "debited" | "owed" | "overdue"> & { dueOpen: string }>(
    `WITH bills AS (
       SELECT bill.vendor_id, bill.legal_entity_id, bill.currency,
              sum(bill.total) FILTER (WHERE bill.status = 'approved') AS invoiced,
              sum(bill.total) FILTER (WHERE bill.status = 'held') AS held,
              sum(bill.total - coalesce(paid.amount, 0)) FILTER (WHERE bill.status = 'approved' AND bill.due_date < ${TODAY}) AS due_open
         FROM supplier_invoices bill
         LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                              JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                             WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true
        WHERE bill.workspace_id = $1 AND bill.status IN ('approved', 'held') GROUP BY bill.vendor_id, bill.legal_entity_id, bill.currency
     ), paid AS (
       SELECT vendor_id, legal_entity_id, currency, sum(amount) AS paid FROM supplier_payments WHERE workspace_id = $1 AND status = 'recorded' GROUP BY vendor_id, legal_entity_id, currency
     ), keys AS (SELECT vendor_id, legal_entity_id, currency FROM bills UNION SELECT vendor_id, legal_entity_id, currency FROM paid)
     SELECT keys.vendor_id AS "vendorId", vendor.display_name AS "supplierName", keys.legal_entity_id AS "legalEntityId", company.display_name AS "companyName", keys.currency,
            coalesce(bills.invoiced, 0)::numeric(18, 4)::text AS invoiced, coalesce(paid.paid, 0)::numeric(18, 4)::text AS paid, coalesce(bills.held, 0)::numeric(18, 4)::text AS held,
            coalesce(bills.due_open, 0)::numeric(18, 4)::text AS "dueOpen"
       FROM keys
       JOIN workspace_vendors vendor ON vendor.workspace_id = $1 AND vendor.id = keys.vendor_id
       JOIN legal_entities company ON company.workspace_id = $1 AND company.id = keys.legal_entity_id
       LEFT JOIN bills ON bills.vendor_id = keys.vendor_id AND bills.legal_entity_id = keys.legal_entity_id AND bills.currency = keys.currency
       LEFT JOIN paid ON paid.vendor_id = keys.vendor_id AND paid.legal_entity_id = keys.legal_entity_id AND paid.currency = keys.currency
      WHERE ($2::uuid IS NULL OR keys.vendor_id = $2) ORDER BY vendor.display_name, company.display_name, keys.currency`, [workspaceId, vendorId])).rows;
  const debits = new Map<string, Dec>();
  for (const note of await readDebitNotes(db, workspaceId, vendorId)) {
    const key = `${note.vendorId}|${note.legalEntityId}|${note.currency}`;
    debits.set(key, (debits.get(key) ?? Dec.ZERO).add(note.amount));
  }
  return rows.map(({ dueOpen, ...row }) => {
    const debited = debits.get(`${row.vendorId}|${row.legalEntityId}|${row.currency}`) ?? Dec.ZERO;
    const owed = Dec.of(row.invoiced).sub(row.paid).sub(debited);
    const overdue = Dec.of(dueOpen).cmp(owed) < 0 ? Dec.of(dueOpen) : owed;
    return { ...row, debited: debited.toFixed(4), owed: owed.toFixed(4), overdue: (overdue.isNegative() ? Dec.ZERO : overdue).toFixed(4) };
  });
}

export type SupplierPayment = {
  id: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; paidOn: string; currency: string; amount: string; method: string; reference: string;
  orderId: string | null; orderNumber: string | null; status: "recorded" | "reversed"; reverseReason: string | null; createdBy: string; createdByName: string; allocated: string; unallocated: string;
  allocations: Array<{ invoiceId: string; number: string; amount: string }>;
};

export async function readPayments(db: Db, workspaceId: string, filter: { id?: string; vendorId?: string; invoiceId?: string } = {}): Promise<SupplierPayment[]> {
  const values: unknown[] = [workspaceId];
  const where = ["payment.workspace_id = $1"];
  if (filter.id) { values.push(filter.id); where.push(`payment.id = $${values.length}`); }
  if (filter.vendorId) { values.push(filter.vendorId); where.push(`payment.vendor_id = $${values.length}`); }
  if (filter.invoiceId) {
    values.push(filter.invoiceId);
    where.push(`EXISTS (SELECT 1 FROM supplier_payment_allocations item WHERE item.workspace_id = payment.workspace_id AND item.payment_id = payment.id AND item.invoice_id = $${values.length})`);
  }
  const rows = (await db.query<Omit<SupplierPayment, "allocations">>(
    `SELECT payment.id, payment.vendor_id AS "vendorId", vendor.display_name AS "supplierName", payment.legal_entity_id AS "legalEntityId", company.display_name AS "companyName",
            payment.paid_on::text AS "paidOn", payment.currency, payment.amount::text AS amount, payment.method, payment.reference, payment.order_id AS "orderId", purchase.number AS "orderNumber",
            payment.status, payment.reverse_reason AS "reverseReason", payment.created_by AS "createdBy", creator.display_name AS "createdByName",
            coalesce(allocated.amount, 0)::numeric(18, 4)::text AS allocated, (payment.amount - coalesce(allocated.amount, 0))::numeric(18, 4)::text AS unallocated
       FROM supplier_payments payment
       JOIN workspace_vendors vendor ON vendor.workspace_id = payment.workspace_id AND vendor.id = payment.vendor_id
       JOIN legal_entities company ON company.workspace_id = payment.workspace_id AND company.id = payment.legal_entity_id
       JOIN users creator ON creator.id = payment.created_by
       LEFT JOIN purchase_orders purchase ON purchase.workspace_id = payment.workspace_id AND purchase.id = payment.order_id
       LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_payment_allocations WHERE workspace_id = payment.workspace_id AND payment_id = payment.id) allocated ON true
      WHERE ${where.join(" AND ")} ORDER BY payment.paid_on DESC, payment.created_at DESC LIMIT 1000`, values)).rows;
  if (!rows.length) return [];
  const allocations = (await db.query<{ paymentId: string; invoiceId: string; number: string; amount: string }>(
    `SELECT allocation.payment_id AS "paymentId", allocation.invoice_id AS "invoiceId", bill.number, allocation.amount::text AS amount
       FROM supplier_payment_allocations allocation JOIN supplier_invoices bill ON bill.workspace_id = allocation.workspace_id AND bill.id = allocation.invoice_id
      WHERE allocation.workspace_id = $1 AND allocation.payment_id = ANY($2::uuid[]) ORDER BY allocation.created_at, allocation.id`, [workspaceId, rows.map((row) => row.id)])).rows;
  return rows.map((row) => ({ ...row, allocations: allocations.filter((item) => item.paymentId === row.id).map(({ paymentId: _paymentId, ...item }) => item) }));
}

/** Approved invoices with something left to pay, due within `days` (overdue ones included), for the daily reminder. */
export async function readBillsDue(db: Db, workspaceId: string, days: number) {
  return (await db.query<{ id: string; vendorId: string; supplierName: string; number: string; dueDate: string; currency: string; balance: string; overdue: boolean }>(
    `SELECT bill.id, bill.vendor_id AS "vendorId", vendor.display_name AS "supplierName", bill.number, bill.due_date::text AS "dueDate", bill.currency,
            (bill.total - coalesce(paid.amount, 0))::numeric(18, 4)::text AS balance, bill.due_date < ${TODAY} AS overdue
       FROM supplier_invoices bill
       JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
       LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                            JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                           WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true
      WHERE bill.workspace_id = $1 AND bill.status = 'approved' AND bill.due_date IS NOT NULL AND bill.due_date <= ${TODAY} + $2::int
        AND bill.total > coalesce(paid.amount, 0)
      ORDER BY bill.due_date, vendor.display_name, bill.number`, [workspaceId, days])).rows;
}
