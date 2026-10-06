import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { balanceAfter, requestReference, type FileKind, type InvoiceKind, type MaterialLocation, type RequestKind, type RequestStatus } from "./finance-requests";

type Db = Pick<PoolClient, "query">;

/** One request as stored, with the names of what it links to. Amounts are exact decimal text. */
export type RequestRow = {
  id: string; number: number; reference: string; kind: RequestKind; status: RequestStatus; source: "manual" | "stage";
  requestedBy: string; requesterName: string; createdAt: string; updatedAt: string; version: number;
  partyId: string | null; clientName: string | null; clientType: string | null;
  opportunityId: string | null; opportunityReference: string | null; opportunityTitle: string | null;
  projectId: string | null; projectReference: string | null; projectName: string | null;
  vendorId: string | null; supplierName: string | null;
  salespersonId: string | null; salespersonName: string | null;
  legalEntityId: string | null; companyName: string | null;
  currency: string; clientEmail: string; clientTaxNumber: string;
  invoiceKind: InvoiceKind | null; caseId: string | null; quoteId: string | null; paymentStageId: string | null; paymentStageTitle: string;
  paymentTerms: string; contractReference: string; orderNumber: string; orderGross: string | null;
  paymentMethodId: string | null; paymentMethod: string; taxCode: string; taxLabel: string; taxRate: string | null;
  net: string | null; tax: string | null; total: string;
  invoiceNumber: string; reason: string; bankDetails: string;
  supplierReference: string; payNow: string | null; balance: string | null; authorisedBy: string | null; authorisedByName: string | null;
  materialLocation: MaterialLocation | null; supplierTaxNumber: string; paidOnStatement: boolean; statementAmount: string | null;
  statementCheckedAt: string | null; statementCheckedByName: string | null; remarks: string;
  financeReference: string; internalNote: string; handledBy: string | null; handledByName: string | null;
  closedByName: string | null; closedAt: string | null; closeNote: string;
  /** A payable whose supplier tax invoice isn't attached yet. */
  invoicePending: boolean;
  /** The latest approval on the engine, when the request needed one. */
  approvalStatus: "pending" | "approved" | "returned" | "rejected" | "cancelled" | "superseded" | null;
  approvedAt: string | null;
  /** The workspace's day a refund's clock starts: its approval, or its submission while not approved. */
  refundFrom: string;
};

export type RequestFilter = {
  id?: string; mine?: string; projectId?: string; opportunityId?: string; partyId?: string; statuses?: RequestStatus[]; caseId?: string; paymentStageId?: string;
};

const name = (alias: string) => `coalesce(nullif(btrim(${alias}.display_name), ''), ${alias}.primary_email)`;

