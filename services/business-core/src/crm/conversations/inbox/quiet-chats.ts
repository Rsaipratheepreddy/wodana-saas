import type { PoolClient } from "pg";
import { recordChatEvent } from "./inbox-commands";

type Db = Pick<PoolClient, "query">;

/** Days a chat stays quiet after our last message before it resolves itself, unless the firm set its own (0 for never). */
export const DEFAULT_AUTO_RESOLVE_DAYS = 7;

/**
 * Quiet chats resolve themselves (AU-2), in the daily run: an open chat whose last message was ours and has had
 * nothing since for the workspace's days is resolved with the note "No reply in N days" — unless something is
 * still pending on it (a follow-up for its client or enquiry, or a message scheduled to go). A client's reply
 * reopens it (the inbound path already does). Never touches a snoozed or waiting chat.
 */
export async function resolveQuietChats(db: Db, workspaceId: string) {
  const days = (await db.query<{ days: number }>(`SELECT auto_resolve_days AS days FROM crm_inbox_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.days
    ?? DEFAULT_AUTO_RESOLVE_DAYS;
  if (!days) return { resolved: 0 };
  const quiet = (await db.query<{ id: string }>(
    `UPDATE crm_conversations conversation SET status = 'closed', resolved_at = now(), version = version + 1, updated_at = now()
      WHERE conversation.id IN (
        SELECT candidate.id FROM crm_conversations candidate
         WHERE candidate.workspace_id = $1 AND candidate.status = 'open'
           AND candidate.last_message_at IS NOT NULL AND candidate.last_message_at < now() - make_interval(days => $2::int)
           AND (candidate.last_inbound_at IS NULL OR candidate.last_inbound_at < candidate.last_message_at)
           AND NOT EXISTS (SELECT 1 FROM crm_scheduled_messages scheduled
                            WHERE scheduled.workspace_id = candidate.workspace_id AND scheduled.conversation_id = candidate.id AND scheduled.status = 'scheduled')
           AND NOT EXISTS (SELECT 1 FROM crm_activities activity
                            WHERE activity.workspace_id = candidate.workspace_id AND activity.status = 'pending'
                              AND ((candidate.lead_id IS NOT NULL AND activity.lead_id = candidate.lead_id)
                                OR (candidate.party_id IS NOT NULL AND activity.party_id = candidate.party_id)))
         ORDER BY candidate.last_message_at LIMIT 200)
        AND conversation.workspace_id = $1 AND conversation.status = 'open'
      RETURNING conversation.id`, [workspaceId, days])).rows;
  for (const chat of quiet) await recordChatEvent(db, { workspaceId, conversationId: chat.id, kind: "resolved", actorUserId: null, method: "quiet", reason: `No reply in ${days} days` });
  return { resolved: quiet.length };
}
