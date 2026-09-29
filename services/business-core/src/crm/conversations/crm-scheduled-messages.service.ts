import { ConflictException, HttpException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { notifyUserInApp } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { stableHash } from "../shared/crm-types";
import { CrmConversationsService } from "./crm-conversations.service";
import type { CreateScheduledMessageDto, UpdateScheduledMessageDto } from "./dto/conversations.dto";
import { inboxLink } from "./inbox/inbox-notices";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const DAY = 86_400_000;
type Row = Record<string, unknown>;
export type ScheduleInput = { sendAt: string; bodyText?: string | null; templateId?: string | null; templateParameters?: string[] | null };

export type ScheduledMessage = {
  id: string; conversationId: string; status: string; sendAt: string; bodyText: string | null; templateId: string | null; templateCode: string | null;
  templateParameters: string[]; renderedText: string; failureReason: string | null; createdBy: string; version: number;
};
export const presentScheduled = (row: Row): ScheduledMessage => ({
  id: String(row.id), conversationId: String(row.conversation_id), status: String(row.status), sendAt: new Date(String(row.send_at)).toISOString(),
  bodyText: (row.body_text as string | null) ?? null, templateId: (row.template_id as string | null) ?? null, templateCode: (row.template_code as string | null) ?? null,
  templateParameters: (row.template_parameters as string[] | null) ?? [], renderedText: String(row.rendered_text), failureReason: (row.failure_reason as string | null) ?? null,
  createdBy: String(row.created_by), version: Number(row.version),
});

/** Whether free text can still go at `sendAt`: WhatsApp takes it only within 24 hours of the client's last message. */
export function windowOpenAt(channel: unknown, lastInboundAt: unknown, sendAt: Date) {
  if (channel !== "whatsapp") return true;
  const last = lastInboundAt ? new Date(String(lastInboundAt)).getTime() : Number.NaN;
  return Number.isFinite(last) && last + DAY > sendAt.getTime();
}

/**
 * "Send later" in a chat: a reply written now that goes at a chosen time, through the same path as a typed reply
 * (consent, the number's health, the template's approval, the signature and the delivery allowlist all apply at
 * send time). A template may go at any time; free text only while WhatsApp's 24-hour window will still be open.
 * It shows in the thread as "Scheduled for …" and can be edited or cancelled until it goes. If it can't go at its
 * time, the person who scheduled it is told.
 */
@Injectable()
export class CrmScheduledMessagesService {
  private readonly logger = new Logger(CrmScheduledMessagesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly conversations: CrmConversationsService,
  ) {}

  /** Exactly what would be scheduled (the words the client will read and when), checked; nothing is written. */
  preview(actor: RequestActor, workspaceId: string, conversationId: string, input: ScheduleInput) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, user) => {
      const { conversation, ...prepared } = await this.prepare(client, workspaceId, conversationId, input, user.userId);
      return { ...prepared, channel: String(conversation.channel) };
    });
  }

  create(actor: RequestActor, workspaceId: string, conversationId: string, input: CreateScheduledMessageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, user) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`scheduled-message:${workspaceId}:${input.clientRequestId}`]);
      const requestHash = stableHash({ conversationId, sendAt: new Date(input.sendAt).toISOString(), bodyText: input.bodyText?.trim() ?? null, templateId: input.templateId ?? null, templateParameters: input.templateParameters ?? null });
      const prior = (await client.query<Row>(`SELECT * FROM crm_scheduled_messages WHERE workspace_id = $1 AND client_request_id = $2`, [workspaceId, input.clientRequestId])).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash || prior.created_by !== user.userId) throw new ConflictException("This request was already used for a different message");
        return { ...presentScheduled(prior), idempotentReplay: true };
      }
      const prepared = await this.prepare(client, workspaceId, conversationId, input, user.userId);
      const inserted = await client.query<Row>(
        `INSERT INTO crm_scheduled_messages (workspace_id, conversation_id, body_text, template_id, template_code, template_parameters, rendered_text, send_at,
           client_request_id, request_hash, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [workspaceId, conversationId, prepared.bodyText, prepared.templateId, prepared.templateCode, prepared.templateParameters, prepared.renderedText, prepared.sendAt,
          input.clientRequestId, requestHash, user.userId]);
      const scheduled = presentScheduled(inserted.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.message.scheduled.v1", entityType: "crm_conversation", entityId: conversationId, after: scheduled });
      return scheduled;
    });
  }

  update(actor: RequestActor, workspaceId: string, conversationId: string, scheduledId: string, input: UpdateScheduledMessageDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, user) => {
      const before = await this.requireScheduled(client, workspaceId, conversationId, scheduledId);
      if (before.status !== "scheduled") throw new ConflictException("This message was already sent or cancelled");
      if (Number(before.version) !== input.version) throw new ConflictException("This scheduled message changed; reload and try again");
      if (before.template_id && input.bodyText !== undefined) throw new UnprocessableEntityException("A template's words can't be changed; change its values instead");
      if (!before.template_id && input.templateParameters !== undefined) throw new UnprocessableEntityException("This message has no template values");
      // The message still goes as its author's: the signature and the values filled from the chat are theirs.
      const prepared = await this.prepare(client, workspaceId, conversationId, {
        sendAt: input.sendAt ?? new Date(String(before.send_at)).toISOString(),
        bodyText: before.template_id ? null : input.bodyText ?? String(before.body_text),
        templateId: (before.template_id as string | null) ?? null,
        templateParameters: before.template_id ? input.templateParameters ?? (before.template_parameters as string[]) : null,
      }, String(before.created_by));
      const updated = await client.query<Row>(
        `UPDATE crm_scheduled_messages SET body_text = $4, template_parameters = $5, rendered_text = $6, send_at = $7, updated_by = $8,
                version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status = 'scheduled' RETURNING *`,
        [workspaceId, scheduledId, input.version, prepared.bodyText, prepared.templateParameters, prepared.renderedText, prepared.sendAt, user.userId]);
      if (!updated.rowCount) throw new ConflictException("This scheduled message changed; reload and try again");
      const after = presentScheduled(updated.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.message.schedule_changed.v1", entityType: "crm_conversation", entityId: conversationId, before: presentScheduled(before), after });
      return after;
    });
  }

  /** Cancels a message before it goes, or clears one that could not go. Cancelling twice is a no-op. */
  cancel(actor: RequestActor, workspaceId: string, conversationId: string, scheduledId: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, user) => {
      const before = await this.requireScheduled(client, workspaceId, conversationId, scheduledId);
      if (before.status === "cancelled") return presentScheduled(before);
      if (before.status === "sent") throw new ConflictException("This message was already sent");
      if (Number(before.version) !== input.version) throw new ConflictException("This scheduled message changed; reload and try again");
      const updated = await client.query<Row>(
        `UPDATE crm_scheduled_messages SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, scheduledId, user.userId]);
      const after = presentScheduled(updated.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.message.schedule_cancelled.v1", entityType: "crm_conversation", entityId: conversationId, before: presentScheduled(before), after });
      return after;
    });
  }

  /** The worker's pass: every message whose time has come, each in its own tenant transaction. */
  async processDueInternal(workspaceId: string, limit = 50) {
    const due = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => (await client.query<{ id: string }>(
      `SELECT id FROM crm_scheduled_messages WHERE workspace_id = $1 AND status = 'scheduled' AND send_at <= now() ORDER BY send_at, id LIMIT $2`,
      [workspaceId, Math.min(Math.max(limit, 1), 100)])).rows.map((row) => row.id));
    const items: Array<{ id: string; status: string; messageId?: string; reason?: string }> = [];
    for (const id of due) {
      const result = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => this.sendOne(client, workspaceId, id));
      if (result) items.push(result);
    }
    return { items, processed: items.length };
  }

  private async sendOne(client: PoolClient, workspaceId: string, id: string) {
    const row = (await client.query<Row>(
      `SELECT * FROM crm_scheduled_messages WHERE workspace_id = $1 AND id = $2 AND status = 'scheduled' AND send_at <= now() FOR UPDATE SKIP LOCKED`, [workspaceId, id])).rows[0];
    if (!row) return null;
    const author = String(row.created_by);
    const conversationId = String(row.conversation_id);
    let messageId: string | null = null;
    let reason: string | null = null;
    if (!await this.access.hasPermission(client, workspaceId, author, "crm.communications.send")) {
      reason = "The person who scheduled it can no longer send messages.";
    } else {
      await client.query("SAVEPOINT crm_scheduled_send");
      try {
        const message = await this.conversations.insertMessageWithClient(client, workspaceId, conversationId, {
          direction: "outbound", purpose: "service", clientMessageId: id,
          ...(row.template_id ? { templateId: String(row.template_id), templateParameters: row.template_parameters as string[] } : { bodyText: String(row.body_text) }),
          metadata: { scheduledMessageId: id },
        } as never, author, "user");
        await client.query("RELEASE SAVEPOINT crm_scheduled_send");
        messageId = String((message as { id: string }).id);
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT crm_scheduled_send");
        reason = error instanceof HttpException || error instanceof Error ? error.message.slice(0, 500) : "It could not be sent.";
        this.logger.warn(`Scheduled message ${id} was not sent: ${reason}`);
      }
    }
    if (messageId) {
      await client.query(`UPDATE crm_scheduled_messages SET status = 'sent', message_id = $3, sent_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, messageId]);
      await this.events.record(client, { workspaceId, actorUserId: author, source: "automation", action: "crm.message.schedule_sent.v1", entityType: "crm_conversation", entityId: conversationId, after: { scheduledMessageId: id, messageId } });
      return { id, status: "sent", messageId };
    }
    await client.query(`UPDATE crm_scheduled_messages SET status = 'failed', failure_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reason]);
    await this.events.record(client, { workspaceId, actorUserId: author, source: "automation", action: "crm.message.schedule_failed.v1", entityType: "crm_conversation", entityId: conversationId, after: { scheduledMessageId: id, reason } });
    const clientName = (await client.query<{ name: string | null }>(
      `SELECT party.display_name AS name FROM crm_conversations conversation LEFT JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
        WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId])).rows[0]?.name ?? "a client";
    await notifyUserInApp(client, { workspaceId, recipientUserId: author, code: "crm.inbox_scheduled_failed", eventType: "crm.inbox.scheduled_failed",
      variables: { clientName, reason: reason ?? "" }, deepLink: inboxLink(conversationId), idempotencyKey: `crm:inbox:scheduled-failed:${id}` });
    return { id, status: "failed", reason: reason ?? undefined };
  }

  /** The chat, the time and the exact words, checked the way the send will check them. */
  private async prepare(client: PoolClient, workspaceId: string, conversationId: string, input: ScheduleInput, authorId: string) {
    const conversation = (await client.query<Row>(
      `SELECT conversation.*, party.display_name AS party_name FROM crm_conversations conversation
         LEFT JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
        WHERE conversation.workspace_id = $1 AND conversation.id = $2`, [workspaceId, conversationId])).rows[0];
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (conversation.channel === "internal" || !conversation.party_id) throw new UnprocessableEntityException("Only replies to a client can be sent later");
    if (conversation.status === "closed") throw new ConflictException("Reopen this conversation before replying");
    const sendAt = new Date(input.sendAt);
    const now = Date.now();
    if (!Number.isFinite(sendAt.getTime()) || sendAt.getTime() < now + 60_000) throw new UnprocessableEntityException("Choose a time at least a minute from now");
    if (sendAt.getTime() > now + 30 * DAY) throw new UnprocessableEntityException("Choose a time within the next 30 days");
    const text = input.bodyText?.trim() || null;
    if (Boolean(text) === Boolean(input.templateId)) throw new UnprocessableEntityException("Write a message or choose a template");
    if (input.templateId) {
      const resolved = await this.conversations.resolveTemplate(client, workspaceId, conversation, input.templateId, input.templateParameters ?? undefined, authorId);
      return { sendAt: sendAt.toISOString(), bodyText: null, templateId: String(resolved.template.id), templateCode: String(resolved.template.code), templateParameters: resolved.parameters,
        renderedText: resolved.text, partyName: (conversation.party_name as string | null) ?? null, conversation };
    }
    if (!windowOpenAt(conversation.channel, conversation.last_inbound_at, sendAt)) {
      throw new UnprocessableEntityException("WhatsApp's 24-hour window will be closed by then. Choose an earlier time or a template.");
    }
    if (text!.length > 4096) throw new UnprocessableEntityException("A message can be up to 4,096 characters");
    return { sendAt: sendAt.toISOString(), bodyText: text, templateId: null, templateCode: null, templateParameters: [] as string[],
      renderedText: await this.conversations.signed(client, workspaceId, text!, authorId), partyName: (conversation.party_name as string | null) ?? null, conversation };
  }

  private async requireScheduled(client: PoolClient, workspaceId: string, conversationId: string, scheduledId: string) {
    const row = (await client.query<Row>(`SELECT * FROM crm_scheduled_messages WHERE workspace_id = $1 AND id = $2 AND conversation_id = $3 FOR UPDATE`, [workspaceId, scheduledId, conversationId])).rows[0];
    if (!row) throw new NotFoundException("Scheduled message not found");
    return row;
  }
}
