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

/**
 * PLM-151: the lead designer allocated on the case becomes the opportunity's dedicated designer, so everything that
 * follows "the designer" (notices, appointments, the client's portal) follows the lead. The change is kept in the
 * designer history with its reason. Nothing is written when they are already the designer.
 */
export async function setDedicatedDesigner(db: Db, workspaceId: string, opportunityId: string, membershipId: string, reason: string, userId: string) {
  const current = (await db.query<{ membershipId: string }>(`SELECT membership_id AS "membershipId" FROM crm_opportunity_designer WHERE workspace_id = $1 AND opportunity_id = $2 FOR UPDATE`,
    [workspaceId, opportunityId])).rows[0]?.membershipId ?? null;
  if (current === membershipId) return false;
  await db.query(
    `INSERT INTO crm_opportunity_designer (workspace_id, opportunity_id, membership_id, assigned_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, opportunity_id) DO UPDATE SET membership_id = excluded.membership_id, assigned_by = excluded.assigned_by, assigned_at = now(),
       version = crm_opportunity_designer.version + 1`, [workspaceId, opportunityId, membershipId, userId]);
  await db.query(`INSERT INTO crm_opportunity_designer_history (workspace_id, opportunity_id, from_membership_id, to_membership_id, reason, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [workspaceId, opportunityId, current, membershipId, reason, userId]);
  if (current) await db.query(`DELETE FROM crm_opportunity_team WHERE workspace_id = $1 AND opportunity_id = $2 AND membership_id = $3 AND role = 'designer'`, [workspaceId, opportunityId, current]);
  await db.query(`INSERT INTO crm_opportunity_team (workspace_id, opportunity_id, membership_id, role) VALUES ($1, $2, $3, 'designer') ON CONFLICT DO NOTHING`, [workspaceId, opportunityId, membershipId]);
  return true;
}

/** The dedicated designer for the case's opportunity, if one was chosen. */
export async function caseDesigner(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ membershipId: string }>(
    `SELECT designer.membership_id AS "membershipId" FROM pre_project_cases pre_case
       JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.membershipId ?? null;
}
