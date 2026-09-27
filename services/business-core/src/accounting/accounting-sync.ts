import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { currencyDecimals } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

export type PostingKind = "invoice" | "credit_note" | "invoice_payment" | "bill" | "bill_payment" | "bill_payment_void";
type Link = { id: string; legalEntityId: string; connectionId: string; provider: "quickbooks" | "zoho_books"; startDate: string; salesItemId: string | null;
  expenseAccountId: string | null; paymentsAccountId: string | null; depositAccountId: string | null; companyName: string };
type Contact = { kind: "customer" | "vendor"; providerId: string | null; name: string; email: string | null; taxNumber: string | null; currency: string };
/** What the worker sends to the accounting system for one posting (the contract with the integration worker). */
export type ClaimedPosting = {
  id: string; leaseToken: string; workspaceId: string; connectionId: string; provider: Link["provider"]; kind: PostingKind; attempt: number; marker: string;
  contact: Contact | null; document: Record<string, unknown>;
};

/** Up to this many attempts are retried by themselves; after that a posting waits for someone to retry it. */
export const MAX_AUTOMATIC_ATTEMPTS = 8;

/** A posting's short, stable marker for finding what it created in the accounting system (W + the first 8 hex digits of its id). */
export const marker = (id: string) => `W${id.replace(/-/g, "").slice(0, 8)}`;

/** Minutes before a retryable failure is tried again: doubling from one minute, at most six hours. */
export const retryDelayMinutes = (attempts: number) => Math.min(2 ** Math.max(attempts - 1, 0), 360);

async function readLinks(db: Db, workspaceId: string) {
  return (await db.query<Link>(
    `SELECT link.id, link.legal_entity_id AS "legalEntityId", link.connection_id AS "connectionId", connection.provider, link.start_date::text AS "startDate",
            link.sales_item_id AS "salesItemId", link.expense_account_id AS "expenseAccountId", link.payments_account_id AS "paymentsAccountId",
            link.deposit_account_id AS "depositAccountId", entity.display_name AS "companyName"
       FROM accounting_links link
       JOIN integration_connections connection ON connection.id = link.connection_id AND connection.workspace_id = link.workspace_id
        AND connection.provider IN ('quickbooks', 'zoho_books') AND connection.status IN ('connected', 'degraded')
       JOIN legal_entities entity ON entity.workspace_id = link.workspace_id AND entity.id = link.legal_entity_id
      WHERE link.workspace_id = $1 AND link.active`, [workspaceId])).rows;
}

/**
 * Adds a posting for everything each company has to post that doesn't have one yet (safe to run any
 * number of times), and cancels supplier payment postings whose payment was reversed before it was sent.
 */
