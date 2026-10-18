import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { ensureSettings, readTeam } from "./project-core.store";
import { drawingsClientRoleOf } from "./project-drawings";

type Db = Pick<PoolClient, "query">;

export type ItemNoticeCode = "project.item_drawing_uploaded" | "project.item_drawing_returned" | "project.item_drawings_signed" | "project.item_supplies_signed";

/** The notices that also go by email: the project manager acts on signed drawings (production or purchase). */
const EMAILED = new Set<ItemNoticeCode>(["project.item_drawings_signed", "project.item_supplies_signed"]);

/**
 * Who hears about shop drawings per item, in the app (signed drawings by email too):
 *   project.item_drawing_uploaded   a version waits for the check            the lead designer (the project manager when no one holds the role)
 *   project.item_drawing_returned   the lead designer returned a version     whoever uploaded it
 *                                   the client asked for changes             whoever uploaded it and the lead designer
 *   project.item_drawings_signed    the client signed items                  the project manager
 * The client hears that drawings wait for their signature through the portal (a decision waiting: the portal and
 * WhatsApp or the branded email, at most once a day per project). The person who acted is never told about their own step.
 */
export async function tellItemPeople(db: Db, input: {
  workspaceId: string; projectId: string; key: string; actorUserId: string | null; actorName?: string; code: ItemNoticeCode; memberships: string[]; item: string; note: string;
}) {
  const facts = (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [input.workspaceId, input.projectId])).rows[0];
  if (!facts || !input.memberships.length) return 0;
  const actor = input.actorName ?? (input.actorUserId
    ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name : undefined) ?? "Someone";
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [input.workspaceId, [...new Set(input.memberships)]])).rows.filter((person) => person.userId !== input.actorUserId);
  const deepLink = `/workspace/projects/${input.projectId}/scope?view=drawings`;
  for (const person of people) {
    const message = { workspaceId: input.workspaceId, recipientUserId: person.userId, code: input.code, eventType: input.code, deepLink,
      variables: { title: facts.title, clientName: facts.clientName, actor, item: input.item.slice(0, 300), note: input.note.slice(0, 480) } };
    const key = `${input.code}:${createHash("sha256").update(`${input.projectId}:${input.key}:${person.userId}`).digest("hex").slice(0, 48)}`;
    await notifyUserInApp(db, { ...message, idempotencyKey: key });
    if (EMAILED.has(input.code)) await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
  }
  return people.length;
}

/** The project's managers (memberships). */
export async function projectManagers(db: Db, workspaceId: string, projectId: string) {
  return ((await readTeam(db, workspaceId, [projectId])).get(projectId) ?? []).filter((member) => member.lead).map((member) => member.membershipId);
}

/**
 * The lead designer's role on projects: the role the firm chose to talk to the client about drawings, else the
 * designer. Null when the firm has neither (then the project manager checks).
 */
export async function leadDesignerRole(db: Db, workspaceId: string) {
  return drawingsClientRoleOf(await ensureSettings(db, workspaceId), "design");
}

/** Who checks the project's shop drawings (memberships): the lead designer, or the project manager when no one holds the role. */
export async function leadDesigners(db: Db, workspaceId: string, projectId: string) {
  const role = await leadDesignerRole(db, workspaceId);
  const team = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  const holders = role ? team.filter((member) => member.roles.includes(role)).map((member) => member.membershipId) : [];
  return holders.length ? holders : team.filter((member) => member.lead).map((member) => member.membershipId);
}

/** The active membership of a user, for telling the person who uploaded a version. */
export async function membershipOfUser(db: Db, workspaceId: string, userId: string) {
  return (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id ?? null;
}

/** "Kitchen cabinets" for one item, "3 items: A, B, C" for several (shortened). */
export function itemsLabel(titles: string[]) {
  if (titles.length === 1) return titles[0];
  const listed = titles.slice(0, 4).join(", ");
  return `${titles.length} items: ${listed}${titles.length > 4 ? ", …" : ""}`;
}
