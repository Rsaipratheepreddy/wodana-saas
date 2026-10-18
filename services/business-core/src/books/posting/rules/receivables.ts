import { Dec } from "../../../catalog-core/decimal";
import { splitMilestone, type TaxGroup } from "../../../receivables/receivables";
import type { BooksSettings, Db, JournalDraft, PendingEvent, PostingIssueResult } from "../../ledger/ledger";
import {
  accountId, isIssue, issue, journalExists, Lines, localDay, party, paymentAccount, pendingRows, role, type RuleAdapter, settingsFor, startOf, taxCodeFor,
  textUuid, undo,
} from "../support";

/**
 * Client money (P1 to P4). A milestone's receipts and tax invoices are read as one timeline:
 * - a receipt verified while the milestone has a live invoice settles receivables, otherwise it is an advance
 *   (with VAT counted on it when the company's tax point is the payment);
 * - an invoice moves the advances received before it into receivables, and the VAT already counted on them goes to
 *   the VAT-on-advances contra instead of VAT output, so VAT is counted once;
 * - a credit note reverses its invoice (advances go back to advances);
 * - a reversed receipt reverses its posting, or, once an invoice moved it into receivables, puts the amount back
 *   on receivables.
 */

type Receipt = {
  caseId: string; id: string; paymentId: string; entityId: string | null; currency: string; amount: string; source: string; method: string | null;
  reference: string; verifiedAt: Date | null; rejectedAt: Date | null; verifiedDay: string | null; rejectedDay: string | null;
};
type Invoice = { id: string; issuedAt: Date; creditedAt: Date | null };

const receiptKey = (caseId: string, receiptId: string) => `${caseId}:${receiptId}`;
const RECEIPT_KEY_SQL = `receipt.case_id::text || ':' || receipt.id`;
const PAYMENT_HREF = `'/workspace/pre-projects/cases/' || receipt.case_id::text || '/payment-plan?payment=' || receipt.payment_id`;
const INVOICE_HREF = (alias: string) => `'/workspace/finance/client-invoices?invoice=' || ${alias}.id::text`;
const VERIFIED_AT = `(nullif(receipt.detail->>'verifiedAt', ''))::timestamptz`;
const REJECTED_AT = `(nullif(receipt.detail->>'rejectedAt', ''))::timestamptz`;

/** The receipts and invoices of one milestone. */
async function readMilestone(db: Db, workspaceId: string, caseId: string, paymentId: string) {
  const receipts = (await db.query<Receipt>(
    `SELECT receipt.case_id AS "caseId", receipt.id, receipt.payment_id AS "paymentId", ${textUuid("receipt.legal_entity_id")} AS "entityId", btrim(receipt.currency) AS currency,
            receipt.amount::text AS amount, receipt.source, receipt.detail->>'method' AS method, receipt.reference,
            ${VERIFIED_AT} AS "verifiedAt", ${REJECTED_AT} AS "rejectedAt", ${localDay(VERIFIED_AT)}::text AS "verifiedDay", ${localDay(REJECTED_AT)}::text AS "rejectedDay"
       FROM commercial_receipts receipt
      WHERE receipt.workspace_id = $1 AND receipt.case_id = $2 AND receipt.payment_id = $3 ORDER BY receipt.sort_order, receipt.id`,
    [workspaceId, caseId, paymentId])).rows;
  const invoices = (await db.query<Invoice>(
    `SELECT invoice.id, invoice.issued_at AS "issuedAt",
            (SELECT min(credit.issued_at) FROM client_credit_notes credit WHERE credit.workspace_id = invoice.workspace_id AND credit.invoice_id = invoice.id) AS "creditedAt"
       FROM client_invoices invoice WHERE invoice.workspace_id = $1 AND invoice.case_id = $2 AND invoice.payment_id = $3 ORDER BY invoice.issued_at`,
    [workspaceId, caseId, paymentId])).rows;
  return { receipts, invoices };
}

