import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The records that show a history, who may read it, and which audit events belong to it. A record's history is its
 * own events plus the events of what hangs off it (an order's deliveries, a case's designs, an approval of it).
 * `where` is a condition on `audit_events e` with $1 = workspace and $2 = the record's id.
 */
export const HISTORY_RECORD_TYPES = [
  "lead", "opportunity", "planning_case", "design", "quotation", "deal_file", "project", "change_request", "purchase_order", "work_order",
  "invoice", "finance_request", "snag", "site_report",
] as const;
export type HistoryRecordType = (typeof HISTORY_RECORD_TYPES)[number];

export type RecordFacts = { reference: string | null; title: string | null; caseId: string | null; projectId: string | null };

export type RecordSpec = {
  /** Any one of these lets a member read the record (and so its history). */
  permissions: string[];
  /** The record itself (null when it isn't in the workspace); `userId` narrows records a member may only see when they are theirs. */
  record: (db: Db, workspaceId: string, id: string, scope: { userId: string; granted: Set<string> }) => Promise<RecordFacts | null>;
  where: string;
  /** Audit entity types that are this record itself (their events take the record's own reference). */
  own: string[];
};

const one = async (db: Db, sql: string, params: unknown[]) => (await db.query<RecordFacts>(sql, params)).rows[0] ?? null;
const approvalOf = (id = "$2::text") => `(e.entity_type = 'approval_request' AND e.after->>'subjectId' = ${id})`;

