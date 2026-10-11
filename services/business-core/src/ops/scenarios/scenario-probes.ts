import type { PoolClient } from "pg";
import type { ScenarioSpec } from "./scenario-matrix";
import { PASS_TWO_PROBES } from "./scenario-probes-two";

/**
 * Whether each scenario has an example in the organization, read in its own tenant transaction: one query per scenario
 * that returns a short reference of a record in that state (its number and name), or nothing. A record about a client
 * counts only when the client is the organization's own country's (their phone is in the region pack's country), so an
 * organization's examples are in its own region; records without a client count in the organization's currency.
 * Dates compare with the organization's own today (its time zone).
 *
 * Every query takes $1 = workspace id and $2 = country code.
 */

const TODAY = `(SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date FROM workspaces WHERE id = $1)`;
/** The client (party) is the organization's own country's. */
const REGIONAL = (party: string) => `EXISTS (SELECT 1 FROM crm_contact_points phone WHERE phone.workspace_id = $1 AND phone.party_id = ${party}
  AND phone.type = 'phone' AND phone.status = 'active' AND phone.country_code = $2)`;
/** A planning case's client. */
const CASE_PARTY = (caseId: string) => `(SELECT opportunity.party_id FROM pre_project_cases pre_case JOIN crm_opportunities opportunity
  ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id WHERE pre_case.workspace_id = $1 AND pre_case.id = ${caseId})`;
const PROJECT_PARTY = (projectId: string) => CASE_PARTY(`(SELECT case_id FROM delivery_projects WHERE workspace_id = $1 AND id = ${projectId})`);
const QUOTE_REF = `coalesce(nullif(quote.title, ''), 'Quotation') || ' v' || quote.number`;
const PROJECT_REF = `project.reference || ' · ' || project.name`;

const quote = (where: string) => `SELECT ${QUOTE_REF} AS ref FROM commercial_quotes quote
  WHERE quote.workspace_id = $1 AND quote.kind = 'quotation' AND coalesce(quote.round, 'main') = 'main' AND ${where} AND ${REGIONAL(CASE_PARTY("quote.case_id"))} LIMIT 1`;
const lead = (where: string) => `SELECT party.display_name || ' · ' || lead.status AS ref FROM crm_leads lead JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
  LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
  WHERE lead.workspace_id = $1 AND ${where} AND ${REGIONAL("lead.party_id")} LIMIT 1`;
const design = (status: string) => `SELECT design.title || ' (' || version.status || ')' AS ref FROM pre_project_designs design
  JOIN LATERAL (SELECT status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) version ON true
  WHERE design.workspace_id = $1 AND design.archived_at IS NULL AND version.status = '${status}' AND ${REGIONAL(CASE_PARTY("design.case_id"))} LIMIT 1`;
const deal = (status: string) => `SELECT 'Deal file · ' || coalesce(quote.title, '') AS ref FROM commercial_cases commercial
  LEFT JOIN commercial_quotes quote ON quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id AND quote.id = commercial.content->'ownerReview'->>'quoteId'
  WHERE commercial.workspace_id = $1 AND commercial.content->'ownerReview'->>'status' = '${status}' AND ${REGIONAL(CASE_PARTY("commercial.case_id"))} LIMIT 1`;
const project = (where: string) => `SELECT ${PROJECT_REF} AS ref FROM delivery_projects project
  WHERE project.workspace_id = $1 AND ${where} AND ${REGIONAL(PROJECT_PARTY("project.id"))} LIMIT 1`;
const change = (status: string) => `SELECT 'CR-' || lpad(change.number::text, 3, '0') || ' · ' || change.title AS ref FROM change_requests change
  WHERE change.workspace_id = $1 AND change.project_id IS NOT NULL AND change.status = '${status}' AND ${REGIONAL(PROJECT_PARTY("change.project_id"))} LIMIT 1`;
const order = (where: string) => `SELECT purchase.number AS ref FROM purchase_orders purchase JOIN workspaces workspace ON workspace.id = purchase.workspace_id
  WHERE purchase.workspace_id = $1 AND purchase.currency = workspace.default_currency AND ${where} LIMIT 1`;
const OUTSTANDING_LINE = `EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
  AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) < ${TODAY}
  AND line.quantity > coalesce((SELECT sum(got.received) FROM goods_receipt_lines got JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id
    WHERE got.workspace_id = line.workspace_id AND got.order_line_id = line.id AND receipt.reversed_at IS NULL), 0))`;
