import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmNotificationsService } from "../notifications/crm-notifications.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";
import { notifyUserInApp } from "../../notifications/default-templates";
import { decodeCursor, encodeCursor, normalizeEmail, normalizeLoosePhone, normalizeName, stableHash } from "../shared/crm-types";
import { CreateConversationDto, CreateMessageDto, CreateSequenceDto, EnrollSequenceDto, ListConversationsQueryDto, MessageReceiptDto, ProviderInboundMessageDto, ProviderMessageReceiptDto, SequenceVersionDto, SimulateWhatsAppDto, StopSequenceEnrollmentDto, UpdateSequenceDto, UpdateConversationDto } from "./dto/conversations.dto";
import { applyConversationChange, mapConversation, recordChatEvent } from "./inbox/inbox-commands";
import { INBOX_MEMBERS_SQL, inboxQueue, selectInboxOwner } from "./inbox/inbox-assignment";
import { cancelScheduledOnReply } from "./inbox/scheduled-cancel";
import { inboxLink, noticeChat, readChatNotices, unassignedAudience, userOfMembership } from "./inbox/inbox-notices";
import { inboundSummary, normalizeTemplateParameter, renderTemplate, stageFilterSql, TEMPLATE_SOURCE_NAMES, templateParametersProblem, templatePlaceholders, withSignature, type TemplateVariableSource } from "./inbox/inbox-rules";
import { resolveTemplateSources } from "./inbox/template-variables";
import { sendAutoReply } from "./inbox/auto-replies";
import { kindOf, safeFileName, sendableProblem, WHATSAPP_MEDIA, type SendableKind } from "./inbox/attachment-rules";
import { inboundDomain } from "./email/mailgun-inbound";
import { conversationVisible, findJob, INBOX_MANAGE, INBOX_READ, JOB_SQL, loadInboxViewer, viewSql, visibleSql, type InboxViewer, type JobKind } from "./inbox/inbox-visibility";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A message's file (one per message), without the storage key; a hidden message hides its file too. */
export const MESSAGE_ATTACHMENT_SQL = `CASE WHEN message.hidden_at IS NULL THEN (SELECT jsonb_build_object('id', attachment.id, 'kind', attachment.kind,
    'mimeType', attachment.content_type, 'fileName', attachment.file_name, 'byteSize', attachment.byte_size, 'status', attachment.status,
    'failureCode', attachment.failure_code)
   FROM crm_message_attachments attachment WHERE attachment.workspace_id = message.workspace_id AND attachment.message_id = message.id
   ORDER BY attachment.position LIMIT 1) END`;
/**
 * An email message's own facts (subject, sender, recipients, every file, and the whole text when the chat shows it
 * without its quoted history); null for any other message. A hidden message hides them too.
 */
export const MESSAGE_EMAIL_SQL = `CASE WHEN message.hidden_at IS NULL THEN (SELECT jsonb_build_object('subject', email.subject, 'from', email.from_address, 'fromName', email.from_name,
    'to', to_jsonb(email.to_addresses), 'cc', to_jsonb(email.cc_addresses),
    'fullText', CASE WHEN email.full_text IS DISTINCT FROM message.body_text THEN email.full_text END,
    'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', attachment.id, 'kind', attachment.kind, 'mimeType', attachment.content_type, 'fileName', attachment.file_name,
        'byteSize', attachment.byte_size, 'status', attachment.status, 'failureCode', attachment.failure_code) ORDER BY attachment.position)
      FROM crm_message_attachments attachment WHERE attachment.workspace_id = message.workspace_id AND attachment.message_id = message.id), '[]'::jsonb))
   FROM crm_email_messages email WHERE email.workspace_id = message.workspace_id AND email.message_id = message.id) END`;
/** The chat's number when it is still connected, else the workspace's default connected WhatsApp number. */
const CHAT_NUMBER_SQL = `SELECT id AS "connectionId", configuration->>'displayPhoneNumber' AS number, configuration->>'accountName' AS "accountName", configuration->'health' AS health
   FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
  ORDER BY (id = $2::uuid) DESC NULLS LAST, COALESCE((configuration->>'isDefault')::boolean, false) DESC, updated_at DESC, id LIMIT 1`;
/** Open chats by who has waited longest for our reply; chats nobody waits on follow, most recent first. */
const WAITING_KEY = `(CASE WHEN conversation.waiting_since IS NOT NULL THEN extract(epoch FROM conversation.waiting_since)
  ELSE 100000000000 - extract(epoch FROM COALESCE(conversation.last_message_at, conversation.created_at)) END)`;