const time = (value: Date | null) => (value ? value.getTime() : Number.NaN);
/** The milestone had a live (issued, not yet credited) invoice at `at`. */
const liveAt = (invoices: Invoice[], at: Date) => invoices.some((invoice) => time(invoice.issuedAt) <= at.getTime() && !(invoice.creditedAt && time(invoice.creditedAt) <= at.getTime()));
/** The receipt went to client advances when it was verified (no live invoice then). */
const toAdvances = (receipt: Receipt, invoices: Invoice[]) => Boolean(receipt.verifiedAt) && !liveAt(invoices, receipt.verifiedAt!);
/** The advances an invoice moves into receivables: verified before it, still in advances, not reversed by then. */
const advancesFor = (invoice: Invoice, receipts: Receipt[], invoices: Invoice[]) => receipts.filter((receipt) =>
  receipt.verifiedAt && toAdvances(receipt, invoices) && time(receipt.verifiedAt) < time(invoice.issuedAt)
  && !(receipt.rejectedAt && time(receipt.rejectedAt) <= time(invoice.issuedAt)));
/** A live invoice issued after the receipt was verified had moved it into receivables when it was reversed. */
const movedToReceivables = (receipt: Receipt, invoices: Invoice[]) => toAdvances(receipt, invoices) && receipt.rejectedAt !== null && invoices.some((invoice) =>
  time(receipt.verifiedAt) < time(invoice.issuedAt) && time(invoice.issuedAt) <= time(receipt.rejectedAt)
  && !(invoice.creditedAt && time(invoice.creditedAt) <= time(receipt.rejectedAt)));

/** How a receipt splits into net and tax: the sealed quotation's rates, else the quotation's rate, else untaxed. */
async function receiptTaxGroups(db: Db, workspaceId: string, receipt: Pick<Receipt, "caseId" | "paymentId" | "amount" | "currency">): Promise<TaxGroup[]> {
  const sealed = (await db.query<{ pricing: { total: string; taxes: Array<{ rate: string; base: string; tax: string }> } | null }>(
    `SELECT seal.snapshot->'pricing' AS pricing FROM commercial_payments payment
       JOIN delivery_projects project ON project.workspace_id = payment.workspace_id AND project.case_id = payment.case_id
       JOIN project_scope_seals seal ON seal.workspace_id = project.workspace_id AND seal.project_id = project.id AND seal.quote_id = payment.source_quote_id
      WHERE payment.workspace_id = $1 AND payment.case_id = $2 AND payment.id = $3 ORDER BY seal.sealed_at LIMIT 1`,
    [workspaceId, receipt.caseId, receipt.paymentId])).rows[0]?.pricing;
  if (sealed && Array.isArray(sealed.taxes)) {
    return splitMilestone(receipt.amount, { total: String(sealed.total), taxes: sealed.taxes.map((group) => ({ rate: String(group.rate), base: String(group.base), tax: String(group.tax) })) },
      receipt.currency);
  }
  const rate = (await db.query<{ rate: string | null }>(
    `SELECT quote.tax_rate::text AS rate FROM commercial_payments payment
       JOIN commercial_quotes quote ON quote.workspace_id = payment.workspace_id AND quote.case_id = payment.case_id AND quote.id = payment.source_quote_id
      WHERE payment.workspace_id = $1 AND payment.case_id = $2 AND payment.id = $3`, [workspaceId, receipt.caseId, receipt.paymentId])).rows[0]?.rate;
  const amount = Dec.of(receipt.amount);
  if (!rate || Dec.of(rate).isZero()) return [{ rate: "0", net: amount.toFixed(4), tax: "0.0000", total: amount.toFixed(4) }];
  return splitMilestone(receipt.amount, { total: receipt.amount, taxes: [{ rate, base: amount.toFixed(4), tax: "0" }] }, receipt.currency);
}

