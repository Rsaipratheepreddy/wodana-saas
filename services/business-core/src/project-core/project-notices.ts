import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

export type ProjectNotice =
  | { code: "project.started"; memberships: Array<{ membershipId: string; role: string }> }
  | { code: "project.team_added"; membershipId: string; role: string }
  | { code: "project.stage_done"; stage: string; previous: string; memberships: string[] }
  | { code: "project.on_hold" | "project.resumed" | "project.off_track"; note: string; memberships: string[] };

/**
 * Who hears about a project: the team when it starts, a person when they're named for a role, the
 * lead and the next stage's owner when a stage finishes, and the team when it's held, resumed or
 * off track. The person who acted is never told about their own step.
 */
export async function noticeProject(db: Db, input: { workspaceId: string; projectId: string; key: string; actorUserId: string; notice: ProjectNotice }) {
  const facts = (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [input.workspaceId, input.projectId])).rows[0];
  if (!facts) return;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const deepLink = `/workspace/projects/${input.projectId}`;
  const users = async (membershipIds: string[]) => (await db.query<{ membershipId: string; userId: string }>(
    `SELECT id AS "membershipId", user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [input.workspaceId, [...new Set(membershipIds)]])).rows.filter((row) => row.userId !== input.actorUserId);
  const tell = async (userId: string, variables: Record<string, string>, email: boolean) => {
    const code = input.notice.code;
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code, eventType: code, variables: { title: facts.title, clientName: facts.clientName, actor, ...variables }, deepLink };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${code}:${input.projectId}:${input.key}:${userId}` });
    if (email) await queueUserEmail(db, { ...message, idempotencyKey: `${code}:${input.projectId}:${input.key}:${userId}:email` });
  };
  const notice = input.notice;
  if (notice.code === "project.started") {
    const roles = new Map<string, string[]>();
    for (const member of notice.memberships) roles.set(member.membershipId, [...(roles.get(member.membershipId) ?? []), member.role]);
    for (const person of await users([...roles.keys()])) await tell(person.userId, { role: roles.get(person.membershipId)!.join(", ") }, true);
  } else if (notice.code === "project.team_added") {
    for (const person of await users([notice.membershipId])) await tell(person.userId, { role: notice.role }, true);
  } else if (notice.code === "project.stage_done") {
    for (const person of await users(notice.memberships)) await tell(person.userId, { stage: notice.stage, previous: notice.previous }, false);
  } else {
    for (const person of await users(notice.memberships)) await tell(person.userId, { note: notice.note }, false);
  }
}
