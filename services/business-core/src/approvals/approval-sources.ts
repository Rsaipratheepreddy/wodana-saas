import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** The chips on the Approvals page, one per kind of work. */
export const APPROVAL_GROUPS = ["quotes", "payments", "deals", "orders", "factory", "site", "stock", "finance", "ai"] as const;
export type ApprovalGroup = (typeof APPROVAL_GROUPS)[number];

export type ApprovalKind =
  | "quote_review" | "receipt" | "agreement" | "deal_finance" | "deal_approval" | "order" | "output" | "material_swap"
  | "site_report" | "petty_cash" | "snag" | "warranty" | "stock_correction" | "bill" | "payment_run" | "reimbursement"
  // A started project's payment milestone falling due (within 3 days, or past) that nobody has invoiced (D-14).
  | "invoice"
  // A change an AI app prepared through MCP (W-5): the person it acts as confirms it in Wodana.
  | "ai_action";

/** What deciding in the row does: approve, and whether the other answer is a return or a refusal (with a note). */
export type RowDecision = { approve: string; other: "return" | "reject" | null; approveNeedsNote: boolean };

export type ApprovalRow = {
  kind: ApprovalKind;
  group: ApprovalGroup;
  id: string;
  /** What it is, as people say it: "PO-0042 · Al Noor Timber", "Q-118 · Kitchen". */
  title: string;
  /** The title as a sentence the web translates (an English key with {placeholders}), when there is one. */
  phrase?: { key: string; values?: Record<string, string | number> } | null;
  /** The client, supplier or item it's about. */
  subject: string | null;
  project: { id: string; reference: string | null; name: string } | null;
  amount: string | null;
  currency: string | null;
  /** When it started waiting. */
  since: string;
  href: string;
  canDecide: boolean;
  /** Why this person can't decide it (their own work). */
  reason: string | null;
  /** In-row decision; null means it opens (the evidence or a form is needed). */
  decide: RowDecision | null;
  /** The record's version or the case revision, sent back with a decision. */
  version: number | null;
  /** The record the decision is sent to when it isn't the row itself (a work order, a case, a project). */
  parentId: string | null;
  /** A look at what's being approved: a daily report's words for the client, its lead photo and how many photos it has. */
  preview?: { text: string; photoId: string | null; photos: number } | null;
};

export type ApprovalContext = {
  workspaceId: string;
  userId: string;
  displayName: string;
  membershipId: string | null;
  can: (permission: string) => Promise<boolean>;
  /** Projects this person manages (a named project manager). */
  managedProjects: ReadonlySet<string>;
  currency: string;
};

const OWN = "It's your own; someone else decides.";

type Source = (db: Db, ctx: ApprovalContext) => Promise<ApprovalRow[]>;

const project = (row: { projectId: string | null; projectReference: string | null; projectName: string | null }) =>
  row.projectId ? { id: row.projectId, reference: row.projectReference, name: row.projectName ?? "" } : null;
const iso = (value: string | Date | null | undefined) => (value instanceof Date ? value.toISOString() : value ?? new Date(0).toISOString());
const row = (input: Omit<ApprovalRow, "canDecide" | "reason" | "version" | "parentId" | "subject" | "since"> & {
  own: boolean; since: string | Date | null; version?: number | null; parentId?: string | null; subject?: string | null;
}): ApprovalRow => {
  const { own, since, ...rest } = input;
  return { subject: null, version: null, parentId: null, ...rest, since: iso(since), canDecide: !own, reason: own ? OWN : null };
};