export const CONVERSATION_LABELS_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', label.id, 'name', label.name, 'color', label.color) ORDER BY lower(label.name))
    FROM crm_conversation_label_links link JOIN crm_conversation_labels label ON label.workspace_id = link.workspace_id AND label.id = link.label_id
   WHERE link.workspace_id = conversation.workspace_id AND link.conversation_id = conversation.id), '[]'::jsonb)`;
const MEMBER_NAME = (alias: string) => `coalesce(nullif(btrim(${alias}.display_name), ''), ${alias}.primary_email)`;
/** A template's variable names, for a blocked send: "Fill in {{2}} (Enquiry reference)". */
const SOURCE_NAMES = TEMPLATE_SOURCE_NAMES;

@Injectable()
export class CrmConversationsService {
  private readonly logger = new Logger(CrmConversationsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly notifications: CrmNotificationsService,
    private readonly receipts: CrmMessageReceiptService = new CrmMessageReceiptService(),
    @Optional() private readonly config?: ConfigService,
  ) {}

  list(actor: RequestActor, workspaceId: string, query: ListConversationsQueryDto) {
    return this.access.withAnyPermission(actor, workspaceId, INBOX_READ, async (client, actorUser) => {
      const sort = query.sort ?? (query.status === "open" ? "waiting" : "recent");
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || (sort === "waiting" && !/^-?\d+(\.\d+)?$/.test(cursor.value)))) throw new BadRequestException("Invalid page cursor");
      // Who may see what (plan §5b): own chats, the team's, or every chat. Every list view stays inside it.
      const viewer = await this.viewer(client, workspaceId, actorUser.userId);
      const values: unknown[] = [workspaceId, viewer.membershipId];
      const clauses = ["conversation.workspace_id = $1", visibleSql(viewer, "$2")];
      const view = viewSql(query.view, "$2");
      if (view) clauses.push(view);
      for (const [column, value] of [["party_id", query.partyId], ["lead_id", query.leadId], ["owner_membership_id", query.ownerMembershipId], ["channel", query.channel], ["connection_id", query.connectionId]] as const) {
        if (value) { values.push(value); clauses.push(`conversation.${column} = $${values.length}`); }
      }
      if (query.status) { values.push(query.status); clauses.push(`conversation.status = $${values.length}`); }
      if (query.labelId) { values.push(query.labelId); clauses.push(`EXISTS (SELECT 1 FROM crm_conversation_label_links link WHERE link.workspace_id = conversation.workspace_id AND link.conversation_id = conversation.id AND link.label_id = $${values.length})`); }
      if (query.stage) { const stageSql = stageFilterSql(query.stage.split(",").slice(0, 30), (value) => { values.push(value); return `$${values.length}`; }); if (stageSql) clauses.push(stageSql); }
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
                COALESCE(message.body_text, message.metadata->>'fileName') AS "lastMessageText", message.metadata->>'messageType' AS "lastMessageKind",
                message.status AS "lastMessageStatus", conversation.connection_id AS "connectionId", ${JOB_SQL()} AS job, ${WAITING_KEY}::text AS "sortKey"
         FROM crm_conversations conversation
         LEFT JOIN crm_parties party ON party.id = conversation.party_id AND party.workspace_id = conversation.workspace_id
         LEFT JOIN workspace_memberships owner_membership ON owner_membership.workspace_id = conversation.workspace_id AND owner_membership.id = conversation.owner_membership_id
         LEFT JOIN users owner_user ON owner_user.id = owner_membership.user_id
         LEFT JOIN LATERAL (
           SELECT id, direction, body_text, status, metadata FROM crm_messages
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
    return this.access.withAnyPermission(actor, workspaceId, INBOX_READ, async (client, actorUser) => {
      const conversation = await this.requireVisibleConversation(client, workspaceId, conversationId, actorUser.userId, false);
      const messages = await client.query(
        `SELECT message.id, message.direction, message.status, message.authorship, message.sender_type AS "senderType", message.sender_id AS "senderId",
                ${MEMBER_NAME("sender")} AS "senderName",
                message.provider_message_id AS "providerMessageId",
                -- A hidden message keeps its content for the audit; Wodana's views show who hid it instead.
                CASE WHEN message.hidden_at IS NULL THEN message.body_text END AS "bodyText",
                CASE WHEN message.hidden_at IS NULL THEN message.body_html END AS "bodyHtml", message.sent_at AS "sentAt", message.delivered_at AS "deliveredAt",
                message.read_at AS "readAt", message.failure_code AS "failureCode",
                CASE WHEN message.hidden_at IS NULL THEN message.metadata ELSE jsonb_strip_nulls(jsonb_build_object('automatic', message.metadata->'automatic')) END AS metadata, message.version,
                message.hidden_at AS "hiddenAt", ${MEMBER_NAME("hider")} AS "hiddenByName", ${MESSAGE_ATTACHMENT_SQL} AS attachment,
                ${MESSAGE_EMAIL_SQL} AS email, message.created_at AS "createdAt", message.updated_at AS "updatedAt"
         FROM crm_messages message LEFT JOIN users sender ON sender.id = message.sender_id LEFT JOIN users hider ON hider.id = message.hidden_by
         WHERE message.workspace_id = $1 AND message.conversation_id = $2
         ORDER BY message.created_at DESC, message.id DESC LIMIT 101`, [workspaceId, conversationId],
      );
      // "Send later": what is still to go, and what could not go (until someone cancels it), in send order.
      const scheduled = await client.query(
        `SELECT scheduled.id, scheduled.status, scheduled.send_at AS "sendAt", scheduled.body_text AS "bodyText", scheduled.template_id AS "templateId",
                scheduled.template_code AS "templateCode", scheduled.template_parameters AS "templateParameters", scheduled.rendered_text AS "renderedText",
                scheduled.failure_reason AS "failureReason", scheduled.created_by AS "createdBy", ${MEMBER_NAME("author")} AS "createdByName",
                scheduled.version, scheduled.created_at AS "createdAt"
           FROM crm_scheduled_messages scheduled LEFT JOIN users author ON author.id = scheduled.created_by
          WHERE scheduled.workspace_id = $1 AND scheduled.conversation_id = $2 AND scheduled.status IN ('scheduled', 'failed')
          ORDER BY scheduled.send_at, scheduled.id LIMIT 50`, [workspaceId, conversationId]);
      const facts = await client.query<{ partyName: string | null; ownerName: string | null; leadReference: string | null; businessName: string; signatureEnabled: boolean | null; blockedAt: Date | null; spamAt: Date | null; emailLocalPart: string | null; googleConnected: boolean }>(
        `SELECT (SELECT display_name FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "partyName",
                (SELECT ${MEMBER_NAME("account")} FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
                  WHERE membership.workspace_id = $1 AND membership.id = $3) AS "ownerName",
                (SELECT enquiry.reference FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
                  WHERE lead.workspace_id = $1 AND lead.id = $4) AS "leadReference",
                (SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) FROM workspaces workspace
                   LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1) AS "businessName",
                (SELECT signature_enabled FROM crm_inbox_settings WHERE workspace_id = $1) AS "signatureEnabled",
                (SELECT blocked_at FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "blockedAt",
                (SELECT spam_at FROM crm_parties WHERE workspace_id = $1 AND id = $2) AS "spamAt",
                (SELECT local_part FROM crm_inbound_email_addresses WHERE workspace_id = $1 AND status = 'active') AS "emailLocalPart",
                EXISTS (SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'google_workspace' AND status = 'connected') AS "googleConnected"`,
        [workspaceId, conversation.party_id ?? null, conversation.owner_membership_id ?? null, conversation.lead_id ?? null],
      );
      const canSend = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.send");
      const canManage = await this.hasAny(client, workspaceId, actorUser.userId, INBOX_MANAGE);
      const job = (await client.query<{ job: Record<string, unknown> | null }>(`SELECT ${JOB_SQL()} AS job FROM crm_conversations conversation WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId])).rows[0]?.job ?? null;
      // The number replies go from: the one the client last wrote to, else the workspace's default number.
      const connection = await client.query<{ connectionId: string; number: string | null; accountName: string | null; health: Record<string, unknown> | null }>(
        CHAT_NUMBER_SQL, [workspaceId, conversation.connection_id ?? null]);
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
        // A demonstration chat (Inbox › Simulate a client message) behaves as connected; nothing reaches Meta.
        ...mapConversation(conversation), canSend, whatsappConnected: Boolean(connection.rowCount) || isDemoThread(conversation),
        demo: isDemoThread(conversation),
        partyName: fact?.partyName ?? null, ownerName: fact?.ownerName ?? null, leadReference: fact?.leadReference ?? null,
        labels: labels.rows[0]?.labels ?? [], events: history.rows,
        replyingAs: { businessName: fact?.businessName ?? null, number: connection.rows[0]?.number ?? null, accountName: connection.rows[0]?.accountName ?? null, connectionId: connection.rows[0]?.connectionId ?? null },
        scheduledMessages: scheduled.rows,
        numberHealth: (connection.rows[0]?.health?.state as string | undefined) ?? null,
        signatureEnabled: fact?.signatureEnabled === true, canManage, job,
        blockedAt: fact?.blockedAt ?? null, spamAt: fact?.spamAt ?? null,
        // An email chat: the address replies come back to, and how replies leave (the inbound address, else Google).
        email: conversation.channel === "email" ? this.emailReplying(fact?.emailLocalPart ?? null, fact?.googleConnected === true) : null,
        windowClosesAt: lastInbound ? new Date(lastInbound.getTime() + 86_400_000).toISOString() : null,
        messages: page.reverse(),
        nextMessagesCursor: hasOlder && oldest ? encodeCursor({ value: new Date(oldest.createdAt).toISOString(), id: oldest.id }) : null,
      };
    });
  }

  messages(actor: RequestActor, workspaceId: string, conversationId: string, query: { cursor?: string; limit: number }) {
    return this.access.withAnyPermission(actor, workspaceId, INBOX_READ, async (client, actorUser) => {
      await this.requireVisibleConversation(client, workspaceId, conversationId, actorUser.userId, false);
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.value)))) throw new BadRequestException("Invalid message cursor");
      // Internal notes are part of the team's thread (never sent to the client).
      const result = await client.query(`SELECT message.id,message.direction,message.status,message.authorship,message.sender_type AS "senderType",message.sender_id AS "senderId",
          coalesce(nullif(btrim(sender.display_name), ''), sender.primary_email) AS "senderName",CASE WHEN message.hidden_at IS NULL THEN message.body_text END AS "bodyText",CASE WHEN message.hidden_at IS NULL THEN message.metadata ELSE jsonb_strip_nulls(jsonb_build_object('automatic', message.metadata->'automatic')) END AS metadata,message.hidden_at AS "hiddenAt",coalesce(nullif(btrim(hider.display_name), ''), hider.primary_email) AS "hiddenByName",${MESSAGE_ATTACHMENT_SQL} AS attachment,${MESSAGE_EMAIL_SQL} AS email,message.created_at AS "createdAt",message.failure_code AS "failureCode"
        FROM crm_messages message LEFT JOIN users sender ON sender.id = message.sender_id LEFT JOIN users hider ON hider.id = message.hidden_by
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
      if (input.channel === "email" && input.partyId) {
        const email = await client.query(`SELECT 1 FROM crm_contact_points WHERE workspace_id=$1 AND party_id=$2 AND type='email' AND status='active' LIMIT 1`, [workspaceId, input.partyId]);
        if (!email.rowCount) throw new UnprocessableEntityException("Add an email address to this contact before starting an email conversation");
      }
      if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
      // Someone who sees only their own chats owns the chat they start, so it never leaves their reach (plan §5b).
      const viewer = await this.viewer(client, workspaceId, actorUser.userId);
      const ownerMembershipId = input.ownerMembershipId ?? (viewer.scope === "own" ? viewer.membershipId : null);
      // A WhatsApp chat we start goes from the default number until the client writes to another one.
      const number = input.channel === "whatsapp" ? (await client.query<{ connectionId: string }>(CHAT_NUMBER_SQL, [workspaceId, null])).rows[0]?.connectionId ?? null : null;
      // A chat started from an enquiry is filed into it.
      const result = await client.query(
        `INSERT INTO crm_conversations
          (workspace_id, party_id, lead_id, channel, subject, owner_membership_id, connection_id, job_kind, job_id, filed_at, filed_by)
         VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, CASE WHEN $3::uuid IS NULL THEN NULL ELSE 'enquiry' END, $3::uuid, CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END, CASE WHEN $3::uuid IS NULL THEN NULL ELSE $8::uuid END)
         RETURNING *`,
        [workspaceId, input.partyId ?? null, input.leadId ?? null, input.channel, input.subject ?? null, ownerMembershipId, number, actorUser.userId],
      );
      const conversation = mapConversation(result.rows[0] as Record<string, unknown>);
      const conversationId = String(conversation.id);
      for (const partyId of new Set([...(input.participantPartyIds ?? []), ...(input.partyId ? [input.partyId] : [])])) {
        await this.requireParty(client, workspaceId, partyId);
        await client.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'party', $3) ON CONFLICT DO NOTHING`, [workspaceId, conversationId, partyId]);
      }
      for (const membershipId of new Set([...(input.participantMembershipIds ?? []), ...(ownerMembershipId ? [ownerMembershipId] : [])])) {
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
      await this.requireVisibleConversation(client, workspaceId, conversationId, actorUser.userId, false);
      return this.insertMessage(client, workspaceId, conversationId, input, actorUser.userId, "user");
    });
  }

  updateConversation(actor: RequestActor, workspaceId: string, conversationId: string, input: UpdateConversationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const before = await this.requireVisibleConversation(client, workspaceId, conversationId, actorUser.userId, true);
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
      await this.requireVisibleConversation(client, workspaceId, conversationId, actorUser.userId, true);
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

  /**
   * A demonstration: a client's WhatsApp message, simulated by a manager, goes through the same intake as a real
   * one (client matched or created, owner chosen and told, greeting or away message). Its chat is marked demo:
   * replies in it show as sent and nothing reaches Meta. Audited.
   */
  async simulateWhatsApp(actor: RequestActor, workspaceId: string, input: SimulateWhatsAppDto) {
    const contact = normalizeLoosePhone(input.phone);
    if (!contact) throw new UnprocessableEntityException("Enter a valid mobile number");
    await this.access.withAnyPermission(actor, workspaceId, [...INBOX_MANAGE], async (client, actorUser) => {
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.demo_message.v1", entityType: "crm_conversation",
        entityId: workspaceId, after: { contact, demo: true } });
    });
    return this.ingestProviderMessage({ workspaceId, channel: "whatsapp", providerThreadId: `demo:${contact}`, providerMessageId: `demo:${randomUUID()}`,
      contact, displayName: input.name?.trim() || undefined, bodyText: input.text.trim(), metadata: { demo: true } });
  }

  ingestProviderMessage(input: ProviderInboundMessageDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, (client) => this.ingestWithClient(client, input));
  }

  /**
   * An inbound email inside the caller's tenant transaction: the sender matched to a client by email (or a new
   * contact), the conversation `thread` finds for it (else a new one), then the same intake as any client message:
   * owner chosen and told, the job's owner told, the wait started.
   */
  ingestEmailWithClient(client: PoolClient, input: ProviderInboundMessageDto, thread: (partyId: string) => Promise<string | null>) {
    if (input.channel !== "email") throw new UnprocessableEntityException("Only email is threaded this way");
    return this.ingestWithClient(client, input, thread);
  }

  /** How an email chat is answered: from the inbound address (Reply-To) when the workspace has one, else Google. */
  private emailReplying(localPart: string | null, googleConnected: boolean) {
    const domain = inboundDomain(this.config?.get<string>("INBOUND_EMAIL_DOMAIN") ?? process.env.INBOUND_EMAIL_DOMAIN);
    const address = localPart && domain ? `${localPart}@${domain}` : null;
    return { address, via: address ? "inbound" : googleConnected ? "google" : null };
  }

  private async ingestWithClient(client: PoolClient, input: ProviderInboundMessageDto, thread?: (partyId: string) => Promise<string | null>) {
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
    let conversationId = found.rows[0]?.id ?? (thread ? await thread(partyId) ?? undefined : undefined);
    if (!conversationId && input.channel === "whatsapp") {
      const manual = await client.query<{ id: string }>(`SELECT id FROM crm_conversations WHERE workspace_id=$1 AND party_id=$2 AND channel='whatsapp' AND provider_thread_id IS NULL ORDER BY last_message_at DESC NULLS LAST, id LIMIT 1 FOR UPDATE`, [input.workspaceId, partyId]);
      if (manual.rowCount) {
        conversationId = manual.rows[0].id;
        await client.query(`UPDATE crm_conversations SET provider_thread_id=$3 WHERE workspace_id=$1 AND id=$2`, [input.workspaceId, conversationId, input.providerThreadId]);
      }
    }
    // The number the client wrote to: replies to this chat go from it from now on.
    const number = input.channel === "whatsapp" ? await this.writtenNumber(client, input.workspaceId, input.metadata) : null;
    if (!conversationId) {
      conversationId = randomUUID();
      await client.query(`INSERT INTO crm_conversations (id,workspace_id,party_id,channel,provider_thread_id,subject,connection_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [conversationId, input.workspaceId, partyId, input.channel, input.providerThreadId, input.subject?.trim() || (input.channel === "whatsapp" ? "WhatsApp conversation" : "Email conversation"), number]);
      await client.query(`INSERT INTO crm_conversation_participants (workspace_id,conversation_id,participant_type,participant_id) VALUES($1,$2,'party',$3) ON CONFLICT DO NOTHING`, [input.workspaceId, conversationId, partyId]);
    } else if (number) {
      await client.query(`UPDATE crm_conversations SET connection_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND connection_id IS DISTINCT FROM $3`, [input.workspaceId, conversationId, number]);
    }
    const message = await this.insertMessage(client, input.workspaceId, conversationId, { direction: "inbound", bodyText: input.bodyText, bodyHtml: input.bodyHtml, providerMessageId: input.providerMessageId, metadata: input.metadata }, null, "integration");
    return { conversationId, partyId, message };
  }

  /**
   * Coexistence: a message the owner sent from the WhatsApp Business app on the same number. It lands in the
   * client's chat once (by Meta's message id) as "Sent from phone", and counts as our reply.
   */
  ingestProviderEcho(input: ProviderInboundMessageDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      if (input.channel !== "whatsapp") throw new UnprocessableEntityException("Only WhatsApp echoes are supported");
      const normalized = normalizeLoosePhone(input.contact);
      if (!normalized) throw new UnprocessableEntityException("Provider contact is invalid");
      const known = await client.query(`SELECT id, conversation_id AS "conversationId" FROM crm_messages WHERE workspace_id = $1 AND provider_message_id = $2`, [input.workspaceId, input.providerMessageId]);
      if (known.rowCount) return { conversationId: known.rows[0].conversationId, messageId: known.rows[0].id, duplicate: true };
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`provider-contact:${input.workspaceId}:whatsapp:${normalized}`]);
      let partyId = (await client.query<{ partyId: string }>(`SELECT party_id AS "partyId" FROM crm_contact_points WHERE workspace_id = $1 AND type = 'phone' AND normalized_value = $2 AND status = 'active' ORDER BY is_verified DESC, is_primary DESC, created_at LIMIT 1`, [input.workspaceId, normalized])).rows[0]?.partyId;
      if (!partyId) {
        partyId = randomUUID();
        const displayName = `WhatsApp ${input.contact}`;
        await client.query(`INSERT INTO crm_parties (id, workspace_id, type, display_name, normalized_name, created_by) VALUES ($1, $2, 'person', $3, $4, NULL)`, [partyId, input.workspaceId, displayName, normalizeName(displayName)]);
        await client.query(`INSERT INTO crm_person_profiles (party_id, workspace_id) VALUES ($1, $2)`, [partyId, input.workspaceId]);
        await client.query(`INSERT INTO crm_contact_points (workspace_id, party_id, type, raw_value, normalized_value, is_primary) VALUES ($1, $2, 'phone', $3, $4, true)`, [input.workspaceId, partyId, input.contact, normalized]);
      }
      let conversationId = (await client.query<{ id: string }>(
        `SELECT id FROM crm_conversations WHERE workspace_id = $1 AND channel = 'whatsapp' AND (provider_thread_id = $2 OR party_id = $3)
          ORDER BY (provider_thread_id = $2) DESC, last_message_at DESC NULLS LAST LIMIT 1 FOR UPDATE`, [input.workspaceId, input.providerThreadId, partyId])).rows[0]?.id;
      if (!conversationId) {
        conversationId = randomUUID();
        await client.query(`INSERT INTO crm_conversations (id, workspace_id, party_id, channel, provider_thread_id, subject) VALUES ($1, $2, $3, 'whatsapp', $4, 'WhatsApp conversation')`, [conversationId, input.workspaceId, partyId, input.providerThreadId]);
        await client.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'party', $3) ON CONFLICT DO NOTHING`, [input.workspaceId, conversationId, partyId]);
      }
      const messageId = randomUUID();
      const echoed = await client.query(
        `INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, provider_message_id, body_text, metadata, sent_at)
         VALUES ($1, $2, $3, 'outbound', 'sent', 'provider', 'provider', $4, $5, $6, now()) ON CONFLICT (workspace_id, provider_message_id) DO NOTHING`,
        [messageId, input.workspaceId, conversationId, input.providerMessageId, input.bodyText ?? null, { ...input.metadata, sentFromPhone: true }]);
      if (echoed.rowCount) await this.queueProviderMedia(client, input.workspaceId, conversationId, messageId, "outbound", input.metadata);
      await client.query(`UPDATE crm_conversations SET last_message_at = now(), waiting_since = NULL, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, conversationId]);
      await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "integration", action: "crm.message.sent_from_phone.v1", entityType: "crm_message", entityId: messageId, after: { conversationId, partyId } });
      return { conversationId, messageId, duplicate: false };
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

  /** A reply written inside a transaction the caller holds (a scheduled message at its time), through the same rules as a typed one. */
  insertMessageWithClient(client: PoolClient, workspaceId: string, conversationId: string, input: CreateMessageDto, actorUserId: string, source: "user") {
    return this.insertMessage(client, workspaceId, conversationId, input, actorUserId, source);
  }

  /**
   * An approved template of the chat's channel with its values (given, else filled from the chat's records) and the
   * exact text the client reads. A missing value or a template that isn't approved blocks the send.
   */
  async resolveTemplate(client: PoolClient, workspaceId: string, conversation: Record<string, unknown>, templateId: string, given: string[] | undefined, actorUserId: string | null) {
    const found = await client.query<Record<string, unknown>>(`SELECT id, code, body_template, subject_template, status FROM notification_templates WHERE id = $1 AND workspace_id = $2 AND channel = $3 ORDER BY version_number DESC LIMIT 1`, [templateId, workspaceId, conversation.channel]);
    if (!found.rowCount || found.rows[0].status !== "approved") throw new UnprocessableEntityException("Template is not approved for this channel");
    const template = found.rows[0];
    const positions = templatePlaceholders(String(template.body_template));
    let parameters: string[] = [];
    if (positions.length) {
      parameters = given?.map(normalizeTemplateParameter) ?? await this.fillTemplate(client, workspaceId, conversation, String(template.code), positions, actorUserId);
      const problem = templateParametersProblem(positions, parameters);
      if (problem) throw new UnprocessableEntityException(problem);
    } else if (given?.length) throw new UnprocessableEntityException("This template has no variables");
    return { template, parameters, text: renderTemplate(String(template.body_template), parameters) };
  }

  /** The chat's reply signature, as a typed reply gets it: the writer's first name when the workspace signs replies. */
  async signed(client: PoolClient, workspaceId: string, text: string, actorUserId: string) {
    const signature = await client.query<{ enabled: boolean | null; name: string | null }>(
      `SELECT (SELECT signature_enabled FROM crm_inbox_settings WHERE workspace_id = $1) AS enabled, (SELECT display_name FROM users WHERE id = $2) AS name`,
      [workspaceId, actorUserId]);
    return withSignature(text, signature.rows[0]?.name, signature.rows[0]?.enabled === true);
  }

  private async insertMessage(client: PoolClient, workspaceId: string, conversationId: string, input: CreateMessageDto, actorUserId: string | null, source: "user" | "integration") {
    if (!input.bodyText?.trim() && !input.bodyHtml?.trim() && !input.templateId && !input.attachmentId) throw new UnprocessableEntityException("Message content or template is required");
    const conversation = await this.requireConversation(client, workspaceId, conversationId, true);
    const requestHash = input.clientMessageId ? stableHash({ direction: input.direction, bodyText: input.bodyText?.trim() ?? null, bodyHtml: input.bodyHtml?.trim() ?? null, templateId: input.templateId ?? null, purpose: input.purpose ?? "service", ...(input.templateParameters ? { templateParameters: input.templateParameters } : {}), ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}) }) : null;
    if (input.clientMessageId) {
      const prior = await client.query(`SELECT id, status, metadata, sender_id FROM crm_messages WHERE workspace_id=$1 AND conversation_id=$2 AND metadata->>'clientMessageId'=$3 LIMIT 1`, [workspaceId, conversationId, input.clientMessageId]);
      if (prior.rowCount) {
        if (prior.rows[0].metadata.requestHash !== requestHash || prior.rows[0].sender_id !== actorUserId) throw new ConflictException("This message retry does not match the original message");
        return { id: prior.rows[0].id, status: prior.rows[0].status, conversationId, idempotentReplay: true };
      }
    }
    // A snoozed chat can still be answered; a resolved one is reopened first.
    if (input.direction === "outbound" && conversation.status === "closed") throw new ConflictException("Reopen this conversation before replying");
    let bodyText = input.bodyText?.trim() || null;
    let bodyHtml = input.bodyHtml?.trim() || null;
    let template: Record<string, unknown> | null = null;
    let templateParameters: string[] = [];
    // A file goes with one of our messages (a reply or a note), never a template, and only once.
    let attachment: Record<string, unknown> | null = null;
    if (input.attachmentId) {
      if (input.direction === "inbound") throw new UnprocessableEntityException("Client files arrive through the provider");
      if (input.templateId) throw new UnprocessableEntityException("A template is sent on its own, without a file");
      attachment = await this.claimUpload(client, workspaceId, conversationId, input.attachmentId, actorUserId);
    }
    if (input.direction === "outbound" && conversation.channel !== "internal") {
      if (!conversation.party_id) throw new UnprocessableEntityException("Outbound customer messages require a party");
      await this.assertConsent(client, workspaceId, String(conversation.party_id), String(conversation.channel), input.purpose ?? "service");
      if (input.templateId) {
        const resolved = await this.resolveTemplate(client, workspaceId, conversation, input.templateId, input.templateParameters, actorUserId);
        template = resolved.template;
        templateParameters = resolved.parameters;
        // What the client receives is the template with its values, never free text beside it.
        bodyText = resolved.text;
        bodyHtml = null;
      }
      if (conversation.channel === "whatsapp") {
        const health = await client.query<{ health: Record<string, unknown> | null }>(CHAT_NUMBER_SQL, [workspaceId, conversation.connection_id ?? null]);
        if (health.rows[0]?.health?.state === "blocked") throw new UnprocessableEntityException("Meta has stopped sending from this WhatsApp number. Check it in Connections.");
      }
      if (conversation.channel === "whatsapp" && !input.templateId) {
        const lastInbound = conversation.last_inbound_at ? new Date(String(conversation.last_inbound_at)) : null;
        if (!lastInbound || Date.now() - lastInbound.getTime() > 24 * 60 * 60 * 1000) throw new UnprocessableEntityException("WhatsApp requires an approved template outside the 24-hour customer-service window");
      }
      if (!input.templateId && source === "user" && actorUserId && bodyText) bodyText = await this.signed(client, workspaceId, bodyText, actorUserId);
      if (conversation.channel === "whatsapp" && attachment) {
        // WhatsApp's own limits: its types and sizes per kind, audio without a caption, captions up to 1,024 characters.
        const kind = attachment.kind as SendableKind;
        const rule = WHATSAPP_MEDIA[kind];
        const problem = rule ? sendableProblem(kind, Number(attachment.byte_size)) : "WhatsApp can't send this file";
        if (problem || !rule.types.includes(String(attachment.content_type))) throw new UnprocessableEntityException(problem ?? "WhatsApp can't send this type of file");
        if (bodyText && !rule.caption) throw new UnprocessableEntityException("WhatsApp sends audio without a caption. Send the text as its own message.");
        if (bodyText && bodyText.length > 1024) throw new UnprocessableEntityException("A caption can be up to 1,024 characters");
      }
    }
    const messageId = randomUUID();
    // A demonstration chat's replies show as sent and never reach a provider.
    const queued = input.direction === "outbound" && conversation.channel !== "internal" && !isDemoThread(conversation);
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
            ...(attachment ? { messageType: attachment.kind, attachmentId: attachment.id, fileName: attachment.file_name, mimeType: attachment.content_type } : {}),
          },
        ],
      );
    if (!inserted.rowCount) {
      const prior = await client.query(`SELECT id, status, conversation_id AS "conversationId", direction FROM crm_messages WHERE workspace_id = $1 AND provider_message_id = $2`, [workspaceId, input.providerMessageId]);
      if (prior.rows[0]?.conversationId !== conversationId || prior.rows[0]?.direction !== input.direction) throw new ConflictException("Provider message already belongs to another conversation or direction");
      return { ...prior.rows[0], idempotentReplay: true };
    }
    if (attachment) await client.query(`UPDATE crm_message_attachments SET message_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, attachment.id, messageId]);
    // A client's file is fetched into our storage later; a failure there never loses the message.
    if (input.direction === "inbound") await this.queueProviderMedia(client, workspaceId, conversationId, messageId, "inbound", input.metadata);
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
      // A follow-up scheduled in this chat doesn't land on top of the client's reply: it's cancelled and its author told (X-1).
      for (const cancelled of await cancelScheduledOnReply(client, workspaceId, conversationId))
        await this.events.record(client, { workspaceId, actorUserId: null, source: "automation", action: "crm.message.schedule_cancelled.v1", entityType: "crm_conversation", entityId: conversationId,
          after: { scheduledMessageId: cancelled.id, reason: "client_replied", messageId } });
    }
    const response = { id: messageId, conversationId, direction: input.direction, status: queued ? "queued" : input.direction === "inbound" ? "delivered" : "sent", bodyText, bodyHtml,
      ...(attachment ? { attachmentId: attachment.id } : {}) };
    if (queued) {
      const notificationId = randomUUID();
      // A file's notification carries its caption (or its name); the worker sends the file itself.
      await client.query(
        `INSERT INTO notifications
          (id, workspace_id, template_id, recipient_type, recipient_id, channel,
           status, subject, body, idempotency_key, correlation_id, template_parameters)
         VALUES ($1, $2, $3, 'party', $4, $5, 'pending', $6, $7, $8, $9, $10)`,
        [notificationId, workspaceId, template?.id ?? null, conversation.party_id, conversation.channel, template?.subject_template ?? conversation.subject, bodyText ?? bodyHtml ?? String(attachment?.file_name ?? "File"), `message:${messageId}`, randomUUID(), templateParameters],
      );
      await this.events.record(client, { workspaceId, actorUserId, source, action: "notification.delivery_requested.v1", entityType: "notification", entityId: notificationId, after: { messageId, channel: conversation.channel, partyId: conversation.party_id } });
    }
    // A client's message is an event of the job the chat is filed into (so the job's activity shows it), else of the client.
    const jobEntity: Record<JobKind, string> = { enquiry: "crm_lead", opportunity: "crm_opportunity", project: "delivery_project" };
    const jobKind = conversation.job_kind as JobKind | null;
    const aggregateType = input.direction !== "inbound" ? "crm_message"
      : jobKind && conversation.job_id ? jobEntity[jobKind]
      : conversation.lead_id ? "crm_lead" : conversation.party_id ? "crm_party" : "crm_message";
    const aggregateId = input.direction === "inbound"
      ? String((jobKind && conversation.job_id) || conversation.lead_id || conversation.party_id || messageId)
      : messageId;
    await this.events.record(client, { workspaceId, actorUserId, source, action: input.direction === "inbound" ? "crm.customer.replied.v1" : "crm.message.created.v1", entityType: aggregateType, entityId: aggregateId,
      after: { ...response, partyId: conversation.party_id, leadId: conversation.lead_id, ...(jobKind && conversation.job_id ? { job: { kind: jobKind, id: conversation.job_id } } : {}) } });
    // A blocked number's messages are kept, but raise no notice and no assignment.
    const blocked = input.direction === "inbound" && conversation.party_id
      ? (await client.query(`SELECT 1 FROM crm_parties WHERE workspace_id = $1 AND id = $2 AND blocked_at IS NOT NULL`, [workspaceId, conversation.party_id])).rowCount : 0;
    if (input.direction === "inbound" && !blocked) await this.routeInbound(client, workspaceId, conversation, touched.rows[0], messageId, bodyText);
    if (input.direction === "inbound" && !blocked && conversation.channel === "whatsapp") await this.autoReply(client, workspaceId, touched.rows[0] ?? conversation, messageId, input.metadata);
    if (input.direction === "internal" && input.mentions?.length) await this.noticeMentions(client, workspaceId, conversation, [...new Set(input.mentions)], messageId, bodyText, actorUserId);
    return response;
  }

  /**
   * The greeting or away message for a client's WhatsApp message, when one is due. It runs in a savepoint, so a
   * reply that can't be written never loses the client's message.
   */
  private async autoReply(client: PoolClient, workspaceId: string, conversation: Record<string, unknown>, inboundMessageId: string, metadata?: Record<string, unknown>) {
    await client.query("SAVEPOINT crm_auto_reply");
    try {
      await sendAutoReply(client, { workspaceId, conversation, inboundMessageId, metadata });
      await client.query("RELEASE SAVEPOINT crm_auto_reply");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_auto_reply");
      this.logger.warn(`Auto reply skipped for message ${inboundMessageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    // A chat filed into a job: the job's owner hears about the message too (once per chat while unread).
    const ownerUser = owner ? await userOfMembership(client, workspaceId, owner) : null;
    const jobOwner = await this.jobOwner(client, workspaceId, before);
    if (jobOwner && jobOwner.userId !== ownerUser?.userId) {
      await noticeChat(client, { workspaceId, conversationId, recipientUserId: jobOwner.userId, code: "crm.inbox_message", eventType: "crm.inbox.message", variables: { clientName, summary }, idempotencyKey: `crm:inbox:job:${messageId}:${jobOwner.userId}` });
    }
    if (owner) {
      if (ownerUser) await noticeChat(client, { workspaceId, conversationId, recipientUserId: ownerUser.userId, code: "crm.inbox_message", eventType: "crm.inbox.message", variables: { clientName, summary }, idempotencyKey: `crm:inbox:message:${messageId}:${ownerUser.userId}` });
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

  /** Each person @mentioned in a note (who can open the inbox, and is not the writer) is told in-app; the push follows it. */
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
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "crm.inbox_mention", eventType: "crm.inbox.mention", variables, deepLink, idempotencyKey: key });
    }
  }

  private async viewerMembership(client: PoolClient, workspaceId: string, userId: string) {
    const result = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId]);
    return result.rows[0]?.id ?? null;
  }

  private async hasAny(client: PoolClient, workspaceId: string, userId: string, permissions: readonly string[]) {
    for (const permission of permissions) if (await this.access.hasPermission(client, workspaceId, userId, permission)) return true;
    return false;
  }

  /** The person's inbox reach and membership, for every query that lists or opens chats (plan §5b). */
  private async viewer(client: PoolClient, workspaceId: string, userId: string): Promise<InboxViewer & { membershipId: string | null }> {
    const viewer = await loadInboxViewer((permission) => this.access.hasPermission(client, workspaceId, userId, permission));
    return { ...viewer, membershipId: await this.viewerMembership(client, workspaceId, userId) };
  }

  /** A chat the person may see; one outside their reach does not exist for them. */
  private async requireVisibleConversation(client: PoolClient, workspaceId: string, conversationId: string, userId: string, lock: boolean) {
    const conversation = await this.requireConversation(client, workspaceId, conversationId, lock);
    const viewer = await this.viewer(client, workspaceId, userId);
    if (!(await conversationVisible(client, workspaceId, conversationId, viewer, viewer.membershipId))) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  /** The owner of the job a chat is filed into (the enquiry's owner, the opportunity's owner, the project's manager). */
  private async jobOwner(client: PoolClient, workspaceId: string, conversation: Record<string, unknown>) {
    const kind = conversation.job_kind as JobKind | null;
    if (!kind || !conversation.job_id) return null;
    const job = await findJob(client, workspaceId, kind, String(conversation.job_id));
    return job?.ownerMembershipId ? userOfMembership(client, workspaceId, job.ownerMembershipId) : null;
  }

  private async assertConsent(client: PoolClient, workspaceId: string, partyId: string, channel: string, purpose: string) {
    if (channel === "portal") return;
    const result = await client.query<{ status: string; expires_at: Date | null }>(`SELECT status, expires_at FROM crm_consents WHERE workspace_id = $1 AND party_id = $2 AND channel = $3 AND purpose = $4 ORDER BY captured_at DESC LIMIT 1`, [workspaceId, partyId, channel, purpose]);
    const consent = result.rows[0];
    if (!consent || consent.status !== "granted" || (consent.expires_at && consent.expires_at <= new Date())) throw new UnprocessableEntityException(`Active ${channel} consent is required for ${purpose} communication`);
  }

  /** A file this person uploaded to this chat and hasn't sent yet. */
  private async claimUpload(client: PoolClient, workspaceId: string, conversationId: string, attachmentId: string, actorUserId: string | null) {
    const found = await client.query<Record<string, unknown>>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, attachmentId]);
    const row = found.rows[0];
    if (!row || row.conversation_id !== conversationId || row.direction !== "outbound" || row.status !== "stored" || (actorUserId && row.uploaded_by && row.uploaded_by !== actorUserId)) {
      throw new UnprocessableEntityException("Attach the file again: it isn't ready for this chat");
    }
    if (row.message_id) throw new ConflictException("This file was already sent");
    return row;
  }

  /**
   * A provider's file on a message (a client's photo, or one the owner sent from the phone) waits to be fetched into
   * our storage. In a savepoint: a file that can't be queued never loses its message.
   */
  private async queueProviderMedia(client: PoolClient, workspaceId: string, conversationId: string, messageId: string, direction: "inbound" | "outbound", metadata?: Record<string, unknown>) {
    const kind = kindOf(metadata?.messageType);
    const mediaId = typeof metadata?.mediaId === "string" ? metadata.mediaId.trim() : "";
    if (!kind || !/^[\w.-]{1,120}$/.test(mediaId)) return;
    await client.query("SAVEPOINT crm_media_fetch");
    try {
      const connectionId = await this.writtenNumber(client, workspaceId, metadata, false);
      const mimeType = typeof metadata?.mimeType === "string" ? metadata.mimeType.trim().slice(0, 160) || null : null;
      const fileName = typeof metadata?.fileName === "string" && metadata.fileName.trim() ? safeFileName(metadata.fileName) : null;
      await client.query(
        `INSERT INTO crm_message_attachments (workspace_id, conversation_id, message_id, direction, kind, content_type, file_name, provider_media_id, connection_id, status, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', now()) ON CONFLICT DO NOTHING`,
        [workspaceId, conversationId, messageId, direction, kind, mimeType, fileName, mediaId, connectionId]);
      await client.query("RELEASE SAVEPOINT crm_media_fetch");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_media_fetch");
      this.logger.warn(`File on message ${messageId} was not queued: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The workspace's WhatsApp number a provider message names (connected, unless any known number will do). */
  private async writtenNumber(client: PoolClient, workspaceId: string, metadata: Record<string, unknown> | undefined, connectedOnly = true) {
    const id = metadata?.connectionId;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
    const found = await client.query<{ id: string }>(`SELECT id FROM integration_connections WHERE workspace_id = $1 AND id = $2 AND provider = 'whatsapp'${connectedOnly ? " AND status = 'connected'" : ""}`, [workspaceId, id]);
    return found.rows[0]?.id ?? null;
  }

  private async requireConversation(client: PoolClient, workspaceId: string, conversationId: string, lock: boolean) {
    const result = await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE id = $1 AND workspace_id = $2${lock ? " FOR UPDATE" : ""}`, [conversationId, workspaceId]);
    if (!result.rowCount) throw new NotFoundException("Conversation not found");
    return result.rows[0];
  }

  private async requireParty(client: PoolClient, workspaceId: string, partyId: string) { const result = await client.query(`SELECT 1 FROM crm_parties WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [partyId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Party does not exist or is inactive"); }
  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) { const result = await client.query(`SELECT 1 FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [membershipId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Member does not exist or is inactive"); }
}

/** A chat started by Inbox › Simulate a client message: shown and answered like any other, never sent to Meta. */
export function isDemoThread(conversation: Record<string, unknown> | { provider_thread_id?: unknown; providerThreadId?: unknown }) {
  const thread = (conversation as Record<string, unknown>).provider_thread_id ?? (conversation as Record<string, unknown>).providerThreadId;
  return typeof thread === "string" && thread.startsWith("demo:");
}