export async function enqueuePostings(db: Db, workspaceId: string) {
  for (const link of await readLinks(db, workspaceId)) {
    const add = (kind: PostingKind, select: string, values: unknown[] = []) => db.query(
      `INSERT INTO accounting_postings (id, workspace_id, link_id, kind, source_id, depends_on, document_date, expected_total)
       SELECT gen_random_uuid(), $1, $2, '${kind}', source.id, source.depends_on, source.document_on, source.total FROM (${select}) source
       ON CONFLICT (workspace_id, link_id, kind, source_id) DO NOTHING`, [workspaceId, link.id, link.legalEntityId, link.startDate, ...values]);
    const posting = (kind: PostingKind, source: string) =>
      `(SELECT id FROM accounting_postings WHERE workspace_id = $1 AND link_id = $2 AND kind = '${kind}' AND source_id = ${source})`;
    await add("invoice", `SELECT invoice.id::text AS id, NULL::uuid AS depends_on, invoice.issue_date AS document_on, invoice.total
      FROM client_invoices invoice WHERE invoice.workspace_id = $1 AND invoice.legal_entity_id = $3 AND invoice.issue_date >= $4`);
    await add("credit_note", `SELECT credit.id::text AS id, ${posting("invoice", "credit.invoice_id::text")} AS depends_on, credit.issue_date AS document_on, credit.total
      FROM client_credit_notes credit WHERE credit.workspace_id = $1 AND credit.legal_entity_id = $3 AND credit.issue_date >= $4
       AND EXISTS ${posting("invoice", "credit.invoice_id::text")}`);
    // A client payment goes on the milestone's live invoice once that invoice has a posting.
    await add("invoice_payment", `SELECT allocation.id AS id, ${posting("invoice", "invoice.id::text")} AS depends_on,
             coalesce(nullif(receipt.detail->>'verifiedAt', ''), nullif(receipt.detail->>'reportedAt', ''))::date AS document_on, allocation.amount AS total
        FROM commercial_allocations allocation
        JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id
         AND receipt.status = 'finance_verified'
        JOIN client_invoices invoice ON invoice.workspace_id = allocation.workspace_id AND invoice.case_id = allocation.case_id AND invoice.payment_id = allocation.payment_id
         AND invoice.status = 'issued' AND invoice.legal_entity_id = $3
       WHERE allocation.workspace_id = $1 AND allocation.detail->>'reversedAt' IS NULL
         AND coalesce(nullif(receipt.detail->>'verifiedAt', ''), nullif(receipt.detail->>'reportedAt', ''))::date >= $4
         AND EXISTS ${posting("invoice", "invoice.id::text")}`);
    await add("bill", `SELECT bill.id::text AS id, NULL::uuid AS depends_on, bill.invoice_date AS document_on, bill.total
      FROM supplier_invoices bill WHERE bill.workspace_id = $1 AND bill.legal_entity_id = $3 AND bill.status = 'approved' AND bill.invoice_date >= $4`);
    await add("bill_payment", `SELECT allocation.id::text AS id, ${posting("bill", "allocation.invoice_id::text")} AS depends_on, payment.paid_on AS document_on, allocation.amount AS total
      FROM supplier_payment_allocations allocation
      JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
     WHERE allocation.workspace_id = $1 AND payment.legal_entity_id = $3 AND payment.paid_on >= $4 AND EXISTS ${posting("bill", "allocation.invoice_id::text")}`);
    // Reversed before it was sent: nothing to post. Reversed after: void what was posted.
    await db.query(
      `UPDATE accounting_postings posting SET status = 'cancelled', error = 'The payment was reversed before it was posted.', lease_token = NULL, lease_until = NULL
        WHERE posting.workspace_id = $1 AND posting.link_id = $2 AND posting.kind = 'bill_payment' AND posting.status IN ('pending', 'failed', 'blocked')
          AND (posting.lease_until IS NULL OR posting.lease_until < now())
          AND EXISTS (SELECT 1 FROM supplier_payment_allocations allocation JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id
                        AND payment.id = allocation.payment_id AND payment.status = 'reversed'
                       WHERE allocation.workspace_id = posting.workspace_id AND allocation.id::text = posting.source_id)`, [workspaceId, link.id]);
    await add("bill_payment_void", `SELECT allocation.id::text AS id, sent.id AS depends_on, (now() AT TIME ZONE 'UTC')::date AS document_on, NULL::numeric AS total
      FROM supplier_payment_allocations allocation
      JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'reversed'
      JOIN accounting_postings sent ON sent.workspace_id = allocation.workspace_id AND sent.link_id = $2 AND sent.kind = 'bill_payment' AND sent.source_id = allocation.id::text
       AND sent.status = 'sent'
     WHERE allocation.workspace_id = $1 AND payment.legal_entity_id = $3 AND $4::date IS NOT NULL`);
  }
}

type Built = { contact: Contact | null; document: Record<string, unknown> } | { blocked: string };

/** The accounting system's tax code for each rate the company maps; a taxed rate without one blocks the posting. */
async function taxCodes(db: Db, workspaceId: string, linkId: string) {
  const rows = (await db.query<{ rate: string; taxId: string }>(`SELECT rate::text AS rate, provider_tax_id AS "taxId" FROM accounting_tax_codes WHERE workspace_id = $1 AND link_id = $2`,
    [workspaceId, linkId])).rows;
  return (rate: string) => rows.find((row) => Dec.of(row.rate).cmp(rate) === 0)?.taxId ?? null;
}

