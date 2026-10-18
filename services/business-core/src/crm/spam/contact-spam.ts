import type { PoolClient } from "pg";
import type { CrmEventsService } from "../shared/crm-events.service";
import { normalizeEmail, normalizeLoosePhone } from "../shared/crm-types";
import { recordChatEvent } from "../conversations/inbox/inbox-commands";

type Db = Pick<PoolClient, "query">;

/**
 * Spam contacts (PLM-138). A contact (crm_parties.spam_at) flagged as spam keeps writing into Wodana, but every later
 * message is spam too: its chats are Spam (kept, nobody told, nothing automatic) and every enquiry it raises, on any
 * source or channel (WhatsApp, forms, email, the website), is created already marked spam: out of round-robin, the
 * response timers, the pipeline and the conversion reports, and counted in the spam figures by source and channel.
 * Only someone allowed (crm.spam.unmark) clears the flag, with a reason the history keeps.
 */

/** The phone digits and emails a submission names, normalized the way contact points are matched. */
export function contactKeys(contact: { mobile?: string | null; phone?: string | null; email?: string | null } | null | undefined) {
  const phones = [contact?.mobile, contact?.phone].filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => normalizeLoosePhone(value)?.replace(/\D/g, "") ?? "").filter(Boolean);
  const emails = typeof contact?.email === "string" && contact.email.trim() ? [normalizeEmail(contact.email)] : [];
  return { phones: [...new Set(phones)], emails };
}

/**
 * The spam contact behind a party: the party itself when it is flagged, else a flagged party that shares one of the
 * given phone numbers or emails (a form sent again under another name). Null when none is.
 */
export async function spamContact(db: Db, workspaceId: string, partyId: string | null, keys: { phones: string[]; emails: string[] } = { phones: [], emails: [] }) {
  const row = (await db.query<{ id: string }>(
    `SELECT party.id FROM crm_parties party
      WHERE party.workspace_id = $1 AND party.spam_at IS NOT NULL
        AND (party.id = $2::uuid OR EXISTS (
          SELECT 1 FROM crm_contact_points point
           WHERE point.workspace_id = party.workspace_id AND point.party_id = party.id AND point.status = 'active'
             AND ((point.type = 'phone' AND regexp_replace(point.normalized_value, '[^0-9]', '', 'g') = ANY($3::text[]))
               OR (point.type = 'email' AND lower(point.normalized_value) = ANY($4::text[])))))
      ORDER BY (party.id = $2::uuid) DESC LIMIT 1`, [workspaceId, partyId, keys.phones, keys.emails])).rows[0];
  return row?.id ?? null;
}

/** Whether the contact has real work with the firm (an opportunity), so it can't be spam. */
export async function hasRealWork(db: Db, workspaceId: string, partyId: string) {
  return Boolean((await db.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND party_id = $2 LIMIT 1`, [workspaceId, partyId])).rowCount);
}

/**
 * Flags the contact as spam (safe to repeat) and moves its chats to Spam, each with a history line. `method` says
 * why: someone marked it ('manual'), or the contact was already spam ('contact_spam').
 */
export async function flagPartySpam(db: Db, events: CrmEventsService, input: { workspaceId: string; partyId: string; actorUserId: string | null; method: "manual" | "contact_spam" }) {
  const { workspaceId, partyId, actorUserId } = input;
  const flagged = await db.query(
    `UPDATE crm_parties SET spam_at = now(), spam_by = $3::uuid, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND spam_at IS NULL`, [workspaceId, partyId, actorUserId]);
  if (flagged.rowCount) {
    await events.record(db as PoolClient, { workspaceId, actorUserId, source: actorUserId ? "user" : "system", action: "crm.party.marked_spam.v1", entityType: "crm_party", entityId: partyId,
      before: { spam: false }, after: { spam: true, method: input.method } });
  }
  const chats = await markChatsSpam(db, { workspaceId, partyId, actorUserId, method: input.method });
  return { flagged: Boolean(flagged.rowCount), chats };
}

/** Every chat of a spam contact that isn't Spam yet becomes Spam (its wait and snooze end), with a history line. */
export async function markChatsSpam(db: Db, input: { workspaceId: string; partyId: string; actorUserId: string | null; method: "manual" | "contact_spam"; conversationIds?: string[] }) {
  const moved = (await db.query<{ id: string }>(
    `UPDATE crm_conversations SET status = 'spam', snoozed_until = NULL, waiting_since = NULL, closing_due_at = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND party_id = $2 AND status <> 'spam' AND channel <> 'internal' AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
      RETURNING id`, [input.workspaceId, input.partyId, input.conversationIds ?? null])).rows;
  for (const chat of moved) {
    await recordChatEvent(db, { workspaceId: input.workspaceId, conversationId: chat.id, kind: "spam", actorUserId: input.actorUserId, method: input.method });
  }
  return moved.map((chat) => chat.id);
}

/**
 * Clears a wrong spam flag (crm.spam.unmark): the contact is a real client again (no longer spam or blocked) and its
 * Spam chats are Open, each with a history line carrying the reason. Its spam enquiries are reopened by the caller.
 */
export async function clearPartySpam(db: Db, events: CrmEventsService, input: { workspaceId: string; partyId: string; actorUserId: string; reason: string }) {
  const { workspaceId, partyId, actorUserId, reason } = input;
  const before = (await db.query<{ spamAt: Date | null; blockedAt: Date | null }>(
    `SELECT spam_at AS "spamAt", blocked_at AS "blockedAt" FROM crm_parties WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, partyId])).rows[0];
  if (!before) return { cleared: false, chats: [] as string[] };
  const cleared = Boolean(before.spamAt || before.blockedAt);
  if (cleared) {
    await db.query(`UPDATE crm_parties SET spam_at = NULL, spam_by = NULL, blocked_at = NULL, blocked_by = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, partyId]);
    await events.record(db as PoolClient, { workspaceId, actorUserId, source: "user", action: "crm.party.spam_reopened.v1", entityType: "crm_party", entityId: partyId,
      before: { spam: Boolean(before.spamAt), blocked: Boolean(before.blockedAt) }, after: { spam: false, blocked: false, reason, note: reason } });
  }
  // A chat whose last message is the client's waits for us again from that message.
  const reopened = (await db.query<{ id: string }>(
    `UPDATE crm_conversations conversation SET status = 'open', version = version + 1, updated_at = now(),
            waiting_since = CASE WHEN conversation.last_inbound_at IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM crm_messages reply WHERE reply.workspace_id = conversation.workspace_id AND reply.conversation_id = conversation.id
                AND reply.direction = 'outbound' AND reply.created_at >= conversation.last_inbound_at) THEN conversation.last_inbound_at END
      WHERE conversation.workspace_id = $1 AND conversation.party_id = $2 AND conversation.status = 'spam'
      RETURNING conversation.id`, [workspaceId, partyId])).rows;
  for (const chat of reopened) await recordChatEvent(db, { workspaceId, conversationId: chat.id, kind: "unspam", actorUserId, method: "manual", reason });
  return { cleared, chats: reopened.map((chat) => chat.id) };
}
