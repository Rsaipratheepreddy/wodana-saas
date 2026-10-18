import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmIntakeService } from "../intake/crm-intake.service";
import { CrmLeadsService } from "../leads/crm-leads.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { recordChatEvent, mapConversation } from "../conversations/inbox/inbox-commands";
import { conversationVisible, loadInboxViewer } from "../conversations/inbox/inbox-visibility";
import { flagPartySpam, hasRealWork } from "./contact-spam";

/**
 * Spam from the inbox (PLM-138). Marking a chat as spam flags its contact, moves its chats to Spam (no message is
 * sent), and marks its enquiry spam: the open one it has, else one created at once for the chat, so spam is still
 * counted by source and channel. "Not spam" (crm.spam.unmark, with a reason) clears the contact and puts its
 * enquiries back into the normal flow as new leads.
 */
@Injectable()
export class CrmSpamService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly leads: CrmLeadsService,
    private readonly intake: CrmIntakeService,
  ) {}

  setChatSpam(actor: RequestActor, workspaceId: string, conversationId: string, input: { version: number; spam: boolean; reason?: string }) {
    return this.access.withPermission(actor, workspaceId, input.spam ? "crm.communications.send" : "crm.spam.unmark", async (client, actorUser) => {
      const viewer = await loadInboxViewer((permission) => this.access.hasPermission(client, workspaceId, actorUser.userId, permission));
      const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, actorUser.userId])).rows[0]?.id ?? null;
      if (!(await conversationVisible(client, workspaceId, conversationId, viewer, membership))) throw new NotFoundException("Conversation not found");
      // One contact is marked or cleared at a time, so two people acting on its chats at once can't both create an enquiry.
      const chat = (await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, conversationId])).rows[0];
      if (!chat) throw new NotFoundException("Conversation not found");
      const partyId = (chat.party_id as string | null) ?? null;
      if (!partyId) throw new UnprocessableEntityException("This chat has no client");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`contact-spam:${workspaceId}:${partyId}`]);
      const current = async () => mapConversation((await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId])).rows[0]);

      if (!input.spam) {
        const reason = input.reason?.trim();
        if (!reason) throw new UnprocessableEntityException("Say why this isn't spam");
        const party = (await client.query<{ spam: boolean }>(`SELECT spam_at IS NOT NULL AS spam FROM crm_parties WHERE workspace_id = $1 AND id = $2`, [workspaceId, partyId])).rows[0];
        if (chat.status !== "spam" && !party?.spam) return { ...(await current()), changed: false };
        if (Number(chat.version) !== input.version) throw new ConflictException("This chat changed; refresh before trying again");
        const result = await this.leads.unmarkPartySpamWith(client, workspaceId, partyId, actorUser.userId, reason);
        await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.conversation.spam_reopened.v1", entityType: "crm_conversation", entityId: conversationId,
          before: { status: "spam" }, after: { status: "open", reason, note: reason, leads: result.leads } });
        return { ...(await current()), changed: true, leads: result.leads };
      }

      // Already spam: nothing changes (safe to repeat, and a second person marking it at once changes nothing).
      if (chat.status === "spam") return { ...(await current()), changed: false };
      if (Number(chat.version) !== input.version) throw new ConflictException("This chat changed; refresh before trying again");
      if (await hasRealWork(client, workspaceId, partyId)) throw new ConflictException("This client has an opportunity with you, so they aren't spam. Block the number instead.");
      await flagPartySpam(client, this.events, { workspaceId, partyId, actorUserId: actorUser.userId, method: "manual" });
      // The contact's open enquiries are spam too; with none, the chat gets one, created already spam.
      const open = (await client.query<{ id: string }>(
        `SELECT lead.id FROM crm_leads lead WHERE lead.workspace_id = $1 AND lead.party_id = $2 AND lead.spam_at IS NULL
            AND lead.status NOT IN ('qualified', 'disqualified', 'duplicate')
          ORDER BY (lead.id = $3::uuid) DESC, lead.created_at DESC`, [workspaceId, partyId, (chat.lead_id as string | null) ?? null])).rows;
      for (const lead of open) await this.leads.markSpamWith(client, workspaceId, lead.id, actorUser, undefined, "chat");
      const linkedSpam = chat.lead_id ? Boolean((await client.query(`SELECT 1 FROM crm_leads WHERE workspace_id = $1 AND id = $2 AND spam_at IS NOT NULL`, [workspaceId, chat.lead_id])).rowCount) : false;
      let leadId: string | null = open[0]?.id ?? (linkedSpam ? chat.lead_id as string : null);
      if (!leadId) {
        const summary = (await client.query<{ text: string | null }>(
          `SELECT string_agg(body_text, E'\n' ORDER BY created_at) AS text FROM (SELECT body_text, created_at FROM crm_messages
            WHERE workspace_id = $1 AND conversation_id = $2 AND direction = 'inbound' AND body_text IS NOT NULL ORDER BY created_at DESC LIMIT 3) recent`,
          [workspaceId, conversationId])).rows[0]?.text ?? null;
        leadId = await this.intake.createSpamEnquiryForChat(client, workspaceId, actorUser.userId, {
          key: `chat-spam:${conversationId}:${chat.version}`, partyId, channel: String(chat.channel), summary, conversationId,
        });
      }
      // Linked to its enquiry for the record, but not filed into it: the chat stays where the inbox team sees it.
      if (leadId && !chat.lead_id) {
        await client.query(`UPDATE crm_conversations SET lead_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId, leadId]);
        await recordChatEvent(client, { workspaceId, conversationId, kind: "linked", actorUserId: actorUser.userId, leadId, method: "manual" });
      }
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.conversation.marked_spam.v1", entityType: "crm_conversation", entityId: conversationId,
        before: { status: chat.status }, after: { status: "spam", leadId, partyId } });
      return { ...(await current()), changed: true, leadId };
    });
  }
}
