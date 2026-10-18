import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * Unread is per person: a chat is unread for someone while its latest client message is newer than when they last
 * opened it (crm_conversation_reads) and than the chat's read baseline (everything before per-person reads counts as
 * read by everyone when it was read then). `user` is the placeholder of the person's user id.
 */
export function unreadSql(user: string, alias = "conversation") {
  return `(${alias}.last_inbound_at IS NOT NULL AND ${alias}.last_inbound_at > GREATEST(
    COALESCE(${alias}.read_baseline_at, '-infinity'::timestamptz),
    COALESCE((SELECT seen.last_read_at FROM crm_conversation_reads seen
               WHERE seen.workspace_id = ${alias}.workspace_id AND seen.conversation_id = ${alias}.id AND seen.user_id = ${user}::uuid), '-infinity'::timestamptz)))`;
}

/** Whether one chat is unread for the person. */
export async function conversationUnread(db: Db, workspaceId: string, conversationId: string, userId: string) {
  const result = await db.query<{ unread: boolean }>(
    `SELECT ${unreadSql("$3")} AS unread FROM crm_conversations conversation WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId, userId]);
  return result.rows[0]?.unread === true;
}

/** Opening a chat marks it read for that person only. Safe to repeat; a read never moves back in time. */
export async function markConversationRead(db: Db, workspaceId: string, conversationId: string, userId: string) {
  await db.query(
    `INSERT INTO crm_conversation_reads (workspace_id, conversation_id, user_id, last_read_at) VALUES ($1, $2, $3, clock_timestamp())
     ON CONFLICT (workspace_id, conversation_id, user_id) DO UPDATE SET last_read_at = greatest(crm_conversation_reads.last_read_at, excluded.last_read_at)`,
    [workspaceId, conversationId, userId]);
}
