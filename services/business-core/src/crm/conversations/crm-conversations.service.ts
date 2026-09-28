import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmNotificationsService } from "../notifications/crm-notifications.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";
import { decodeCursor, encodeCursor, normalizeEmail, normalizeLoosePhone, normalizeName, stableHash } from "../shared/crm-types";
import { CreateConversationDto, CreateMessageDto, CreateSequenceDto, EnrollSequenceDto, ListConversationsQueryDto, MessageReceiptDto, ProviderInboundMessageDto, ProviderMessageReceiptDto, SequenceVersionDto, StopSequenceEnrollmentDto, UpdateSequenceDto, UpdateConversationDto } from "./dto/conversations.dto";
import { applyConversationChange, mapConversation, recordChatEvent } from "./inbox/inbox-commands";
import { INBOX_MEMBERS_SQL, inboxQueue, selectInboxOwner } from "./inbox/inbox-assignment";
import { inboxLink, noticeChat, readChatNotices, unassignedAudience, userOfMembership } from "./inbox/inbox-notices";
import { notifyUserInApp, queueUserPush } from "../../notifications/default-templates";
import { inboundSummary, normalizeTemplateParameter, renderTemplate, templateParametersProblem, templatePlaceholders, withSignature, type TemplateVariableSource } from "./inbox/inbox-rules";
import { resolveTemplateSources } from "./inbox/template-variables";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** Open chats by who has waited longest for our reply; chats nobody waits on follow, most recent first. */
const WAITING_KEY = `(CASE WHEN conversation.waiting_since IS NOT NULL THEN extract(epoch FROM conversation.waiting_since)
  ELSE 100000000000 - extract(epoch FROM COALESCE(conversation.last_message_at, conversation.created_at)) END)`;
/** The people who share a queue (or a team in one) with the given membership. */
const TEAM_SQL = (parameter: number) => `SELECT teammate.membership_id FROM crm_effective_queue_members teammate
  WHERE teammate.workspace_id = $1 AND teammate.queue_id IN (
    SELECT mine.queue_id FROM crm_effective_queue_members mine WHERE mine.workspace_id = $1 AND mine.membership_id = $${parameter})`;