async function contact(db: Db, workspaceId: string, linkId: string, kind: Contact["kind"], partyId: string, details: Omit<Contact, "kind" | "providerId">): Promise<Contact> {
  const providerId = (await db.query<{ providerId: string }>(
    `SELECT provider_id AS "providerId" FROM accounting_contacts WHERE workspace_id = $1 AND link_id = $2 AND kind = $3 AND party_id = $4`, [workspaceId, linkId, kind, partyId])).rows[0]?.providerId ?? null;
  return { kind, providerId, ...details };
}

/** The document for one posting, or why it can't go yet (a mapping to choose first). */
export async function buildPosting(db: Db, workspaceId: string, link: Link, posting: { id: string; kind: PostingKind; sourceId: string; dependsOn: string | null }): Promise<Built> {
  const taxId = await taxCodes(db, workspaceId, link.id);
  const dependency = posting.dependsOn ? (await db.query<{ providerId: string | null }>(`SELECT provider_id AS "providerId" FROM accounting_postings WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, posting.dependsOn])).rows[0]?.providerId ?? null : null;
  const money = (value: string, currency: string) => Dec.of(value).toFixed(currencyDecimals(currency));
  const lineTax = (rate: string): { blocked: string } | { code: string | null } => {
    const code = taxId(rate);
    if (!code && Dec.of(rate).cmp(0) > 0) return { blocked: `Map the ${Dec.of(rate).toString()}% tax rate to a tax code in Settings → Accounting.` };
    return { code };
  };

  if (posting.kind === "invoice" || posting.kind === "credit_note") {
    const invoiceId = posting.kind === "invoice" ? posting.sourceId
      : (await db.query<{ invoiceId: string }>(`SELECT invoice_id AS "invoiceId" FROM client_credit_notes WHERE workspace_id = $1 AND id = $2`, [workspaceId, posting.sourceId])).rows[0].invoiceId;
    const invoice = (await db.query<{ number: string; issueDate: string; dueDate: string; currency: string; net: string; tax: string; total: string; customerName: string;
      customerTaxNumber: string; milestoneTitle: string; projectReference: string; partyId: string; email: string | null }>(
      `SELECT invoice.number, invoice.issue_date::text AS "issueDate", invoice.due_date::text AS "dueDate", invoice.currency, invoice.net::text AS net, invoice.tax::text AS tax,
              invoice.total::text AS total, invoice.customer_name AS "customerName", invoice.customer_tax_number AS "customerTaxNumber", invoice.milestone_title AS "milestoneTitle",
              project.reference AS "projectReference", coalesce(opportunity.party_id, opportunity.id) AS "partyId",
              (SELECT point.normalized_value FROM crm_contact_points point WHERE point.workspace_id = opportunity.workspace_id AND point.party_id = opportunity.party_id
                  AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC, point.created_at LIMIT 1) AS email
         FROM client_invoices invoice
         JOIN delivery_projects project ON project.workspace_id = invoice.workspace_id AND project.id = invoice.project_id
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = invoice.workspace_id AND pre_case.id = invoice.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
        WHERE invoice.workspace_id = $1 AND invoice.id = $2`, [workspaceId, invoiceId])).rows[0];
    const lines = [];
    for (const line of (await db.query<{ description: string; taxRate: string; net: string }>(
      `SELECT description, tax_rate::text AS "taxRate", net::text AS net FROM client_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position`,
      [workspaceId, invoiceId])).rows) {
      const tax = lineTax(line.taxRate);
      if ("blocked" in tax) return { blocked: tax.blocked };
      lines.push({ description: line.description, amount: money(line.net, invoice.currency), taxId: tax.code });
    }
    if (!link.salesItemId && link.provider === "quickbooks") return { blocked: "Choose the accounting item for invoice lines in Settings → Accounting." };
    const customer = await contact(db, workspaceId, link.id, "customer", invoice.partyId,
      { name: invoice.customerName, email: invoice.email, taxNumber: invoice.customerTaxNumber || null, currency: invoice.currency });
    const common = { currency: invoice.currency, itemId: link.salesItemId, lines, net: money(invoice.net, invoice.currency), tax: money(invoice.tax, invoice.currency),
      total: money(invoice.total, invoice.currency) };
    if (posting.kind === "invoice")
      return { contact: customer, document: { number: invoice.number, date: invoice.issueDate, dueDate: invoice.dueDate, reference: `${invoice.projectReference} · ${invoice.milestoneTitle}`, ...common } };
    const credit = (await db.query<{ number: string; issueDate: string; reason: string }>(
      `SELECT number, issue_date::text AS "issueDate", reason FROM client_credit_notes WHERE workspace_id = $1 AND id = $2`, [workspaceId, posting.sourceId])).rows[0];
    if (!dependency) return { blocked: "The invoice it credits isn't posted yet." };
    return { contact: customer, document: { number: credit.number, date: credit.issueDate, reference: invoice.number, invoiceProviderId: dependency, reason: credit.reason, ...common } };
  }

  if (posting.kind === "invoice_payment") {
    const row = (await db.query<{ amount: string; currency: string; paidOn: string; reference: string; partyId: string; customerName: string; customerTaxNumber: string; invoiceCurrency: string }>(
      `SELECT allocation.amount::text AS amount, allocation.currency, coalesce(nullif(receipt.detail->>'verifiedAt', ''), nullif(receipt.detail->>'reportedAt', ''))::date::text AS "paidOn",
              receipt.reference, coalesce(opportunity.party_id, opportunity.id) AS "partyId", invoice.customer_name AS "customerName",
              invoice.customer_tax_number AS "customerTaxNumber", invoice.currency AS "invoiceCurrency"
         FROM commercial_allocations allocation
         JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id
         JOIN client_invoices invoice ON invoice.workspace_id = allocation.workspace_id AND invoice.case_id = allocation.case_id AND invoice.payment_id = allocation.payment_id
          AND invoice.status = 'issued'
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = invoice.workspace_id AND pre_case.id = invoice.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
        WHERE allocation.workspace_id = $1 AND allocation.id = $2`, [workspaceId, posting.sourceId])).rows[0];
    if (!row) return { blocked: "The payment's invoice was credited; it goes on the invoice issued again." };
    if (!dependency) return { blocked: "The invoice it pays isn't posted yet." };
    const currency = row.currency || row.invoiceCurrency;
    return { contact: await contact(db, workspaceId, link.id, "customer", row.partyId, { name: row.customerName, email: null, taxNumber: row.customerTaxNumber || null, currency }),
      document: { date: row.paidOn, currency, amount: money(row.amount, currency), invoiceProviderId: dependency, reference: row.reference, depositAccountId: link.depositAccountId } };
  }

  if (posting.kind === "bill") {
    if (!link.expenseAccountId) return { blocked: "Choose the expense account for supplier bills in Settings → Accounting." };
    const bill = (await db.query<{ number: string; invoiceDate: string; dueDate: string | null; currency: string; net: string; tax: string; total: string; vendorId: string;
      supplierName: string; taxNumber: string | null; email: string | null; orders: string | null }>(
      `SELECT bill.number, bill.invoice_date::text AS "invoiceDate", bill.due_date::text AS "dueDate", bill.currency, bill.net::text AS net, bill.tax::text AS tax, bill.total::text AS total,
              bill.vendor_id AS "vendorId", vendor.display_name AS "supplierName", vendor.tax_registration_number AS "taxNumber",
              (SELECT site.email FROM workspace_vendor_sites site WHERE site.workspace_id = vendor.workspace_id AND site.vendor_id = vendor.id AND site.status = 'active'
                ORDER BY site.is_primary DESC, site.created_at LIMIT 1) AS email,
              (SELECT string_agg(DISTINCT purchase.number, ', ') FROM supplier_invoice_lines line
                 JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
                 JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
                WHERE line.workspace_id = bill.workspace_id AND line.invoice_id = bill.id) AS orders
         FROM supplier_invoices bill JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
        WHERE bill.workspace_id = $1 AND bill.id = $2`, [workspaceId, posting.sourceId])).rows[0];
    const lines = [];
    for (const line of (await db.query<{ description: string; taxRate: string; net: string }>(
      `SELECT description, tax_rate::text AS "taxRate", net::text AS net FROM supplier_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position, id`,
      [workspaceId, posting.sourceId])).rows) {
      const tax = lineTax(line.taxRate);
      if ("blocked" in tax) return { blocked: tax.blocked };
      lines.push({ description: line.description, amount: money(line.net, bill.currency), taxId: tax.code, accountId: link.expenseAccountId });
    }
    return { contact: await contact(db, workspaceId, link.id, "vendor", bill.vendorId, { name: bill.supplierName, email: bill.email, taxNumber: bill.taxNumber, currency: bill.currency }),
      document: { number: bill.number, date: bill.invoiceDate, dueDate: bill.dueDate, currency: bill.currency, reference: bill.orders ?? "", lines,
        net: money(bill.net, bill.currency), tax: money(bill.tax, bill.currency), total: money(bill.total, bill.currency) } };
  }

  // Supplier payments, one allocation at a time, and voids of the ones reversed after they were posted.
  const row = (await db.query<{ amount: string; currency: string; paidOn: string; reference: string; method: string; vendorId: string; supplierName: string; taxNumber: string | null;
    reverseReason: string | null }>(
    `SELECT allocation.amount::text AS amount, payment.currency, payment.paid_on::text AS "paidOn", payment.reference, payment.method, payment.vendor_id AS "vendorId",
            vendor.display_name AS "supplierName", vendor.tax_registration_number AS "taxNumber", payment.reverse_reason AS "reverseReason"
       FROM supplier_payment_allocations allocation
       JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id
       JOIN workspace_vendors vendor ON vendor.workspace_id = payment.workspace_id AND vendor.id = payment.vendor_id
      WHERE allocation.workspace_id = $1 AND allocation.id::text = $2`, [workspaceId, posting.sourceId])).rows[0];
  const supplier = await contact(db, workspaceId, link.id, "vendor", row.vendorId, { name: row.supplierName, email: null, taxNumber: row.taxNumber, currency: row.currency });
  if (posting.kind === "bill_payment_void") {
    if (!dependency) return { blocked: "The payment to void isn't posted." };
    return { contact: supplier, document: { paymentProviderId: dependency, reason: row.reverseReason ?? "Reversed in Wodana" } };
  }
  if (!link.paymentsAccountId) return { blocked: "Choose the account supplier payments are paid from in Settings → Accounting." };
  if (!dependency) return { blocked: "The bill it pays isn't posted yet." };
  return { contact: supplier, document: { date: row.paidOn, currency: row.currency, amount: money(row.amount, row.currency), billProviderId: dependency, reference: row.reference,
    paidFromAccountId: link.paymentsAccountId, method: row.method } };
}

/**
 * Claims up to `limit` due postings in one workspace: pending ones, failed ones whose retry time has
 * come, and blocked ones (checked again, since a mapping may have been chosen), each after what it
 * depends on was sent. A posting that still can't go is marked blocked with why; the rest are leased for
 * five minutes and returned with their documents.
 */
export async function claimPostings(db: Db, workspaceId: string, limit: number): Promise<ClaimedPosting[]> {
  await enqueuePostings(db, workspaceId);
  const links = new Map((await readLinks(db, workspaceId)).map((link) => [link.id, link]));
  const due = (await db.query<{ id: string; linkId: string; kind: PostingKind; sourceId: string; dependsOn: string | null; attempts: number; status: string; error: string | null }>(
    `SELECT posting.id, posting.link_id AS "linkId", posting.kind, posting.source_id AS "sourceId", posting.depends_on AS "dependsOn", posting.attempts, posting.status, posting.error
       FROM accounting_postings posting
      WHERE posting.workspace_id = $1 AND posting.link_id = ANY($2::uuid[])
        AND (posting.status IN ('pending', 'blocked') OR (posting.status = 'failed' AND posting.next_at IS NOT NULL AND posting.next_at <= now()))
        AND (posting.lease_until IS NULL OR posting.lease_until < now())
        AND (posting.depends_on IS NULL OR EXISTS (SELECT 1 FROM accounting_postings before WHERE before.workspace_id = posting.workspace_id AND before.id = posting.depends_on
                                                     AND before.status = 'sent'))
      ORDER BY posting.document_date, posting.created_at, posting.id
      LIMIT $3 FOR UPDATE OF posting SKIP LOCKED`, [workspaceId, [...links.keys()], limit])).rows;
  const claimed: ClaimedPosting[] = [];
  for (const posting of due) {
    const link = links.get(posting.linkId)!;
    const built = await buildPosting(db, workspaceId, link, posting);
    if ("blocked" in built) {
      if (posting.status !== "blocked" || posting.error !== built.blocked) {
        await db.query(`UPDATE accounting_postings SET status = 'blocked', error_code = 'mapping_required', error = $3, next_at = NULL WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, posting.id, built.blocked]);
        await tellAttention(db, workspaceId, link, posting.id, built.blocked);
      }
      continue;
    }
    const leaseToken = randomUUID();
    await db.query(`UPDATE accounting_postings SET lease_token = $3, lease_until = now() + interval '5 minutes', status = CASE WHEN status = 'blocked' THEN 'pending' ELSE status END,
                      error = CASE WHEN status = 'blocked' THEN NULL ELSE error END, error_code = CASE WHEN status = 'blocked' THEN NULL ELSE error_code END
                    WHERE workspace_id = $1 AND id = $2`, [workspaceId, posting.id, leaseToken]);
    claimed.push({ id: posting.id, leaseToken, workspaceId, connectionId: link.connectionId, provider: link.provider, kind: posting.kind, attempt: posting.attempts,
      marker: marker(posting.id), contact: built.contact, document: built.document });
  }
  return claimed;
}

