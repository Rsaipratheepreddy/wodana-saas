import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
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

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

@Injectable()
export class CrmConversationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly notifications: CrmNotificationsService,
    private readonly receipts: CrmMessageReceiptService = new CrmMessageReceiptService(),
  ) {}

  list(actor: RequestActor, workspaceId: string, query: ListConversationsQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["conversation.workspace_id = $1"];
      for (const [column, value] of [["party_id", query.partyId], ["lead_id", query.leadId], ["owner_membership_id", query.ownerMembershipId], ["channel", query.channel]] as const) {
        if (value) { values.push(value); clauses.push(`conversation.${column} = $${values.length}`); }
      }
      if (query.status) { values.push(query.status); clauses.push(`conversation.status = $${values.length}`); }
      if (query.unread === "true") clauses.push("conversation.unread_count > 0");
      if (query.search?.trim()) { values.push(`%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`); clauses.push(`(conversation.subject ILIKE $${values.length} OR party.display_name ILIKE $${values.length} OR EXISTS (SELECT 1 FROM crm_contact_points contact WHERE contact.workspace_id=conversation.workspace_id AND contact.party_id=conversation.party_id AND contact.status='active' AND (contact.raw_value ILIKE $${values.length} OR contact.normalized_value ILIKE $${values.length})))`); }
      if (cursor) { values.push(cursor.value, cursor.id); clauses.push(`(COALESCE(conversation.last_message_at, '-infinity'::timestamptz), conversation.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`); }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT conversation.id, conversation.party_id AS "partyId", party.display_name AS "partyName",
                conversation.lead_id AS "leadId", conversation.channel, conversation.subject,
                conversation.status, conversation.owner_membership_id AS "ownerMembershipId",
                conversation.last_message_at AS "lastMessageAt", conversation.last_inbound_at AS "lastInboundAt",
                conversation.unread_count AS "unreadCount", conversation.version,
                message.id AS "lastMessageId", message.direction AS "lastMessageDirection",
                message.body_text AS "lastMessageText", message.status AS "lastMessageStatus"
         FROM crm_conversations conversation
         LEFT JOIN crm_parties party ON party.id = conversation.party_id AND party.workspace_id = conversation.workspace_id
         LEFT JOIN LATERAL (
           SELECT id, direction, body_text, status FROM crm_messages
           WHERE workspace_id = conversation.workspace_id AND conversation_id = conversation.id AND (conversation.channel <> 'whatsapp' OR direction <> 'internal')
           ORDER BY created_at DESC LIMIT 1
         ) message ON true
         WHERE ${clauses.join(" AND ")}
         ORDER BY conversation.last_message_at DESC NULLS LAST, conversation.id DESC
         LIMIT $${values.length}`, values,
      );
      const hasMore = result.rows.length > query.limit;
      const data = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = data.at(-1) as { id: string; lastMessageAt: Date | null } | undefined;
      return { data, nextCursor: hasMore && last ? encodeCursor({ value: last.lastMessageAt ? new Date(last.lastMessageAt).toISOString() : "-infinity", id: last.id }) : null };
    });
  }

  get(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const conversation = await this.requireConversation(client, workspaceId, conversationId, false);
      const messages = await client.query(
        `SELECT id, direction, status, authorship, sender_type AS "senderType", sender_id AS "senderId",
                provider_message_id AS "providerMessageId", body_text AS "bodyText",
                body_html AS "bodyHtml", sent_at AS "sentAt", delivered_at AS "deliveredAt",
                read_at AS "readAt", failure_code AS "failureCode", metadata, version,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM crm_messages WHERE workspace_id = $1 AND conversation_id = $2 AND ($3 <> 'whatsapp' OR direction <> 'internal')
         ORDER BY created_at DESC, id DESC LIMIT 101`, [workspaceId, conversationId, conversation.channel],
      );
      const party = conversation.party_id ? await client.query(`SELECT display_name FROM crm_parties WHERE workspace_id=$1 AND id=$2`, [workspaceId, conversation.party_id]) : null;
      const manager = conversation.owner_membership_id ? await client.query(`SELECT u.display_name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.id=$2`, [workspaceId, conversation.owner_membership_id]) : null;
      const canSend = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.send");
      const connection = await client.query(`SELECT EXISTS (SELECT 1 FROM integration_connections WHERE workspace_id=$1 AND provider='whatsapp' AND status='connected') AS connected`, [workspaceId]);
      const page = messages.rows.slice(0, 100);
      const oldest = page.at(-1);
      return { ...this.mapConversation(conversation), canSend, whatsappConnected: connection.rows[0].connected, partyName: party?.rows[0]?.display_name ?? null, ownerName: manager?.rows[0]?.display_name ?? null, messages: page.reverse(), nextMessagesCursor: messages.rows.length > 100 && oldest ? encodeCursor({ value: new Date(oldest.createdAt).toISOString(), id: oldest.id }) : null };
    });
  }

  messages(actor: RequestActor, workspaceId: string, conversationId: string, query: { cursor?: string; limit: number }) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const conversation = await this.requireConversation(client, workspaceId, conversationId, false);
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.value)))) throw new BadRequestException("Invalid message cursor");
      const result = await client.query(`SELECT id,direction,status,authorship,sender_type AS "senderType",sender_id AS "senderId",body_text AS "bodyText",metadata,created_at AS "createdAt",failure_code AS "failureCode" FROM crm_messages WHERE workspace_id=$1 AND conversation_id=$2 AND ($6 <> 'whatsapp' OR direction <> 'internal') AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`, [workspaceId, conversationId, cursor?.value ?? null, cursor?.id ?? null, query.limit + 1, conversation.channel]);
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
        if (existing.rowCount) return this.mapConversation(existing.rows[0]);
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
      const conversation = this.mapConversation(result.rows[0] as Record<string, unknown>);
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
      if (Number(before.version) !== input.version) throw new ConflictException("Conversation changed; refresh before trying again");
      if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
      const updated = await client.query(`UPDATE crm_conversations SET subject=COALESCE($1,subject), status=COALESCE($2,status), owner_membership_id=CASE WHEN $3::boolean THEN $4::uuid ELSE owner_membership_id END, version=version+1 WHERE workspace_id=$5 AND id=$6 AND version=$7 RETURNING *`, [input.subject?.trim() ?? null, input.status ?? null, input.ownerMembershipId !== undefined, input.ownerMembershipId ?? null, workspaceId, conversationId, input.version]);
      const after = this.mapConversation(updated.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.conversation.updated.v1", entityType: "crm_conversation", entityId: conversationId, before: this.mapConversation(before), after });
      return after;
    });
  }

  addInboundInternal(workspaceId: string, conversationId: string, input: CreateMessageDto) {
    if (input.direction !== "inbound") throw new UnprocessableEntityException("Provider ingestion only accepts inbound messages");
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
      this.insertMessage(client, workspaceId, conversationId, input, null, "integration"));
  }

  markRead(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      await this.requireConversation(client, workspaceId, conversationId, true);
      await client.query(`UPDATE crm_conversations SET unread_count = 0, version = version + 1 WHERE id = $1 AND workspace_id = $2`, [conversationId, workspaceId]);
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
    const requestHash = input.clientMessageId ? stableHash({ direction: input.direction, bodyText: input.bodyText?.trim() ?? null, bodyHtml: input.bodyHtml?.trim() ?? null, templateId: input.templateId ?? null, purpose: input.purpose ?? "service" }) : null;
    if (input.clientMessageId) {
      const prior = await client.query(`SELECT id, status, metadata, sender_id FROM crm_messages WHERE workspace_id=$1 AND conversation_id=$2 AND metadata->>'clientMessageId'=$3 LIMIT 1`, [workspaceId, conversationId, input.clientMessageId]);
      if (prior.rowCount) {
        if (prior.rows[0].metadata.requestHash !== requestHash || prior.rows[0].sender_id !== actorUserId) throw new ConflictException("This message retry does not match the original message");
        return { id: prior.rows[0].id, status: prior.rows[0].status, conversationId, idempotentReplay: true };
      }
    }
    if (input.direction === "outbound" && conversation.status !== "open") throw new ConflictException("Reopen this conversation before replying");
    let bodyText = input.bodyText?.trim() ?? null;
    let bodyHtml = input.bodyHtml?.trim() ?? null;
    let template: Record<string, unknown> | null = null;
    if (input.direction === "outbound" && conversation.channel !== "internal") {
      if (!conversation.party_id) throw new UnprocessableEntityException("Outbound customer messages require a party");
      await this.assertConsent(client, workspaceId, String(conversation.party_id), String(conversation.channel), input.purpose ?? "service");
      if (input.templateId) {
        const found = await client.query<Record<string, unknown>>(`SELECT id, body_template, subject_template, status FROM notification_templates WHERE id = $1 AND workspace_id = $2 AND channel = $3 ORDER BY version_number DESC LIMIT 1`, [input.templateId, workspaceId, conversation.channel]);
        if (!found.rowCount || found.rows[0].status !== "approved") throw new UnprocessableEntityException("Template is not approved for this channel");
        template = found.rows[0];
        bodyText ??= String(template.body_template);
      }
      if (conversation.channel === "whatsapp" && !input.templateId) {
        const lastInbound = conversation.last_inbound_at ? new Date(String(conversation.last_inbound_at)) : null;
        if (!lastInbound || Date.now() - lastInbound.getTime() > 24 * 60 * 60 * 1000) throw new UnprocessableEntityException("WhatsApp requires an approved template outside the 24-hour customer-service window");
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
          { ...input.metadata, ...(input.clientMessageId ? { clientMessageId: input.clientMessageId, requestHash } : {}) },
        ],
      );
    if (!inserted.rowCount) {
      const prior = await client.query(`SELECT id, status, conversation_id AS "conversationId", direction FROM crm_messages WHERE workspace_id = $1 AND provider_message_id = $2`, [workspaceId, input.providerMessageId]);
      if (prior.rows[0]?.conversationId !== conversationId || prior.rows[0]?.direction !== input.direction) throw new ConflictException("Provider message already belongs to another conversation or direction");
      return { ...prior.rows[0], idempotentReplay: true };
    }
    await client.query(
      `UPDATE crm_conversations SET last_message_at = now(),
         status = CASE WHEN $1 = 'inbound' AND status = 'closed' THEN 'open' ELSE status END,
         last_inbound_at = CASE WHEN $1 = 'inbound' THEN now() ELSE last_inbound_at END,
         unread_count = CASE WHEN $1 = 'inbound' THEN unread_count + 1 ELSE unread_count END,
         version = version + 1 WHERE id = $2 AND workspace_id = $3`,
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
           status, subject, body, idempotency_key, correlation_id)
         VALUES ($1, $2, $3, 'party', $4, $5, 'pending', $6, $7, $8, $9)`,
        [notificationId, workspaceId, template?.id ?? null, conversation.party_id, conversation.channel, template?.subject_template ?? conversation.subject, bodyText ?? bodyHtml, `message:${messageId}`, randomUUID()],
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
    return response;
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

  private mapConversation(row: Record<string, unknown>) { return { id: row.id, partyId: row.party_id, leadId: row.lead_id, channel: row.channel, subject: row.subject, status: row.status, ownerMembershipId: row.owner_membership_id, lastMessageAt: row.last_message_at, lastInboundAt: row.last_inbound_at, unreadCount: row.unread_count, version: Number(row.version) }; }
  private async requireParty(client: PoolClient, workspaceId: string, partyId: string) { const result = await client.query(`SELECT 1 FROM crm_parties WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [partyId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Party does not exist or is inactive"); }
  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) { const result = await client.query(`SELECT 1 FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [membershipId, workspaceId]); if (!result.rowCount) throw new UnprocessableEntityException("Member does not exist or is inactive"); }
}