/** The client and the project of a deal. */
async function dealContext(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ partyId: string | null; projectId: string | null }>(
    `SELECT (SELECT coalesce(opportunity.party_id, opportunity.id) FROM pre_project_cases pre_case
               JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
              WHERE pre_case.workspace_id = $1 AND pre_case.id = $2) AS "partyId",
            (SELECT project.id FROM delivery_projects project WHERE project.workspace_id = $1 AND project.case_id = $2 ORDER BY project.created_at LIMIT 1) AS "projectId"`,
    [workspaceId, caseId])).rows[0];
}

/** The milestone was invoiced outside Wodana (a QuickBooks or Zoho invoice linked to it). */
async function invoicedElsewhere(db: Db, workspaceId: string, caseId: string, paymentId: string) {
  return Boolean((await db.query(
    `SELECT 1 FROM commercial_payments payment WHERE payment.workspace_id = $1 AND payment.case_id = $2 AND payment.id = $3
        AND (jsonb_typeof(payment.detail->'invoice') = 'object'
          OR EXISTS (SELECT 1 FROM commercial_cases cases, jsonb_array_elements(CASE WHEN jsonb_typeof(cases.content->'financeDocuments') = 'array'
                                                                               THEN cases.content->'financeDocuments' ELSE '[]'::jsonb END) document
                      WHERE cases.workspace_id = payment.workspace_id AND cases.case_id = payment.case_id AND document->>'kind' = 'invoice'
                        AND document->>'source' = 'provider' AND document->>'paymentId' = payment.id))`,
    [workspaceId, caseId, paymentId])).rowCount);
}

const receiptMethod = (receipt: Receipt) => (receipt.source === "provider" ? "provider" : receipt.method ?? "bank");

/** P3: the receipt as posted when it was verified. */
async function receiptDraft(db: Db, workspaceId: string, receipt: Receipt, invoices: Invoice[], source: JournalDraft["source"]): Promise<JournalDraft | PostingIssueResult> {
  const settings = await settingsFor(db, workspaceId, receipt.entityId);
  if (isIssue(settings)) return settings;
  if (!invoices.length && await invoicedElsewhere(db, workspaceId, receipt.caseId, receipt.paymentId)) {
    return issue("external_invoice", "This milestone was invoiced in the accounting system: issue its tax invoice here to post the payment.");
  }
  const into = await paymentAccount(db, workspaceId, settings.legalEntityId, "in", receiptMethod(receipt));
  if (isIssue(into)) return into;
  const context = await dealContext(db, workspaceId, receipt.caseId);
  const dimensions = { projectId: context?.projectId ?? null, caseId: receipt.caseId, party: party("client", context?.partyId) };
  const lines = new Lines(receipt.currency).debit(accountId(into), receipt.amount, { ...dimensions, description: receipt.reference });
  if (!toAdvances(receipt, invoices)) {
    lines.credit(role("ar_control"), receipt.amount, dimensions);
  } else {
    lines.credit(role("client_advances"), receipt.amount, dimensions);
    if (settings.taxPointOnPayment) {
      const vat = await advanceVat(db, workspaceId, settings, receipt);
      if (isIssue(vat)) return vat;
      for (const group of vat) {
        lines.debit(role("vat_advance_contra"), group.tax, dimensions);
        lines.credit(role("vat_output"), group.tax, { ...dimensions, taxCodeId: group.taxCodeId, taxBase: group.net, taxRegion: settings.vatRegion });
      }
    }
  }
  return { legalEntityId: settings.legalEntityId, eventDate: receipt.verifiedDay!, source, currency: receipt.currency, description: source.label, lines: lines.lines };
}

/** The VAT on an advance, per rate, with the company's sales tax code (only taxed rates). */
async function advanceVat(db: Db, workspaceId: string, settings: BooksSettings, receipt: Receipt) {
  const out: Array<{ rate: string; net: string; tax: string; taxCodeId: string }> = [];
  for (const group of await receiptTaxGroups(db, workspaceId, receipt)) {
    if (Dec.of(group.tax).isZero()) continue;
    const code = await taxCodeFor(db, workspaceId, settings.legalEntityId, "sales", { rate: group.rate }, receipt.verifiedDay!);
    if (isIssue(code)) return code;
    if (!code) return issue("unknown_tax", `No sales tax code at ${Dec.of(group.rate).toString()}% for this company.`);
    out.push({ rate: Dec.of(group.rate).toString(), net: group.net, tax: group.tax, taxCodeId: code.id });
  }
  return out;
}