/** Quotes waiting for the QS estimate review or an approver. */
const quotes: Source = async (db, ctx) => {
  const [estimate, approve] = [await ctx.can("commercial.estimate"), await ctx.can("commercial.approve")];
  if (!estimate && !approve) return [];
  const rows = (await db.query<{ id: string; caseId: string; number: number; title: string; kind: string; amount: string; currency: string; since: Date; servicePath: boolean; revision: number; client: string }>(
    `SELECT quote.id, quote.case_id AS "caseId", quote.number, quote.title, quote.kind, quote.total::text AS amount, quote.currency, quote.updated_at AS since,
            (commercial.content ? 'servicePath' AND commercial.content->'servicePath' <> 'null'::jsonb) AS "servicePath", commercial.revision,
            coalesce(party.display_name, opportunity.title) AS client
       FROM commercial_quotes quote
       JOIN commercial_cases commercial ON commercial.workspace_id = quote.workspace_id AND commercial.case_id = quote.case_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id AND pre_case.status IN ('active', 'released')
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE quote.workspace_id = $1 AND quote.status = 'internal_review'
      ORDER BY quote.updated_at LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.filter((quote) => (quote.servicePath && quote.kind === "quotation" ? estimate : approve)).map((quote) => row({
    kind: "quote_review", group: "quotes", id: quote.id, title: `Q-${quote.number} · ${quote.title}`, subject: quote.client, project: null,
    amount: quote.amount, currency: quote.currency, since: quote.since, own: false, version: quote.revision, parentId: quote.caseId,
    href: `/workspace/pre-projects/cases/${quote.caseId}/quotations?quote=${quote.id}`,
    decide: { approve: quote.servicePath && quote.kind === "quotation" ? "qs_approve" : "approve", other: "return", approveNeedsNote: false },
  }));
};

/** Client payments reported and waiting for Finance to verify them. */
const receipts: Source = async (db, ctx) => {
  if (!(await ctx.can("commercial.finance.verify"))) return [];
  const rows = (await db.query<{ id: string; caseId: string; paymentId: string; title: string; amount: string; currency: string; source: string; since: string | null;
    reportedById: string | null; reportedBy: string | null; revision: number; client: string; projectId: string | null; projectReference: string | null; projectName: string | null }>(
    `SELECT receipt.id, receipt.case_id AS "caseId", receipt.payment_id AS "paymentId", coalesce(payment.title, receipt.reference) AS title,
            receipt.amount::text AS amount, receipt.currency, receipt.source, receipt.detail->>'reportedAt' AS since,
            receipt.detail->>'reportedById' AS "reportedById", receipt.detail->>'reportedBy' AS "reportedBy", commercial.revision,
            coalesce(party.display_name, opportunity.title) AS client,
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM commercial_receipts receipt
       JOIN commercial_cases commercial ON commercial.workspace_id = receipt.workspace_id AND commercial.case_id = receipt.case_id
       LEFT JOIN commercial_payments payment ON payment.workspace_id = receipt.workspace_id AND payment.case_id = receipt.case_id AND payment.id = receipt.payment_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = receipt.workspace_id AND pre_case.id = receipt.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN delivery_projects project ON project.workspace_id = receipt.workspace_id AND project.case_id = receipt.case_id
      WHERE receipt.workspace_id = $1 AND receipt.status IN ('reported', 'provider_confirmed')
      ORDER BY receipt.detail->>'reportedAt' NULLS FIRST LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.map((receipt) => row({
    kind: "receipt", group: "payments", id: receipt.paymentId, title: receipt.title, subject: receipt.client, project: project(receipt),
    amount: receipt.amount, currency: receipt.currency, since: receipt.since, version: receipt.revision, parentId: receipt.caseId,
    own: receipt.source === "manual" && (receipt.reportedById ? receipt.reportedById === ctx.userId : receipt.reportedBy === ctx.displayName),
    href: `/workspace/pre-projects/cases/${receipt.caseId}/payment-plan`,
    decide: { approve: "verify_payment", other: null, approveNeedsNote: false },
  }));
};

/** Deals waiting for Finance to confirm them, then for approval. Decided on the case (commissions, evidence). */
const deals: Source = async (db, ctx) => {
  const [finance, approve] = [await ctx.can("commercial.finance.verify"), await ctx.can("commercial.deal.approve")];
  if (!finance && !approve) return [];
  const rows = (await db.query<{ caseId: string; status: string; submittedById: string | null; financeReviewedById: string | null; since: string | null;
    amount: string | null; currency: string | null; quoteNumber: number | null; client: string; title: string }>(
    `SELECT commercial.case_id AS "caseId", commercial.content->'ownerReview'->>'status' AS status,
            commercial.content->'ownerReview'->>'submittedById' AS "submittedById", commercial.content->'ownerReview'->>'financeReviewedById' AS "financeReviewedById",
            coalesce(commercial.content->'ownerReview'->>'financeReviewedAt', commercial.content->'ownerReview'->>'submittedAt') AS since,
            quote.total::text AS amount, quote.currency, quote.number AS "quoteNumber",
            coalesce(party.display_name, opportunity.title) AS client, opportunity.title
       FROM commercial_cases_view commercial
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = commercial.workspace_id AND pre_case.id = commercial.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN commercial_quotes quote ON quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id
             AND quote.id::text = commercial.content->'ownerReview'->>'quoteId'
      WHERE commercial.workspace_id = $1 AND commercial.content->'ownerReview'->>'status' IN ('pending_finance', 'pending_approval')
      LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.filter((deal) => (deal.status === "pending_finance" ? finance : approve)).map((deal) => row({
    kind: deal.status === "pending_finance" ? "deal_finance" : "deal_approval", group: "deals", id: deal.caseId, parentId: deal.caseId,
    title: deal.quoteNumber ? `${deal.title} · Q-${deal.quoteNumber}` : deal.title, subject: deal.client, project: null,
    amount: deal.amount, currency: deal.currency, since: deal.since,
    own: deal.submittedById === ctx.userId || (deal.status === "pending_approval" && deal.financeReviewedById === ctx.userId),
    href: `/workspace/pre-projects/cases/${deal.caseId}/execution-release`, decide: null,
  }));
};

/**
 * Signed agreements on record (an uploaded signed document or its description) waiting to be verified, for
 * whoever verifies agreements. Opened on the case's Agreement tab, where the signed document is.
 */
const agreements: Source = async (db, ctx) => {
  if (!(await ctx.can("commercial.approve"))) return [];
  const rows = (await db.query<{ caseId: string; reference: string | null; since: Date; revision: number; amount: string | null; currency: string | null;
    quoteNumber: number | null; client: string; title: string }>(
    `SELECT commercial.case_id AS "caseId", commercial.content->'agreement'->>'reference' AS reference, commercial.updated_at AS since, commercial.revision,
            quote.total::text AS amount, quote.currency, quote.number AS "quoteNumber",
            coalesce(party.display_name, opportunity.title) AS client, opportunity.title
       FROM commercial_cases_view commercial
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = commercial.workspace_id AND pre_case.id = commercial.case_id AND pre_case.status IN ('active', 'released')
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN commercial_quotes quote ON quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id
             AND quote.id::text = commercial.content->'agreement'->>'quoteId'
      WHERE commercial.workspace_id = $1 AND jsonb_typeof(commercial.content->'agreement') = 'object'
        AND commercial.content->'agreement'->>'status' IS DISTINCT FROM 'executed'
        AND (nullif(btrim(commercial.content->'agreement'->>'evidence'), '') IS NOT NULL
             OR jsonb_array_length(CASE WHEN jsonb_typeof(commercial.content->'agreement'->'files') = 'array' THEN commercial.content->'agreement'->'files' ELSE '[]'::jsonb END) > 0)
      ORDER BY commercial.updated_at LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.map((agreement) => row({
    kind: "agreement", group: "deals", id: agreement.caseId, parentId: agreement.caseId, version: agreement.revision,
    title: [agreement.title, agreement.reference || (agreement.quoteNumber ? `Q-${agreement.quoteNumber}` : "")].filter(Boolean).join(" · "),
    subject: agreement.client, project: null, amount: agreement.amount, currency: agreement.currency, since: agreement.since, own: false,
    href: `/workspace/pre-projects/cases/${agreement.caseId}/contracts`, decide: null,
  }));
};

/** Purchase orders waiting for approval. */
const orders: Source = async (db, ctx) => {
  if (!(await ctx.can("purchasing.approve"))) return [];
  const rows = (await db.query<{ id: string; number: string; supplier: string | null; amount: string; currency: string; since: Date; createdBy: string | null; submittedBy: string | null; version: number;
    projectId: string | null; projectReference: string | null; projectName: string | null }>(
    `SELECT purchase_order.id, purchase_order.number, vendor.display_name AS supplier, purchase_order.total::text AS amount, purchase_order.currency,
            coalesce((SELECT max(event.at) FROM purchase_order_events event WHERE event.workspace_id = purchase_order.workspace_id AND event.order_id = purchase_order.id AND event.kind = 'submitted'), purchase_order.updated_at) AS since,
            purchase_order.created_by AS "createdBy", purchase_order.submitted_by AS "submittedBy", purchase_order.version,
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM purchase_orders purchase_order
       LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = purchase_order.workspace_id AND vendor.id = purchase_order.vendor_id
       LEFT JOIN LATERAL (SELECT line.project_id FROM purchase_order_lines line WHERE line.workspace_id = purchase_order.workspace_id AND line.order_id = purchase_order.id AND line.project_id IS NOT NULL ORDER BY line.position LIMIT 1) first_line ON true
       LEFT JOIN delivery_projects project ON project.workspace_id = purchase_order.workspace_id AND project.id = first_line.project_id
      WHERE purchase_order.workspace_id = $1 AND purchase_order.status = 'pending_approval'
      ORDER BY since LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.map((order) => row({
    kind: "order", group: "orders", id: order.id, title: order.number, subject: order.supplier, project: project(order),
    amount: order.amount, currency: order.currency, since: order.since, own: order.createdBy === ctx.userId || order.submittedBy === ctx.userId, version: order.version,
    href: `/workspace/purchasing/orders?order=${order.id}`, decide: { approve: "approve", other: "return", approveNeedsNote: false },
  }));
};

/** Factory output reported and material swaps asked for, waiting for someone who approves factory work. */
const factory: Source = async (db, ctx) => {
  if (!(await ctx.can("factory.approve"))) return [];
  const reports = (await db.query<{ id: string; orderId: string; number: number; title: string; good: string; unit: string; since: Date; reportedBy: string; version: number;
    projectId: string | null; projectReference: string | null; projectName: string | null }>(
    `SELECT report.id, work_order.id AS "orderId", work_order.number, work_order.title, report.good::text AS good, work_order.unit, report.reported_at AS since, report.reported_by AS "reportedBy", work_order.version,
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM work_order_reports report
       JOIN work_orders work_order ON work_order.workspace_id = report.workspace_id AND work_order.id = report.work_order_id
       LEFT JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
      WHERE report.workspace_id = $1 AND report.status = 'pending' ORDER BY report.reported_at LIMIT 100`, [ctx.workspaceId])).rows;
  const swaps = (await db.query<{ id: string; orderId: string; number: number; title: string; since: Date; requestedBy: string;
    projectId: string | null; projectReference: string | null; projectName: string | null }>(
    `SELECT material.id, work_order.id AS "orderId", work_order.number, work_order.title, material.requested_at AS since, material.requested_by AS "requestedBy",
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM work_order_materials material
       JOIN work_orders work_order ON work_order.workspace_id = material.workspace_id AND work_order.id = material.work_order_id
       LEFT JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
      WHERE material.workspace_id = $1 AND material.status = 'pending' ORDER BY material.requested_at LIMIT 100`, [ctx.workspaceId])).rows;
  return [
    ...reports.map((report) => row({
      kind: "output", group: "factory", id: report.id, parentId: report.orderId, title: `WO-${report.number} · ${report.title}`, subject: `${report.good} ${report.unit}`,
      project: project(report), amount: null, currency: null, since: report.since, own: report.reportedBy === ctx.userId, version: report.version,
      href: `/workspace/factory/orders?order=${report.orderId}`, decide: { approve: "approve", other: "reject", approveNeedsNote: false },
    })),
    ...swaps.map((swap) => row({
      kind: "material_swap", group: "factory", id: swap.id, parentId: swap.orderId, title: `WO-${swap.number} · ${swap.title}`, project: project(swap),
      amount: null, currency: null, since: swap.since, own: swap.requestedBy === ctx.userId,
      href: `/workspace/factory/orders?order=${swap.orderId}`, decide: null,
    })),
  ];
};

/**
 * Project work a project manager decides: site reports, petty cash, snags ready to close and warranty claims.
 * Whoever manages projects sees every project's; a named project manager sees their projects'.
 */
const site: Source = async (db, ctx) => {
  const all = await ctx.can("projects.manage");
  if (!all && !ctx.managedProjects.size) return [];
  const scope = all ? null : [...ctx.managedProjects];
  const projectColumns = `project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"`;
  const reports = (await db.query<{ id: string; reportDate: string; since: Date; authorId: string; version: number; author: string | null; projectId: string; projectReference: string | null; projectName: string;
    summary: string; photoId: string | null; photos: number }>(
    `SELECT report.id, report.report_date::text AS "reportDate", report.submitted_at AS since, report.author_id AS "authorId", report.version, author.display_name AS author, ${projectColumns},
            report.client_summary AS summary,
            coalesce(report.hero_photo_id, (SELECT photo.id FROM site_report_photos photo WHERE photo.workspace_id = report.workspace_id AND photo.report_id = report.id
                                             ORDER BY photo.for_client DESC, photo.position, photo.created_at LIMIT 1)) AS "photoId",
            (SELECT count(*)::int FROM site_report_photos photo WHERE photo.workspace_id = report.workspace_id AND photo.report_id = report.id) AS photos
       FROM site_reports report JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
       LEFT JOIN users author ON author.id = report.author_id
      WHERE report.workspace_id = $1 AND report.status = 'submitted' AND ($2::uuid[] IS NULL OR report.project_id = ANY($2::uuid[]))
      ORDER BY report.submitted_at LIMIT 100`, [ctx.workspaceId, scope])).rows;
  const claims = (await db.query<{ id: string; number: number; description: string; amount: string; currency: string; since: Date; claimedBy: string; version: number;
    projectId: string; projectReference: string | null; projectName: string }>(
    `SELECT claim.id, claim.number, claim.description, claim.amount::text AS amount, claim.currency, claim.submitted_at AS since, claim.claimed_by AS "claimedBy", claim.version, ${projectColumns}
       FROM petty_cash_claims claim JOIN delivery_projects project ON project.workspace_id = claim.workspace_id AND project.id = claim.project_id
      WHERE claim.workspace_id = $1 AND claim.status = 'submitted' AND ($2::uuid[] IS NULL OR claim.project_id = ANY($2::uuid[]))
      ORDER BY claim.submitted_at LIMIT 100`, [ctx.workspaceId, scope])).rows;
  const snags = (await db.query<{ id: string; number: number; title: string; since: Date; fixedBy: string | null; assignee: string | null; projectId: string; projectReference: string | null; projectName: string }>(
    `SELECT item.id, item.number, item.title, item.updated_at AS since, item.fixed_by AS "fixedBy", item.assignee_membership_id AS assignee, ${projectColumns}
       FROM work_items item JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
      WHERE item.workspace_id = $1 AND item.type = 'snag' AND item.status = 'in_review' AND ($2::uuid[] IS NULL OR item.project_id = ANY($2::uuid[]))
      ORDER BY item.updated_at LIMIT 100`, [ctx.workspaceId, scope])).rows;
  const warranty = (await db.query<{ id: string; number: number; description: string; since: Date; projectId: string; projectReference: string | null; projectName: string }>(
    `SELECT claim.id, claim.number, claim.description, claim.created_at AS since, ${projectColumns}
       FROM warranty_claims claim JOIN delivery_projects project ON project.workspace_id = claim.workspace_id AND project.id = claim.project_id
      WHERE claim.workspace_id = $1 AND claim.status = 'open' AND ($2::uuid[] IS NULL OR claim.project_id = ANY($2::uuid[]))
      ORDER BY claim.created_at LIMIT 100`, [ctx.workspaceId, scope])).rows;
  return [
    ...reports.map((report) => row({
      kind: "site_report", group: "site", id: report.id, parentId: report.projectId, title: report.reportDate, subject: report.author, project: project(report),
      amount: null, currency: null, since: report.since, own: report.authorId === ctx.userId, version: report.version,
      // Approving in the row sends the day to the client as reviewed; opening it reviews the client's card first.
      href: `/workspace/projects/${report.projectId}/site?report=${report.id}`, decide: { approve: "approve_send", other: "return", approveNeedsNote: false },
      preview: { text: report.summary, photoId: report.photoId, photos: report.photos },
    })),
    ...claims.map((claim) => row({
      kind: "petty_cash", group: "site", id: claim.id, parentId: claim.projectId, title: `PC-${claim.number} · ${claim.description}`, project: project(claim),
      amount: claim.amount, currency: claim.currency, since: claim.since, own: claim.claimedBy === ctx.userId, version: claim.version,
      href: `/workspace/projects/${claim.projectId}/petty-cash?claim=${claim.id}`, decide: { approve: "approve", other: "reject", approveNeedsNote: false },
    })),
    ...snags.map((snag) => row({
      kind: "snag", group: "site", id: snag.id, parentId: snag.projectId, title: `#${snag.number} · ${snag.title}`, project: project(snag),
      amount: null, currency: null, since: snag.since, own: snag.fixedBy === ctx.userId || (Boolean(ctx.membershipId) && snag.assignee === ctx.membershipId),
      href: `/workspace/projects/${snag.projectId}/plan?item=${snag.id}`, decide: null,
    })),
    ...warranty.map((claim) => row({
      kind: "warranty", group: "site", id: claim.id, parentId: claim.projectId, title: `W-${claim.number} · ${claim.description}`, project: project(claim),
      amount: null, currency: null, since: claim.since, own: false, href: `/workspace/projects/${claim.projectId}/warranty`, decide: null,
    })),
  ];
};

/** Stock corrections above the firm's threshold. */
const stock: Source = async (db, ctx) => {
  if (!(await ctx.can("stock.adjust"))) return [];
  const rows = (await db.query<{ id: string; item: string; unit: string; difference: string; value: string | null; since: Date; requestedBy: string;
    projectId: string | null; projectReference: string | null; projectName: string | null }>(
    `SELECT request.id, item.name AS item, item.unit, request.difference::text AS difference, request.value::text AS value, request.requested_at AS since, request.requested_by AS "requestedBy",
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM stock_adjustment_requests request
       JOIN stock_items item ON item.workspace_id = request.workspace_id AND item.id = request.item_id
       LEFT JOIN delivery_projects project ON project.workspace_id = request.workspace_id AND project.id = request.project_id
      WHERE request.workspace_id = $1 AND request.status = 'pending' ORDER BY request.requested_at LIMIT 100`, [ctx.workspaceId])).rows;
  return rows.map((request) => row({
    kind: "stock_correction", group: "stock", id: request.id, title: request.item, subject: `${request.difference} ${request.unit}`, project: project(request),
    amount: request.value, currency: request.value === null ? null : ctx.currency, since: request.since, own: request.requestedBy === ctx.userId,
    href: "/workspace/inventory", decide: { approve: "approve", other: "reject", approveNeedsNote: false },
  }));
};

/** Held supplier bills, payment runs and approved petty cash to pay back. */
const finance: Source = async (db, ctx) => {
  const [approve, manage] = [await ctx.can("payables.approve"), await ctx.can("payables.manage")];
  const out: ApprovalRow[] = [];
  if (approve) {
    const bills = (await db.query<{ id: string; number: string; supplier: string | null; amount: string; currency: string; createdBy: string; since: Date; version: number }>(
      `SELECT bill.id, bill.number, vendor.display_name AS supplier, bill.total::text AS amount, bill.currency, bill.created_by AS "createdBy", bill.version,
              coalesce((SELECT max(audit.occurred_at) FROM audit_events audit WHERE audit.workspace_id = bill.workspace_id AND audit.entity_type = 'supplier_invoice'
                          AND audit.entity_id = bill.id AND audit.action = 'supplier_invoice.submitted'), bill.created_at) AS since
         FROM supplier_invoices bill LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
        WHERE bill.workspace_id = $1 AND bill.status = 'held' ORDER BY bill.created_at LIMIT 100`, [ctx.workspaceId])).rows;
    const runs = (await db.query<{ id: string; number: number; amount: string | null; currency: string | null; since: Date; preparedBy: string | null; createdBy: string; version: number }>(
      `SELECT run.id, run.number, run.submitted_at AS since, run.prepared_by AS "preparedBy", run.created_by AS "createdBy", run.version,
              CASE WHEN count(DISTINCT bill.currency) = 1 THEN sum(item.amount)::text END AS amount,
              CASE WHEN count(DISTINCT bill.currency) = 1 THEN min(bill.currency) END AS currency
         FROM payment_runs run
         LEFT JOIN payment_run_items item ON item.workspace_id = run.workspace_id AND item.run_id = run.id
         LEFT JOIN supplier_invoices bill ON bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id
        WHERE run.workspace_id = $1 AND run.status = 'submitted' GROUP BY run.id ORDER BY run.submitted_at LIMIT 100`, [ctx.workspaceId])).rows;
    out.push(
      ...bills.map((bill) => row({
        kind: "bill", group: "finance", id: bill.id, title: bill.number, subject: bill.supplier, project: null, amount: bill.amount, currency: bill.currency,
        since: bill.since, own: bill.createdBy === ctx.userId, version: bill.version, href: `/workspace/finance/bills?bill=${bill.id}`,
        decide: { approve: "approve", other: null, approveNeedsNote: true },
      })),
      ...runs.map((run) => row({
        kind: "payment_run", group: "finance", id: run.id, title: `Run ${run.number}`, project: null, amount: run.amount, currency: run.currency,
        since: run.since, own: run.preparedBy === ctx.userId || run.createdBy === ctx.userId, version: run.version, href: `/workspace/finance/runs?run=${run.id}`,
        decide: { approve: "approve", other: "return", approveNeedsNote: false },
      })),
    );
  }
  if (manage) {
    const claims = (await db.query<{ id: string; number: number; description: string; amount: string; currency: string; since: Date; projectId: string; projectReference: string | null; projectName: string }>(
      `SELECT claim.id, claim.number, claim.description, claim.amount::text AS amount, claim.currency, claim.decided_at AS since,
              project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
         FROM petty_cash_claims claim JOIN delivery_projects project ON project.workspace_id = claim.workspace_id AND project.id = claim.project_id
        WHERE claim.workspace_id = $1 AND claim.status = 'approved' ORDER BY claim.decided_at LIMIT 100`, [ctx.workspaceId])).rows;
    out.push(...claims.map((claim) => row({
      kind: "reimbursement", group: "finance", id: claim.id, title: `PC-${claim.number} · ${claim.description}`, project: project(claim),
      amount: claim.amount, currency: claim.currency, since: claim.since, own: false, href: `/workspace/finance/petty-cash?claim=${claim.id}`, decide: null,
    })));
  }
  return out;
};

/** Days ahead a milestone to invoice shows in the list (and in the daily notice, project-core/delivery-reminders). */
export const INVOICE_AHEAD_DAYS = 3;

/**
 * Milestones of started projects falling due within three days, or already past, with no issued invoice and no
 * payment reported or verified: "Issue invoice" for the people who invoice clients (D-14). It opens the project's
 * client money, where the invoice is issued; nothing is decided in the row.
 */
const invoices: Source = async (db, ctx) => {
  if (!(await ctx.can("receivables.manage"))) return [];
  const rows = (await db.query<{ id: string; caseId: string; title: string; amount: string; currency: string | null; dueDate: string; client: string;
    projectId: string; projectReference: string | null; projectName: string }>(
    `SELECT payment.id, payment.case_id AS "caseId", payment.title, payment.amount::text AS amount, coalesce(payment.currency, project.currency) AS currency,
            payment.due_date::text AS "dueDate", coalesce(party.display_name, opportunity.title) AS client,
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName"
       FROM commercial_payments payment
       JOIN delivery_projects project ON project.workspace_id = payment.workspace_id AND project.case_id = payment.case_id
        AND project.status = 'active' AND project.started_at IS NOT NULL
       JOIN project_scope_seals seal ON seal.workspace_id = project.workspace_id AND seal.project_id = project.id AND seal.quote_id = payment.source_quote_id
       JOIN workspaces workspace ON workspace.id = payment.workspace_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = payment.workspace_id AND pre_case.id = payment.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE payment.workspace_id = $1 AND payment.status = 'pending' AND payment.due_date IS NOT NULL
        AND payment.due_date <= (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date + $2::int
        AND NOT EXISTS (SELECT 1 FROM client_invoices invoice WHERE invoice.workspace_id = payment.workspace_id AND invoice.payment_id = payment.id
                          AND invoice.case_id = payment.case_id AND invoice.status = 'issued')
        AND NOT EXISTS (SELECT 1 FROM commercial_receipts receipt WHERE receipt.workspace_id = payment.workspace_id AND receipt.case_id = payment.case_id
                          AND receipt.payment_id = payment.id AND receipt.status <> 'rejected')
      ORDER BY payment.due_date, project.reference LIMIT 100`, [ctx.workspaceId, INVOICE_AHEAD_DAYS])).rows;
  return rows.map((milestone) => row({
    kind: "invoice", group: "payments", id: milestone.id, title: milestone.title, phrase: { key: "Issue invoice · {milestone}", values: { milestone: milestone.title } },
    subject: milestone.client, project: project(milestone), amount: milestone.amount, currency: milestone.currency, since: new Date(Date.parse(`${milestone.dueDate}T00:00:00.000Z`) - INVOICE_AHEAD_DAYS * 86_400_000),
    own: false, parentId: milestone.caseId, href: `/workspace/projects/${milestone.projectId}/money?view=client`, decide: null,
  }));
};

/**
 * Changes an AI app prepared through MCP (W-5) that wait for this person's OK: only their own, while the
 * proposal is open. Always opened (the card shows exactly what changes), never decided in the row.
 */
const aiActions: Source = async (db, ctx) => {
  const rows = (await db.query<{ id: string; summary: string; title: { key: string; values?: Record<string, string | number> } | null; since: Date; client: string | null }>(
    `SELECT call.id, call.summary, call.preview->'title' AS title, call.created_at AS since, connection.client_name AS client
       FROM ai_tool_calls call
       JOIN ai_agent_runs run ON run.workspace_id = call.workspace_id AND run.id = call.run_id AND run.surface = 'mcp'
       LEFT JOIN mcp_connections connection ON connection.workspace_id = run.workspace_id AND connection.id::text = run.context_id
      WHERE call.workspace_id = $1 AND call.requested_by = $2 AND call.status = 'proposed' AND call.expires_at > now()
      ORDER BY call.created_at LIMIT 50`, [ctx.workspaceId, ctx.userId])).rows;
  return rows.map((action) => row({
    kind: "ai_action", group: "ai", id: action.id, title: action.summary, phrase: action.title?.key ? action.title : null, subject: action.client, project: null,
    amount: null, currency: null, since: action.since, own: false, href: `/workspace/ai-actions/${action.id}`, decide: null,
  }));
};

export const APPROVAL_SOURCES: Source[] = [quotes, receipts, invoices, agreements, deals, orders, factory, site, stock, finance, aiActions];

/** Everything waiting on this person, oldest first; what they may decide before what is their own. */
export async function waitingFor(db: Db, ctx: ApprovalContext) {
  const rows: ApprovalRow[] = [];
  for (const source of APPROVAL_SOURCES) rows.push(...await source(db, ctx));
  rows.sort((left, right) => Number(right.canDecide) - Number(left.canDecide) || left.since.localeCompare(right.since));
  const counts = Object.fromEntries(APPROVAL_GROUPS.map((group) => [group, rows.filter((item) => item.group === group && item.canDecide).length])) as Record<ApprovalGroup, number>;
  return { rows, count: rows.filter((item) => item.canDecide).length, counts };
}
