import { Dec } from "../../../catalog-core/decimal";
import { orderUnitPrice } from "../../../purchasing/payables";
import type { Db, DraftLine, JournalDraft, PendingEvent, PostingIssueResult } from "../../ledger/ledger";
import {
  accountId, auditedDay, isIssue, issue, journalExists, Lines, localDay, party, paymentAccount, pendingRows, role, type RuleAdapter, settingsFor, startOf, taxCodeFor,
  undo as undoEvent,
} from "../support";

/**
 * Supplier money (P5 to P8).
 * - An approved bill: order lines clear goods received not invoiced at the order's net price, the difference is a
 *   price variance; charges go to their account, else the project's other costs, else general expenses. Recoverable
 *   tax is VAT input; reverse charge and imports post VAT input and output; tax that can't be recovered is a cost.
 *   Payables carry the bill's total.
 * - A cancelled bill reverses it. A supplier payment (by hand or in a payment run) settles payables from the
 *   account it was paid from; a reversed payment reverses it.
 */

const source = (event: PendingEvent) => ({ type: event.sourceType, id: event.sourceId, event: event.sourceEvent, label: event.label, href: event.href });
const RC = ["reverse_charge", "import_reverse_charge"];

/** P5: an approved supplier bill. */
async function billDraft(db: Db, workspaceId: string, billId: string, source?: JournalDraft["source"]): Promise<JournalDraft | PostingIssueResult> {
  const bill = (await db.query<{ id: string; entityId: string; vendorId: string; number: string; supplier: string; invoiceDate: string; currency: string }>(
    `SELECT bill.id, bill.legal_entity_id AS "entityId", bill.vendor_id AS "vendorId", bill.number, coalesce(vendor.display_name, '') AS supplier,
            bill.invoice_date::text AS "invoiceDate", btrim(bill.currency) AS currency
       FROM supplier_invoices bill LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
      WHERE bill.workspace_id = $1 AND bill.id = $2`, [workspaceId, billId])).rows[0];
  if (!bill) return issue("no_entity", "The supplier invoice is no longer there.");
  const settings = await settingsFor(db, workspaceId, bill.entityId);
  if (isIssue(settings)) return settings;
  const items = (await db.query<{ description: string; quantity: string; net: string; tax: string; taxRate: string; taxCode: string | null; accountId: string | null;
    orderLineId: string | null; unitPrice: string | null; discountPercent: string | null; projectId: string | null }>(
    `SELECT line.description, line.quantity::text AS quantity, line.net::text AS net, line.tax::text AS tax, line.tax_rate::text AS "taxRate", line.tax_code AS "taxCode",
            line.books_account_id AS "accountId", line.order_line_id AS "orderLineId", ordered.unit_price::text AS "unitPrice",
            ordered.discount_percent::text AS "discountPercent", coalesce(ordered.project_id, line.project_id) AS "projectId"
       FROM supplier_invoice_lines line
       LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
      WHERE line.workspace_id = $1 AND line.invoice_id = $2 ORDER BY line.position, line.id`, [workspaceId, bill.id])).rows;
  const vendor = party("vendor", bill.vendorId);
  const lines = new Lines(bill.currency);
  let payable = Dec.ZERO;
  for (const item of items) {
    const code = await taxCodeFor(db, workspaceId, settings.legalEntityId, "purchases", { code: item.taxCode, rate: item.taxRate }, bill.invoiceDate);
    if (isIssue(code)) return code;
    const net = Dec.of(item.net), tax = Dec.of(item.tax);
    const dimensions = { projectId: item.projectId, description: item.description };
    let cost = Dec.ZERO; // tax that can't be recovered
    let taxLine = false;
    if (code && RC.includes(code.treatment)) {
      // Reverse charge and imports: the company accounts for the supplier's VAT itself, on both sides.
      const selfTax = net.mul(code.rate).div(100).round(lines.places);
      const tagged = { ...dimensions, taxCodeId: code.id, taxBase: net.toFixed(4), taxRegion: settings.vatRegion };
      if (code.recoverable) lines.debit(role("vat_input"), selfTax, tagged); else cost = cost.add(selfTax);
      lines.credit(role("vat_output"), selfTax, tagged);
      cost = cost.add(tax);
      taxLine = !selfTax.isZero();
    } else if (!tax.isZero()) {
      if (!code || Dec.of(code.rate).isZero()) return issue("unknown_tax", `${item.description}: tax of ${tax.toString()} has no tax code. Choose one on the invoice line.`);
      if (code.recoverable) {
        lines.debit(role("vat_input"), tax, { ...dimensions, taxCodeId: code.id, taxBase: net.toFixed(4), taxRegion: settings.vatRegion });
        taxLine = true;
      } else cost = cost.add(tax);
    }
    // A code with no tax line (zero-rated, exempt...) is reported on the net line.
    const report: Partial<DraftLine> = code && !taxLine ? { taxCodeId: code.id, taxBase: net.toFixed(4), taxRegion: settings.vatRegion } : {};
    const chargeAccount = item.accountId ? accountId(item.accountId) : role(item.projectId ? "cost_other" : "general_expense");
    if (item.orderLineId && item.unitPrice !== null) {
      const cleared = Dec.of(item.quantity).mul(orderUnitPrice({ unitPrice: item.unitPrice, discountPercent: item.discountPercent ?? "0" })).round(lines.places);
      lines.debit(role("grni"), cleared, { ...dimensions, ...report });
      lines.debit(role("cost_price_variance"), net.sub(cleared), dimensions);
      lines.debit(chargeAccount, cost, dimensions);
    } else {
      lines.debit(chargeAccount, net.add(cost), { ...dimensions, ...report });
    }
    payable = payable.add(net).add(tax);
  }
  lines.credit(role("ap_control"), payable, { party: vendor, description: bill.number });
  return {
    legalEntityId: settings.legalEntityId, eventDate: bill.invoiceDate, currency: bill.currency, description: `${bill.supplier} ${bill.number}`.trim(), lines: lines.lines,
    source: source ?? { type: "supplier_bill", id: bill.id, event: "approved", label: `${bill.supplier} ${bill.number}`.trim(), href: `/workspace/finance/bills?bill=${bill.id}` },
  };
}

