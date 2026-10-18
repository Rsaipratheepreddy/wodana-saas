import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

export type TaxGroup = { rate: string; net: string; tax: string; total: string };

/**
 * A milestone's amount split by the accepted quotation's tax rates, exactly. Each rate's share of the
 * milestone follows its share of the quotation's total (the largest share takes the rounding, so the
 * shares add up to the milestone); within a share, tax is carved out at its rate (the milestone is what
 * the client pays, tax included), rounded to the currency's minor units, and net is the rest.
 */
export function splitMilestone(amount: string, pricing: { total: string; taxes: Array<{ rate: string; base: string; tax: string }> }, currency: string): TaxGroup[] {
  const places = currencyDecimals(currency);
  const total = Dec.of(pricing.total);
  const due = Dec.of(amount).round(places);
  const groups = pricing.taxes.map((group) => ({ rate: Dec.of(group.rate), gross: Dec.of(group.base).add(group.tax) }));
  const taxed = groups.reduce((sum, group) => sum.add(group.gross), Dec.ZERO);
  // What isn't taxed at any rate is a zero-rated share.
  if (total.sub(taxed).cmp(0) > 0) groups.push({ rate: Dec.ZERO, gross: total.sub(taxed) });
  if (!groups.length || total.cmp(0) <= 0) return [{ rate: "0", net: due.toFixed(4), tax: "0.0000", total: due.toFixed(4) }];
  const largest = groups.reduce((best, group, index) => (group.gross.cmp(groups[best].gross) > 0 ? index : best), 0);
  const shares = groups.map((group) => due.mul(group.gross).div(total).round(places));
  shares[largest] = due.sub(shares.reduce((sum, share, index) => (index === largest ? sum : sum.add(share)), Dec.ZERO));
  return groups.map((group, index) => {
    const share = shares[index];
    const tax = share.mul(group.rate).div(Dec.of(100).add(group.rate)).round(places);
    return { rate: group.rate.toString(), net: share.sub(tax).toFixed(4), tax: tax.toFixed(4), total: share.toFixed(4) };
  }).filter((group) => !Dec.of(group.total).isZero());
}

/** A project's payment milestone as the deal keeps it, with the sealed quotation it belongs to. */
export type Milestone = {
  projectId: string; projectReference: string; projectName: string; caseId: string; paymentId: string; title: string; amount: string; currency: string | null;
  dueDate: string | null; legalEntityId: string | null; quoteId: string; clientName: string; invoiceId: string | null; invoiceNumber: string | null;
};

/** Milestones of started projects whose quotation is sealed into the project (baseline or variation), with their live invoice. */
export async function readMilestones(db: Db, workspaceId: string, filter: { projectId?: string; caseId?: string; paymentId?: string } = {}): Promise<Milestone[]> {
  const values: unknown[] = [workspaceId];
  const where = ["payment.workspace_id = $1", "payment.amount > 0"];
  if (filter.projectId) { values.push(filter.projectId); where.push(`project.id = $${values.length}`); }
  if (filter.caseId) { values.push(filter.caseId); where.push(`payment.case_id = $${values.length}`); }
  if (filter.paymentId) { values.push(filter.paymentId); where.push(`payment.id = $${values.length}`); }
  return (await db.query<Milestone>(
    `SELECT project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", payment.case_id AS "caseId", payment.id AS "paymentId",
            payment.title, payment.amount::text AS amount, coalesce(nullif(payment.currency, ''), seal.currency) AS currency, payment.due_date::text AS "dueDate",
            nullif(payment.legal_entity_id, '') AS "legalEntityId", payment.source_quote_id AS "quoteId", coalesce(party.display_name, opportunity.title) AS "clientName",
            invoice.id AS "invoiceId", invoice.number AS "invoiceNumber"
       FROM commercial_payments payment
       JOIN delivery_projects project ON project.workspace_id = payment.workspace_id AND project.case_id = payment.case_id AND project.started_at IS NOT NULL
       JOIN project_scope_seals seal ON seal.workspace_id = project.workspace_id AND seal.project_id = project.id AND seal.quote_id = payment.source_quote_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN client_invoices invoice ON invoice.workspace_id = payment.workspace_id AND invoice.case_id = payment.case_id AND invoice.payment_id = payment.id AND invoice.status = 'issued'
      WHERE ${where.join(" AND ")}
      ORDER BY payment.due_date NULLS LAST, project.reference, payment.sort_order`, values)).rows;
}

export type ClientInvoice = {
  id: string; legalEntityId: string; projectId: string; projectReference: string; caseId: string; paymentId: string; number: string; issueDate: string; dueDate: string;
  currency: string; net: string; tax: string; total: string; milestoneTitle: string; customerName: string; customerAddress: string; customerTaxNumber: string;
  companyName: string; companyAddress: string; companyTaxNumber: string; note: string; status: "issued" | "credited"; issuedByName: string; issuedAt: string; version: number;
  creditNoteId: string | null; creditNoteNumber: string | null; creditReason: string | null; creditedOn: string | null;
};

