import type { PoolClient } from "pg";
import { notifyUserInApp } from "../../../notifications/default-templates";
import { inboxLink } from "./inbox-notices";

type Db = Pick<PoolClient, "query">;

/**
 * A follow-up that cancels itself when the client replies first (X-1). Called in the client's message's own
 * transaction (the crm.customer.replied.v1 path): every message still scheduled in that chat and marked "cancel if
 * the client replies first" (the default) is cancelled with the reason, and whoever scheduled it is told, so a
 * nudge never lands on top of the client's answer. Returns what was cancelled, for the event log.
 */
export async function cancelScheduledOnReply(db: Db, workspaceId: string, conversationId: string) {
  const cancelled = (await db.query<{ id: string; createdBy: string; sendAt: Date; renderedText: string }>(
    `UPDATE crm_scheduled_messages SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'client_replied', version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND conversation_id = $2 AND status = 'scheduled' AND cancel_on_reply
      RETURNING id, created_by AS "createdBy", send_at AS "sendAt", rendered_text AS "renderedText"`, [workspaceId, conversationId])).rows;
  if (!cancelled.length) return [];
  const clientName = (await db.query<{ name: string | null }>(
    `SELECT party.display_name AS name FROM crm_conversations conversation LEFT JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
      WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId])).rows[0]?.name ?? "The client";
  for (const message of cancelled) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: message.createdBy, code: "crm.inbox_scheduled_cancelled", eventType: "crm.inbox.scheduled_cancelled",
      variables: { clientName, preview: message.renderedText.slice(0, 120) }, deepLink: inboxLink(conversationId), idempotencyKey: `crm:inbox:scheduled-cancelled:${message.id}` });
  }
  return cancelled.map((message) => ({ id: message.id, createdBy: message.createdBy, sendAt: new Date(message.sendAt).toISOString() }));
}
