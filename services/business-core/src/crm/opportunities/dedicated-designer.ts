import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** PLM-088: the designer chosen at the intro meeting follows the client into Design & Planning. */
export async function assignDesignerToCase(db: Db, workspaceId: string, caseId: string) {
  await db.query(
    `INSERT INTO project_assignments (workspace_id, case_id, membership_id, is_manager)
     SELECT designer.workspace_id, pre_case.id, designer.membership_id, false
       FROM pre_project_cases pre_case
       JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2
     ON CONFLICT (workspace_id, case_id, membership_id) WHERE case_id IS NOT NULL DO UPDATE SET active = true`,
    [workspaceId, caseId]);
}

/** The dedicated designer for the case's opportunity, if one was chosen. */
export async function caseDesigner(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ membershipId: string }>(
    `SELECT designer.membership_id AS "membershipId" FROM pre_project_cases pre_case
       JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.membershipId ?? null;
}