const BILL_BALANCE = `bill.total > coalesce((SELECT sum(allocation.amount) FROM supplier_payment_allocations allocation JOIN supplier_payments payment
  ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
  WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id), 0)`;
const bill = (where: string) => `SELECT bill.number AS ref FROM supplier_invoices bill JOIN workspaces workspace ON workspace.id = bill.workspace_id
  WHERE bill.workspace_id = $1 AND bill.currency = workspace.default_currency AND ${where} LIMIT 1`;
const INVOICE_PAID = `EXISTS (SELECT 1 FROM commercial_receipts receipt JOIN commercial_allocations allocation ON allocation.workspace_id = receipt.workspace_id
  AND allocation.case_id = receipt.case_id AND allocation.receipt_id = receipt.id
  WHERE receipt.workspace_id = invoice.workspace_id AND receipt.case_id = invoice.case_id AND receipt.payment_id = invoice.payment_id AND receipt.status = 'finance_verified'
    AND allocation.detail->>'reversedAt' IS NULL)`;
const invoice = (where: string) => `SELECT invoice.number || ' · ' || invoice.milestone_title AS ref FROM client_invoices invoice
  WHERE invoice.workspace_id = $1 AND invoice.status = 'issued' AND ${where} AND ${REGIONAL(CASE_PARTY("invoice.case_id"))} LIMIT 1`;
const receipt = (status: string) => `SELECT coalesce(nullif(receipt.reference, ''), 'Receipt') || ' · ' || payment.title AS ref FROM commercial_receipts receipt
  JOIN commercial_payments payment ON payment.workspace_id = receipt.workspace_id AND payment.case_id = receipt.case_id AND payment.id = receipt.payment_id
  WHERE receipt.workspace_id = $1 AND receipt.status = '${status}' AND ${REGIONAL(CASE_PARTY("receipt.case_id"))} LIMIT 1`;
const stageProject = (key: string) => project(`project.status = 'active' AND EXISTS (SELECT 1 FROM project_stages stage WHERE stage.workspace_id = project.workspace_id
  AND stage.project_id = project.id AND stage.status = 'current' AND stage.key = '${key.replace(/'/g, "''")}')`);

