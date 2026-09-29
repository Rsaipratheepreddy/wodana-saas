import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * One role vocabulary. Where configuration names people by role (a source only some may pick, say), a
 * name is a lower-case code that matches a role the member holds or a team they belong to, whichever way
 * it was typed: `SALES`, `sales` and the team role `team_sales` all mean the Sales people. Owners and
 * administrators always match. Behaviour that is not configuration checks a permission, never a name.
 */
export const ADMINISTRATOR_ROLES: readonly string[] = ["owner", "administrator"];

export function roleKey(code: string | null | undefined) {
  return (code ?? "").trim().toLowerCase();
}

/** Lower-case, trimmed, unique and sorted: how role lists are stored. */
export function normaliseRoleCodes(codes: readonly string[] | null | undefined): string[] {
  return [...new Set((codes ?? []).map(roleKey).filter(Boolean))].sort();
}

/** Whether a member with these role keys is one of the allowed roles (an empty list allows everyone). */
export function holdsAllowedRole(memberKeys: readonly string[], allowed: readonly string[] | null | undefined) {
  const wanted = normaliseRoleCodes(allowed);
  if (!wanted.length) return true;
  const held = new Set(memberKeys.map(roleKey));
  if (ADMINISTRATOR_ROLES.some((code) => held.has(code))) return true;
  return wanted.some((code) => held.has(code) || held.has(`team_${code}`) || (code.startsWith("team_") && held.has(code.slice(5))));
}

/** The member's role codes and team codes, lower-case (see `holdsAllowedRole`). */
export async function memberRoleKeys(db: Db, workspaceId: string, userId: string): Promise<string[]> {
  const rows = (await db.query<{ key: string }>(
    `SELECT DISTINCT lower(role.code) AS key
       FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN roles role ON role.id = assigned.role_id AND role.workspace_id = membership.workspace_id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
     UNION
     SELECT DISTINCT lower(team.code)
       FROM workspace_memberships membership
       JOIN workspace_team_members member ON member.membership_id = membership.id AND member.workspace_id = membership.workspace_id
       JOIN workspace_teams team ON team.id = member.team_id AND team.workspace_id = member.workspace_id AND team.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`,
    [workspaceId, userId])).rows;
  return rows.map((row) => row.key).sort();
}