export type PostingResult = {
  id: string; leaseToken: string; providerId?: string; providerNumber?: string | null; providerTotal?: string | null; contactProviderId?: string;
  error?: { code: string; message: string; retryable: boolean };
};

/**
 * Records what the accounting system did with a leased posting: sent (with its ids, the contact it used,
 * and a flag when its total differs from Wodana's), or failed — tried again later when that can help,
 * otherwise left for someone to retry, who hears about it.
 */
export async function applyResult(db: Db, workspaceId: string, result: PostingResult) {
  const posting = (await db.query<{ id: string; linkId: string; kind: PostingKind; sourceId: string; expectedTotal: string | null; attempts: number }>(
    `SELECT id, link_id AS "linkId", kind, source_id AS "sourceId", expected_total::text AS "expectedTotal", attempts FROM accounting_postings
      WHERE workspace_id = $1 AND id = $2 AND lease_token = $3 AND lease_until > now() FOR UPDATE`, [workspaceId, result.id, result.leaseToken])).rows[0];
  if (!posting) return { applied: false };
  const link = (await readLinks(db, workspaceId)).find((item) => item.id === posting.linkId);
  // A contact found or created by the worker is remembered for the next posting (a mapping already chosen stays).
  if (result.contactProviderId) {
    const partyId = await contactParty(db, workspaceId, posting.kind, posting.sourceId);
    if (partyId)
      await db.query(
        `INSERT INTO accounting_contacts (id, workspace_id, link_id, kind, party_id, provider_id) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, link_id, kind, party_id) DO NOTHING`,
        [randomUUID(), workspaceId, posting.linkId, ["invoice", "credit_note", "invoice_payment"].includes(posting.kind) ? "customer" : "vendor", partyId,
          String(result.contactProviderId).slice(0, 120)]);
  }
  if (!result.error && result.providerId) {
    const differs = result.providerTotal && posting.expectedTotal && Dec.of(result.providerTotal).cmp(posting.expectedTotal) !== 0;
    const note = differs && link ? `${link.provider === "quickbooks" ? "QuickBooks" : "Zoho Books"} shows ${result.providerTotal}; Wodana shows ${Dec.of(posting.expectedTotal!).toString()}.` : null;
    await db.query(
      `UPDATE accounting_postings SET status = 'sent', provider_id = $3, provider_number = $4, provider_total = $5, sent_at = now(), attempts = attempts + 1,
              lease_token = NULL, lease_until = NULL, next_at = NULL, error_code = $6, error = $7
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, posting.id, String(result.providerId).slice(0, 120), result.providerNumber ? String(result.providerNumber).slice(0, 120) : null,
        result.providerTotal ?? null, differs ? "total_differs" : null, note]);
    if (note && link) await tellAttention(db, workspaceId, link, posting.id, note);
    return { applied: true };
  }
  const error = result.error ?? { code: "no_result", message: "The accounting system didn't say what it created.", retryable: false };
  const attempts = posting.attempts + 1;
  const retry = error.retryable && attempts < MAX_AUTOMATIC_ATTEMPTS;
  await db.query(
    `UPDATE accounting_postings SET status = 'failed', attempts = $3, error_code = $4, error = $5, lease_token = NULL, lease_until = NULL,
            next_at = CASE WHEN $6 THEN now() + make_interval(mins => $7) ELSE NULL END
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, posting.id, attempts, error.code.slice(0, 40), error.message.slice(0, 500), retry, retryDelayMinutes(attempts)]);
  if (!retry && link) await tellAttention(db, workspaceId, link, posting.id, error.message);
  return { applied: true };
}

