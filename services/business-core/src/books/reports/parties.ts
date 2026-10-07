import type { Db } from "../ledger/ledger";

/**
 * The names of the parties journal lines carry (party type + id): clients are CRM parties, vendors the workspace's
 * suppliers, employees members, teams the workspace's teams. Keyed "type:id"; a party that no longer resolves is left out.
 */
export async function partyNames(db: Db, workspaceId: string, lines: ReadonlyArray<{ partyType: string | null; partyId: string | null }>): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(lines.filter((line) => line.partyType === type && line.partyId).map((line) => line.partyId!))];
  const clients = ids("client"), vendors = ids("vendor"), employees = ids("employee"), teams = ids("team");
  const names = new Map<string, string>();
  if (!clients.length && !vendors.length && !employees.length && !teams.length) return names;
  const rows = (await db.query<{ key: string; name: string }>(
    `SELECT 'client:' || party.id AS key, party.display_name AS name FROM crm_parties party WHERE party.workspace_id = $1 AND party.id = ANY($2::uuid[])
     UNION ALL
     SELECT 'vendor:' || vendor.id, vendor.display_name FROM workspace_vendors vendor WHERE vendor.workspace_id = $1 AND vendor.id = ANY($3::uuid[])
     UNION ALL
     SELECT 'employee:' || person.id, coalesce(nullif(btrim(person.display_name), ''), person.primary_email) FROM users person
       JOIN workspace_memberships membership ON membership.user_id = person.id AND membership.workspace_id = $1 WHERE person.id = ANY($4::uuid[])
     UNION ALL
     SELECT 'team:' || team.id, team.name FROM workspace_teams team WHERE team.workspace_id = $1 AND team.id = ANY($5::uuid[])`,
    [workspaceId, clients, vendors, employees, teams])).rows;
  for (const row of rows) names.set(row.key, row.name);
  return names;
}
