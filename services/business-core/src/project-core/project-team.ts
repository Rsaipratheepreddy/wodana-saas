import type { PoolClient } from "pg";
import { ensureSettings, setRole } from "./project-core.store";
import { LEAD_ROLE, type ProjectRole } from "./project-checks";
import type { TeamRoleView } from "./team-types";

export type { TeamRoleView };

type Db = Pick<PoolClient, "query">;

/** One role's choice: a person, or "not applicable" for this job. */
export type TeamChoice = { membershipId: string | null; notApplicable: boolean };
/** What carrying the team did, role by role, for the audit record. */
export type Carried = Array<{ role: string } & TeamChoice>;

type Scope = { caseId: string } | { projectId: string };
const column = (scope: Scope) => ("caseId" in scope ? "case_id" : "project_id");
const id = (scope: Scope) => ("caseId" in scope ? scope.caseId : scope.projectId);

/**
 * PLM-100 / PLM-089: what to carry from one record's team to the next. Only the workspace's own roles carry, and
 * only into a role nobody settled yet (a person named or "not applicable" chosen), so a carry never overwrites.
 */
export function teamToCarry(roles: string[], settled: Set<string>, source: Map<string, TeamChoice>): Carried {
  return roles.filter((role) => !settled.has(role) && source.has(role)).map((role) => ({ role, ...source.get(role)! }))
    // The project always has a project manager: that role is never "not applicable".
    .filter((entry) => entry.membershipId || (entry.notApplicable && entry.role !== LEAD_ROLE));
}

/**
 * The team tagged on the opportunity, role by role: the enquiry's tags (a person or "not applicable"), then the
 * opportunity's own team on top (its latest person per role), and the opportunity's owner as account manager
 * when nobody else is. Only active members count.
 */
export async function opportunityTeam(db: Db, workspaceId: string, opportunityId: string): Promise<Map<string, TeamChoice>> {
  const team = new Map<string, TeamChoice>();
  const tagged = (await db.query<{ role: string; membershipId: string | null; notApplicable: boolean }>(
    `SELECT tag.role_code AS role, CASE WHEN member.id IS NOT NULL THEN tag.membership_id END AS "membershipId", tag.not_applicable AS "notApplicable"
       FROM crm_opportunities opportunity
       JOIN crm_lead_team tag ON tag.workspace_id = opportunity.workspace_id AND tag.lead_id = opportunity.lead_id
       LEFT JOIN workspace_memberships member ON member.workspace_id = tag.workspace_id AND member.id = tag.membership_id AND member.status = 'active'
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows;
  for (const row of tagged) if (row.membershipId || row.notApplicable) team.set(row.role, { membershipId: row.membershipId, notApplicable: !row.membershipId });
  const members = (await db.query<{ role: string; membershipId: string }>(
    `SELECT team.role, team.membership_id AS "membershipId" FROM crm_opportunity_team team
       JOIN workspace_memberships member ON member.workspace_id = team.workspace_id AND member.id = team.membership_id AND member.status = 'active'
      WHERE team.workspace_id = $1 AND team.opportunity_id = $2 ORDER BY team.created_at, team.membership_id`, [workspaceId, opportunityId])).rows;
  for (const row of members) team.set(row.role, { membershipId: row.membershipId, notApplicable: false });
  if (!team.has("account_manager")) {
    const owner = (await db.query<{ membershipId: string }>(
      `SELECT opportunity.owner_membership_id AS "membershipId" FROM crm_opportunities opportunity
         JOIN workspace_memberships member ON member.workspace_id = opportunity.workspace_id AND member.id = opportunity.owner_membership_id AND member.status = 'active'
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0];
    if (owner) team.set("account_manager", { membershipId: owner.membershipId, notApplicable: false });
  }
  return team;
}

/** The roles settled on a Planning case or a project: who holds each (active members), and the ones marked "not applicable". */
export async function settledTeam(db: Db, workspaceId: string, scope: Scope): Promise<Map<string, TeamChoice>> {
  const team = new Map<string, TeamChoice>();
  const held = (await db.query<{ role: string; membershipId: string }>(
    `SELECT DISTINCT role.key AS role, assignment.membership_id AS "membershipId" FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
       CROSS JOIN LATERAL unnest(assignment.role_keys) AS role(key)
      WHERE assignment.workspace_id = $1 AND assignment.${column(scope)} = $2 AND assignment.active`, [workspaceId, id(scope)])).rows;
  for (const row of held) team.set(row.role, { membershipId: row.membershipId, notApplicable: false });
  for (const role of await notApplicableRoles(db, workspaceId, scope)) if (!team.has(role)) team.set(role, { membershipId: null, notApplicable: true });
  return team;
}

export async function notApplicableRoles(db: Db, workspaceId: string, scope: Scope) {
  return (await db.query<{ role: string }>(`SELECT role_key AS role FROM project_team_not_applicable WHERE workspace_id = $1 AND ${column(scope)} = $2`,
    [workspaceId, id(scope)])).rows.map((row) => row.role);
}

