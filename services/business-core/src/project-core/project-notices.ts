import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

export type ProjectNotice =
  | { code: "project.started"; memberships: Array<{ membershipId: string; role: string }> }
  | { code: "project.team_added"; membershipId: string; role: string }
  | { code: "project.stage_done"; stage: string; previous: string; memberships: string[] }
  | { code: "project.on_hold" | "project.resumed" | "project.off_track" | "project.cancelled" | "project.completed" | "project.finished_automatically" | "project.reopened"; note: string; memberships: string[] }
  | { code: "project.variation_applied"; variation: string; amount: string; memberships: string[] }
  | { code: "project.materials_signed_off" | "project.materials_changes"; revision: string; note: string; memberships: string[] }
  | { code: "project.drawings_changes"; revision: string; note: string; memberships: string[] }
  | { code: "project.drawings_approved"; revision: string; date: string; memberships: string[] }
  | { code: "project.factory_slot_booked"; date: string; memberships: string[] }
  | { code: "project.drawings_started" | "project.production_started" | "project.installation_scheduled"; date: string; note: string; memberships: string[] }
  | { code: "project.material_details"; item: string; note: string; memberships: string[] };

/**
 * Who hears about a project: the team when it starts, a person when they're named for a role, the
 * lead and the next stage's owner when a stage finishes, and the team when it's held, resumed or
 * off track, and when it's cancelled (also by email), completed or reopened. The person who acted is never
 * told about their own step.
 */
export async function noticeProject(db: Db, input: { workspaceId: string; projectId: string; key: string; actorUserId: string | null; notice: ProjectNotice; deepLink?: string }) {
  const facts = (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [input.workspaceId, input.projectId])).rows[0];
  if (!facts) return;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const deepLink = input.deepLink ?? `/workspace/projects/${input.projectId}`;
  const users = async (membershipIds: string[]) => (await db.query<{ membershipId: string; userId: string }>(
    `SELECT id AS "membershipId", user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [input.workspaceId, [...new Set(membershipIds)]])).rows.filter((row) => row.userId !== input.actorUserId);
  const tell = async (userId: string, variables: Record<string, string>, email: boolean) => {
    const code = input.notice.code;
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code, eventType: code, variables: { title: facts.title, clientName: facts.clientName, actor, ...variables }, deepLink };
    // One notice per project, event and person; hashed so long role keys fit the key column.
    const key = `${code}:${createHash("sha256").update(`${input.projectId}:${input.key}:${userId}`).digest("hex").slice(0, 48)}`;
    await notifyUserInApp(db, { ...message, idempotencyKey: key });
    if (email) await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
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
  } else if (notice.code === "project.materials_signed_off" || notice.code === "project.materials_changes") {
    for (const person of await users(notice.memberships)) await tell(person.userId, { revision: notice.revision, note: notice.note }, false);
  } else if (notice.code === "project.variation_applied") {
    for (const person of await users(notice.memberships)) await tell(person.userId, { variation: notice.variation, amount: notice.amount }, false);
  } else if (notice.code === "project.drawings_changes") {
    for (const person of await users(notice.memberships)) await tell(person.userId, { revision: notice.revision, note: notice.note, date: "" }, false);
  } else if (notice.code === "project.drawings_approved" || notice.code === "project.factory_slot_booked") {
    // Days read the way the workspace writes them. The approval also goes by email: the factory acts on it.
    const date = await workspaceDay(db, input.workspaceId, notice.date);
    const revision = notice.code === "project.drawings_approved" ? notice.revision : "";
    for (const person of await users(notice.memberships)) await tell(person.userId, { revision, note: "", date }, notice.code === "project.drawings_approved");
  } else if (notice.code === "project.drawings_started" || notice.code === "project.production_started" || notice.code === "project.installation_scheduled") {
    // PLM-055 / PLM-069: the key moments, in the app and by email.
    const date = notice.date ? await workspaceDay(db, input.workspaceId, notice.date) : "";
    for (const person of await users(notice.memberships)) await tell(person.userId, { date, note: notice.note }, true);
  } else if (notice.code === "project.material_details") {
    for (const person of await users(notice.memberships)) await tell(person.userId, { item: notice.item, note: notice.note }, false);
  } else {
    for (const person of await users(notice.memberships)) await tell(person.userId, { note: notice.note }, notice.code === "project.cancelled");
  }
}

export type WorkNotice =
  | { code: "work.assigned" | "work.done"; item: { id: string; number: number; title: string; dueDate?: string | null }; memberships: string[] }
  | { code: "work.commented" | "work.blocked" | "work.snag_ready" | "work.snag_reopened"; item: { id: string; number: number; title: string }; note: string; memberships: string[] }
  | { code: "work.moved" | "work.planned" | "work.sprint_started" | "work.sprint_closed"; item: { id: string; number: number; title: string; dueDate?: string | null }; note: string; memberships: string[] };

/**
 * Who hears about project work: the person it's given to (also by email), the assignee and the person
 * who raised it when someone comments, the person who raised it when it's done, the project manager
 * and the assignee when a blocker is reported, and the assignee when their work is pushed later by a
 * change upstream. Never the person who acted.
 */
export async function noticeWork(db: Db, input: { workspaceId: string; projectId: string; key: string; actorUserId: string; notice: WorkNotice }) {
  const facts = (await db.query<{ title: string; clientName: string }>(
    `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [input.workspaceId, input.projectId])).rows[0];
  if (!facts) return;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const { notice } = input;
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [input.workspaceId, [...new Set(notice.memberships)]])).rows.filter((row) => row.userId !== input.actorUserId);
  // A planned package is named as itself; one item is "#n title".
  const task = notice.code === "work.planned" || notice.code === "work.sprint_started" || notice.code === "work.sprint_closed" ? notice.item.title : `#${notice.item.number} ${notice.item.title}`;
  // Dates read the way the workspace writes them.
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [input.workspaceId])).rows[0]?.locale ?? "en";
  const day = (value: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; } };
  const variables: Record<string, string> = { title: facts.title, clientName: facts.clientName, actor, task,
    note: notice.code === "work.planned" ? (notice.note === "1" ? "1 task" : `${notice.note} tasks`) : "note" in notice ? notice.note : "",
    due: notice.code === "work.moved" ? (notice.item.dueDate ? day(notice.item.dueDate) : "")
      : notice.code === "work.planned" ? (notice.item.dueDate ? `First due ${day(notice.item.dueDate)}.` : "")
      : notice.code === "work.assigned" && notice.item.dueDate ? `Due ${day(notice.item.dueDate)}.` : "" };
  const sprint = notice.code === "work.sprint_started" || notice.code === "work.sprint_closed";
  const deepLink = sprint ? `/workspace/projects/${input.projectId}/plan?view=sprints` : `/workspace/projects/${input.projectId}/plan?item=${notice.item.id}`;
  for (const person of people) {
    const message = { workspaceId: input.workspaceId, recipientUserId: person.userId, code: notice.code, eventType: notice.code, variables, deepLink };
    await notifyUserInApp(db, { ...message, idempotencyKey: `${notice.code}:${input.key}:${person.userId}` });
    if (notice.code === "work.assigned") await queueUserEmail(db, { ...message, idempotencyKey: `${notice.code}:${input.key}:${person.userId}:email` });
  }
}

/** A day (YYYY-MM-DD) the way the workspace writes it ("5 Oct 2026"); the ISO day when the locale can't. */
export async function workspaceDay(db: Db, workspaceId: string, day: string) {
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`)); } catch { return day; }
}