/** The fixed scenarios' queries; the per-organization ones (enquiry types, pipeline and route stages) are made below. */
const FIXED: Record<string, string> = {
  "sales.enquiry.new": lead(`lead.status = 'new'`),
  "sales.enquiry.contacted": lead(`lead.status IN ('attempting_contact', 'connected') AND EXISTS (SELECT 1 FROM crm_activities activity
    WHERE activity.workspace_id = lead.workspace_id AND activity.lead_id = lead.id AND activity.status = 'pending' AND activity.due_at IS NOT NULL)`),
  "sales.enquiry.qualified": lead(`lead.status = 'qualified'`),
  "sales.enquiry.not_sure": lead(`lead.status IN ('new', 'attempting_contact', 'connected', 'nurturing') AND enquiry.service_type = 'not_sure'`),
  "sales.enquiry.lost": lead(`lead.status = 'disqualified' AND nullif(lead.disqualification_reason, '') IS NOT NULL`),
  "sales.enquiry.converted": lead(`lead.status = 'qualified' AND EXISTS (SELECT 1 FROM crm_opportunities opportunity JOIN pre_project_cases pre_case
    ON pre_case.workspace_id = opportunity.workspace_id AND pre_case.opportunity_id = opportunity.id WHERE opportunity.workspace_id = lead.workspace_id AND opportunity.lead_id = lead.id)`),
  "sales.follow_up.today": `SELECT activity.title AS ref FROM crm_activities activity WHERE activity.workspace_id = $1 AND activity.status = 'pending' AND activity.type <> 'note'
    AND (activity.due_at AT TIME ZONE (SELECT coalesce(nullif(default_timezone, ''), 'UTC') FROM workspaces WHERE id = $1))::date = ${TODAY}
    AND ${REGIONAL("activity.party_id")} LIMIT 1`,
  "sales.follow_up.overdue": `SELECT activity.title AS ref FROM crm_activities activity WHERE activity.workspace_id = $1 AND activity.status = 'pending' AND activity.type <> 'note'
    AND (activity.due_at AT TIME ZONE (SELECT coalesce(nullif(default_timezone, ''), 'UTC') FROM workspaces WHERE id = $1))::date < ${TODAY}
    AND ${REGIONAL("activity.party_id")} LIMIT 1`,
  "design.stage.concepts": design("draft"),
  "design.stage.internal_review": design("internal_review"),
  "design.stage.client_review": design("client_review"),
  "design.stage.revision_requested": design("changes_requested"),
  "design.stage.approved": design("approved"),
  "quote.draft": quote(`quote.status = 'draft' AND NOT EXISTS (SELECT 1 FROM quote_qs_reviews review WHERE review.workspace_id = quote.workspace_id AND review.quote_id = quote.id AND review.status = 'with_qs')`),
  "quote.with_qs": quote(`quote.status = 'draft' AND EXISTS (SELECT 1 FROM quote_qs_reviews review WHERE review.workspace_id = quote.workspace_id AND review.quote_id = quote.id AND review.status = 'with_qs')`),
  "quote.internal_approved": quote(`quote.status = 'internal_approved'`),
  "quote.sent": quote(`quote.status = 'issued' AND (quote.valid_until IS NULL OR quote.valid_until >= ${TODAY})`),
  "quote.accepted": quote(`quote.status = 'accepted'`),
  "quote.declined": quote(`quote.status = 'declined'`),
  "quote.expired": quote(`(quote.status = 'expired' OR (quote.status = 'issued' AND quote.valid_until < ${TODAY}))`),
  "quote.discount_pending": quote(`quote.status = 'internal_review' AND EXISTS (SELECT 1 FROM workspace_quotation_settings settings WHERE settings.workspace_id = quote.workspace_id
    AND settings.discount_approval_percent IS NOT NULL AND quote.discount > 0 AND quote.discount * 100 > settings.discount_approval_percent * (quote.total + quote.discount))`),
  "quote.revision": quote(`quote.number > 1 AND quote.family_id IS NOT NULL`),
  "deal.waiting_finance": deal("pending_finance"),
  "deal.waiting_approval": deal("pending_approval"),
  "deal.released": deal("approved"),
  "project.on_hold": project(`project.status = 'on_hold'`),
  "project.completed": project(`project.status = 'completed' AND EXISTS (SELECT 1 FROM handover_packs pack WHERE pack.workspace_id = project.workspace_id AND pack.project_id = project.id
    AND pack.status = 'accepted')`),
  "project.at_risk": project(`project.status = 'active' AND project.health IN ('at_risk', 'off_track')`),
  "project.over_budget": project(`project.status IN ('active', 'on_hold') AND EXISTS (SELECT 1 FROM purchase_order_lines line JOIN purchase_orders purchase
    ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id WHERE line.workspace_id = project.workspace_id AND line.project_id = project.id
    AND purchase.notes LIKE '%over the budget%')`),
  "project.costs": project(`EXISTS (SELECT 1 FROM petty_cash_claims claim WHERE claim.workspace_id = project.workspace_id AND claim.project_id = project.id AND claim.status IN ('approved', 'reimbursed'))
    AND EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id AND report.status = 'approved')
    AND EXISTS (SELECT 1 FROM purchase_order_lines line JOIN supplier_invoice_lines billed ON billed.workspace_id = line.workspace_id AND billed.order_line_id = line.id
      WHERE line.workspace_id = project.workspace_id AND line.project_id = project.id)`),
  "project.committed": project(`project.status IN ('active', 'on_hold') AND EXISTS (SELECT 1 FROM purchase_order_lines line JOIN purchase_orders purchase
    ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id WHERE line.workspace_id = project.workspace_id AND line.project_id = project.id
    AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received'))`),
  "project.budget": project(`EXISTS (SELECT 1 FROM project_scope_seals seal JOIN commercial_quote_lines line ON line.workspace_id = seal.workspace_id AND line.quote_id = seal.quote_id
    WHERE seal.workspace_id = project.workspace_id AND seal.project_id = project.id AND line.unit_cost > 0)`),
  "change.draft": change("draft"),
  "change.pricing": change("pricing"),
  "change.with_qs": `SELECT 'CR-' || lpad(change.number::text, 3, '0') || ' · ' || change.title AS ref FROM change_requests change JOIN quote_qs_reviews review
    ON review.workspace_id = change.workspace_id AND review.quote_id = change.quote_id AND review.status = 'with_qs'
    WHERE change.workspace_id = $1 AND change.status = 'pricing' AND ${REGIONAL(PROJECT_PARTY("change.project_id"))} LIMIT 1`,
  "change.waiting_approval": change("pending_approval"),
  "change.with_client": change("with_client"),
  "change.applied": change("applied"),
  "change.declined": change("declined"),
  "po.draft": order(`purchase.status = 'draft'`),
  "po.sent": order(`purchase.status IN ('sent', 'confirmed')`),
  "po.part_received": order(`purchase.status = 'partly_received'`),
  "po.received": order(`purchase.status IN ('received', 'closed')`),
  "po.billed": order(`EXISTS (SELECT 1 FROM purchase_order_lines line JOIN supplier_invoice_lines billed ON billed.workspace_id = line.workspace_id AND billed.order_line_id = line.id
    JOIN supplier_invoices bill ON bill.workspace_id = billed.workspace_id AND bill.id = billed.invoice_id AND bill.status IN ('held', 'approved')
    WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id)`),
  "po.late": order(`purchase.status IN ('sent', 'confirmed', 'partly_received') AND ${OUTSTANDING_LINE}`),
  "bill.due": bill(`bill.status = 'approved' AND bill.due_date >= ${TODAY} AND ${BILL_BALANCE}`),
  "bill.overdue": bill(`bill.status = 'approved' AND bill.due_date < ${TODAY} AND ${BILL_BALANCE}`),
  "invoice.issued": invoice(`invoice.due_date >= ${TODAY} AND NOT ${INVOICE_PAID}`),
  "invoice.overdue": invoice(`invoice.due_date < ${TODAY} AND NOT ${INVOICE_PAID}`),
  "invoice.paid": invoice(INVOICE_PAID),
  "receipt.verified": receipt("finance_verified"),
  "receipt.pending": receipt("reported"),
  "ledger.on": `SELECT entity.display_name || ' · ' || settings.template_code || ' from ' || settings.start_date AS ref FROM books_settings settings
    JOIN legal_entities entity ON entity.workspace_id = settings.workspace_id AND entity.id = settings.legal_entity_id WHERE settings.workspace_id = $1 AND settings.enabled LIMIT 1`,
  "ledger.statements_source": `SELECT 'Statements from the Ledger' AS ref FROM books_statement_sources source WHERE source.workspace_id = $1 AND source.source = 'ledger' LIMIT 1`,
  "ledger.posted": `SELECT count(*)::text || ' journals' AS ref FROM books_journals journal WHERE journal.workspace_id = $1 HAVING count(*) > 0`,
};