/** Marks a role "not applicable" on a case or project, or takes the mark off. Idempotent. */
export async function markNotApplicable(db: Db, workspaceId: string, scope: Scope, role: string, on: boolean, actorUserId: string | null) {
  if (!on) {
    await db.query(`DELETE FROM project_team_not_applicable WHERE workspace_id = $1 AND ${column(scope)} = $2 AND role_key = $3`, [workspaceId, id(scope), role]);
    return;
  }
  await db.query(
    `INSERT INTO project_team_not_applicable (workspace_id, ${column(scope)}, role_key, set_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, ${column(scope)}, role_key) WHERE ${column(scope)} IS NOT NULL DO NOTHING`, [workspaceId, id(scope), role, actorUserId]);
}

/**
 * When the Planning case starts, the opportunity's team joins it (PLM-100): each person in their role (which also
 * opens the case to them), each "not applicable" as such. Roles already settled on the case are kept.
 */
export async function carryTeamToCase(db: Db, workspaceId: string, caseId: string, actorUserId: string | null): Promise<Carried> {
  const opportunityId = (await db.query<{ opportunityId: string }>(`SELECT opportunity_id AS "opportunityId" FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, caseId])).rows[0]?.opportunityId;
  if (!opportunityId) return [];
  const roles = (await ensureSettings(db, workspaceId)).roles.map((role) => role.key);
  const carry = teamToCarry(roles, new Set((await settledTeam(db, workspaceId, { caseId })).keys()), await opportunityTeam(db, workspaceId, opportunityId));
  for (const entry of carry) {
    if (entry.membershipId)
      await db.query(
        `INSERT INTO project_assignments (workspace_id, case_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY[$4::varchar])
         ON CONFLICT (workspace_id, case_id, membership_id) WHERE case_id IS NOT NULL
         DO UPDATE SET active = true, role_keys = CASE WHEN $4::varchar = ANY(project_assignments.role_keys) THEN project_assignments.role_keys
                                                       ELSE array_append(project_assignments.role_keys, $4::varchar) END`,
        [workspaceId, caseId, entry.membershipId, entry.role]);
    else await markNotApplicable(db, workspaceId, { caseId }, entry.role, true, actorUserId);
  }
  return carry;
}

/**
 * When the project starts, its team comes from the Planning case, and from the opportunity for roles the case
 * never settled (PLM-100 / PLM-089). Roles chosen at the start (the project manager) or already named are kept.
 */
export async function carryTeamToProject(db: Db, workspaceId: string, input: { projectId: string; caseId: string; opportunityId: string; actorUserId: string | null }): Promise<Carried> {
  const roles = (await ensureSettings(db, workspaceId)).roles.map((role) => role.key);
  const source = await opportunityTeam(db, workspaceId, input.opportunityId);
  for (const [role, choice] of await settledTeam(db, workspaceId, { caseId: input.caseId })) source.set(role, choice);
  const carry = teamToCarry(roles, new Set((await settledTeam(db, workspaceId, { projectId: input.projectId })).keys()), source);
  for (const entry of carry) {
    if (entry.membershipId) await setRole(db, workspaceId, input.projectId, entry.role, entry.membershipId);
    else await markNotApplicable(db, workspaceId, { projectId: input.projectId }, entry.role, true, input.actorUserId);
  }
  return carry;
}

/** The roles settled on a team, in the workspace's order, with who holds each; roles nobody settled are left out. */
export async function describeTeam(db: Db, workspaceId: string, roles: ProjectRole[], team: Map<string, TeamChoice>): Promise<TeamRoleView[]> {
  const ids = [...new Set([...team.values()].map((choice) => choice.membershipId).filter((value): value is string => Boolean(value)))];
  const people = new Map((ids.length ? (await db.query<{ membershipId: string; name: string; email: string | null }>(
    `SELECT member.id AS "membershipId", coalesce(person.display_name, person.primary_email) AS name, person.primary_email AS email
       FROM workspace_memberships member JOIN users person ON person.id = member.user_id WHERE member.workspace_id = $1 AND member.id = ANY($2::uuid[])`,
    [workspaceId, ids])).rows : []).map((row) => [row.membershipId, row]));
  return roles.filter((role) => team.has(role.key)).map((role) => {
    const choice = team.get(role.key)!;
    const member = choice.membershipId ? people.get(choice.membershipId) ?? null : null;
    return { role: role.key, label: role.label, member, notApplicable: !member && choice.notApplicable };
  }).filter((entry) => entry.member || entry.notApplicable);
}

/**
 * The team a Planning case (and its Deal File) shows: what the case settled, and for the roles it didn't, what the
 * opportunity tagged (read only, nothing is written), so the case never reads empty when the opportunity had a team.
 */
export async function readCaseTeam(db: Db, workspaceId: string, caseId: string): Promise<TeamRoleView[]> {
  const opportunityId = (await db.query<{ opportunityId: string }>(`SELECT opportunity_id AS "opportunityId" FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, caseId])).rows[0]?.opportunityId;
  if (!opportunityId) return [];
  const team = await opportunityTeam(db, workspaceId, opportunityId);
  for (const [role, choice] of await settledTeam(db, workspaceId, { caseId })) team.set(role, choice);
  return describeTeam(db, workspaceId, (await ensureSettings(db, workspaceId)).roles, team);
}
