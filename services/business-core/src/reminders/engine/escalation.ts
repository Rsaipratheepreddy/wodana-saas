import type { ReminderChainLink } from "../reminders-contract";
import { readAdmins, readPermissionHolders } from "../delivery/people";
import type { Db } from "./engine";
import type { SubjectRow } from "./subjects";

/** The project's (else the case's) named managers, active. */
async function projectManagers(db: Db, workspaceId: string, subject: Pick<SubjectRow, "projectId" | "caseId">): Promise<string[]> {
  if (!subject.projectId && !subject.caseId) return [];
  return (await db.query<{ membershipId: string }>(
    `SELECT DISTINCT assignment.membership_id AS "membershipId" FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.active AND assignment.is_manager
        AND ((assignment.project_id = $2::uuid) OR ($2::uuid IS NULL AND assignment.case_id = $3::uuid))
      ORDER BY assignment.membership_id`, [workspaceId, subject.projectId, subject.caseId])).rows.map((row) => row.membershipId);
}

/** Team leads of the teams the owner is in (not the owner), active. */
async function teamLeads(db: Db, workspaceId: string, ownerMembershipId: string | null): Promise<string[]> {
  if (!ownerMembershipId) return [];
  return (await db.query<{ membershipId: string }>(
    `SELECT DISTINCT lead.membership_id AS "membershipId" FROM workspace_team_members mine
       JOIN workspace_team_members lead ON lead.workspace_id = mine.workspace_id AND lead.team_id = mine.team_id AND lead.is_lead AND lead.membership_id <> mine.membership_id
       JOIN workspace_memberships member ON member.workspace_id = lead.workspace_id AND member.id = lead.membership_id AND member.status = 'active'
      WHERE mine.workspace_id = $1 AND mine.membership_id = $2 ORDER BY lead.membership_id`, [workspaceId, ownerMembershipId])).rows.map((row) => row.membershipId);
}

/**
 * Who one chain link is for a subject (plan §6.24a "Chain resolvers"): manager = a team lead of the owner's team,
 * else the project manager; project_manager; finance (receivables.manage); purchasing (purchasing.approve); owner
 * (the system role).
 */
export async function resolveChainLink(db: Db, workspaceId: string, link: ReminderChainLink, subject: Pick<SubjectRow, "ownerMembershipId" | "projectId" | "caseId">): Promise<string[]> {
  switch (link) {
    case "manager": {
      const leads = await teamLeads(db, workspaceId, subject.ownerMembershipId);
      return leads.length ? leads : projectManagers(db, workspaceId, subject);
    }
    case "project_manager": return projectManagers(db, workspaceId, subject);
    case "finance": return readPermissionHolders(db, workspaceId, ["receivables.manage"]);
    case "purchasing": return readPermissionHolders(db, workspaceId, ["purchasing.approve"]);
    case "owner": return readAdmins(db, workspaceId, ["owner"]);
  }
}

/**
 * The people an escalation level goes to: the level-th link of the chain that resolves to somebody other than those
 * already told (the owner and the people copied in). A link that resolves to nobody passes to the next, so with no
 * team lead and no project manager the first escalation goes to the owner. Null when the chain has no such level.
 */
export async function escalationRecipients(db: Db, workspaceId: string, chain: readonly ReminderChainLink[], level: number,
  subject: Pick<SubjectRow, "ownerMembershipId" | "ccMembershipIds" | "projectId" | "caseId">): Promise<{ link: ReminderChainLink; membershipIds: string[] } | null> {
  const told = new Set([subject.ownerMembershipId, ...subject.ccMembershipIds].filter((id): id is string => Boolean(id)));
  let reached = 0;
  for (const link of chain) {
    const people = (await resolveChainLink(db, workspaceId, link, subject)).filter((id) => !told.has(id));
    if (!people.length) continue;
    reached += 1;
    if (reached === level) return { link, membershipIds: people };
  }
  return null;
}
