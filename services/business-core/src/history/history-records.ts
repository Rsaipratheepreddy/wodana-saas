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
  /**
   * The module's own event log, when it is richer than the audit trail for this record (a purchase order's chases and
   * shipments): rows shaped as audit rows (id, action, entity_type, entity_id, source, occurred_at, before, after,
   * actor_user_id) for $1 = workspace, $2 = record. The audit rows it replaces are left out of `where`.
   */
  events?: string;
  /** Audit entity types that are this record itself (their events take the record's own reference). */
  own: string[];
};

/**
 * The commercial case's own log (every quotation, payment, agreement and deal step since the case began, kept with
 * the case): its staff entries carry the person's name, its portal entries the client's. A staff command now also
 * writes an audit row (with the amount of a verified payment); a log entry with that row beside it is left out, so
 * nothing shows twice and older entries still show.
 */
const commercialLog = (only = "") => `SELECT (entry->>'id')::uuid,
    'commercial.' || regexp_replace(lower(btrim(regexp_replace(entry->>'action', '\\s*\\(portal\\)|\\s+CR-\\d+', '', 'g'))), '\\s+', '_', 'g'),
    'commercial_case', commercial.case_id, CASE WHEN entry->>'action' LIKE '%(portal)%' THEN 'client_portal' ELSE 'user' END, (entry->>'at')::timestamptz, NULL::jsonb,
    jsonb_strip_nulls(jsonb_build_object('quoteId', entry->>'quoteId', 'note', nullif(entry->>'note', ''), 'by', nullif(entry->>'actor', ''),
      'number', substring(entry->>'action' from 'CR-[0-9]+'))), NULL::uuid
  FROM commercial_cases commercial CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(commercial.content->'audit') = 'array' THEN commercial.content->'audit' ELSE '[]'::jsonb END) entry
  WHERE commercial.workspace_id = $1 AND commercial.case_id = %CASE%
    AND entry->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND entry->>'at' ~ '^[0-9]{4}-'${only}
    AND NOT EXISTS (SELECT 1 FROM audit_events audited WHERE audited.workspace_id = $1 AND audited.entity_type = 'commercial_case' AND audited.entity_id = commercial.case_id
      AND audited.action = 'commercial.' || (entry->>'action') || '.v1' AND audited.occurred_at BETWEEN (entry->>'at')::timestamptz - interval '5 seconds' AND (entry->>'at')::timestamptz + interval '5 seconds')`;

const one = async (db: Db, sql: string, params: unknown[]) => (await db.query<RecordFacts>(sql, params)).rows[0] ?? null;
const approvalOf = (id = "$2::text") => `(e.entity_type = 'approval_request' AND e.after->>'subjectId' = ${id})`;

export const RECORD_SPECS: Record<HistoryRecordType, RecordSpec> = {
  lead: {
    permissions: ["crm.leads.view"],
    own: ["crm_lead"],
    record: (db, workspaceId, id) => one(db, `SELECT NULL::text AS reference, party.display_name AS title, NULL::uuid AS "caseId", NULL::uuid AS "projectId"
      FROM crm_leads lead LEFT JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id WHERE lead.workspace_id = $1 AND lead.id = $2`, [workspaceId, id]),
    // PLM-094: the enquiry, its lead and its client, and the follow-ups on it.
    where: `((e.entity_type = 'crm_lead' AND e.entity_id = $2)
      OR (e.entity_type = 'crm_enquiry' AND e.entity_id = (SELECT enquiry_id FROM crm_leads WHERE workspace_id = $1 AND id = $2))
      OR (e.entity_type = 'crm_party' AND e.entity_id = (SELECT party_id FROM crm_leads WHERE workspace_id = $1 AND id = $2))
      OR (e.entity_type = 'crm_activity' AND e.after->>'leadId' = $2::text))`,
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
    events: commercialLog().replace("%CASE%", "$2::uuid"),
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
    events: commercialLog().replace("%CASE%", "$2::uuid"),
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
    events: commercialLog(" AND entry->>'action' ~ '(owner_review|deal_finance|payment|agreement|release|record_decision|Client accept)'")
      .replace("%CASE%", "(SELECT case_id FROM commercial_deal_files WHERE workspace_id = $1 AND id = $2::text)"),
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
    // The order's own log has every step (approval, sending, chasing, shipments, deliveries and inspections).
    where: "FALSE",
    events: `SELECT event.id, 'purchase_order.' || event.kind, 'purchase_order', event.order_id, 'user', event.at, NULL::jsonb, event.detail, event.actor_id
      FROM purchase_order_events event WHERE event.workspace_id = $1 AND event.order_id = $2::uuid`,
  },
  work_order: {
    permissions: ["factory.view"],
    own: ["work_order"],
    record: (db, workspaceId, id) => one(db, `SELECT 'WO-' || lpad(number::text, 4, '0') AS reference, title, NULL::uuid AS "caseId", project_id AS "projectId" FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]),
    where: "FALSE",
    events: `SELECT event.id, 'work_order.' || event.kind, 'work_order', event.work_order_id, 'user', event.at, NULL::jsonb, event.detail, event.actor_id
      FROM work_order_events event WHERE event.workspace_id = $1 AND event.work_order_id = $2::uuid`,
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
    where: `(${approvalOf()} OR (e.entity_type <> 'finance_request' AND e.after->>'financeRequestId' = $2::text))`,
    events: `SELECT event.id, 'finance_request.' || event.kind, 'finance_request', event.request_id, 'user', event.occurred_at,
        CASE WHEN event.from_status IS NULL THEN NULL ELSE jsonb_build_object('status', event.from_status) END,
        jsonb_strip_nulls(jsonb_build_object('status', event.to_status, 'note', nullif(event.note, ''))), event.actor_id
      FROM finance_request_events event WHERE event.workspace_id = $1 AND event.request_id = $2::uuid`,
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
