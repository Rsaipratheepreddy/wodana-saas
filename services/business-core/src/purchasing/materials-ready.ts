import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { readNeeds, type Need } from "./orders";

type Db = Pick<PoolClient, "query">;

/**
 * The lines a project buys, when every one of them is in (received, from stock or installed), as a
 * fingerprint of the lines and their quantities; null while anything is still required or on order.
 * A project that buys nothing is never "ready".
 */
export function materialsReady(needs: Array<Pick<Need, "key" | "required" | "status">>): { fingerprint: string; lines: number } | null {
  if (!needs.length || needs.some((need) => need.status !== "received" && need.status !== "installed")) return null;
  const set = needs.map((need) => `${need.key}=${need.required ?? ""}`).sort().join("|");
  return { fingerprint: createHash("sha256").update(set).digest("hex"), lines: needs.length };
}

/**
 * PLM-074: when everything a project buys is in, its project manager and its production (factory) lead
 * hear that materials are ready, in the app and by email. Once per set of lines: the record of that set
 * is written first and only the call that writes it tells anyone, so retries, a reversed and re-received
 * delivery or two receipts at once never repeat it. Lines added later (a variation) make a new set.
 * The person whose step completed it isn't told about their own step.
 */
export async function tellMaterialsReady(db: Db, workspaceId: string, projectIds: Array<string | null>, actorUserId: string | null) {
  let told = 0;
  for (const projectId of new Set(projectIds.filter((id): id is string => Boolean(id)))) {
    const ready = materialsReady(await readNeeds(db, workspaceId, false, projectId));
    if (!ready) continue;
    const recorded = await db.query(
      `INSERT INTO project_materials_ready (workspace_id, project_id, fingerprint, lines, recorded_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, project_id, fingerprint) DO NOTHING RETURNING project_id`,
      [workspaceId, projectId, ready.fingerprint, ready.lines, actorUserId]);
    if (!recorded.rowCount) continue;
    const project = (await db.query<{ title: string }>(
      `SELECT project.reference || ' · ' || project.name AS title FROM delivery_projects project WHERE project.workspace_id = $1 AND project.id = $2`,
      [workspaceId, projectId])).rows[0];
    if (!project) continue;
    const recipients = await readyRecipients(db, workspaceId, projectId);
    const variables = { project: project.title, lines: String(ready.lines) };
    for (const userId of recipients.filter((id) => id !== actorUserId)) {
      const message = { workspaceId, recipientUserId: userId, code: "purchasing.materials_ready", eventType: "purchasing.materials_ready", variables, deepLink: `/workspace/projects/${projectId}` };
      const key = `purchasing.materials_ready:${projectId}:${ready.fingerprint.slice(0, 32)}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) told += 1;
    }
    await recordAudit(db, { workspaceId, actorUserId, action: "project.materials_ready", entityType: "project", entityId: projectId, source: actorUserId ? "user" : "internal",
      after: { lines: ready.lines, fingerprint: ready.fingerprint, told: recipients.filter((id) => id !== actorUserId).length } });
  }
  return told;
}

/**
 * Who hears: the project's manager(s) and its factory lead(s) on the project team. With no factory lead
 * on the team, the people who run the factory (they plan production for every project).
 */
async function readyRecipients(db: Db, workspaceId: string, projectId: string) {
  const team = (await db.query<{ userId: string; lead: boolean }>(
    `SELECT DISTINCT membership.user_id AS "userId", 'factory_lead' = ANY(assignment.role_keys) AS lead
       FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active
        AND (assignment.is_manager OR assignment.role_keys && ARRAY['project_manager', 'factory_lead']::varchar[])`, [workspaceId, projectId])).rows;
  const factory = team.some((row) => row.lead) ? [] : (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'factory.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows;
  return [...new Set([...team.map((row) => row.userId), ...factory.map((row) => row.userId)])];
}