/** P1: a tax invoice. */
async function invoiceDraft(db: Db, workspaceId: string, invoiceId: string, source?: JournalDraft["source"]): Promise<JournalDraft | PostingIssueResult> {
  const invoice = (await db.query<{ id: string; entityId: string; projectId: string; caseId: string; paymentId: string; number: string; issueDate: string; currency: string;
    total: string; issuedAt: Date }>(
    `SELECT invoice.id, invoice.legal_entity_id AS "entityId", invoice.project_id AS "projectId", invoice.case_id AS "caseId", invoice.payment_id AS "paymentId",
            invoice.number, invoice.issue_date::text AS "issueDate", btrim(invoice.currency) AS currency, invoice.total::text AS total, invoice.issued_at AS "issuedAt"
       FROM client_invoices invoice WHERE invoice.workspace_id = $1 AND invoice.id = $2`, [workspaceId, invoiceId])).rows[0];
  if (!invoice) return issue("no_entity", "The invoice is no longer there.");
  const settings = await settingsFor(db, workspaceId, invoice.entityId);
  if (isIssue(settings)) return settings;
  const items = (await db.query<{ description: string; taxRate: string; net: string; tax: string }>(
    `SELECT description, tax_rate::text AS "taxRate", net::text AS net, tax::text AS tax FROM client_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position`,
    [workspaceId, invoice.id])).rows;
  const context = await dealContext(db, workspaceId, invoice.caseId);
  const dimensions = { projectId: invoice.projectId, caseId: invoice.caseId, party: party("client", context?.partyId) };
  const { receipts, invoices } = await readMilestone(db, workspaceId, invoice.caseId, invoice.paymentId);
  const self = invoices.find((item) => item.id === invoice.id) ?? { id: invoice.id, issuedAt: invoice.issuedAt, creditedAt: null };
  const advances = advancesFor(self, receipts, invoices);

  // VAT already counted on the advances (tax point on payment), per rate.
  const counted = new Map<string, { tax: Dec; net: Dec }>();
  if (settings.taxPointOnPayment) {
    for (const receipt of advances) {
      if (!receipt.verifiedDay) continue;
      for (const group of await receiptTaxGroups(db, workspaceId, receipt)) {
        const key = Dec.of(group.rate).toString();
        const sum = counted.get(key) ?? { tax: Dec.ZERO, net: Dec.ZERO };
        counted.set(key, { tax: sum.tax.add(group.tax), net: sum.net.add(group.net) });
      }
    }
  }

  const lines = new Lines(invoice.currency).debit(role("ar_control"), invoice.total, dimensions);
  for (const item of items) {
    const code = await taxCodeFor(db, workspaceId, settings.legalEntityId, "sales", { rate: item.taxRate }, invoice.issueDate);
    if (isIssue(code)) return code;
    const tax = Dec.of(item.tax);
    const key = Dec.of(item.taxRate).toString();
    const already = counted.get(key) ?? { tax: Dec.ZERO, net: Dec.ZERO };
    const contra = already.tax.cmp(tax) > 0 ? tax : already.tax;
    const contraNet = already.net.cmp(item.net) > 0 ? Dec.of(item.net) : already.net;
    counted.set(key, { tax: already.tax.sub(contra), net: already.net.sub(contraNet) });
    const output = tax.sub(contra);
    const reportOnNet = Boolean(code) && tax.isZero();
    lines.credit(role("revenue_project"), item.net, { ...dimensions, description: item.description,
      ...(reportOnNet ? { taxCodeId: code!.id, taxBase: Dec.of(item.net).toFixed(4), taxRegion: settings.vatRegion } : {}) });
    if (output.cmp(0) > 0) {
      if (!code) return issue("unknown_tax", `No sales tax code at ${key}% for this company.`);
      lines.credit(role("vat_output"), output, { ...dimensions, taxCodeId: code.id, taxBase: Dec.of(item.net).sub(contraNet).toFixed(4), taxRegion: settings.vatRegion });
    }
    lines.credit(role("vat_advance_contra"), contra, dimensions);
  }
  const advanced = advances.reduce((sum, receipt) => sum.add(receipt.amount), Dec.ZERO);
  const moved = advanced.cmp(invoice.total) > 0 ? Dec.of(invoice.total) : advanced;
  lines.debit(role("client_advances"), moved, { ...dimensions, description: "Advances applied" });
  lines.credit(role("ar_control"), moved, { ...dimensions, description: "Advances applied" });
  return {
    legalEntityId: settings.legalEntityId, eventDate: invoice.issueDate, currency: invoice.currency, description: invoice.number, lines: lines.lines,
    source: source ?? { type: "client_invoice", id: invoice.id, event: "issued", label: invoice.number, href: `/workspace/finance/client-invoices?invoice=${invoice.id}` },
  };
}

