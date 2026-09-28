import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { CrmEventsService } from "../../shared/crm-events.service";
import { INBOX_MEMBERS_SQL } from "./inbox-assignment";
import { noticeAssigned } from "./inbox-notices";
import { snoozeProblem, type ConversationState } from "./inbox-rules";

type Db = Pick<PoolClient, "query">;
export type ConversationRow = Record<string, unknown>;
export type ChatEventKind = "resolved" | "reopened" | "snoozed" | "woke" | "assigned" | "unassigned" | "labelled" | "unlabelled" | "linked";
export type ChatEventMethod = "manual" | "bulk" | "relationship" | "queue" | "client_replied" | "schedule" | "enquiry";

export type ConversationChange = {
  status?: ConversationState;
  snoozedUntil?: string;
  ownerMembershipId?: string | null;
  leadId?: string | null;
  subject?: string;
};

/** One line of the chat's own history (shown in the thread as a system note). */
export async function recordChatEvent(db: Db, event: {
  workspaceId: string; conversationId: string; kind: ChatEventKind; actorUserId: string | null;
  ownerMembershipId?: string | null; previousOwnerMembershipId?: string | null; labelId?: string | null;
  leadId?: string | null; snoozedUntil?: Date | string | null; method?: ChatEventMethod | null; reason?: string | null;
}) {
  await db.query(
    `INSERT INTO crm_conversation_events
       (workspace_id, conversation_id, kind, actor_user_id, owner_membership_id, previous_owner_membership_id,
        label_id, lead_id, snoozed_until, method, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [event.workspaceId, event.conversationId, event.kind, event.actorUserId, event.ownerMembershipId ?? null,
      event.previousOwnerMembershipId ?? null, event.labelId ?? null, event.leadId ?? null, event.snoozedUntil ?? null,
      event.method ?? null, event.reason?.slice(0, 500) ?? null],
  );
}

export function mapConversation(row: ConversationRow) {
  return {
    id: row.id, partyId: row.party_id, leadId: row.lead_id, channel: row.channel, subject: row.subject, status: row.status,
    ownerMembershipId: row.owner_membership_id, lastMessageAt: row.last_message_at, lastInboundAt: row.last_inbound_at,
    unreadCount: row.unread_count, snoozedUntil: row.snoozed_until ?? null, waitingSince: row.waiting_since ?? null,
    assignedAt: row.assigned_at ?? null, resolvedAt: row.resolved_at ?? null, version: Number(row.version),
  };
}

async function requireInboxMember(db: Db, workspaceId: string, membershipId: string) {
  const result = await db.query(`SELECT 1 FROM (${INBOX_MEMBERS_SQL}) inbox WHERE inbox."membershipId" = $2`, [workspaceId, membershipId]);
  if (!result.rowCount) throw new UnprocessableEntityException("Choose someone who can open the inbox");
}

const same = (left: unknown, right: unknown) => (left ?? null) === (right ?? null);
const instant = (value: unknown) => value == null ? null : new Date(value as string | Date).getTime();

/**
 * One validated change to a chat: its state (with the snooze time), owner, enquiry link or subject.
 * Asking for the state the chat is already in changes nothing (safe to retry); a real change needs the
 * version the person saw when `expectedVersion` is given. Each change is a history line and an audit event;
 * a chat given to someone else tells them.
 */
export async function applyConversationChange(db: Db, events: CrmEventsService, input: {
  workspaceId: string; before: ConversationRow; change: ConversationChange; actorUserId: string;
  method: "manual" | "bulk" | "enquiry"; expectedVersion?: number;
}) {
  const { workspaceId, before, change, actorUserId } = input;
  const conversationId = String(before.id);
  if (change.status === "snoozed" && !change.snoozedUntil) throw new UnprocessableEntityException("Choose when this chat comes back");
  if (change.snoozedUntil && change.status !== "snoozed") throw new UnprocessableEntityException("A snooze time needs the snoozed state");
  const status = change.status ?? String(before.status) as ConversationState;
  const snoozedUntil = status !== "snoozed" ? null : new Date((change.snoozedUntil ?? before.snoozed_until) as string | Date);
  if (change.status === "snoozed") {
    const problem = snoozeProblem(snoozedUntil!);
    if (problem) throw new UnprocessableEntityException(problem);
  }
  const owner = change.ownerMembershipId === undefined ? (before.owner_membership_id as string | null) : change.ownerMembershipId;
  const leadId = change.leadId === undefined ? (before.lead_id as string | null) : change.leadId;
  const subject = change.subject?.trim() || (before.subject as string | null);
  const statusChanged = status !== before.status || (status === "snoozed" && instant(snoozedUntil) !== instant(before.snoozed_until));
  const ownerChanged = !same(owner, before.owner_membership_id);
  const leadChanged = !same(leadId, before.lead_id);
  const subjectChanged = !same(subject, before.subject);
  if (!statusChanged && !ownerChanged && !leadChanged && !subjectChanged) return { after: mapConversation(before), changed: false };
  if (input.expectedVersion !== undefined && Number(before.version) !== input.expectedVersion) throw new ConflictException("Conversation changed; refresh before trying again");
  if (ownerChanged && owner) await requireInboxMember(db, workspaceId, owner);
  if (leadChanged && leadId) {
    const lead = await db.query<{ partyId: string }>(`SELECT party_id AS "partyId" FROM crm_leads WHERE workspace_id = $1 AND id = $2`, [workspaceId, leadId]);
    if (!lead.rowCount) throw new UnprocessableEntityException("Enquiry not found");
    if (before.party_id && lead.rows[0].partyId !== before.party_id) throw new UnprocessableEntityException("This enquiry belongs to another client");
  }
  const updated = await db.query<ConversationRow>(
    `UPDATE crm_conversations SET status = $3, snoozed_until = $4,
            resolved_at = CASE WHEN $3 = 'closed' THEN COALESCE(CASE WHEN status = 'closed' THEN resolved_at END, now()) ELSE NULL END,
            owner_membership_id = $5::uuid,
            assigned_at = CASE WHEN $5::uuid IS NULL THEN NULL WHEN owner_membership_id IS DISTINCT FROM $5::uuid THEN now() ELSE assigned_at END,
            lead_id = $6::uuid, subject = $7, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 RETURNING *`,
    [workspaceId, conversationId, status, snoozedUntil, owner, leadId, subject],
  );
  const after = updated.rows[0];
  const method = input.method === "enquiry" ? "enquiry" : input.method;
  if (statusChanged) {
    const kind: ChatEventKind = status === "closed" ? "resolved" : status === "snoozed" ? "snoozed" : "reopened";
    await recordChatEvent(db, { workspaceId, conversationId, kind, actorUserId, snoozedUntil, method });
  }
  if (ownerChanged) {
    await recordChatEvent(db, { workspaceId, conversationId, kind: owner ? "assigned" : "unassigned", actorUserId, ownerMembershipId: owner, previousOwnerMembershipId: before.owner_membership_id as string | null, method });
  }
  if (leadChanged) await recordChatEvent(db, { workspaceId, conversationId, kind: "linked", actorUserId, leadId, method });
  const response = mapConversation(after);
  await events.record(db as PoolClient, { workspaceId, actorUserId, source: "user", action: "crm.conversation.updated.v1", entityType: "crm_conversation", entityId: conversationId, before: mapConversation(before), after: { ...response, method } });
  if (ownerChanged && owner) {
    const facts = await db.query<{ clientName: string | null; actorName: string | null }>(
      `SELECT (SELECT display_name FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "clientName",
              (SELECT coalesce(nullif(btrim(display_name), ''), primary_email) FROM users WHERE id = $3) AS "actorName"`,
      [workspaceId, before.party_id ?? null, actorUserId],
    );
    await noticeAssigned(db, { workspaceId, conversationId, ownerMembershipId: owner, actorUserId, clientName: facts.rows[0]?.clientName ?? "A client", reason: `Assigned by ${facts.rows[0]?.actorName ?? "a teammate"}`, version: response.version });
  }
  return { after: response, changed: true };
}