const BILL_LABEL = `btrim(coalesce(vendor.display_name, '') || ' ' || bill.number)`;
const BILL_FROM = `FROM supplier_invoices bill LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id`;
const CANCELLED_ON = `coalesce(${auditedDay("supplier_invoice", "supplier_invoice.cancelled", "bill.id")}, ${localDay("now()")})`;

/** P5 supplier bill approved (dated its invoice date). */
export const billApproved: RuleAdapter = {
  rule: "P5",
  sourceType: "supplier_bill",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "supplier_bill", limit,
    `SELECT bill.id::text AS source_id, 'approved' AS source_event, bill.legal_entity_id AS entity_id, bill.invoice_date AS event_date, bill.approved_at AS at,
            ${BILL_LABEL} AS label, '/workspace/finance/bills?bill=' || bill.id::text AS href
       ${BILL_FROM} WHERE bill.workspace_id = $1 AND bill.approved_at IS NOT NULL AND bill.status IN ('approved', 'cancelled')`),
  build: (db, workspaceId, event) => billDraft(db, workspaceId, event.sourceId, source(event)),
};

/** P6 bill cancelled: the approval reversed. */
export const billCancelled: RuleAdapter = {
  rule: "P6",
  sourceType: "supplier_bill",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "supplier_bill", limit,
    `SELECT bill.id::text AS source_id, 'cancelled' AS source_event, bill.legal_entity_id AS entity_id, ${CANCELLED_ON} AS event_date, now() AS at,
            ${BILL_LABEL} AS label, '/workspace/finance/bills?bill=' || bill.id::text AS href
       ${BILL_FROM} WHERE bill.workspace_id = $1 AND bill.approved_at IS NOT NULL AND bill.status = 'cancelled'
        AND (${journalExists("supplier_bill", "bill.id::text", "approved")} OR bill.invoice_date < ${startOf("bill.legal_entity_id")})`),
  build: async (db, workspaceId, event) => undo(db, workspaceId, event, () => billDraft(db, workspaceId, event.sourceId)),
};

