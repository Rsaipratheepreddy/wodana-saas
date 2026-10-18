import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** The enquiry type a planning case's job came in as (the questions a firm asks may depend on it). */
export async function caseJobType(db: Db, workspaceId: string, caseId: string): Promise<string | null> {
  return (await db.query<{ type: string | null }>(
    `SELECT enquiry.service_type AS type FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.type ?? null;
}

/** The enquiry type of a project's job. */
export async function projectJobType(db: Db, workspaceId: string, projectId: string): Promise<string | null> {
  const caseId = (await db.query<{ caseId: string | null }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0]?.caseId;
  return caseId ? caseJobType(db, workspaceId, caseId) : null;
}