async function readReceipt(db: Db, workspaceId: string, sourceId: string) {
  const [caseId, receiptId] = [sourceId.slice(0, 36), sourceId.slice(37)];
  const payment = (await db.query<{ paymentId: string }>(`SELECT payment_id AS "paymentId" FROM commercial_receipts WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [workspaceId, caseId, receiptId])).rows[0];
  if (!payment) return null;
  const milestone = await readMilestone(db, workspaceId, caseId, payment.paymentId);
  const receipt = milestone.receipts.find((item) => item.id === receiptId)!;
  return { receipt, invoices: milestone.invoices };
}

const source = (event: PendingEvent) => ({ type: event.sourceType, id: event.sourceId, event: event.sourceEvent, label: event.label, href: event.href });

/** P3 receipt finance-verified. */
export const receiptVerified: RuleAdapter = {
  rule: "P3",
  sourceType: "receipt",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "receipt", limit,
    `SELECT ${RECEIPT_KEY_SQL} AS source_id, 'verified' AS source_event, ${textUuid("receipt.legal_entity_id")} AS entity_id,
            ${localDay(VERIFIED_AT)} AS event_date, ${VERIFIED_AT} AS at, coalesce(nullif(receipt.reference, ''), payment.title) AS label, ${PAYMENT_HREF} AS href
       FROM commercial_receipts receipt
       JOIN commercial_payments payment ON payment.workspace_id = receipt.workspace_id AND payment.case_id = receipt.case_id AND payment.id = receipt.payment_id
      WHERE receipt.workspace_id = $1 AND receipt.status IN ('finance_verified', 'rejected') AND nullif(receipt.detail->>'verifiedAt', '') IS NOT NULL`),
  build: async (db, workspaceId, event) => {
    const found = await readReceipt(db, workspaceId, event.sourceId);
    if (!found?.receipt.verifiedAt) return issue("no_entity", "The receipt is no longer there.");
    return receiptDraft(db, workspaceId, found.receipt, found.invoices, source(event));
  },
};

/** P1 client invoice issued. */
export const invoiceIssued: RuleAdapter = {
  rule: "P1",
  sourceType: "client_invoice",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "client_invoice", limit,
    `SELECT invoice.id::text AS source_id, 'issued' AS source_event, invoice.legal_entity_id AS entity_id, invoice.issue_date AS event_date, invoice.issued_at AS at,
            invoice.number AS label, ${INVOICE_HREF("invoice")} AS href
       FROM client_invoices invoice WHERE invoice.workspace_id = $1`),
  build: (db, workspaceId, event) => invoiceDraft(db, workspaceId, event.sourceId, source(event)),
};

/** P2 credit note issued: its invoice reversed. */
export const creditNoteIssued: RuleAdapter = {
  rule: "P2",
  sourceType: "client_credit_note",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "client_credit_note", limit,
    `SELECT credit.id::text AS source_id, 'issued' AS source_event, credit.legal_entity_id AS entity_id, credit.issue_date AS event_date, credit.issued_at AS at,
            credit.number AS label, ${INVOICE_HREF("invoice")} AS href
       FROM client_credit_notes credit
       JOIN client_invoices invoice ON invoice.workspace_id = credit.workspace_id AND invoice.id = credit.invoice_id
      WHERE credit.workspace_id = $1
        AND (${journalExists("client_invoice", "invoice.id::text", "issued")} OR invoice.issue_date < ${startOf("invoice.legal_entity_id")})`),
  build: async (db, workspaceId, event) => {
    const credit = (await db.query<{ invoiceId: string; issueDate: string }>(
      `SELECT invoice_id AS "invoiceId", issue_date::text AS "issueDate" FROM client_credit_notes WHERE workspace_id = $1 AND id = $2`, [workspaceId, event.sourceId])).rows[0];
    if (!credit) return issue("no_entity", "The credit note is no longer there.");
    return undo(db, workspaceId, { type: "client_invoice", id: credit.invoiceId, event: "issued" }, { eventDate: credit.issueDate, source: source(event) },
      () => invoiceDraft(db, workspaceId, credit.invoiceId));
  },
};

/** P4 receipt reversed. */
export const receiptReversed: RuleAdapter = {
  rule: "P4",
  sourceType: "receipt",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "receipt", limit,
    `SELECT ${RECEIPT_KEY_SQL} AS source_id, 'reversed' AS source_event, ${textUuid("receipt.legal_entity_id")} AS entity_id,
            ${localDay(REJECTED_AT)} AS event_date, ${REJECTED_AT} AS at, coalesce(nullif(receipt.reference, ''), payment.title) AS label, ${PAYMENT_HREF} AS href
       FROM commercial_receipts receipt
       JOIN commercial_payments payment ON payment.workspace_id = receipt.workspace_id AND payment.case_id = receipt.case_id AND payment.id = receipt.payment_id
      WHERE receipt.workspace_id = $1 AND receipt.status = 'rejected' AND nullif(receipt.detail->>'verifiedAt', '') IS NOT NULL
        AND nullif(receipt.detail->>'rejectedAt', '') IS NOT NULL
        AND (${journalExists("receipt", RECEIPT_KEY_SQL, "verified")} OR ${localDay(VERIFIED_AT)} < ${startOf(textUuid("receipt.legal_entity_id"))})`),
  build: async (db, workspaceId, event) => {
    const found = await readReceipt(db, workspaceId, event.sourceId);
    if (!found?.receipt.verifiedAt || !found.receipt.rejectedDay) return issue("no_entity", "The receipt is no longer there.");
    const { receipt, invoices } = found;
    const input = { eventDate: receipt.rejectedDay!, source: source(event) };
    if (movedToReceivables(receipt, invoices)) {
      // An invoice already moved this advance into receivables: the client owes it again.
      const settings = await settingsFor(db, workspaceId, receipt.entityId);
      if (isIssue(settings)) return settings;
      const into = await paymentAccount(db, workspaceId, settings.legalEntityId, "in", receiptMethod(receipt));
      if (isIssue(into)) return into;
      const context = await dealContext(db, workspaceId, receipt.caseId);
      const dimensions = { projectId: context?.projectId ?? null, caseId: receipt.caseId, party: party("client", context?.partyId) };
      return { legalEntityId: settings.legalEntityId, ...input, currency: receipt.currency, description: event.label,
        lines: new Lines(receipt.currency).debit(role("ar_control"), receipt.amount, dimensions).credit(accountId(into), receipt.amount, { ...dimensions, description: receipt.reference }).lines };
    }
    return undo(db, workspaceId, { type: "receipt", id: event.sourceId, event: "verified" }, input,
      () => receiptDraft(db, workspaceId, receipt, invoices, { type: "receipt", id: event.sourceId, event: "verified" }));
  },
};

export { receiptKey };
