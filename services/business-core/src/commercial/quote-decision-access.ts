import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;
type Can = (code: string) => Promise<boolean>;

/**
 * Who may record a client's decision given outside the portal (a signed PDF, a WhatsApp, a call) — Q-24.
 *   approver  holds commercial.approve, as before; evidence is welcome but optional.
 *   sales     holds commercial.record_decision, or owns the case or its opportunity and can edit it; the
 *             method and an evidence file are required, and the estimators and deal approvers are told.
 * Null when neither.
 */
export async function decisionRecorder(db: Db, can: Can, input: { workspaceId: string; caseId: string; userId: string }): Promise<"approver" | "sales" | null> {
  if (await can("commercial.approve")) return "approver";
  if (await can("commercial.record_decision")) return "sales";
  if (!(await can("pre_projects.edit"))) return null;
  const owner = await db.query(
    `SELECT 1 FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       JOIN workspace_memberships membership ON membership.workspace_id = pre_case.workspace_id AND membership.user_id = $3 AND membership.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2
        AND membership.id IN (pre_case.owner_membership_id, opportunity.owner_membership_id)`,
    [input.workspaceId, input.caseId, input.userId]);
  return owner.rowCount ? "sales" : null;
}

export type DecisionEvidenceFile = { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean };

/** The uploaded case file offered as evidence of the client's decision; it must belong to this case. */
export async function decisionEvidenceFile(db: Db, workspaceId: string, caseId: string, assetId: string): Promise<DecisionEvidenceFile | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) return null;
  const row = (await db.query<{ id: string; name: string; mimeType: string; byteSize: string | number; hasPreview: boolean }>(
    `SELECT id, original_name AS name, mime_type AS "mimeType", byte_size AS "byteSize", preview_key IS NOT NULL AS "hasPreview"
       FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, assetId])).rows[0];
  return row ? { ...row, byteSize: Number(row.byteSize) } : null;
}