export const CONVERSATION_LABELS_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', label.id, 'name', label.name, 'color', label.color) ORDER BY lower(label.name))
    FROM crm_conversation_label_links link JOIN crm_conversation_labels label ON label.workspace_id = link.workspace_id AND label.id = link.label_id
   WHERE link.workspace_id = conversation.workspace_id AND link.conversation_id = conversation.id), '[]'::jsonb)`;
const MEMBER_NAME = (alias: string) => `coalesce(nullif(btrim(${alias}.display_name), ''), ${alias}.primary_email)`;
/** A template's variable names, for a blocked send: "Fill in {{2}} (Enquiry reference)". */
const SOURCE_NAMES: Record<TemplateVariableSource, string> = {
  "contact.first_name": "Client first name", "contact.name": "Client name", "enquiry.reference": "Enquiry reference",
  "opportunity.reference": "Opportunity reference", "project.name": "Project name", "quote.number": "Quote number",
  "invoice.number": "Invoice number", "invoice.total": "Invoice amount", "portal.link": "Client portal link",
  "staff.first_name": "Your first name", "business.name": "Business name", "today.date": "Today's date",
  "project.stage": "Project stage", "invoice.due_date": "Invoice due date", "payment.amount": "Payment amount",
};

@Injectable()
export class CrmConversationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly notifications: CrmNotificationsService,
    private readonly receipts: CrmMessageReceiptService = new CrmMessageReceiptService(),
    @Optional() private readonly config?: ConfigService,
  ) {}

  list(actor: RequestActor, workspaceId: string, query: ListConversationsQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const sort = query.sort ?? (query.status === "open" ? "waiting" : "recent");
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || (sort === "waiting" && !/^-?\d+(\.\d+)?$/.test(cursor.value)))) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["conversation.workspace_id = $1"];
      for (const [column, value] of [["party_id", query.partyId], ["lead_id", query.leadId], ["owner_membership_id", query.ownerMembershipId], ["channel", query.channel]] as const) {
        if (value) { values.push(value); clauses.push(`conversation.${column} = $${values.length}`); }
      }
      if (query.status) { values.push(query.status); clauses.push(`conversation.status = $${values.length}`); }
      if (query.view === "unassigned") clauses.push("conversation.owner_membership_id IS NULL");
      else if (query.view === "mine" || query.view === "team") {
        values.push(await this.viewerMembership(client, workspaceId, actorUser.userId));
        clauses.push(query.view === "mine" ? `conversation.owner_membership_id = $${values.length}` : `conversation.owner_membership_id IN (${TEAM_SQL(values.length)})`);
      }
      if (query.labelId) { values.push(query.labelId); clauses.push(`EXISTS (SELECT 1 FROM crm_conversation_label_links link WHERE link.workspace_id = conversation.workspace_id AND link.conversation_id = conversation.id AND link.label_id = $${values.length})`); }
      if (query.unread === "true") clauses.push("conversation.unread_count > 0");
      if (query.search?.trim()) { values.push(`%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`); clauses.push(`(conversation.subject ILIKE $${values.length} OR party.display_name ILIKE $${values.length} OR EXISTS (SELECT 1 FROM crm_contact_points contact WHERE contact.workspace_id=conversation.workspace_id AND contact.party_id=conversation.party_id AND contact.status='active' AND (contact.raw_value ILIKE $${values.length} OR contact.normalized_value ILIKE $${values.length})))`); }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(sort === "waiting"
          ? `(${WAITING_KEY}, conversation.id) > ($${values.length - 1}::numeric, $${values.length}::uuid)`
          : `(COALESCE(conversation.last_message_at, '-infinity'::timestamptz), conversation.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT conversation.id, conversation.party_id AS "partyId", party.display_name AS "partyName",
                conversation.lead_id AS "leadId", conversation.channel, conversation.subject,
                conversation.status, conversation.owner_membership_id AS "ownerMembershipId", ${MEMBER_NAME("owner_user")} AS "ownerName",
                conversation.last_message_at AS "lastMessageAt", conversation.last_inbound_at AS "lastInboundAt",
                conversation.waiting_since AS "waitingSince", conversation.snoozed_until AS "snoozedUntil",
                conversation.unread_count AS "unreadCount", conversation.version, ${CONVERSATION_LABELS_SQL} AS labels,
                message.id AS "lastMessageId", message.direction AS "lastMessageDirection",
                message.body_text AS "lastMessageText", message.status AS "lastMessageStatus", ${WAITING_KEY}::text AS "sortKey"
         FROM crm_conversations conversation
         LEFT JOIN crm_parties party ON party.id = conversation.party_id AND party.workspace_id = conversation.workspace_id
         LEFT JOIN workspace_memberships owner_membership ON owner_membership.workspace_id = conversation.workspace_id AND owner_membership.id = conversation.owner_membership_id
         LEFT JOIN users owner_user ON owner_user.id = owner_membership.user_id
         LEFT JOIN LATERAL (
           SELECT id, direction, body_text, status FROM crm_messages
           WHERE workspace_id = conversation.workspace_id AND conversation_id = conversation.id AND (conversation.channel <> 'whatsapp' OR direction <> 'internal')
           ORDER BY created_at DESC LIMIT 1
         ) message ON true
         WHERE ${clauses.join(" AND ")}
         ORDER BY ${sort === "waiting" ? `${WAITING_KEY}, conversation.id` : "conversation.last_message_at DESC NULLS LAST, conversation.id DESC"}
         LIMIT $${values.length}`, values,
      );
      const hasMore = result.rows.length > query.limit;
      const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const data = rows.map(({ sortKey: _sortKey, ...row }) => row);
      const last = rows.at(-1) as { id: string; lastMessageAt: Date | null; sortKey: string } | undefined;
      const nextValue = !last ? null : sort === "waiting" ? last.sortKey : last.lastMessageAt ? new Date(last.lastMessageAt).toISOString() : "-infinity";
      return { data, nextCursor: hasMore && last && nextValue ? encodeCursor({ value: nextValue, id: last.id }) : null };
    });
  }

  get(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const conversation = await this.requireConversation(client, workspaceId, conversationId, false);
      const messages = await client.query(
        `SELECT message.id, message.direction, message.status, message.authorship, message.sender_type AS "senderType", message.sender_id AS "senderId",
                ${MEMBER_NAME("sender")} AS "senderName",
                message.provider_message_id AS "providerMessageId", message.body_text AS "bodyText",
                message.body_html AS "bodyHtml", message.sent_at AS "sentAt", message.delivered_at AS "deliveredAt",
                message.read_at AS "readAt", message.failure_code AS "failureCode", message.metadata, message.version,
                message.created_at AS "createdAt", message.updated_at AS "updatedAt"
         FROM crm_messages message LEFT JOIN users sender ON sender.id = message.sender_id
         WHERE message.workspace_id = $1 AND message.conversation_id = $2
         ORDER BY message.created_at DESC, message.id DESC LIMIT 101`, [workspaceId, conversationId],
      );
      const facts = await client.query<{ partyName: string | null; ownerName: string | null; leadReference: string | null; businessName: string; signatureEnabled: boolean | null }>(
        `SELECT (SELECT display_name FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "partyName",
                (SELECT ${MEMBER_NAME("account")} FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
                  WHERE membership.workspace_id = $1 AND membership.id = $3) AS "ownerName",
                (SELECT enquiry.reference FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
                  WHERE lead.workspace_id = $1 AND lead.id = $4) AS "leadReference",
                (SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) FROM workspaces workspace
                   LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1) AS "businessName",
                (SELECT signature_enabled FROM crm_inbox_settings WHERE workspace_id = $1) AS "signatureEnabled"`,
        [workspaceId, conversation.party_id ?? null, conversation.owner_membership_id ?? null, conversation.lead_id ?? null],
      );
      const canSend = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.send");
      // The number every seat replies from: the workspace's default connected WhatsApp number.
      const connection = await client.query<{ number: string | null; accountName: string | null }>(
        `SELECT configuration->>'displayPhoneNumber' AS number, configuration->>'accountName' AS "accountName"
           FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
          ORDER BY COALESCE((configuration->>'isDefault')::boolean, false) DESC, updated_at DESC, id LIMIT 1`, [workspaceId]);
      const page = messages.rows.slice(0, 100);
      const oldest = page.at(-1);
      const hasOlder = messages.rows.length > 100;
      const history = await client.query(
        `SELECT event.id, event.kind, event.method, event.reason, event.snoozed_until AS "snoozedUntil", event.lead_id AS "leadId",
                event.created_at AS "createdAt", ${MEMBER_NAME("actor")} AS "actorName", ${MEMBER_NAME("owner_user")} AS "ownerName",
                label.name AS "labelName", label.color AS "labelColor"
           FROM crm_conversation_events event
           LEFT JOIN users actor ON actor.id = event.actor_user_id
           LEFT JOIN workspace_memberships owner_membership ON owner_membership.workspace_id = event.workspace_id AND owner_membership.id = event.owner_membership_id
           LEFT JOIN users owner_user ON owner_user.id = owner_membership.user_id
           LEFT JOIN crm_conversation_labels label ON label.workspace_id = event.workspace_id AND label.id = event.label_id
          WHERE event.workspace_id = $1 AND event.conversation_id = $2 AND ($3::timestamptz IS NULL OR event.created_at >= $3)
          ORDER BY event.created_at, event.id LIMIT 300`,
        [workspaceId, conversationId, hasOlder && oldest ? oldest.createdAt : null],
      );
      const labels = await client.query<{ labels: unknown[] }>(`SELECT ${CONVERSATION_LABELS_SQL} AS labels FROM crm_conversations conversation WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId]);
      const lastInbound = conversation.last_inbound_at ? new Date(conversation.last_inbound_at as string | Date) : null;
      const fact = facts.rows[0];
      return {
        ...mapConversation(conversation), canSend, whatsappConnected: Boolean(connection.rowCount),
        partyName: fact?.partyName ?? null, ownerName: fact?.ownerName ?? null, leadReference: fact?.leadReference ?? null,
        labels: labels.rows[0]?.labels ?? [], events: history.rows,
        replyingAs: { businessName: fact?.businessName ?? null, number: connection.rows[0]?.number ?? null, accountName: connection.rows[0]?.accountName ?? null },
        signatureEnabled: fact?.signatureEnabled === true,
        windowClosesAt: lastInbound ? new Date(lastInbound.getTime() + 86_400_000).toISOString() : null,
        messages: page.reverse(),
        nextMessagesCursor: hasOlder && oldest ? encodeCursor({ value: new Date(oldest.createdAt).toISOString(), id: oldest.id }) : null,
      };
    });
  }

  messages(actor: RequestActor, workspaceId: string, conversationId: string, query: { cursor?: string; limit: number }) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      await this.requireConversation(client, workspaceId, conversationId, false);
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.value)))) throw new BadRequestException("Invalid message cursor");
      // Internal notes are part of the team's thread (never sent to the client).
      const result = await client.query(`SELECT message.id,message.direction,message.status,message.authorship,message.sender_type AS "senderType",message.sender_id AS "senderId",
          coalesce(nullif(btrim(sender.display_name), ''), sender.primary_email) AS "senderName",message.body_text AS "bodyText",message.metadata,message.created_at AS "createdAt",message.failure_code AS "failureCode"
        FROM crm_messages message LEFT JOIN users sender ON sender.id = message.sender_id
        WHERE message.workspace_id=$1 AND message.conversation_id=$2 AND ($3::timestamptz IS NULL OR (message.created_at,message.id)<($3::timestamptz,$4::uuid))
        ORDER BY message.created_at DESC,message.id DESC LIMIT $5`, [workspaceId, conversationId, cursor?.value ?? null, cursor?.id ?? null, query.limit + 1]);
      const data = result.rows.slice(0, query.limit), oldest = data.at(-1);
      return { data: data.reverse(), nextCursor: result.rows.length > query.limit && oldest ? encodeCursor({ value: new Date(oldest.createdAt).toISOString(), id: oldest.id }) : null };
    });
  }

  createConversation(actor: RequestActor, workspaceId: string, input: CreateConversationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      if (!input.partyId && !input.leadId && !(input.participantMembershipIds?.length)) throw new UnprocessableEntityException("Conversation requires a customer or internal participant");
      if (input.partyId) await this.requireParty(client, workspaceId, input.partyId);
      if (input.leadId) {
        const lead = await client.query(`SELECT party_id FROM crm_leads WHERE id = $1 AND workspace_id = $2`, [input.leadId, workspaceId]);
        if (!lead.rowCount) throw new UnprocessableEntityException("Lead does not exist");
        if (input.partyId && lead.rows[0].party_id !== input.partyId) throw new UnprocessableEntityException("Lead and party do not match");
        input.partyId ??= String(lead.rows[0].party_id);
      }
      if (input.channel === "whatsapp") {
        if (!input.partyId) throw new UnprocessableEntityException("Choose a contact for this WhatsApp chat");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`whatsapp-chat:${workspaceId}:${input.partyId}`]);
        const existing = await client.query(`SELECT * FROM crm_conversations WHERE workspace_id=$1 AND party_id=$2 AND channel='whatsapp' ORDER BY last_message_at DESC NULLS LAST, id LIMIT 1`, [workspaceId, input.partyId]);
        if (existing.rowCount) return mapConversation(existing.rows[0]);
        const phone = await client.query(`SELECT 1 FROM crm_contact_points WHERE workspace_id=$1 AND party_id=$2 AND type='phone' AND status='active' LIMIT 1`, [workspaceId, input.partyId]);
        if (!phone.rowCount) throw new UnprocessableEntityException("Add a phone number to this contact before opening WhatsApp");
      }
      if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
      const result = await client.query(
        `INSERT INTO crm_conversations
          (workspace_id, party_id, lead_id, channel, subject, owner_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [workspaceId, input.partyId ?? null, input.leadId ?? null, input.channel, input.subject ?? null, input.ownerMembershipId ?? null],
      );
      const conversation = mapConversation(result.rows[0] as Record<string, unknown>);
      const conversationId = String(conversation.id);
      for (const partyId of new Set([...(input.participantPartyIds ?? []), ...(input.partyId ? [input.partyId] : [])])) {
        await this.requireParty(client, workspaceId, partyId);
        await client.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'party', $3) ON CONFLICT DO NOTHING`, [workspaceId, conversationId, partyId]);
      }
      for (const membershipId of new Set([...(input.participantMembershipIds ?? []), ...(input.ownerMembershipId ? [input.ownerMembershipId] : [])])) {
        await this.requireMembership(client, workspaceId, membershipId);
        await client.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'membership', $3) ON CONFLICT DO NOTHING`, [workspaceId, conversationId, membershipId]);
      }
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.conversation.created.v1", entityType: "crm_conversation", entityId: conversationId, after: conversation });
      return conversation;
    });
  }

  addMessage(actor: RequestActor, workspaceId: string, conversationId: string, input: CreateMessageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      if (input.direction === "inbound") throw new UnprocessableEntityException("Inbound messages must arrive through an authenticated provider integration");
      return this.insertMessage(client, workspaceId, conversationId, input, actorUser.userId, "user");
    });
  }

  updateConversation(actor: RequestActor, workspaceId: string, conversationId: string, input: UpdateConversationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const before = await this.requireConversation(client, workspaceId, conversationId, true);
      const { after } = await applyConversationChange(client, this.events, {
        workspaceId, before, actorUserId: actorUser.userId, method: "manual", expectedVersion: input.version,
        change: { status: input.status as "open" | "snoozed" | "closed" | undefined, snoozedUntil: input.snoozedUntil, ownerMembershipId: input.ownerMembershipId, leadId: input.leadId, subject: input.subject },
      });
      return after;
    });
  }

  addInboundInternal(workspaceId: string, conversationId: string, input: CreateMessageDto) {
    if (input.direction !== "inbound") throw new UnprocessableEntityException("Provider ingestion only accepts inbound messages");
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
      this.insertMessage(client, workspaceId, conversationId, input, null, "integration"));
  }

  markRead(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      await this.requireConversation(client, workspaceId, conversationId, true);
      await client.query(`UPDATE crm_conversations SET unread_count = 0, version = version + 1 WHERE id = $1 AND workspace_id = $2 AND unread_count <> 0`, [conversationId, workspaceId]);
      await readChatNotices(client, workspaceId, conversationId, actorUser.userId);
      return { conversationId, unreadCount: 0 };
    });
  }

  recordReceipt(messageId: string, input: MessageReceiptDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      return this.recordReceiptWithClient(client, messageId, input);
    });
  }

  recordProviderReceipt(input: ProviderMessageReceiptDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      // The provider's own receipt is the only thing that marks a notification delivered (WhatsApp accepts first).
      if (["delivered", "read", "failed"].includes(input.status)) {
        await client.query(
          `UPDATE notifications notification
              SET status = $3::notification_status,
                  delivered_at = CASE WHEN $3 = 'delivered' THEN COALESCE(notification.delivered_at, now()) ELSE notification.delivered_at END,
                  version = notification.version + 1, updated_at = now()
             FROM notification_delivery_attempts attempt
            WHERE attempt.workspace_id = $1 AND attempt.provider_message_id = $2
              AND notification.workspace_id = attempt.workspace_id AND notification.id = attempt.notification_id
              AND notification.status = 'sent'`,
          [input.workspaceId, input.providerMessageId, input.status === "failed" ? "failed" : "delivered"]);
      }
      const message = await client.query<{ id: string }>(`SELECT id FROM crm_messages WHERE workspace_id=$1 AND provider_message_id=$2`, [input.workspaceId, input.providerMessageId]);
      if (!message.rowCount) return { ignored: true, reason: "message_not_found" };
      return this.recordReceiptWithClient(client, message.rows[0].id, input);
    });
  }

  ingestProviderMessage(input: ProviderInboundMessageDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const normalized = input.channel === "email" ? normalizeEmail(input.contact) : normalizeLoosePhone(input.contact);
      if (!normalized) throw new UnprocessableEntityException("Provider contact is invalid");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-contact:${input.workspaceId}:${input.channel}:${normalized}`]);
      const type = input.channel === "email" ? "email" : "phone";
      const existing = await client.query<{ party_id: string }>(`SELECT party_id FROM crm_contact_points WHERE workspace_id=$1 AND type=$2 AND normalized_value=$3 AND status='active' ORDER BY is_verified DESC,is_primary DESC,created_at LIMIT 1`, [input.workspaceId, type, normalized]);
      let partyId = existing.rows[0]?.party_id;
      if (!partyId) {
        partyId = randomUUID();
        const displayName = input.displayName?.trim() || (input.channel === "whatsapp" ? `WhatsApp ${input.contact}` : input.contact);
        await client.query(`INSERT INTO crm_parties (id,workspace_id,type,display_name,normalized_name,created_by) VALUES($1,$2,'person',$3,$4,NULL)`, [partyId, input.workspaceId, displayName, normalizeName(displayName)]);
        await client.query(`INSERT INTO crm_person_profiles (party_id,workspace_id) VALUES($1,$2)`, [partyId, input.workspaceId]);
        await client.query(`INSERT INTO crm_contact_points (workspace_id,party_id,type,raw_value,normalized_value,is_primary,is_verified,verified_at) VALUES($1,$2,$3,$4,$5,true,true,now())`, [input.workspaceId, partyId, type, input.contact, normalized]);
      }
      const consent = await client.query<{ id: string }>(`SELECT id FROM crm_consents WHERE workspace_id=$1 AND party_id=$2 AND legal_entity_id IS NULL AND purpose='service' AND channel=$3 ORDER BY captured_at DESC LIMIT 1`, [input.workspaceId, partyId, input.channel]);
      const evidence = { method: "provider_inbound", providerMessageId: input.providerMessageId };
      if (consent.rowCount) await client.query(`UPDATE crm_consents SET status='granted',evidence=$1,captured_at=now(),withdrawn_at=NULL,version=version+1,updated_at=now() WHERE id=$2 AND workspace_id=$3`, [evidence, consent.rows[0].id, input.workspaceId]);
      else await client.query(`INSERT INTO crm_consents (workspace_id,party_id,purpose,channel,status,evidence) VALUES($1,$2,'service',$3,'granted',$4)`, [input.workspaceId, partyId, input.channel, evidence]);
      if (input.channel === "whatsapp") await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`whatsapp-chat:${input.workspaceId}:${partyId}`]);
      const found = await client.query<{ id: string }>(`SELECT id FROM crm_conversations WHERE workspace_id=$1 AND channel=$2 AND provider_thread_id=$3`, [input.workspaceId, input.channel, input.providerThreadId]);
      let conversationId = found.rows[0]?.id;
      if (!conversationId && input.channel === "whatsapp") {
        const manual = await client.query<{ id: string }>(`SELECT id FROM crm_conversations WHERE workspace_id=$1 AND party_id=$2 AND channel='whatsapp' AND provider_thread_id IS NULL ORDER BY last_message_at DESC NULLS LAST, id LIMIT 1 FOR UPDATE`, [input.workspaceId, partyId]);
        if (manual.rowCount) {
          conversationId = manual.rows[0].id;
          await client.query(`UPDATE crm_conversations SET provider_thread_id=$3 WHERE workspace_id=$1 AND id=$2`, [input.workspaceId, conversationId, input.providerThreadId]);
        }
      }
      if (!conversationId) {
        conversationId = randomUUID();
        await client.query(`INSERT INTO crm_conversations (id,workspace_id,party_id,channel,provider_thread_id,subject) VALUES($1,$2,$3,$4,$5,$6)`, [conversationId, input.workspaceId, partyId, input.channel, input.providerThreadId, input.subject?.trim() || (input.channel === "whatsapp" ? "WhatsApp conversation" : "Email conversation")]);
        await client.query(`INSERT INTO crm_conversation_participants (workspace_id,conversation_id,participant_type,participant_id) VALUES($1,$2,'party',$3) ON CONFLICT DO NOTHING`, [input.workspaceId, conversationId, partyId]);
      }
      const message = await this.insertMessage(client, input.workspaceId, conversationId, { direction: "inbound", bodyText: input.bodyText, bodyHtml: input.bodyHtml, providerMessageId: input.providerMessageId, metadata: input.metadata }, null, "integration");
      return { conversationId, partyId, message };
    });
  }

  private async recordReceiptWithClient(client: PoolClient, messageId: string, input: MessageReceiptDto) {
    return this.receipts.record(client, messageId, input);
  }

  createSequence(actor: RequestActor, workspaceId: string, input: CreateSequenceDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      this.assertSequence(input);
      const sequence = await client.query(`INSERT INTO crm_sequences (workspace_id, name, exit_conditions, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, status, exit_conditions AS "exitConditions", version`, [workspaceId, input.name, input.exitConditions, actorUser.userId]);
      const sequenceId = String(sequence.rows[0].id);
      for (const [index, step] of input.steps.entries()) await client.query(`INSERT INTO crm_sequence_steps (workspace_id, sequence_id, position, type, delay_minutes, configuration) VALUES ($1, $2, $3, $4, $5, $6)`, [workspaceId, sequenceId, index, step.type, step.delayMinutes ?? 0, step.configuration ?? {}]);
      const response = { ...sequence.rows[0], steps: input.steps };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sequence.created.v1", entityType: "crm_sequence", entityId: sequenceId, after: response });
      return response;
    });
  }

  listSequences(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client) => {
      const result = await client.query(
        `SELECT sequence.id,sequence.name,sequence.status,sequence.exit_conditions AS "exitConditions",sequence.version,
                COALESCE(jsonb_agg(jsonb_build_object('id',step.id,'position',step.position,'type',step.type,'delayMinutes',step.delay_minutes,'configuration',step.configuration) ORDER BY step.position) FILTER (WHERE step.id IS NOT NULL),'[]'::jsonb) AS steps
         FROM crm_sequences sequence
         LEFT JOIN crm_sequence_steps step ON step.workspace_id=sequence.workspace_id AND step.sequence_id=sequence.id
         WHERE sequence.workspace_id=$1
         GROUP BY sequence.id ORDER BY sequence.name`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  updateSequence(actor: RequestActor, workspaceId: string, sequenceId: string, input: UpdateSequenceDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      this.assertSequence(input);
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_sequences WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, sequenceId]);
      if (!existing.rowCount) throw new NotFoundException("Sequence not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Sequence changed; reload and try again");
      if (!['draft', 'paused'].includes(String(before.status))) throw new ConflictException("Pause the sequence before editing it");
      const active = await client.query(`SELECT 1 FROM crm_sequence_enrollments WHERE workspace_id = $1 AND sequence_id = $2 AND status = 'active' LIMIT 1`, [workspaceId, sequenceId]);
      if (active.rowCount) throw new ConflictException("Stop or finish active enrollments before editing this sequence");
      const result = await client.query(`UPDATE crm_sequences SET name = $1, exit_conditions = $2, version = version + 1, updated_at = now() WHERE workspace_id = $3 AND id = $4 AND version = $5 RETURNING id, name, status, exit_conditions AS "exitConditions", version`, [input.name.trim(), input.exitConditions, workspaceId, sequenceId, input.version]);
      if (!result.rowCount) throw new ConflictException("Sequence changed; reload and try again");
      await client.query(`DELETE FROM crm_sequence_steps WHERE workspace_id = $1 AND sequence_id = $2`, [workspaceId, sequenceId]);
      for (const [index, step] of input.steps.entries()) await client.query(`INSERT INTO crm_sequence_steps (workspace_id, sequence_id, position, type, delay_minutes, configuration) VALUES ($1,$2,$3,$4,$5,$6)`, [workspaceId, sequenceId, index, step.type, step.delayMinutes ?? 0, step.configuration ?? {}]);
      const response = { ...result.rows[0], steps: input.steps };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sequence.updated.v1", entityType: "crm_sequence", entityId: sequenceId, before, after: response });
      return response;
    });
  }

  archiveSequence(actor: RequestActor, workspaceId: string, sequenceId: string, input: SequenceVersionDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const active = await client.query(`SELECT 1 FROM crm_sequence_enrollments WHERE workspace_id = $1 AND sequence_id = $2 AND status = 'active' LIMIT 1`, [workspaceId, sequenceId]);
      if (active.rowCount) throw new ConflictException("Stop or finish active enrollments before archiving this sequence");
      const result = await client.query(`UPDATE crm_sequences SET status = 'archived', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status <> 'archived' RETURNING id, name, status, version`, [workspaceId, sequenceId, input.version]);
      if (!result.rowCount) throw new ConflictException("Sequence changed, is archived, or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sequence.archived.v1", entityType: "crm_sequence", entityId: sequenceId, after: result.rows[0] as Record<string, unknown> });
      return result.rows[0];
    });
  }

  setSequenceStatus(actor: RequestActor, workspaceId: string, sequenceId: string, input: SequenceVersionDto, status: "active" | "paused") {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const result = await client.query(
        `UPDATE crm_sequences SET status=$1,version=version+1
         WHERE workspace_id=$2 AND id=$3 AND version=$4 AND status<>'archived'
         RETURNING id,name,status,version`,
        [status, workspaceId, sequenceId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Sequence changed, is archived, or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: `crm.sequence.${status === "active" ? "published" : "paused"}.v1`, entityType: "crm_sequence", entityId: sequenceId, after: result.rows[0] as Record<string, unknown> });
      return result.rows[0];
    });
  }

  enrollSequence(actor: RequestActor, workspaceId: string, sequenceId: string, input: EnrollSequenceDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, input.partyId);
      const sequence = await client.query(`SELECT id FROM crm_sequences WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [sequenceId, workspaceId]);
      if (!sequence.rowCount) throw new NotFoundException("Sequence not found or inactive");
      if (input.leadId) {
        const lead = await client.query(`SELECT 1 FROM crm_leads WHERE id = $1 AND workspace_id = $2 AND party_id = $3`, [input.leadId, workspaceId, input.partyId]);
        if (!lead.rowCount) throw new UnprocessableEntityException("Lead does not belong to the party");
      }
      const firstStep = await client.query<{ delay_minutes: number }>(`SELECT delay_minutes FROM crm_sequence_steps WHERE workspace_id = $1 AND sequence_id = $2 ORDER BY position LIMIT 1`, [workspaceId, sequenceId]);
      if (!firstStep.rowCount) throw new ConflictException("Sequence has no steps");
      const result = await client.query(
        `INSERT INTO crm_sequence_enrollments
          (workspace_id, sequence_id, party_id, lead_id, next_run_at, enrolled_by)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, $6)
         RETURNING id, status, current_step AS "currentStep", next_run_at AS "nextRunAt", version`,
        [workspaceId, sequenceId, input.partyId, input.leadId ?? null, firstStep.rows[0].delay_minutes, actorUser.userId],
      );
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sequence.enrollment.created.v1", entityType: "crm_sequence_enrollment", entityId: String(response.id), after: { ...response, sequenceId, partyId: input.partyId, leadId: input.leadId ?? null } });
      return response;
    });
  }

  listSequenceEnrollments(actor: RequestActor, workspaceId: string, sequenceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const sequence = await client.query(`SELECT 1 FROM crm_sequences WHERE workspace_id=$1 AND id=$2`, [workspaceId, sequenceId]);
      if (!sequence.rowCount) throw new NotFoundException("Sequence not found");
      const result = await client.query(
        `SELECT enrollment.id,enrollment.party_id AS "partyId",party.display_name AS "partyName",
                enrollment.lead_id AS "leadId",enrollment.status,
                enrollment.current_step AS "currentStep",enrollment.next_run_at AS "nextRunAt",
                enrollment.exit_reason AS "exitReason",enrollment.exited_at AS "exitedAt",
                enrollment.version,enrollment.created_at AS "createdAt",enrollment.updated_at AS "updatedAt"
         FROM crm_sequence_enrollments enrollment
         JOIN crm_parties party ON party.workspace_id=enrollment.workspace_id AND party.id=enrollment.party_id
         WHERE enrollment.workspace_id=$1 AND enrollment.sequence_id=$2
         ORDER BY enrollment.created_at DESC LIMIT 200`,
        [workspaceId, sequenceId],
      );
      return result.rows;
    });
  }

  stopSequenceEnrollment(actor: RequestActor, workspaceId: string, enrollmentId: string, input: StopSequenceEnrollmentDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const result = await client.query(
        `UPDATE crm_sequence_enrollments SET status='stopped',exit_reason=$1,exited_at=now(),
                next_run_at=NULL,version=version+1
         WHERE workspace_id=$2 AND id=$3 AND status='active' AND version=$4
         RETURNING id,sequence_id AS "sequenceId",party_id AS "partyId",lead_id AS "leadId",
                   status,exit_reason AS "exitReason",exited_at AS "exitedAt",version`,
        [input.reason, workspaceId, enrollmentId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Enrollment changed, stopped, or was not found");
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.sequence.enrollment.stopped.v1", entityType: "crm_sequence_enrollment", entityId: enrollmentId, after: response });
      return response;
    });
  }

  async processDueSequencesInternal(workspaceId: string, limit = 50) {
    const candidateIds = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT enrollment.id FROM crm_sequence_enrollments enrollment
         JOIN crm_sequences sequence ON sequence.workspace_id=enrollment.workspace_id AND sequence.id=enrollment.sequence_id
         WHERE enrollment.workspace_id=$1 AND enrollment.status='active'
           AND enrollment.next_run_at<=now() AND sequence.status='active'
         ORDER BY enrollment.next_run_at,enrollment.id LIMIT $2`,
        [workspaceId, Math.min(Math.max(limit, 1), 100)],
      );
      return result.rows.map((row) => row.id);
    });
    const items: Record<string, unknown>[] = [];
    for (const enrollmentId of candidateIds) {
      try {
        const result = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
          this.processSequenceEnrollment(client, workspaceId, enrollmentId));
        if (result) items.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sequence step failed";
        const failed = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
          const result = await client.query(
            `UPDATE crm_sequence_enrollments SET status='failed',exit_reason='step_failed',
                    exited_at=now(),next_run_at=NULL,version=version+1
             WHERE workspace_id=$1 AND id=$2 AND status='active'
             RETURNING id,status,exit_reason AS "exitReason",version`,
            [workspaceId, enrollmentId],
          );
          if (result.rowCount) await this.events.record(client, { workspaceId, actorUserId: null, source: "automation", action: "crm.sequence.enrollment.failed.v1", entityType: "crm_sequence_enrollment", entityId: enrollmentId, after: { ...result.rows[0], error: message } });
          return result.rows[0] as Record<string, unknown> | undefined;
        });
        if (failed) items.push({ ...failed, error: message });
      }
    }
    return { items, processed: items.length };
  }

  private async processSequenceEnrollment(client: PoolClient, workspaceId: string, enrollmentId: string) {
    const enrollmentResult = await client.query<Record<string, unknown>>(
      `SELECT enrollment.*,sequence.status AS sequence_status
       FROM crm_sequence_enrollments enrollment
       JOIN crm_sequences sequence ON sequence.workspace_id=enrollment.workspace_id AND sequence.id=enrollment.sequence_id
       WHERE enrollment.workspace_id=$1 AND enrollment.id=$2 AND enrollment.status='active'
         AND enrollment.next_run_at<=now() AND sequence.status='active'
       FOR UPDATE OF enrollment SKIP LOCKED`,
      [workspaceId, enrollmentId],
    );
    if (!enrollmentResult.rowCount) return null;
    const enrollment = enrollmentResult.rows[0];
    const currentStep = Number(enrollment.current_step);
    const stepResult = await client.query<Record<string, unknown>>(
      `SELECT id,position,type,delay_minutes,configuration FROM crm_sequence_steps
       WHERE workspace_id=$1 AND sequence_id=$2 AND position=$3`,
      [workspaceId, enrollment.sequence_id, currentStep],
    );
    if (!stepResult.rowCount) return this.completeSequenceEnrollment(client, workspaceId, enrollmentId, currentStep);
    const step = stepResult.rows[0];
    const configuration = (step.configuration && typeof step.configuration === "object" && !Array.isArray(step.configuration))
      ? step.configuration as Record<string, unknown>
      : {};
    let action: Record<string, unknown> = { type: step.type, step: currentStep };
    if (step.type === "task") {
      const activity = await client.query(
        `INSERT INTO crm_activities
          (workspace_id,party_id,lead_id,type,title,description,owner_membership_id,
           priority,due_at,is_next_action,created_by)
         SELECT $1,$2,$3,'task',$4,$5,lead.owner_membership_id,$6,
                now()+($7::text||' minutes')::interval,$8,NULL
         FROM (SELECT 1) input
         LEFT JOIN crm_leads lead ON lead.workspace_id=$1 AND lead.id=$3
         RETURNING id,title,status,due_at AS "dueAt",owner_membership_id AS "ownerMembershipId",version`,
        [workspaceId, enrollment.party_id, enrollment.lead_id ?? null, configuration.title, configuration.description ?? null, configuration.priority ?? "normal", configuration.dueInMinutes ?? 0, configuration.isNextAction === true],
      );
      action = { ...action, activity: activity.rows[0] };
    } else if (step.type === "email" || step.type === "whatsapp") {
      const notification = await this.notifications.enqueueWithClient(client, {
        workspaceId,
        recipientType: "party",
        recipientId: String(enrollment.party_id),
        channel: String(step.type),
        templateCode: String(configuration.templateCode),
        locale: typeof configuration.locale === "string" ? configuration.locale : undefined,
        eventType: typeof configuration.eventType === "string" ? configuration.eventType : "crm.sequence.step",
        variables: configuration.variables && typeof configuration.variables === "object" && !Array.isArray(configuration.variables) ? configuration.variables as Record<string, unknown> : {},
        idempotencyKey: `sequence:${enrollmentId}:${currentStep}`,
        correlationId: randomUUID(),
        deepLink: typeof configuration.deepLink === "string" ? configuration.deepLink : undefined,
      });
      action = { ...action, notification };
      if (notification.status === "suppressed" && ["consent_missing", "recipient_preference"].includes(String(notification.suppressedReason))) {
        const stopped = await client.query(
          `UPDATE crm_sequence_enrollments SET status='exited',exit_reason=$1,exited_at=now(),
                  next_run_at=NULL,version=version+1 WHERE workspace_id=$2 AND id=$3
           RETURNING id,status,exit_reason AS "exitReason",version`,
          [notification.suppressedReason, workspaceId, enrollmentId],
        );
        return { ...stopped.rows[0], action };
      }
    }
    const nextStep = await client.query<{ delay_minutes: number }>(
      `SELECT delay_minutes FROM crm_sequence_steps
       WHERE workspace_id=$1 AND sequence_id=$2 AND position=$3`,
      [workspaceId, enrollment.sequence_id, currentStep + 1],
    );
    const updated = nextStep.rowCount
      ? await client.query(
        `UPDATE crm_sequence_enrollments SET current_step=$1,
                next_run_at=now()+($2::text||' minutes')::interval,version=version+1
         WHERE workspace_id=$3 AND id=$4
         RETURNING id,status,current_step AS "currentStep",next_run_at AS "nextRunAt",version`,
        [currentStep + 1, nextStep.rows[0].delay_minutes, workspaceId, enrollmentId],
      )
      : await client.query(
        `UPDATE crm_sequence_enrollments SET status='completed',current_step=$1,
                next_run_at=NULL,exited_at=now(),version=version+1
         WHERE workspace_id=$2 AND id=$3
         RETURNING id,status,current_step AS "currentStep",exited_at AS "exitedAt",version`,
        [currentStep + 1, workspaceId, enrollmentId],
      );
    const response = { ...updated.rows[0], action } as Record<string, unknown>;
    await this.events.record(client, { workspaceId, actorUserId: null, source: "automation", action: "crm.sequence.step.executed.v1", entityType: "crm_sequence_enrollment", entityId: enrollmentId, after: response });
    return response;
  }

  private async completeSequenceEnrollment(client: PoolClient, workspaceId: string, enrollmentId: string, currentStep: number) {
    const result = await client.query(
      `UPDATE crm_sequence_enrollments SET status='completed',current_step=$1,
              next_run_at=NULL,exited_at=now(),version=version+1
       WHERE workspace_id=$2 AND id=$3
       RETURNING id,status,current_step AS "currentStep",exited_at AS "exitedAt",version`,
      [currentStep, workspaceId, enrollmentId],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  private validateSequenceStep(type: string, configuration: Record<string, unknown>) {
    if ((type === "email" || type === "whatsapp") && (typeof configuration.templateCode !== "string" || !/^[a-z][a-z0-9_.-]{0,98}$/.test(configuration.templateCode))) {
      throw new UnprocessableEntityException(`${type} sequence steps require a valid templateCode`);
    }
    if (type === "task" && (typeof configuration.title !== "string" || !configuration.title.trim() || configuration.title.length > 240)) {
      throw new UnprocessableEntityException("Task sequence steps require a title of at most 240 characters");
    }
    if (configuration.variables !== undefined && (!configuration.variables || typeof configuration.variables !== "object" || Array.isArray(configuration.variables))) {
      throw new UnprocessableEntityException("Sequence template variables must be an object");
    }
    if (configuration.dueInMinutes !== undefined && (!Number.isInteger(configuration.dueInMinutes) || Number(configuration.dueInMinutes) < 0 || Number(configuration.dueInMinutes) > 525_600)) {
      throw new UnprocessableEntityException("Task dueInMinutes must be between 0 and 525600");
    }
  }

  private assertSequence(input: CreateSequenceDto) {
    if (!input.steps.length || input.steps.length > 100) throw new UnprocessableEntityException("Sequence requires 1 to 100 steps");
    const allowed = new Set(["email", "whatsapp", "task", "delay"]);
    for (const step of input.steps) {
      if (!allowed.has(step.type)) throw new UnprocessableEntityException(`Unsupported sequence step: ${step.type}`);
      if ((step.delayMinutes ?? 0) < 0) throw new UnprocessableEntityException("Sequence delay cannot be negative");
      this.validateSequenceStep(step.type, step.configuration ?? {});
    }
  }

  private async insertMessage(client: PoolClient, workspaceId: string, conversationId: string, input: CreateMessageDto, actorUserId: string | null, source: "user" | "integration") {
    if (!input.bodyText?.trim() && !input.bodyHtml?.trim() && !input.templateId) throw new UnprocessableEntityException("Message content or template is required");
    const conversation = await this.requireConversation(client, workspaceId, conversationId, true);
    const requestHash = input.clientMessageId ? stableHash({ direction: input.direction, bodyText: input.bodyText?.trim() ?? null, bodyHtml: input.bodyHtml?.trim() ?? null, templateId: input.templateId ?? null, purpose: input.purpose ?? "service", ...(input.templateParameters ? { templateParameters: input.templateParameters } : {}) }) : null;
    if (input.clientMessageId) {
      const prior = await client.query(`SELECT id, status, metadata, sender_id FROM crm_messages WHERE workspace_id=$1 AND conversation_id=$2 AND metadata->>'clientMessageId'=$3 LIMIT 1`, [workspaceId, conversationId, input.clientMessageId]);
      if (prior.rowCount) {
        if (prior.rows[0].metadata.requestHash !== requestHash || prior.rows[0].sender_id !== actorUserId) throw new ConflictException("This message retry does not match the original message");
        return { id: prior.rows[0].id, status: prior.rows[0].status, conversationId, idempotentReplay: true };
      }
    }
    // A snoozed chat can still be answered; a resolved one is reopened first.
    if (input.direction === "outbound" && conversation.status === "closed") throw new ConflictException("Reopen this conversation before replying");
    let bodyText = input.bodyText?.trim() ?? null;
    let bodyHtml = input.bodyHtml?.trim() ?? null;
    let template: Record<string, unknown> | null = null;
    let templateParameters: string[] = [];
    if (input.direction === "outbound" && conversation.channel !== "internal") {
      if (!conversation.party_id) throw new UnprocessableEntityException("Outbound customer messages require a party");
      await this.assertConsent(client, workspaceId, String(conversation.party_id), String(conversation.channel), input.purpose ?? "service");
      if (input.templateId) {
        const found = await client.query<Record<string, unknown>>(`SELECT id, code, body_template, subject_template, status FROM notification_templates WHERE id = $1 AND workspace_id = $2 AND channel = $3 ORDER BY version_number DESC LIMIT 1`, [input.templateId, workspaceId, conversation.channel]);
        if (!found.rowCount || found.rows[0].status !== "approved") throw new UnprocessableEntityException("Template is not approved for this channel");
        template = found.rows[0];
        const positions = templatePlaceholders(String(template.body_template));
        if (positions.length) {
          templateParameters = input.templateParameters?.map(normalizeTemplateParameter)
            ?? await this.fillTemplate(client, workspaceId, conversation, String(template.code), positions, actorUserId);
          const problem = templateParametersProblem(positions, templateParameters);
          if (problem) throw new UnprocessableEntityException(problem);
        } else if (input.templateParameters?.length) throw new UnprocessableEntityException("This template has no variables");
        // What the client receives is the template with its values, never free text beside it.
        bodyText = renderTemplate(String(template.body_template), templateParameters);
        bodyHtml = null;
      }
      if (conversation.channel === "whatsapp" && !input.templateId) {
        const lastInbound = conversation.last_inbound_at ? new Date(String(conversation.last_inbound_at)) : null;
        if (!lastInbound || Date.now() - lastInbound.getTime() > 24 * 60 * 60 * 1000) throw new UnprocessableEntityException("WhatsApp requires an approved template outside the 24-hour customer-service window");
      }
      if (!input.templateId && source === "user" && actorUserId && bodyText) {
        const signature = await client.query<{ enabled: boolean | null; name: string | null }>(
          `SELECT (SELECT signature_enabled FROM crm_inbox_settings WHERE workspace_id = $1) AS enabled, (SELECT display_name FROM users WHERE id = $2) AS name`,
          [workspaceId, actorUserId]);
        bodyText = withSignature(bodyText, signature.rows[0]?.name, signature.rows[0]?.enabled === true);
      }
    }
    const messageId = randomUUID();
    const queued = input.direction === "outbound" && conversation.channel !== "internal";
    const inserted = await client.query(
        `INSERT INTO crm_messages
          (id, workspace_id, conversation_id, direction, status, authorship, sender_type,
           sender_id, provider_message_id, body_text, body_html, metadata)
         VALUES ($1, $2, $3, $4::crm_message_direction, $5::crm_message_status,
                 $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (workspace_id, provider_message_id) DO NOTHING RETURNING id`,
        [
          messageId,
          workspaceId,
          conversationId,
          input.direction,
          queued ? "queued" : input.direction === "inbound" ? "delivered" : "sent",
          actorUserId && source === "user" ? "human" : source === "integration" ? "provider" : "automation",
          actorUserId ? "user" : source === "integration" ? "provider" : "system",
          actorUserId,
          input.providerMessageId ?? null,
          bodyText,
          bodyHtml,
          {
            ...input.metadata,
            ...(input.clientMessageId ? { clientMessageId: input.clientMessageId, requestHash } : {}),
            ...(template ? { template: { id: template.id, code: template.code, parameters: templateParameters } } : {}),
            ...(input.direction === "internal" && input.mentions?.length ? { mentions: [...new Set(input.mentions)] } : {}),
          },
        ],
      );
    if (!inserted.rowCount) {
      const prior = await client.query(`SELECT id, status, conversation_id AS "conversationId", direction FROM crm_messages WHERE workspace_id = $1 AND provider_message_id = $2`, [workspaceId, input.providerMessageId]);
      if (prior.rows[0]?.conversationId !== conversationId || prior.rows[0]?.direction !== input.direction) throw new ConflictException("Provider message already belongs to another conversation or direction");
      return { ...prior.rows[0], idempotentReplay: true };
    }
    // A client message reopens and un-snoozes the chat and starts (or keeps) its wait; our reply ends the wait.
    const touched = await client.query<Record<string, unknown>>(
      `UPDATE crm_conversations SET last_message_at = now(),
         status = CASE WHEN $1 = 'inbound' THEN 'open' ELSE status END,
         snoozed_until = CASE WHEN $1 = 'inbound' THEN NULL ELSE snoozed_until END,
         resolved_at = CASE WHEN $1 = 'inbound' THEN NULL ELSE resolved_at END,
         last_inbound_at = CASE WHEN $1 = 'inbound' THEN now() ELSE last_inbound_at END,
         waiting_since = CASE WHEN $1 = 'inbound' THEN COALESCE(waiting_since, now()) WHEN $1 = 'outbound' THEN NULL ELSE waiting_since END,
         unread_count = CASE WHEN $1 = 'inbound' THEN unread_count + 1 ELSE unread_count END,
         version = version + 1 WHERE id = $2 AND workspace_id = $3 RETURNING *`,
      [input.direction, conversationId, workspaceId],
    );
    if (input.direction === "inbound") {
      await client.query(`UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = 'customer_replied', exited_at = now(), next_run_at = NULL, version = version + 1 WHERE workspace_id = $1 AND party_id = $2 AND status = 'active'`, [workspaceId, conversation.party_id]);
    }
    const response = { id: messageId, conversationId, direction: input.direction, status: queued ? "queued" : input.direction === "inbound" ? "delivered" : "sent", bodyText, bodyHtml };
    if (queued) {
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
          (id, workspace_id, template_id, recipient_type, recipient_id, channel,
           status, subject, body, idempotency_key, correlation_id, template_parameters)
         VALUES ($1, $2, $3, 'party', $4, $5, 'pending', $6, $7, $8, $9, $10)`,
        [notificationId, workspaceId, template?.id ?? null, conversation.party_id, conversation.channel, template?.subject_template ?? conversation.subject, bodyText ?? bodyHtml, `message:${messageId}`, randomUUID(), templateParameters],
      );
      await this.events.record(client, { workspaceId, actorUserId, source, action: "notification.delivery_requested.v1", entityType: "notification", entityId: notificationId, after: { messageId, channel: conversation.channel, partyId: conversation.party_id } });
    }
    const aggregateType = input.direction === "inbound" && conversation.lead_id
      ? "crm_lead"
      : input.direction === "inbound" && conversation.party_id
        ? "crm_party"
        : "crm_message";
    const aggregateId = input.direction === "inbound"
      ? String(conversation.lead_id ?? conversation.party_id ?? messageId)
      : messageId;
    await this.events.record(client, { workspaceId, actorUserId, source, action: input.direction === "inbound" ? "crm.customer.replied.v1" : "crm.message.created.v1", entityType: aggregateType, entityId: aggregateId, after: { ...response, partyId: conversation.party_id, leadId: conversation.lead_id } });
    if (input.direction === "inbound") await this.routeInbound(client, workspaceId, conversation, touched.rows[0], messageId, bodyText);
    if (input.direction === "internal" && input.mentions?.length) await this.noticeMentions(client, workspaceId, conversation, [...new Set(input.mentions)], messageId, bodyText, actorUserId);
    return response;
  }

  /**
   * After a client message: a resolved or snoozed chat is back (a history line); a chat nobody owns goes to the
   * person who already looks after the client, else the inbox queue; then one notice per chat tells its owner,
   * or the queue when nobody could take it.
   */
  private async routeInbound(client: PoolClient, workspaceId: string, before: Record<string, unknown>, after: Record<string, unknown>, messageId: string, bodyText: string | null) {
    const conversationId = String(before.id);
    if (before.status === "closed" || before.status === "snoozed") {
      await recordChatEvent(client, { workspaceId, conversationId, kind: "reopened", actorUserId: null, method: "client_replied" });
    }
    let owner = (after.owner_membership_id as string | null) ?? null;
    let queueId: string | null = null;
    if (!owner) {
      const selection = await selectInboxOwner(client, workspaceId, { partyId: (before.party_id as string | null) ?? null, leadId: (before.lead_id as string | null) ?? null, channel: String(before.channel) });
      queueId = selection.queueId;
      if (selection.ownerMembershipId && selection.method) {
        const assigned = await client.query(`UPDATE crm_conversations SET owner_membership_id = $3, assigned_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2 AND owner_membership_id IS NULL RETURNING version`, [workspaceId, conversationId, selection.ownerMembershipId]);
        if (assigned.rowCount) {
          owner = selection.ownerMembershipId;
          await recordChatEvent(client, { workspaceId, conversationId, kind: "assigned", actorUserId: null, ownerMembershipId: owner, method: selection.method, reason: selection.reason });
          await this.events.record(client, { workspaceId, actorUserId: null, source: "automation", action: "crm.conversation.assigned.v1", entityType: "crm_conversation", entityId: conversationId, after: { ownerMembershipId: owner, method: selection.method, reason: selection.reason, queueId: selection.queueId } });
        }
      }
    }
    const facts = await client.query<{ clientName: string | null; kinds: string[] }>(
      `SELECT (SELECT display_name FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "clientName",
              ARRAY(SELECT coalesce(metadata->>'messageType', 'text') FROM crm_messages
                     WHERE workspace_id = $1 AND conversation_id = $3 AND direction = 'inbound'
                     ORDER BY created_at DESC LIMIT greatest($4::int, 1)) AS kinds`,
      [workspaceId, before.party_id ?? null, conversationId, Number(after.unread_count ?? 1)]);
    const clientName = facts.rows[0]?.clientName ?? "A client";
    const summary = inboundSummary(Number(after.unread_count ?? 1), bodyText, facts.rows[0]?.kinds ?? []);
    if (owner) {
      const user = await userOfMembership(client, workspaceId, owner);
      if (user) await noticeChat(client, { workspaceId, conversationId, recipientUserId: user.userId, code: "crm.inbox_message", eventType: "crm.inbox.message", variables: { clientName, summary }, idempotencyKey: `crm:inbox:message:${messageId}:${user.userId}` });
      return;
    }
    queueId ??= (await inboxQueue(client, workspaceId, String(before.channel)))?.id ?? null;
    for (const userId of await unassignedAudience(client, workspaceId, queueId)) {
      await noticeChat(client, { workspaceId, conversationId, recipientUserId: userId, code: "crm.inbox_unassigned", eventType: "crm.inbox.unassigned", variables: { clientName }, idempotencyKey: `crm:inbox:unassigned:${messageId}:${userId}` });
    }
  }

  /** Values for a template's {{n}} from the workspace's mapping and the chat's records; a missing one blocks the send. */
  private async fillTemplate(client: PoolClient, workspaceId: string, conversation: Record<string, unknown>, code: string, positions: number[], actorUserId: string | null) {
    const mapping = await client.query<{ position: number; source: TemplateVariableSource }>(
      `SELECT position, source FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' AND template_code = $2`, [workspaceId, code]);
    const sources = new Map(mapping.rows.map((row) => [Number(row.position), row.source]));
    const unmapped = positions.find((position) => !sources.has(position));
    if (unmapped) throw new UnprocessableEntityException(`Fill in {{${unmapped}}}: choose its field in Settings → Inbox → Templates`);
    const values = await resolveTemplateSources(client, { workspaceId, partyId: (conversation.party_id as string | null) ?? null, leadId: (conversation.lead_id as string | null) ?? null, staffUserId: actorUserId, config: this.config }, sources.values());
    return positions.map((position) => {
      const source = sources.get(position)!;
      const value = values[source];
      if (!value) throw new UnprocessableEntityException(`Fill in {{${position}}} (${SOURCE_NAMES[source]}): this chat has no value for it`);
      return normalizeTemplateParameter(value);
    });
  }

  /** Each person @mentioned in a note (who can open the inbox, and is not the writer) is told in-app and by push. */
  private async noticeMentions(client: PoolClient, workspaceId: string, conversation: Record<string, unknown>, mentions: string[], messageId: string, bodyText: string | null, actorUserId: string | null) {
    const people = await client.query<{ userId: string }>(`SELECT inbox."userId" FROM (${INBOX_MEMBERS_SQL}) inbox WHERE inbox."membershipId" = ANY($2::uuid[])`, [workspaceId, mentions]);
    const facts = await client.query<{ actor: string | null; clientName: string | null }>(
      `SELECT (SELECT ${MEMBER_NAME("account")} FROM users account WHERE account.id = $2) AS actor,
              (SELECT display_name FROM crm_parties WHERE workspace_id = $1 AND id = $3) AS "clientName"`,
      [workspaceId, actorUserId, conversation.party_id ?? null]);
    const variables = { actor: facts.rows[0]?.actor ?? "A teammate", clientName: facts.rows[0]?.clientName ?? "a client", summary: inboundSummary(1, bodyText) };
    const deepLink = inboxLink(String(conversation.id));
    for (const { userId } of people.rows) {
      if (userId === actorUserId) continue;
      const key = `crm:inbox:mention:${messageId}:${userId}`;
      const raised = await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "crm.inbox_mention", eventType: "crm.inbox.mention", variables, deepLink, idempotencyKey: key });
      if (raised.queued) await queueUserPush(client, { workspaceId, recipientUserId: userId, code: "crm.inbox_mention", eventType: "crm.inbox.mention", variables, deepLink, idempotencyKey: `${key}:push` });
    }
  }

  private async viewerMembership(client: PoolClient, workspaceId: string, userId: string) {
    const result = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId]);
    return result.rows[0]?.id ?? null;
  }

  private async assertConsent(client: PoolClient, workspaceId: string, partyId: string, channel: string, purpose: string) {
    if (channel === "portal") return;
    const result = await client.query<{ status: string; expires_at: Date | null }>(`SELECT status, expires_at FROM crm_consents WHERE workspace_id = $1 AND party_id = $2 AND channel = $3 AND purpose = $4 ORDER BY captured_at DESC LIMIT 1`, [workspaceId, partyId, channel, purpose]);
    const consent = result.rows[0];
    if (!consent || consent.status !== "granted" || (consent.expires_at && consent.expires_at <= new Date())) throw new UnprocessableEntityException(`Active ${channel} consent is required for ${purpose} communication`);
  }

  private async requireConversation(client: PoolClient, workspaceId: string, conversationId: string, lock: boolean) {
    const result = await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`, [conversationId, workspaceId]);
    if (!result.rowCount) throw new NotFoundException("Conversation not found");
    return result.rows[0];
  }

  private async requireParty(client: PoolClient, workspaceId: string, partyId: string) { const result = await client.query(`SELECT 1 FROM crm_parties WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [partyId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Party does not exist or is inactive"); }
  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) { const result = await client.query(`SELECT 1 FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [membershipId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Member does not exist or is inactive"); }
}
