import type { PoolClient } from "pg";
import { designQueue } from "../pre-projects/design-notices";
import type { HomeFocusItem } from "./home-summary";

type Db = Pick<PoolClient, "query">;

/** What the person may decide, from their permissions (see WorkspacesService.homeSummary). */
export type HomeApprovalAccess = {
  /** pre_projects.view: designs waiting on them (the design queue decides which). */
  designs: boolean;
  /** pre_projects.review_designs */
  reviewDesigns: boolean;
  /** pre_projects.record_client_design_decisions */
  recordClientDesigns: boolean;
  /** commercial.estimate or commercial.approve: quotations submitted for internal review. */
  reviewQuotes: boolean;
  /** commercial.finance.verify: client payments reported and not yet verified. */
  verifyPayments: boolean;
  /** purchasing.approve: orders above the threshold, raised by someone else. */
  approveOrders: boolean;
  /** hrms.manage: leave requests from anyone else in the workspace. */
  manageLeave: boolean;
  /** projects.view: petty cash claims on the projects they manage (petty-cash.service decides who approves). */
  projects: boolean;
  /** projects.manage: every project's petty cash. */
  manageProjects: boolean;
};

export type HomeApprovalContext = { workspaceId: string; membershipId: string; userId: string };

/**
 * One kind of decision that waits on a person. Home's Today list reads approvals only through
 * `readWaitingApprovals`; the cross-module approvals list (backlog AP-1) replaces these sources with its
 * engine behind the same function, so Home needs no change when it lands.
 */
export type HomeApprovalSource = {
  key: string;
  allowed: (access: HomeApprovalAccess) => boolean;
  read: (db: Db, context: HomeApprovalContext, access: HomeApprovalAccess) => Promise<HomeFocusItem[]>;
};

const LIMIT = 20;
const iso = (value: Date | string | null) => value === null ? null : value instanceof Date ? value.toISOString() : String(value);
const segment = encodeURIComponent;
type Row = { recordId: string; parentId: string | null; title: string | null; context: string | null; due: Date | string | null };
const waiting = (source: HomeFocusItem["source"], row: Row, href: string): HomeFocusItem => ({
  id: `${source}:${row.recordId}`, source, urgency: "waiting", recordId: row.recordId,
  title: row.title ?? "", context: row.context ?? "", due: iso(row.due), href,
});