export const RECORD_SPECS: Record<HistoryRecordType, RecordSpec> = {
  lead: {
    permissions: ["crm.leads.view"],
    own: ["crm_lead"],
    record: (db, workspaceId, id) => one(db, `SELECT NULL::text AS reference, party.display_name AS title, NULL::uuid AS "caseId", NULL::uuid AS "projectId"
      FROM crm_leads lead LEFT JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id WHERE lead.workspace_id = $1 AND lead.id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'crm_lead' AND e.entity_id = $2) OR (e.entity_type = 'crm_activity' AND e.after->>'leadId' = $2::text))`,
  },
  opportunity: {
    permissions: ["crm.opportunities.view"],
    own: ["crm_opportunity"],
    record: (db, workspaceId, id) => one(db, `SELECT opportunity.reference, opportunity.title, (SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY created_at LIMIT 1) AS "caseId", NULL::uuid AS "projectId"
      FROM crm_opportunities opportunity WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'crm_opportunity' AND e.entity_id = $2) OR (e.entity_type = 'crm_activity' AND e.after->>'opportunityId' = $2::text) OR ${approvalOf()})`,
  },
  planning_case: {
    permissions: ["pre_projects.view"],
    own: ["pre_project_case"],
    record: caseFacts,
    where: `((e.entity_id = $2 AND e.entity_type IN ('pre_project_case', 'commercial_case', 'pre_project_brief'))
      OR (e.entity_type IN ('pre_project_design', 'pre_project_site_record', 'pre_project_brief', 'pre_project_item_specification', 'design_ledger_entry', 'design_package', 'pre_project_definition_baseline', 'change_request') AND e.after->>'caseId' = $2::text))`,
  },
  design: {
    permissions: ["pre_projects.view"],
    own: [],
    record: caseFacts,
    where: `((e.entity_type IN ('pre_project_design', 'design_ledger_entry', 'design_package', 'pre_project_item_specification') AND (e.entity_id = $2 OR e.after->>'caseId' = $2::text))
      OR (e.entity_type = 'pre_project_case' AND e.entity_id = $2 AND (e.action LIKE 'design.%' OR e.action LIKE 'pre_project.design%' OR e.action IN ('client_portal.design_decision', 'client_portal.moodboard_shared', 'client_portal.moodboard_replied', 'client_portal.board_comment'))))`,
  },
  quotation: {
    permissions: ["pre_projects.view"],
    own: [],
    record: caseFacts,
    where: `((e.entity_type = 'commercial_case' AND e.entity_id = $2)
      OR (e.entity_type = 'pre_project_case' AND e.entity_id = $2 AND (e.action LIKE 'quotation.%' OR e.action LIKE 'commercial.%' OR e.action = 'client_portal.quote_decision'))
      OR (e.entity_type = 'approval_request' AND e.after->>'subjectId' IN (SELECT id::text FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2)))`,
  },
  deal_file: {
    permissions: ["pre_projects.view", "crm.opportunities.view"],
    own: ["commercial_deal_file"],
    record: (db, workspaceId, id) => one(db, `SELECT reference, NULL::text AS title, case_id AS "caseId", NULL::uuid AS "projectId" FROM commercial_deal_files WHERE workspace_id = $1 AND id = $2::text`, [workspaceId, id]),
    where: `((e.entity_type = 'commercial_deal_file' AND e.entity_id = $2)
      OR (e.entity_type = 'approval_request' AND e.after->>'subjectId' IN (SELECT detail->>'ownerReviewId' FROM commercial_deal_files WHERE workspace_id = $1 AND id = $2::text))
      OR (e.entity_type IN ('commercial_case', 'pre_project_case') AND e.entity_id = (SELECT case_id FROM commercial_deal_files WHERE workspace_id = $1 AND id = $2::text)
          AND e.action ~ '(owner_review|deal_finance|deal_file|payment|agreement|release|quote_decision)'))`,
  },
  project: {
    permissions: ["projects.view"],
    own: ["project", "delivery_project"],
    record: (db, workspaceId, id) => one(db, `SELECT reference, name AS title, case_id AS "caseId", id AS "projectId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `(e.entity_type IN ('project', 'delivery_project') AND e.entity_id = $2)`,
  },
  change_request: {
    permissions: ["pre_projects.view", "projects.view"],
    own: ["change_request"],
    record: (db, workspaceId, id) => one(db, `SELECT 'CR-' || lpad(number::text, 3, '0') AS reference, title, case_id AS "caseId", project_id AS "projectId" FROM change_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'change_request' AND e.entity_id = $2) OR ${approvalOf()}
      OR (e.entity_type = 'pre_project_case' AND e.action LIKE 'change_request.%' AND e.after->>'requestId' = (SELECT esign_request_id::text FROM change_requests WHERE workspace_id = $1 AND id = $2)))`,
  },
  purchase_order: {
    permissions: ["purchasing.view"],
    own: ["purchase_order"],
    record: (db, workspaceId, id) => one(db, `SELECT number AS reference, NULL::text AS title, NULL::uuid AS "caseId", NULL::uuid AS "projectId" FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'purchase_order' AND e.entity_id = $2) OR ${approvalOf()}
      OR (e.entity_type = 'goods_receipt' AND e.entity_id IN (SELECT id FROM goods_receipts WHERE workspace_id = $1 AND order_id = $2)))`,
  },
  work_order: {
    permissions: ["factory.view"],
    own: ["work_order"],
    record: (db, workspaceId, id) => one(db, `SELECT 'WO-' || lpad(number::text, 4, '0') AS reference, title, NULL::uuid AS "caseId", project_id AS "projectId" FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `(e.entity_type = 'work_order' AND e.entity_id = $2)`,
  },
  invoice: {
    permissions: ["receivables.view"],
    own: ["client_invoice"],
    record: (db, workspaceId, id) => one(db, `SELECT number AS reference, milestone_title AS title, case_id AS "caseId", project_id AS "projectId" FROM client_invoices WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'client_invoice' AND e.entity_id = $2) OR e.after->>'invoiceId' = $2::text)`,
  },
  finance_request: {
    permissions: ["finance_requests.manage", "finance_requests.raise"],
    own: ["finance_request"],
    // Whoever only raises requests sees the history of their own.
    record: (db, workspaceId, id, scope) => one(db, `SELECT 'FR-' || lpad(number::text, 4, '0') AS reference, NULL::text AS title, case_id AS "caseId", project_id AS "projectId" FROM finance_requests
      WHERE workspace_id = $1 AND id = $2 AND ($3::boolean OR requested_by = $4)`, [workspaceId, id, scope.granted.has("finance_requests.manage"), scope.userId]),
    where: `((e.entity_type = 'finance_request' AND e.entity_id = $2) OR ${approvalOf()} OR e.after->>'financeRequestId' = $2::text)`,
  },
  snag: {
    permissions: ["projects.view"],
    own: ["work_item"],
    record: (db, workspaceId, id) => one(db, `SELECT 'SN-' || number AS reference, title, NULL::uuid AS "caseId", project_id AS "projectId" FROM work_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'work_item' AND e.entity_id = $2) OR (e.entity_type = 'project' AND (e.after->>'issueId' = $2::text OR e.after->>'workItemId' = $2::text)))`,
  },
  site_report: {
    permissions: ["projects.view"],
    own: ["site_report"],
    record: (db, workspaceId, id) => one(db, `SELECT to_char(report_date, 'YYYY-MM-DD') AS reference, NULL::text AS title, NULL::uuid AS "caseId", project_id AS "projectId" FROM site_reports WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: `((e.entity_type = 'site_report' AND e.entity_id = $2) OR (e.entity_type = 'project' AND e.after->>'reportId' = $2::text))`,
  },
};

function caseFacts(db: Db, workspaceId: string, id: string) {
  return one(db, `SELECT opportunity.reference, opportunity.title, pre_case.id AS "caseId",
      (SELECT project.id FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id LIMIT 1) AS "projectId"
    FROM pre_project_cases pre_case
    LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
   WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, id]);
}
