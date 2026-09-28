import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserPush, renderNoticeText } from "../../../notifications/default-templates";
import { INBOX_MEMBERS_SQL } from "./inbox-assignment";

type Db = Pick<PoolClient, "query">;

/**
 * Who is told what about a chat (all in-app, with a push when the person has a device):
 * - a client writes → the owner, or when nobody owns it the inbox queue (else the inbox managers);
 * - a chat is given to someone else → the new owner;
 * - a snoozed chat comes back → its owner.
 * A chat raises one unread notice per person: later messages update its text instead of adding more.
 */
export const inboxLink = (conversationId: string) => `/workspace/crm/conversations?record=${conversationId}`;

export async function userOfMembership(db: Db, workspaceId: string, membershipId: string | null) {
  if (!membershipId) return null;
  const result = await db.query<{ userId: string; displayName: string }>(
    `SELECT membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS "displayName"
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id AND account.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active'`,
    [workspaceId, membershipId],
  );
  return result.rows[0] ?? null;
}

/** Everyone who should hear about a chat nobody owns: the available people of the queue, else the inbox managers. */
export async function unassignedAudience(db: Db, workspaceId: string, queueId: string | null) {
  if (queueId) {
    const queue = await db.query<{ userId: string }>(
      `SELECT DISTINCT inbox."userId" FROM (${INBOX_MEMBERS_SQL}) inbox
         JOIN crm_effective_queue_members member ON member.workspace_id = $1 AND member.membership_id = inbox."membershipId"
        WHERE member.queue_id = $2 AND member.is_available AND (member.unavailable_until IS NULL OR member.unavailable_until <= now())`,
      [workspaceId, queueId],
    );
    if (queue.rowCount) return queue.rows.map((row) => row.userId);
  }
  const managers = await db.query<{ userId: string }>(
    `SELECT DISTINCT inbox."userId" FROM (${INBOX_MEMBERS_SQL}) inbox
      WHERE EXISTS (SELECT 1 FROM effective_member_roles assigned
                      JOIN role_permissions granted ON granted.role_id = assigned.role_id
                      JOIN permissions permission ON permission.id = granted.permission_id
                     WHERE assigned.workspace_id = $1 AND assigned.membership_id = inbox."membershipId"
                       AND permission.code = 'crm.settings.manage')`,
    [workspaceId],
  );
  return managers.rows.map((row) => row.userId);
}

/** The one notice a chat keeps per person while it is unread; returns whether a new notice was raised. */
export async function noticeChat(db: Db, input: {
  workspaceId: string; conversationId: string; recipientUserId: string;
  code: "crm.inbox_message" | "crm.inbox_unassigned"; eventType: string;
  variables: Record<string, string>; idempotencyKey: string;
}) {
  const deepLink = inboxLink(input.conversationId);
  const open = await db.query<{ id: string }>(
    `SELECT id FROM notifications
      WHERE workspace_id = $1 AND recipient_type = 'user' AND recipient_id = $2 AND channel = 'in_app'
        AND event_type = $3 AND deep_link = $4 AND read_at IS NULL
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [input.workspaceId, input.recipientUserId, input.eventType, deepLink],
  );
  if (open.rowCount) {
    const template = await db.query<{ subject: string | null; body: string }>(
      `SELECT subject_template AS subject, body_template AS body FROM notification_templates
        WHERE workspace_id = $1 AND code = $2 AND channel = 'in_app' AND status = 'approved' AND locale = 'en'
        ORDER BY version_number DESC LIMIT 1`,
      [input.workspaceId, input.code],
    );
    const row = template.rows[0];
    if (row) await db.query(
      `UPDATE notifications SET subject = $1, body = $2, delivered_at = now(), updated_at = now(), version = version + 1
        WHERE workspace_id = $3 AND id = $4`,
      [row.subject ? renderNoticeText(row.subject, input.variables) : null, renderNoticeText(row.body, input.variables), input.workspaceId, open.rows[0].id],
    );
    return false;
  }
  const raised = await notifyUserInApp(db, { workspaceId: input.workspaceId, recipientUserId: input.recipientUserId, code: input.code, eventType: input.eventType, variables: input.variables, deepLink, idempotencyKey: input.idempotencyKey });
  if (raised.queued && input.code === "crm.inbox_message") {
    await queueUserPush(db, { workspaceId: input.workspaceId, recipientUserId: input.recipientUserId, code: input.code, eventType: input.eventType, variables: input.variables, deepLink, idempotencyKey: `${input.idempotencyKey}:push` });
  }
  return raised.queued;
}

/** The new owner hears that the chat is theirs (not when they took it themselves). */
export async function noticeAssigned(db: Db, input: { workspaceId: string; conversationId: string; ownerMembershipId: string; actorUserId: string | null; clientName: string; reason: string; version: number }) {
  const owner = await userOfMembership(db, input.workspaceId, input.ownerMembershipId);
  if (!owner || owner.userId === input.actorUserId) return;
  const variables = { clientName: input.clientName, reason: input.reason };
  const key = `crm:inbox:assigned:${input.conversationId}:${input.version}:${owner.userId}`;
  const deepLink = inboxLink(input.conversationId);
  const raised = await notifyUserInApp(db, { workspaceId: input.workspaceId, recipientUserId: owner.userId, code: "crm.inbox_assigned", eventType: "crm.inbox.assigned", variables, deepLink, idempotencyKey: key });
  if (raised.queued) await queueUserPush(db, { workspaceId: input.workspaceId, recipientUserId: owner.userId, code: "crm.inbox_assigned", eventType: "crm.inbox.assigned", variables, deepLink, idempotencyKey: `${key}:push` });
}

/** When someone reads the chat, its unread notices are read too. */
export async function readChatNotices(db: Db, workspaceId: string, conversationId: string, userId: string) {
  await db.query(
    `UPDATE notifications SET read_at = now(), version = version + 1
      WHERE workspace_id = $1 AND recipient_type = 'user' AND recipient_id = $2 AND channel = 'in_app'
        AND deep_link = $3 AND read_at IS NULL`,
    [workspaceId, userId, inboxLink(conversationId)],
  );
}