export const HOME_APPROVAL_SOURCES: HomeApprovalSource[] = [
  {
    key: "designs",
    allowed: (access) => access.designs,
    async read(db, context, access) {
      const items = await designQueue(db, context.workspaceId, context.userId, { review: access.reviewDesigns, recordClient: access.recordClientDesigns });
      const sources = { review: "design_review", record_client: "design_client", present: "design_present", revise: "design_revise" } as const;
      return items.slice(0, LIMIT).map((item) => waiting(sources[item.step], {
        recordId: item.designId, parentId: item.caseId, title: item.title, context: item.clientName, due: item.since,
      }, `/workspace/pre-projects/cases/${segment(item.caseId)}/designs?file=${segment(item.designId)}`));
    },
  },
  {
    key: "quote_review",
    allowed: (access) => access.reviewQuotes,
    async read(db, context) {
      const rows = (await db.query<Row>(
        `SELECT quote.id AS "recordId", quote.case_id::text AS "parentId", opportunity.title,
                coalesce(party.display_name, '') AS context, quote.updated_at AS due
           FROM commercial_quotes quote
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE quote.workspace_id = $1 AND quote.kind = 'quotation' AND quote.status = 'internal_review'
            AND pre_case.status NOT IN ('cancelled', 'released')
          ORDER BY quote.updated_at, quote.id LIMIT ${LIMIT}`, [context.workspaceId])).rows;
      return rows.map((row) => waiting("quote_review", row, `/workspace/pre-projects/cases/${segment(row.parentId ?? "")}/quotations?quote=${segment(row.recordId)}`));
    },
  },
  {
    key: "receipt",
    allowed: (access) => access.verifyPayments,
    async read(db, context) {
      const rows = (await db.query<Row>(
        `SELECT receipt.id AS "recordId", receipt.case_id::text AS "parentId", opportunity.title,
                coalesce(party.display_name, '') AS context,
                CASE WHEN receipt.detail->>'reportedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (receipt.detail->>'reportedAt')::timestamptz END AS due
           FROM commercial_receipts receipt
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = receipt.workspace_id AND pre_case.id = receipt.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE receipt.workspace_id = $1 AND receipt.status = 'reported' AND pre_case.status <> 'cancelled'
          ORDER BY due NULLS LAST, receipt.id LIMIT ${LIMIT}`, [context.workspaceId])).rows;
      return rows.map((row) => waiting("receipt", row, `/workspace/pre-projects/cases/${segment(row.parentId ?? "")}/approvals`));
    },
  },
  {
    key: "order_approval",
    allowed: (access) => access.approveOrders,
    async read(db, context) {
      // Someone else approves an order you raised (orders.service), so your own never wait on you.
      const rows = (await db.query<Row>(
        `SELECT purchase.id::text AS "recordId", NULL AS "parentId", purchase.number AS title,
                coalesce(vendor.display_name, '') AS context, purchase.updated_at AS due
           FROM purchase_orders purchase
           LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
          WHERE purchase.workspace_id = $1 AND purchase.status = 'pending_approval'
            AND purchase.created_by <> $2 AND coalesce(purchase.submitted_by, purchase.created_by) <> $2
          ORDER BY purchase.updated_at, purchase.id LIMIT ${LIMIT}`, [context.workspaceId, context.userId])).rows;
      return rows.map((row) => waiting("order_approval", row, `/workspace/purchasing/orders?order=${segment(row.recordId)}`));
    },
  },
  {
    key: "petty_cash",
    allowed: (access) => access.projects || access.manageProjects,
    async read(db, context, access) {
      // The project's manager (or whoever manages every project) decides, never the person who claimed it.
      const rows = (await db.query<Row>(
        `SELECT claim.id::text AS "recordId", claim.project_id::text AS "parentId", person.display_name AS title,
                project.name AS context, claim.submitted_at AS due
           FROM petty_cash_claims claim
           JOIN delivery_projects project ON project.workspace_id = claim.workspace_id AND project.id = claim.project_id
           JOIN users person ON person.id = claim.claimed_by
          WHERE claim.workspace_id = $1 AND claim.status = 'submitted' AND claim.claimed_by <> $2
            AND ($4::boolean OR EXISTS (SELECT 1 FROM project_assignments seat WHERE seat.workspace_id = claim.workspace_id
              AND seat.project_id = claim.project_id AND seat.membership_id = $3 AND seat.active AND seat.is_manager))
          ORDER BY claim.submitted_at NULLS LAST, claim.id LIMIT ${LIMIT}`,
        [context.workspaceId, context.userId, context.membershipId, access.manageProjects])).rows;
      return rows.map((row) => waiting("petty_cash", row, `/workspace/projects/${segment(row.parentId ?? "")}/petty-cash?claim=${segment(row.recordId)}`));
    },
  },
  {
    key: "leave",
    allowed: (access) => access.manageLeave,
    async read(db, context) {
      const rows = (await db.query<Row>(
        `SELECT request.id::text AS "recordId", NULL AS "parentId", person.display_name AS title,
                coalesce(kind.name, '') AS context, request.created_at AS due
           FROM hrms_leave_requests request
           JOIN workspace_memberships member ON member.workspace_id = request.workspace_id AND member.id = request.membership_id
           JOIN users person ON person.id = member.user_id
           LEFT JOIN hrms_leave_types kind ON kind.workspace_id = request.workspace_id AND kind.id = request.leave_type_id
          WHERE request.workspace_id = $1 AND request.status = 'pending' AND request.membership_id <> $2
          ORDER BY request.created_at, request.id LIMIT ${LIMIT}`, [context.workspaceId, context.membershipId])).rows;
      return rows.map((row) => waiting("leave", row, "/workspace/hrms/team"));
    },
  },
];

/** Every decision waiting on the person, oldest first, from the sources they may decide. */
export async function readWaitingApprovals(db: Db, context: HomeApprovalContext, access: HomeApprovalAccess, sources = HOME_APPROVAL_SOURCES): Promise<HomeFocusItem[]> {
  const items: HomeFocusItem[] = [];
  for (const source of sources) if (source.allowed(access)) items.push(...await source.read(db, context, access));
  return items.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