/** Requests, newest first (at most 500): one, a person's own (requested or theirs as salesperson), a record's, or by status. */
export async function readRequests(db: Db, workspaceId: string, filter: RequestFilter = {}): Promise<RequestRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["request.workspace_id = $1"];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filter.id) add("request.id = ?", filter.id);
  if (filter.mine) add("(request.requested_by = ? OR request.salesperson_id = ?)", filter.mine);
  if (filter.projectId) add("request.project_id = ?", filter.projectId);
  if (filter.opportunityId) add("request.opportunity_id = ?", filter.opportunityId);
  if (filter.partyId) add("request.party_id = ?", filter.partyId);
  if (filter.statuses) add("request.status = ANY(?::text[])", filter.statuses);
  if (filter.caseId) add("request.case_id = ?", filter.caseId);
  if (filter.paymentStageId) add("request.payment_stage_id = ?", filter.paymentStageId);
  const rows = (await db.query<Omit<RequestRow, "reference" | "balance">>(
    `SELECT request.id, request.number, request.kind, request.status, request.source, request.requested_by AS "requestedBy", ${name("requester")} AS "requesterName",
            request.created_at AS "createdAt", request.updated_at AS "updatedAt", request.version,
            request.party_id AS "partyId", party.display_name AS "clientName", party.type::text AS "clientType",
            request.opportunity_id AS "opportunityId", opportunity.reference AS "opportunityReference", opportunity.title AS "opportunityTitle",
            request.project_id AS "projectId", project.reference AS "projectReference", project.name AS "projectName",
            request.vendor_id AS "vendorId", vendor.display_name AS "supplierName",
            request.salesperson_id AS "salespersonId", ${name("salesperson")} AS "salespersonName",
            request.legal_entity_id AS "legalEntityId", coalesce(nullif(entity.display_name, ''), entity.registered_name) AS "companyName",
            request.currency, request.client_email AS "clientEmail", request.client_tax_number AS "clientTaxNumber",
            request.invoice_kind AS "invoiceKind", request.case_id AS "caseId", request.quote_id AS "quoteId", request.payment_stage_id AS "paymentStageId",
            request.payment_stage_title AS "paymentStageTitle", request.payment_terms AS "paymentTerms", request.contract_reference AS "contractReference",
            request.order_number AS "orderNumber", request.order_gross::text AS "orderGross", request.payment_method_id AS "paymentMethodId",
            request.payment_method AS "paymentMethod", request.tax_code AS "taxCode", request.tax_label AS "taxLabel", request.tax_rate::text AS "taxRate",
            request.net_amount::text AS net, request.tax_amount::text AS tax, request.total_amount::text AS total,
            request.invoice_number AS "invoiceNumber", request.reason, request.bank_details AS "bankDetails",
            request.supplier_reference AS "supplierReference", request.pay_now_amount::text AS "payNow", request.authorised_by AS "authorisedBy",
            ${name("authoriser")} AS "authorisedByName", request.material_location AS "materialLocation", request.supplier_tax_number AS "supplierTaxNumber",
            request.paid_on_statement AS "paidOnStatement", request.statement_amount::text AS "statementAmount", request.statement_checked_at AS "statementCheckedAt",
            ${name("checker")} AS "statementCheckedByName", request.remarks, request.finance_reference AS "financeReference", request.internal_note AS "internalNote",
            request.handled_by AS "handledBy", ${name("handler")} AS "handledByName", ${name("closer")} AS "closedByName", request.closed_at AS "closedAt",
            request.close_note AS "closeNote",
            (request.kind = 'payable' AND NOT EXISTS (SELECT 1 FROM finance_request_files file WHERE file.workspace_id = request.workspace_id
              AND file.request_id = request.id AND file.kind = 'tax_invoice')) AS "invoicePending",
            approval.status AS "approvalStatus", approval.decided_at AS "approvedAt",
            (CASE WHEN approval.status = 'approved' THEN approval.decided_at ELSE request.created_at END
              AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "refundFrom"
       FROM finance_requests request
       JOIN workspaces workspace ON workspace.id = request.workspace_id
       JOIN users requester ON requester.id = request.requested_by
       LEFT JOIN crm_parties party ON party.id = request.party_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.id = request.opportunity_id
       LEFT JOIN delivery_projects project ON project.workspace_id = request.workspace_id AND project.id = request.project_id
       LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = request.workspace_id AND vendor.id = request.vendor_id
       LEFT JOIN legal_entities entity ON entity.workspace_id = request.workspace_id AND entity.id = request.legal_entity_id
       LEFT JOIN users salesperson ON salesperson.id = request.salesperson_id
       LEFT JOIN users authoriser ON authoriser.id = request.authorised_by
       LEFT JOIN users checker ON checker.id = request.statement_checked_by
       LEFT JOIN users handler ON handler.id = request.handled_by
       LEFT JOIN users closer ON closer.id = request.closed_by
       LEFT JOIN LATERAL (SELECT item.status, item.decided_at FROM approval_requests item
                           WHERE item.workspace_id = request.workspace_id AND item.subject_id = request.id
                             AND item.subject_kind IN ('refund', 'payable_request')
                           ORDER BY item.requested_at DESC, item.id DESC LIMIT 1) approval ON true
      WHERE ${where.join(" AND ")}
      ORDER BY request.created_at DESC, request.number DESC LIMIT 500`, values)).rows;
  return rows.map((row) => ({ ...row, reference: requestReference(row.number), balance: row.kind === "payable" && row.payNow ? balanceAfter(row.total, row.payNow) : null }));
}