/** Who a posting's contact is in Wodana: the client's party (or their deal) or the supplier. */
async function contactParty(db: Db, workspaceId: string, kind: PostingKind, sourceId: string) {
  const query = kind === "invoice" ? `SELECT coalesce(opportunity.party_id, opportunity.id) AS id FROM client_invoices invoice
      JOIN pre_project_cases pre_case ON pre_case.workspace_id = invoice.workspace_id AND pre_case.id = invoice.case_id
      JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
     WHERE invoice.workspace_id = $1 AND invoice.id::text = $2`
    : kind === "credit_note" ? `SELECT coalesce(opportunity.party_id, opportunity.id) AS id FROM client_credit_notes credit
      JOIN client_invoices invoice ON invoice.workspace_id = credit.workspace_id AND invoice.id = credit.invoice_id
      JOIN pre_project_cases pre_case ON pre_case.workspace_id = invoice.workspace_id AND pre_case.id = invoice.case_id
      JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
     WHERE credit.workspace_id = $1 AND credit.id::text = $2`
    : kind === "invoice_payment" ? `SELECT coalesce(opportunity.party_id, opportunity.id) AS id FROM commercial_allocations allocation
      JOIN pre_project_cases pre_case ON pre_case.workspace_id = allocation.workspace_id AND pre_case.id = allocation.case_id
      JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
     WHERE allocation.workspace_id = $1 AND allocation.id = $2`
    : kind === "bill" ? `SELECT vendor_id AS id FROM supplier_invoices WHERE workspace_id = $1 AND id::text = $2`
    : `SELECT payment.vendor_id AS id FROM supplier_payment_allocations allocation JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id
        AND payment.id = allocation.payment_id WHERE allocation.workspace_id = $1 AND allocation.id::text = $2`;
  return (await db.query<{ id: string }>(query, [workspaceId, sourceId])).rows[0]?.id ?? null;
}

/** People who manage accounting hear once when a posting needs them (blocked, failed for good, or totals differ). */
async function tellAttention(db: Db, workspaceId: string, link: Link, postingId: string, note: string) {
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'accounting.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  for (const userId of people)
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "accounting.attention", eventType: "accounting.attention",
      variables: { company: link.companyName, note: note.slice(0, 480) }, deepLink: "/workspace/finance/accounting",
      idempotencyKey: `accounting.attention:${postingId}:${note.slice(0, 60)}:${userId}` });
}
