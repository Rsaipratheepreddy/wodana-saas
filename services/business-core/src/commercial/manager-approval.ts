import type { PoolClient } from "pg";
import { readCaseTeam } from "../project-core/project-team";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P8 (guide 12–16): a quotation's manager approval comes from the job's own lead designer, creative director or
 * account manager when the firm says so (Settings → Quotations → approval_team_roles): the approver must hold one of
 * those roles on this job. With no roles set, anyone who approves quotes may (the permission already checked). Returns
 * why this person can't approve, or null.
 */
export async function managerApprovalProblem(db: Db, workspaceId: string, caseId: string, userId: string): Promise<string | null> {
  const roles = (await db.query<{ roles: string[] | null }>(`SELECT approval_team_roles::text[] AS roles FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId]))
    .rows[0]?.roles ?? [];
  if (!roles.length) return null;
  const team = await readCaseTeam(db, workspaceId, caseId);
  const holders = team.filter((entry) => roles.includes(entry.role) && entry.member);
  if (!holders.length) return `Name this job's ${roles.map((role) => role.replace(/_/g, " ")).join(" or ")} first: manager approval comes from them.`;
  const memberships = (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows.map((row) => row.id);
  if (holders.some((entry) => entry.member && memberships.includes(entry.member.membershipId))) return null;
  return `Manager approval for this quotation comes from ${holders.map((entry) => `${entry.member!.name} (${entry.label})`).join(" or ")}.`;
}
