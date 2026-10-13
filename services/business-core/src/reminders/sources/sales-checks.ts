import type { DueItem, ReminderSource } from "../engine/engine";
import { encode, idsOf, keysOf } from "./support";

const DAY = 86_400_000;

/**
 * crm.timeline_check (PLM-155): a timeline question on an opportunity, not answered yet. The person asked hears two hours
 * before the end of the working day it is due and when it is due (Settings › Reminders), then their team lead and the
 * owner. Done once it is answered or cancelled, or the opportunity closes.
 */
export const timelineCheckSource: ReminderSource = {
  kind: "crm.timeline_check", module: "sales", audience: "staff", critical: false, notify: "engine",
  viewPermission: "crm.opportunities.view", template: { code: "reminders.crm.timeline_check" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; dueAt: Date; owner: string | null; opportunityId: string; partyId: string | null; client: string; reference: string; asker: string | null }>(
      `SELECT check_row.id, check_row.due_at AS "dueAt", assignee.id AS owner, opportunity.id AS "opportunityId", party.id AS "partyId",
              coalesce(party.display_name, '') AS client, opportunity.reference, check_row.asker_membership_id AS asker
         FROM crm_timeline_checks check_row
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = check_row.workspace_id AND opportunity.id = check_row.opportunity_id
         LEFT JOIN workspace_memberships assignee ON assignee.workspace_id = check_row.workspace_id AND assignee.id = check_row.assignee_membership_id AND assignee.status = 'active'
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE check_row.workspace_id = $1 AND check_row.status = 'open' AND opportunity.status = 'open'
          AND check_row.due_at BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY check_row.due_at DESC, check_row.id LIMIT $4`,
      [workspaceId, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + 14 * DAY), limit])).rows;
    return rows.map((row): DueItem => ({
      key: `timeline:${row.id}`, sourceType: "crm_timeline_check", sourceId: row.id, jobSource: { type: "opportunity", id: row.opportunityId },
      projectId: null, caseId: null, partyId: row.partyId, ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.dueAt),
      title: row.client || row.reference, context: row.reference, href: `/workspace/timeline-checks/${encode(row.id)}`, variables: { client: row.client },
    }));
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "timeline");
    if (!ids.length) return new Set();
    return keysOf("timeline", (await db.query<{ id: string }>(
      `SELECT check_row.id FROM crm_timeline_checks check_row
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = check_row.workspace_id AND opportunity.id = check_row.opportunity_id
        WHERE check_row.workspace_id = $1 AND check_row.id = ANY($2::uuid[]) AND check_row.status = 'open' AND opportunity.status = 'open'`,
      [workspaceId, ids])).rows.map((row) => row.id));
  },
};

/**
 * crm.chat_closing (PLM-137, My day only): a chat whose "Closing the chat" message is due: still work, nobody waiting
 * on us, and no reply from the client for the firm's quiet working hours since our last message. It waits for whoever
 * may send it (crm.inbox.close_chats: the Sales admins); nothing is ever sent by itself. Done once the client writes,
 * the chat is resolved or marked spam, or the closing message went.
 */
export const chatClosingSource: ReminderSource = {
  kind: "crm.chat_closing", module: "sales", audience: "staff", critical: false, notify: "module",
  viewPermission: "crm.inbox.close_chats", poolPermission: "crm.inbox.close_chats", template: { code: "" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; partyId: string | null; client: string; subject: string; dueAt: Date; leadId: string | null }>(
      `SELECT conversation.id, party.id AS "partyId", coalesce(party.display_name, '') AS client, coalesce(conversation.subject, '') AS subject,
              conversation.closing_due_at AS "dueAt", conversation.lead_id AS "leadId"
         FROM crm_conversations conversation
         LEFT JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
        WHERE conversation.workspace_id = $1 AND conversation.status IN ('open', 'unresolved') AND conversation.channel <> 'internal'
          AND conversation.waiting_since IS NULL AND conversation.closing_due_at <= $2
        ORDER BY conversation.closing_due_at, conversation.id LIMIT $3`, [workspaceId, now, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `closing:${row.id}`, sourceType: "crm_conversation", sourceId: row.id, jobSource: row.leadId ? { type: "lead", id: row.leadId } : null,
      projectId: null, caseId: null, partyId: row.partyId, ownerMembershipId: null, ccMembershipIds: [], dueAt: new Date(row.dueAt), title: row.client,
      context: row.subject, href: `/workspace/crm/conversations?record=${encode(row.id)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "closing");
    if (!ids.length) return new Set();
    return keysOf("closing", (await db.query<{ id: string }>(
      `SELECT conversation.id FROM crm_conversations conversation
        WHERE conversation.workspace_id = $1 AND conversation.id = ANY($2::uuid[]) AND conversation.status IN ('open', 'unresolved')
          AND conversation.waiting_since IS NULL AND conversation.closing_due_at <= $3`,
      [workspaceId, ids, at?.now ?? new Date()])).rows.map((row) => row.id));
  },
};