/** P7: a supplier payment. */
async function paymentDraft(db: Db, workspaceId: string, paymentId: string, source?: JournalDraft["source"]): Promise<JournalDraft | PostingIssueResult> {
  const payment = (await db.query<{ id: string; entityId: string; vendorId: string; paidOn: string; currency: string; amount: string; method: string; reference: string;
    paidFrom: string | null; label: string; href: string }>(
    `SELECT payment.id, payment.legal_entity_id AS "entityId", payment.vendor_id AS "vendorId", payment.paid_on::text AS "paidOn", btrim(payment.currency) AS currency,
            payment.amount::text AS amount, payment.method, payment.reference, payment.paid_from_account_id AS "paidFrom", ${PAYMENT_LABEL} AS label, ${PAYMENT_HREF} AS href
       ${PAYMENT_FROM} WHERE payment.workspace_id = $1 AND payment.id = $2`, [workspaceId, paymentId])).rows[0];
  if (!payment) return issue("no_entity", "The supplier payment is no longer there.");
  const settings = await settingsFor(db, workspaceId, payment.entityId);
  if (isIssue(settings)) return settings;
  const from = payment.paidFrom ?? await paymentAccount(db, workspaceId, settings.legalEntityId, "out", payment.method);
  if (isIssue(from)) return from;
  const vendor = party("vendor", payment.vendorId);
  return {
    legalEntityId: settings.legalEntityId, eventDate: payment.paidOn, currency: payment.currency, description: payment.label,
    lines: new Lines(payment.currency).debit(role("ap_control"), payment.amount, { party: vendor, description: payment.reference })
      .credit(accountId(from), payment.amount, { party: vendor, description: payment.reference }).lines,
    source: source ?? { type: "supplier_payment", id: payment.id, event: "paid", label: payment.label, href: payment.href },
  };
}

const PAYMENT_FROM = `FROM supplier_payments payment
  LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = payment.workspace_id AND vendor.id = payment.vendor_id
  LEFT JOIN payment_runs run ON run.workspace_id = payment.workspace_id AND run.id = payment.run_id`;
const PAYMENT_LABEL = `btrim(coalesce(vendor.display_name, '') || ' ' || CASE WHEN run.id IS NOT NULL THEN 'PR-' || lpad(run.number::text, 4, '0') ELSE payment.reference END)`;
const PAYMENT_HREF = `CASE WHEN run.id IS NOT NULL THEN '/workspace/finance/runs?run=' || run.id::text ELSE '/workspace/finance/suppliers/' || payment.vendor_id::text END`;
const REVERSED_ON = `coalesce(${auditedDay("supplier_payment", "supplier_payment.reversed", "payment.id")}, ${localDay("now()")})`;

/** P7 supplier payment (by hand or in a payment run). */
export const paymentPaid: RuleAdapter = {
  rule: "P7",
  sourceType: "supplier_payment",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "supplier_payment", limit,
    `SELECT payment.id::text AS source_id, 'paid' AS source_event, payment.legal_entity_id AS entity_id, payment.paid_on AS event_date, payment.created_at AS at,
            ${PAYMENT_LABEL} AS label, ${PAYMENT_HREF} AS href
       ${PAYMENT_FROM} WHERE payment.workspace_id = $1`),
  build: (db, workspaceId, event) => paymentDraft(db, workspaceId, event.sourceId, source(event)),
};

/** P8 payment reversed. */
export const paymentReversed: RuleAdapter = {
  rule: "P8",
  sourceType: "supplier_payment",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "supplier_payment", limit,
    `SELECT payment.id::text AS source_id, 'reversed' AS source_event, payment.legal_entity_id AS entity_id, ${REVERSED_ON} AS event_date, now() AS at,
            ${PAYMENT_LABEL} AS label, ${PAYMENT_HREF} AS href
       ${PAYMENT_FROM} WHERE payment.workspace_id = $1 AND payment.status = 'reversed'
        AND (${journalExists("supplier_payment", "payment.id::text", "paid")} OR payment.paid_on < ${startOf("payment.legal_entity_id")})`),
  build: async (db, workspaceId, event) => undo(db, workspaceId, event, () => paymentDraft(db, workspaceId, event.sourceId)),
};

/** The original event an undo event reverses, and its own day and source. */
function undo(db: Db, workspaceId: string, event: PendingEvent, rebuild: () => Promise<JournalDraft | PostingIssueResult>) {
  const original = event.sourceType === "supplier_bill" ? "approved" : "paid";
  return undoEvent(db, workspaceId, { type: event.sourceType, id: event.sourceId, event: original }, { eventDate: event.eventDate, source: source(event) }, rebuild);
}
