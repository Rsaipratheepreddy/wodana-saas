import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * The events of a job's steps (rule 9): who is told what, on which channel.
 *   flow.step_not_needed   in-app   the job's owner, when someone else marks a step not needed (E2-5, PLM-081)
 *   flow.job_moved         in-app   the job's owner, when an admin moves the job to a newer version of its steps (E2-3)
 * The site visit's invitation (PLM-080/044: the salesperson, the designer and the Account Manager, in-app and by email)
 * is the design site visit's own notice; booking it from the job doesn't send a second one.
 * Seeded into a workspace the first time it needs them; a firm edits its own copy like any template.
 */
export const FLOW_STEP_NOTICE_TEMPLATES = [
  { code: "flow.step_not_needed", channel: "in_app", subject: "{{step}} not needed · {{title}}", body: "{{actor}}: {{reason}}", variables: ["step", "title", "actor", "reason"] },
  { code: "flow.job_moved", channel: "in_app", subject: "New steps for {{title}}", body: "{{actor}} moved it to version {{version}} of {{flow}}. Now: {{now}}", variables: ["title", "actor", "version", "flow", "now"] },
] as const;

export async function ensureFlowStepTemplates(db: Db, workspaceId: string) {
  for (const template of FLOW_STEP_NOTICE_TEMPLATES) {
    await db.query(
      `INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
       VALUES ($1, $2, $3, 'en', 1, 'approved', $4, $5, $6::jsonb, now())
       ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING`,
      [workspaceId, template.code, template.channel, template.subject, template.body, JSON.stringify(template.variables)]);
  }
}

/** Tells the members (by membership) once per key; never the person who acted. */
export async function tellMembers(db: Db, input: {
  workspaceId: string; membershipIds: Array<string | null>; actorUserId: string; code: (typeof FLOW_STEP_NOTICE_TEMPLATES)[number]["code"];
  channel: "in_app" | "email"; variables: Record<string, string>; deepLink: string; key: string;
}) {
  const ids = [...new Set(input.membershipIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  await ensureFlowStepTemplates(db, input.workspaceId);
  const users = (await db.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [input.workspaceId, ids])).rows;
  for (const { userId } of users) {
    if (userId === input.actorUserId) continue;
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables: input.variables, deepLink: input.deepLink };
    if (input.channel === "in_app") await notifyUserInApp(db, { ...message, idempotencyKey: `${input.key}:${userId}` });
    else await queueUserEmail(db, { ...message, idempotencyKey: `${input.key}:${userId}:email` });
  }
}