export async function readInvoices(db: Db, workspaceId: string, filter: { id?: string; projectId?: string } = {}): Promise<ClientInvoice[]> {
  const values: unknown[] = [workspaceId];
  const where = ["invoice.workspace_id = $1"];
  if (filter.id) { values.push(filter.id); where.push(`invoice.id = $${values.length}`); }
  if (filter.projectId) { values.push(filter.projectId); where.push(`invoice.project_id = $${values.length}`); }
  return (await db.query<ClientInvoice>(
    `SELECT invoice.id, invoice.legal_entity_id AS "legalEntityId", invoice.project_id AS "projectId", project.reference AS "projectReference", invoice.case_id AS "caseId",
            invoice.payment_id AS "paymentId", invoice.number, invoice.issue_date::text AS "issueDate", invoice.due_date::text AS "dueDate", invoice.currency,
            invoice.net::text AS net, invoice.tax::text AS tax, invoice.total::text AS total, invoice.milestone_title AS "milestoneTitle", invoice.customer_name AS "customerName",
            invoice.customer_address AS "customerAddress", invoice.customer_tax_number AS "customerTaxNumber", invoice.company_name AS "companyName",
            invoice.company_address AS "companyAddress", invoice.company_tax_number AS "companyTaxNumber", invoice.note, invoice.status, issuer.display_name AS "issuedByName",
            invoice.issued_at AS "issuedAt", invoice.version, credit.id AS "creditNoteId", credit.number AS "creditNoteNumber", credit.reason AS "creditReason",
            credit.issue_date::text AS "creditedOn"
       FROM client_invoices invoice
       JOIN delivery_projects project ON project.workspace_id = invoice.workspace_id AND project.id = invoice.project_id
       JOIN users issuer ON issuer.id = invoice.issued_by
       LEFT JOIN client_credit_notes credit ON credit.workspace_id = invoice.workspace_id AND credit.invoice_id = invoice.id
      WHERE ${where.join(" AND ")} ORDER BY invoice.issue_date DESC, invoice.number DESC LIMIT 1000`, values)).rows;
}

export async function readInvoiceLines(db: Db, workspaceId: string, invoiceId: string) {
  return (await db.query<{ id: string; position: number; description: string; taxRate: string; net: string; tax: string; total: string }>(
    `SELECT id, position, description, tax_rate::text AS "taxRate", net::text AS net, tax::text AS tax, total::text AS total
       FROM client_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position`, [workspaceId, invoiceId])).rows;
}

/**
 * What the client paid on each milestone: receipts finance verified and allocated to it (allocations not
 * reversed). A deal kept before receipts were recorded counts a verified milestone as paid in full.
 */
export async function readMilestonePaid(db: Db, workspaceId: string, milestones: Array<{ caseId: string; paymentId: string }>) {
  const paid = new Map<string, Dec>();
  if (!milestones.length) return paid;
  const rows = (await db.query<{ caseId: string; paymentId: string; allocated: string | null; status: string; amount: string; contracted: boolean }>(
    `SELECT payment.case_id AS "caseId", payment.id AS "paymentId", payment.status, payment.amount::text AS amount,
            (SELECT sum(allocation.amount) FROM commercial_allocations allocation
               JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id
                AND receipt.status = 'finance_verified'
              WHERE allocation.workspace_id = payment.workspace_id AND allocation.case_id = payment.case_id AND allocation.payment_id = payment.id
                AND allocation.detail->>'reversedAt' IS NULL)::text AS allocated,
            (cases.content->'financeContext') IS NOT NULL AND jsonb_typeof(cases.content->'financeContext') = 'object' AS contracted
       FROM commercial_payments payment
       JOIN commercial_cases cases ON cases.workspace_id = payment.workspace_id AND cases.case_id = payment.case_id
      WHERE payment.workspace_id = $1 AND (payment.case_id, payment.id) IN (SELECT * FROM unnest($2::uuid[], $3::text[]))`,
    [workspaceId, milestones.map((item) => item.caseId), milestones.map((item) => item.paymentId)])).rows;
  for (const row of rows) {
    const value = row.allocated !== null ? Dec.of(row.allocated) : !row.contracted && row.status === "verified" ? Dec.of(row.amount) : Dec.ZERO;
    paid.set(`${row.caseId}|${row.paymentId}`, value);
  }
  return paid;
}

/** Invoices with what's paid on them (never more than their total), what's left, and whether that's overdue. */
export async function withBalances(db: Db, workspaceId: string, invoices: ClientInvoice[], today: string) {
  const paid = await readMilestonePaid(db, workspaceId, invoices.filter((invoice) => invoice.status === "issued").map((invoice) => ({ caseId: invoice.caseId, paymentId: invoice.paymentId })));
  return invoices.map((invoice) => {
    const received = invoice.status === "issued" ? paid.get(`${invoice.caseId}|${invoice.paymentId}`) ?? Dec.ZERO : Dec.ZERO;
    const capped = received.cmp(invoice.total) > 0 ? Dec.of(invoice.total) : received;
    const balance = invoice.status === "issued" ? Dec.of(invoice.total).sub(capped) : Dec.ZERO;
    return { ...invoice, paid: capped.toFixed(4), balance: balance.toFixed(4), overdue: invoice.status === "issued" && balance.cmp(0) > 0 && invoice.dueDate < today };
  });
}