export type RequestLine = { id: string; position: number; description: string; quantity: string; unitPrice: string; amount: string };
export async function readLines(db: Db, workspaceId: string, requestId: string): Promise<RequestLine[]> {
  return (await db.query<RequestLine>(
    `SELECT id, position, description, quantity::text AS quantity, unit_price::text AS "unitPrice", amount::text AS amount
       FROM finance_request_lines WHERE workspace_id = $1 AND request_id = $2 ORDER BY position`, [workspaceId, requestId])).rows;
}

export type RequestFile = { id: string; kind: FileKind; name: string; contentType: string; uploadedByName: string; uploadedAt: string };
export async function readFiles(db: Db, workspaceId: string, requestId: string): Promise<RequestFile[]> {
  return (await db.query<RequestFile>(
    `SELECT file.id, file.kind, file.name, file.content_type AS "contentType", ${name("uploader")} AS "uploadedByName", file.uploaded_at AS "uploadedAt"
       FROM finance_request_files file JOIN users uploader ON uploader.id = file.uploaded_by
      WHERE file.workspace_id = $1 AND file.request_id = $2 ORDER BY file.uploaded_at`, [workspaceId, requestId])).rows;
}

export type RequestEvent = { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string; actorName: string | null; occurredAt: string };
export async function readEvents(db: Db, workspaceId: string, requestId: string): Promise<RequestEvent[]> {
  return (await db.query<RequestEvent>(
    `SELECT event.id, event.kind, event.from_status AS "fromStatus", event.to_status AS "toStatus", event.note, ${name("actor")} AS "actorName",
            event.occurred_at AS "occurredAt"
       FROM finance_request_events event LEFT JOIN users actor ON actor.id = event.actor_id
      WHERE event.workspace_id = $1 AND event.request_id = $2 ORDER BY event.occurred_at, event.id`, [workspaceId, requestId])).rows;
}

/**
 * A request as this viewer may read it: Finance's internal note and the client's bank details stay with
 * Finance; everyone else learns only that bank details were given.
 */
export function present(row: RequestRow, finance: boolean) {
  const { internalNote, bankDetails, ...rest } = row;
  return { ...rest, internalNote: finance ? internalNote : null, bankDetails: finance ? bankDetails : null, hasBankDetails: bankDetails.length > 0 };
}
export type PresentedRequest = ReturnType<typeof present>;

/** "AED 10,500.00" for notices and emails (server-rendered English, like their subjects). */
export function moneyText(amount: string, currency: string) {
  const places = currencyDecimals(currency);
  const [whole, fraction] = Dec.of(amount).toFixed(places).split(".");
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

export const KIND_NAME: Record<RequestKind, string> = { invoice: "Invoice", refund: "Refund", payable: "Payable" };

/** The settings, or the product defaults (no inbox, no refund days, no automatic stage requests). */
export type RequestSettings = { financeInbox: string | null; refundDays: number | null; stageInvoiceRequests: boolean; version: number };
export async function readSettings(db: Db, workspaceId: string): Promise<RequestSettings> {
  const row = (await db.query<RequestSettings>(
    `SELECT finance_inbox AS "financeInbox", refund_days AS "refundDays", stage_invoice_requests AS "stageInvoiceRequests", version
       FROM finance_request_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ?? { financeInbox: null, refundDays: null, stageInvoiceRequests: false, version: 0 };
}

export type PaymentMethod = { id: string; label: string; refundGuidance: string; needsBankDetails: boolean; position: number; version: number };
export async function readPaymentMethods(db: Db, workspaceId: string): Promise<PaymentMethod[]> {
  return (await db.query<PaymentMethod>(
    `SELECT id, label, refund_guidance AS "refundGuidance", needs_bank_details AS "needsBankDetails", position, version
       FROM finance_payment_methods WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY position, lower(label)`, [workspaceId])).rows;
}

/** People holding a permission in the workspace (active memberships). */
export async function holders(db: Db, workspaceId: string, code: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, code])).rows.map((row) => row.userId);
}

/** The people on a project's team in any of these roles (its account manager, QS, procurement…). */
export async function projectPeople(db: Db, workspaceId: string, projectId: string, roles: readonly string[]) {
  if (!roles.length) return [];
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.role_keys && $3::varchar[]`,
    [workspaceId, projectId, roles])).rows.map((row) => row.userId);
}

export async function today(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
}