export type ProbeQuery = (sql: string, values: unknown[]) => Promise<Array<{ ref: string | null }>>;

/** The query for one scenario; null for one this pass doesn't probe. */
export function probeSql(spec: ScenarioSpec): string | null {
  if (FIXED[spec.key]) return FIXED[spec.key];
  if (PASS_TWO_PROBES[spec.key]) return PASS_TWO_PROBES[spec.key];
  if (spec.key.startsWith("sales.enquiry_type.")) {
    const code = spec.key.slice("sales.enquiry_type.".length).replace(/'/g, "''");
    return lead(`enquiry.service_type = '${code}'`);
  }
  if (spec.key.startsWith("sales.opportunity.")) {
    const code = spec.key.slice("sales.opportunity.".length).replace(/'/g, "''");
    return `SELECT opportunity.title AS ref FROM crm_opportunities opportunity JOIN crm_pipeline_stages stage ON stage.workspace_id = opportunity.workspace_id AND stage.id = opportunity.stage_id
      WHERE opportunity.workspace_id = $1 AND stage.code = '${code}' AND ${REGIONAL("opportunity.party_id")} LIMIT 1`;
  }
  if (spec.key.startsWith("project.stage.")) return stageProject(spec.key.slice("project.stage.".length));
  return null;
}

/** Each scenario's example now (null: none, or not probed). */
export async function probeScenarios(client: Pick<PoolClient, "query">, workspaceId: string, country: string, matrix: readonly ScenarioSpec[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  for (const spec of matrix) {
    const sql = probeSql(spec);
    if (!sql) { found.set(spec.key, null); continue; }
    const row = (await client.query<{ ref: string | null }>(sql, sql.includes("$2") ? [workspaceId, country] : [workspaceId])).rows[0];
    found.set(spec.key, row?.ref ?? null);
  }
  return found;
}
