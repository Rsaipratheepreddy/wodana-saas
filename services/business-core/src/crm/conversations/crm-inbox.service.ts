import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { BlockConversationDto, BulkConversationsDto, CreateLabelDto, HideMessageDto, CreateQuickReplyDto, RemoveAutoRepliesDto, SetConversationLabelsDto, SetTemplateVariablesDto, UpdateAutoRepliesDto, UpdateInboxSettingsDto, UpdateLabelDto, UpdateQuickReplyDto } from "./dto/inbox.dto";
import { readAutoReplyScopes, workspaceHours } from "./inbox/auto-replies";
import { AUTO_REPLY_FIELDS, unknownAutoReplyFields, validTimeZone } from "./inbox/auto-reply-rules";
import { INBOX_MEMBERS_SQL } from "./inbox/inbox-assignment";
import { applyConversationChange, recordChatEvent, type ConversationChange } from "./inbox/inbox-commands";
import { inboxLink, unassignedAudience, userOfMembership } from "./inbox/inbox-notices";
import { notifyUserInApp } from "../../notifications/default-templates";
import { ENQUIRY_STAGES, placeholdersAreContiguous, stageFilterSql, TEMPLATE_VARIABLE_SOURCES, templatePlaceholders } from "./inbox/inbox-rules";
import { resolveTemplateSources } from "./inbox/template-variables";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Row = Record<string, unknown>;
const LABEL_COLUMNS = `id, name, color, status, version, created_at AS "createdAt", updated_at AS "updatedAt"`;
const REPLY_COLUMNS = `reply.id, reply.shortcut, reply.body, reply.status, reply.version, reply.owner_membership_id AS "ownerMembershipId",
  CASE WHEN reply.owner_membership_id IS NULL THEN 'workspace' ELSE 'personal' END AS scope, reply.updated_at AS "updatedAt"`;

/**
 * The team inbox around the chats: views and their counts, owners, labels, quick replies, the inbox
 * settings (auto-assign, queue, signature, the one number), the WhatsApp template variable mapping,
 * the client's records beside a chat, bulk actions, and waking snoozed chats.
 */
@Injectable()
export class CrmInboxService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Open chats per view (Team is null for someone in no queue) and the Snoozed and Resolved totals. */
  summary(actor: RequestActor, workspaceId: string, stage?: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const me = await this.membership(client, workspaceId, actorUser.userId);
      const values: unknown[] = [workspaceId, me];
      // The counts follow the stage filter, so each view says how many of its chats are at those stages.
      const stageSql = stage ? stageFilterSql(stage.split(",").slice(0, 30), (value) => { values.push(value); return `$${values.length}`; }) : null;
      const result = await client.query<Row>(
        `SELECT count(*) FILTER (WHERE status = 'open' AND owner_membership_id = $2)::int AS mine,
                count(*) FILTER (WHERE status = 'open' AND owner_membership_id IS NULL)::int AS unassigned,
                CASE WHEN EXISTS (SELECT 1 FROM crm_effective_queue_members WHERE workspace_id = $1 AND membership_id = $2)
                     THEN count(*) FILTER (WHERE status = 'open' AND owner_membership_id IN (
                       SELECT teammate.membership_id FROM crm_effective_queue_members teammate WHERE teammate.workspace_id = $1 AND teammate.queue_id IN (
                         SELECT mine.queue_id FROM crm_effective_queue_members mine WHERE mine.workspace_id = $1 AND mine.membership_id = $2)))::int END AS team,
                count(*) FILTER (WHERE status = 'open')::int AS "all",
                count(*) FILTER (WHERE status = 'snoozed')::int AS snoozed,
                count(*) FILTER (WHERE status = 'open' AND unread_count > 0 AND (owner_membership_id = $2 OR owner_membership_id IS NULL))::int AS "unreadForMe"
           FROM crm_conversations conversation WHERE workspace_id = $1${stageSql ? ` AND ${stageSql}` : ""}`,
        values,
      );
      // The connected WhatsApp numbers: with two or more, the inbox can show one number's chats.
      const numbers = await client.query<{ connectionId: string; number: string | null; accountName: string | null; isDefault: boolean }>(
        `SELECT id AS "connectionId", configuration->>'displayPhoneNumber' AS number, configuration->>'accountName' AS "accountName",
                COALESCE((configuration->>'isDefault')::boolean, false) AS "isDefault"
           FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
          ORDER BY COALESCE((configuration->>'isDefault')::boolean, false) DESC, created_at, id`, [workspaceId]);
      return { ...result.rows[0], membershipId: me, numbers: numbers.rows };
    });
  }

  /** What a chat can be filtered by: enquiry states, the sales pipeline's stages and the project stages in use. */
  stages(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const opportunity = await client.query<{ id: string; name: string; pipeline: string }>(
        `SELECT stage.id, stage.name, pipeline.name AS pipeline FROM crm_pipeline_stages stage
           JOIN crm_pipelines pipeline ON pipeline.workspace_id = stage.workspace_id AND pipeline.id = stage.pipeline_id
          WHERE stage.workspace_id = $1 AND stage.status = 'active' AND pipeline.status = 'active' ORDER BY pipeline.name, stage.position`, [workspaceId]);
      const project = await client.query<{ key: string; name: string }>(
        `SELECT DISTINCT ON (stage.key) stage.key, stage.name FROM project_stages stage
           JOIN delivery_projects project ON project.workspace_id = stage.workspace_id AND project.id = stage.project_id AND project.status = 'active'
          WHERE stage.workspace_id = $1 ORDER BY stage.key, stage.position`, [workspaceId]);
      return {
        enquiry: ENQUIRY_STAGES.map((status) => ({ id: `lead:${status}`, status })),
        opportunity: opportunity.rows.map((row) => ({ id: `opportunity:${row.id}`, name: row.name, pipeline: row.pipeline })),
        project: project.rows.map((row) => ({ id: `project:${row.key}`, name: row.name })),
      };
    });
  }

  /** Everyone a chat can be given to, with their open chats and whether they are away. */
  owners(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const result = await client.query<Row>(
        `SELECT inbox."membershipId" AS id, inbox."displayName",
                (SELECT count(*) FROM crm_conversations chat WHERE chat.workspace_id = $1 AND chat.owner_membership_id = inbox."membershipId" AND chat.status = 'open')::int AS "openChats",
                (EXISTS (SELECT 1 FROM crm_effective_queue_members member WHERE member.workspace_id = $1 AND member.membership_id = inbox."membershipId")
                 AND NOT EXISTS (SELECT 1 FROM crm_effective_queue_members member WHERE member.workspace_id = $1 AND member.membership_id = inbox."membershipId"
                   AND member.is_available AND (member.unavailable_until IS NULL OR member.unavailable_until <= now()))) AS away,
                inbox."userId" = $2 AS "isMe"
           FROM (${INBOX_MEMBERS_SQL}) inbox ORDER BY lower(inbox."displayName"), inbox."membershipId"`,
        [workspaceId, actorUser.userId],
      );
      return result.rows;
    });
  }

  bulk(actor: RequestActor, workspaceId: string, input: BulkConversationsDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const ids = [...new Set(input.conversationIds)];
      const found = await client.query<Row>(`SELECT * FROM crm_conversations WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [workspaceId, ids]);
      if (found.rowCount !== ids.length) throw new NotFoundException("Some chats were not found");
      if ((input.action === "label" || input.action === "unlabel") && !input.labelId) throw new UnprocessableEntityException("Choose a label");
      if (input.action === "label") await this.requireActiveLabel(client, workspaceId, input.labelId!);
      if (input.action === "assign" && input.ownerMembershipId === undefined) throw new UnprocessableEntityException("Choose who takes these chats");
      let changed = 0;
      for (const before of found.rows) {
        if (input.action === "label" || input.action === "unlabel") {
          changed += await this.changeLabel(client, workspaceId, String(before.id), input.labelId!, input.action === "label", actorUser.userId, "bulk") ? 1 : 0;
          continue;
        }
        const change: ConversationChange = input.action === "assign" ? { ownerMembershipId: input.ownerMembershipId ?? null }
          : input.action === "resolve" ? { status: "closed" } : input.action === "reopen" ? { status: "open" }
          : { status: "snoozed", snoozedUntil: input.snoozedUntil };
        const result = await applyConversationChange(client, this.events, { workspaceId, before, change, actorUserId: actorUser.userId, method: "bulk" });
        if (result.changed) changed += 1;
      }
      return { action: input.action, requested: ids.length, changed, unchanged: ids.length - changed };
    });
  }

  /**
   * Blocks (or unblocks) the chat's number, optionally marking it as spam. A blocked client's messages are kept but
   * raise no notice or assignment, and it gets no automatic messages. Safe to repeat.
   */
  blockConversation(actor: RequestActor, workspaceId: string, conversationId: string, input: BlockConversationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const chat = (await client.query<{ partyId: string | null }>(`SELECT party_id AS "partyId" FROM crm_conversations WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId])).rows[0];
      if (!chat) throw new NotFoundException("Conversation not found");
      if (!chat.partyId) throw new UnprocessableEntityException("This chat has no client to block");
      const before = (await client.query<{ blockedAt: Date | null; spamAt: Date | null }>(`SELECT blocked_at AS "blockedAt", spam_at AS "spamAt" FROM crm_parties WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, chat.partyId])).rows[0];
      const spam = input.blocked && Boolean(input.spam);
      if (Boolean(before?.blockedAt) === input.blocked && Boolean(before?.spamAt) === spam) return { conversationId, blocked: input.blocked, spam };
      await client.query(
        `UPDATE crm_parties SET blocked_at = CASE WHEN $3 THEN COALESCE(blocked_at, now()) END, blocked_by = CASE WHEN $3 THEN $4::uuid END,
                spam_at = CASE WHEN $5 THEN COALESCE(spam_at, now()) END, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, chat.partyId, input.blocked, actorUser.userId, spam]);
      if (Boolean(before?.blockedAt) !== input.blocked) await recordChatEvent(client, { workspaceId, conversationId, kind: input.blocked ? "blocked" : "unblocked", actorUserId: actorUser.userId, method: "manual", reason: spam ? "Spam" : null });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: input.blocked ? "crm.party.blocked.v1" : "crm.party.unblocked.v1", entityType: "crm_party", entityId: chat.partyId, before: { blocked: Boolean(before?.blockedAt), spam: Boolean(before?.spamAt) }, after: { blocked: input.blocked, spam } });
      return { conversationId, blocked: input.blocked, spam };
    });
  }

  /** Hides a message from Wodana's views (it stays on the client's phone); only an administrator shows it again. */
  hideMessage(actor: RequestActor, workspaceId: string, conversationId: string, messageId: string, input: HideMessageDto) {
    return this.access.withPermission(actor, workspaceId, input.hidden ? "crm.communications.send" : "crm.settings.manage", async (client, actorUser) => {
      const before = (await client.query<{ hiddenAt: Date | null }>(`SELECT hidden_at AS "hiddenAt" FROM crm_messages WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, conversationId, messageId])).rows[0];
      if (!before) throw new NotFoundException("Message not found");
      if (Boolean(before.hiddenAt) === input.hidden) return { messageId, hidden: input.hidden };
      await client.query(`UPDATE crm_messages SET hidden_at = CASE WHEN $4 THEN now() END, hidden_by = CASE WHEN $4 THEN $5::uuid END, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3`, [workspaceId, conversationId, messageId, input.hidden, actorUser.userId]);
      await recordChatEvent(client, { workspaceId, conversationId, kind: input.hidden ? "hidden" : "unhidden", actorUserId: actorUser.userId, method: "manual" });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: input.hidden ? "crm.message.hidden.v1" : "crm.message.unhidden.v1", entityType: "crm_message", entityId: messageId, before: { hidden: Boolean(before.hiddenAt) }, after: { hidden: input.hidden } });
      return { messageId, hidden: input.hidden };
    });
  }

  /** The chat's labels become exactly these (safe to repeat). */
  setConversationLabels(actor: RequestActor, workspaceId: string, conversationId: string, input: SetConversationLabelsDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const chat = await client.query(`SELECT 1 FROM crm_conversations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, conversationId]);
      if (!chat.rowCount) throw new NotFoundException("Conversation not found");
      const wanted = [...new Set(input.labelIds)];
      const current = await client.query<{ labelId: string }>(`SELECT label_id AS "labelId" FROM crm_conversation_label_links WHERE workspace_id = $1 AND conversation_id = $2`, [workspaceId, conversationId]);
      const had = new Set(current.rows.map((row) => row.labelId));
      for (const labelId of wanted.filter((id) => !had.has(id))) await this.requireActiveLabel(client, workspaceId, labelId);
      for (const labelId of wanted.filter((id) => !had.has(id))) await this.changeLabel(client, workspaceId, conversationId, labelId, true, actorUser.userId, "manual");
      for (const labelId of [...had].filter((id) => !wanted.includes(id))) await this.changeLabel(client, workspaceId, conversationId, labelId, false, actorUser.userId, "manual");
      const labels = await client.query(
        `SELECT label.id, label.name, label.color FROM crm_conversation_label_links link
           JOIN crm_conversation_labels label ON label.workspace_id = link.workspace_id AND label.id = link.label_id
          WHERE link.workspace_id = $1 AND link.conversation_id = $2 ORDER BY lower(label.name)`, [workspaceId, conversationId]);
      return { conversationId, labels: labels.rows };
    });
  }

  labels(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => (await client.query(
      `SELECT ${LABEL_COLUMNS}, (SELECT count(*) FROM crm_conversation_label_links link JOIN crm_conversations chat ON chat.workspace_id = link.workspace_id AND chat.id = link.conversation_id
                                 WHERE link.workspace_id = label.workspace_id AND link.label_id = label.id AND chat.status <> 'closed')::int AS "openChats"
         FROM crm_conversation_labels label WHERE workspace_id = $1 ORDER BY status, lower(name)`, [workspaceId])).rows);
  }

  createLabel(actor: RequestActor, workspaceId: string, input: CreateLabelDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const name = input.name.trim().replace(/\s+/g, " ");
      const existing = await client.query<Row>(`SELECT ${LABEL_COLUMNS} FROM crm_conversation_labels WHERE workspace_id = $1 AND lower(btrim(name)) = lower($2) AND status = 'active'`, [workspaceId, name]);
      if (existing.rowCount) {
        if (existing.rows[0].color === input.color) return { ...existing.rows[0], idempotentReplay: true };
        throw new ConflictException("A label with this name already exists");
      }
      const result = await client.query<Row>(`INSERT INTO crm_conversation_labels (workspace_id, name, color, created_by) VALUES ($1, $2, $3, $4) RETURNING ${LABEL_COLUMNS}`, [workspaceId, name, input.color, actorUser.userId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.label.created.v1", entityType: "crm_conversation_label", entityId: String(result.rows[0].id), after: result.rows[0] });
      return result.rows[0];
    });
  }

  /** Rename, recolour, archive or restore; labels are archived, never deleted, so history keeps its words. */
  updateLabel(actor: RequestActor, workspaceId: string, labelId: string, input: UpdateLabelDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const before = await client.query<Row>(`SELECT ${LABEL_COLUMNS} FROM crm_conversation_labels WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, labelId]);
      if (!before.rowCount) throw new NotFoundException("Label not found");
      const current = before.rows[0];
      const name = input.name?.trim().replace(/\s+/g, " ") ?? String(current.name);
      const color = input.color ?? String(current.color);
      const status = input.status ?? String(current.status);
      if (name === current.name && color === current.color && status === current.status) return current;
      if (Number(current.version) !== input.version) throw new ConflictException("Label changed; reload and try again");
      if (status === "active") {
        const clash = await client.query(`SELECT 1 FROM crm_conversation_labels WHERE workspace_id = $1 AND id <> $2 AND status = 'active' AND lower(btrim(name)) = lower($3)`, [workspaceId, labelId, name]);
        if (clash.rowCount) throw new ConflictException("A label with this name already exists");
      }
      const result = await client.query<Row>(`UPDATE crm_conversation_labels SET name = $3, color = $4, status = $5, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING ${LABEL_COLUMNS}`, [workspaceId, labelId, name, color, status]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.label.updated.v1", entityType: "crm_conversation_label", entityId: labelId, before: current, after: result.rows[0] });
      return result.rows[0];
    });
  }

  /** The workspace's quick replies and my own; `canEdit` says which I may change. */
  quickReplies(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const me = await this.membership(client, workspaceId, actorUser.userId);
      const canManage = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage");
      const result = await client.query<Row>(
        `SELECT ${REPLY_COLUMNS} FROM crm_quick_replies reply
          WHERE reply.workspace_id = $1 AND (reply.owner_membership_id IS NULL OR reply.owner_membership_id = $2)
          ORDER BY reply.status, reply.shortcut, reply.owner_membership_id NULLS LAST`, [workspaceId, me]);
      return result.rows.map((row) => ({ ...row, canEdit: row.scope === "personal" || canManage }));
    });
  }

  createQuickReply(actor: RequestActor, workspaceId: string, input: CreateQuickReplyDto) {
    const permission = input.scope === "workspace" ? "crm.settings.manage" : "crm.communications.send";
    return this.access.withPermission(actor, workspaceId, permission, async (client, actorUser) => {
      const owner = input.scope === "personal" ? await this.membership(client, workspaceId, actorUser.userId) : null;
      const shortcut = input.shortcut.trim().toLowerCase();
      const body = input.body.trim();
      const existing = await client.query<Row>(
        `SELECT ${REPLY_COLUMNS} FROM crm_quick_replies reply WHERE reply.workspace_id = $1 AND reply.status = 'active'
            AND reply.owner_membership_id IS NOT DISTINCT FROM $2::uuid AND reply.shortcut = $3`, [workspaceId, owner, shortcut]);
      if (existing.rowCount) {
        if (existing.rows[0].body === body) return { ...existing.rows[0], canEdit: true, idempotentReplay: true };
        throw new ConflictException(`/${shortcut} is already in use`);
      }
      const result = await client.query<Row>(
        `INSERT INTO crm_quick_replies (workspace_id, owner_membership_id, shortcut, body, created_by) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, shortcut, body, status, version, owner_membership_id AS "ownerMembershipId",
                   CASE WHEN owner_membership_id IS NULL THEN 'workspace' ELSE 'personal' END AS scope, updated_at AS "updatedAt"`,
        [workspaceId, owner, shortcut, body, actorUser.userId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.quick_reply.created.v1", entityType: "crm_quick_reply", entityId: String(result.rows[0].id), after: result.rows[0] });
      return { ...result.rows[0], canEdit: true };
    });
  }

  updateQuickReply(actor: RequestActor, workspaceId: string, replyId: string, input: UpdateQuickReplyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, actorUser) => {
      const found = await client.query<Row>(`SELECT ${REPLY_COLUMNS} FROM crm_quick_replies reply WHERE reply.workspace_id = $1 AND reply.id = $2 FOR UPDATE`, [workspaceId, replyId]);
      if (!found.rowCount) throw new NotFoundException("Quick reply not found");
      const before = found.rows[0];
      if (before.scope === "workspace" && !(await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage"))) throw new ForbiddenException("Only a sales administrator can change the team's quick replies");
      if (before.scope === "personal" && before.ownerMembershipId !== await this.membership(client, workspaceId, actorUser.userId)) throw new ForbiddenException("This quick reply belongs to someone else");
      const shortcut = input.shortcut?.trim().toLowerCase() ?? String(before.shortcut);
      const body = input.body?.trim() ?? String(before.body);
      const status = input.status ?? String(before.status);
      if (shortcut === before.shortcut && body === before.body && status === before.status) return { ...before, canEdit: true };
      if (Number(before.version) !== input.version) throw new ConflictException("Quick reply changed; reload and try again");
      if (status === "active") {
        const clash = await client.query(`SELECT 1 FROM crm_quick_replies WHERE workspace_id = $1 AND id <> $2 AND status = 'active' AND owner_membership_id IS NOT DISTINCT FROM $3::uuid AND shortcut = $4`, [workspaceId, replyId, before.ownerMembershipId ?? null, shortcut]);
        if (clash.rowCount) throw new ConflictException(`/${shortcut} is already in use`);
      }
      const result = await client.query<Row>(
        `UPDATE crm_quick_replies reply SET shortcut = $3, body = $4, status = $5, version = version + 1, updated_at = now()
          WHERE reply.workspace_id = $1 AND reply.id = $2 RETURNING ${REPLY_COLUMNS}`, [workspaceId, replyId, shortcut, body, status]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.quick_reply.updated.v1", entityType: "crm_quick_reply", entityId: replyId, before, after: result.rows[0] });
      return { ...result.rows[0], canEdit: true };
    });
  }

  /** Inbox settings with what they act on: the queues, the one connected number and how many seats reply from it. */
  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => this.readSettings(client, workspaceId, actorUser.userId));
  }

  updateSettings(actor: RequestActor, workspaceId: string, input: UpdateInboxSettingsDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const before = await client.query<Row>(`SELECT auto_assign AS "autoAssign", queue_id AS "queueId", signature_enabled AS "signatureEnabled", version FROM crm_inbox_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
      const current = before.rows[0] ?? { autoAssign: true, queueId: null, signatureEnabled: false, version: 0 };
      const queueId = input.queueId ?? null;
      if (current.autoAssign === input.autoAssign && (current.queueId ?? null) === queueId && current.signatureEnabled === input.signatureEnabled) return this.readSettings(client, workspaceId, actorUser.userId);
      if (Number(current.version) !== input.version) throw new ConflictException("Inbox settings changed; reload and try again");
      if (queueId) {
        const queue = await client.query(`SELECT 1 FROM crm_queues WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, queueId]);
        if (!queue.rowCount) throw new UnprocessableEntityException("Choose an active sales queue");
      }
      await client.query(
        `INSERT INTO crm_inbox_settings (workspace_id, auto_assign, queue_id, signature_enabled, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id) DO UPDATE SET auto_assign = EXCLUDED.auto_assign, queue_id = EXCLUDED.queue_id,
           signature_enabled = EXCLUDED.signature_enabled, updated_by = EXCLUDED.updated_by, updated_at = now(), version = crm_inbox_settings.version + 1`,
        [workspaceId, input.autoAssign, queueId, input.signatureEnabled, actorUser.userId]);
      const after = await this.readSettings(client, workspaceId, actorUser.userId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.settings.updated.v1", entityType: "crm_inbox_settings", entityId: workspaceId, before: current, after: { autoAssign: after.autoAssign, queueId: after.queueId, signatureEnabled: after.signatureEnabled, version: after.version } });
      return after;
    });
  }

  /** Auto replies: the workspace's greeting and away message, each WhatsApp number's own (if any), and what "the workspace's hours" are. */
  autoReplies(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => this.readAutoReplies(client, workspaceId, actorUser.userId));
  }

  /** Saves one scope (the workspace, or one number) as a whole; safe to repeat, version-checked and audited. */
  updateAutoReplies(actor: RequestActor, workspaceId: string, input: UpdateAutoRepliesDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const connectionId = input.connectionId ?? null;
      if (connectionId) {
        const number = await client.query(`SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND id = $2 AND provider = 'whatsapp' AND status = 'connected'`, [workspaceId, connectionId]);
        if (!number.rowCount) throw new UnprocessableEntityException("Choose a connected WhatsApp number");
      }
      const next = {
        greetingEnabled: input.greetingEnabled, greetingText: input.greetingText.trim(), silenceDays: input.greetingSilenceDays,
        awayEnabled: input.awayEnabled, awayText: input.awayText.trim(), windowHours: input.awayWindowHours,
        workingDays: input.workingDays?.length ? [...new Set(input.workingDays)].sort((a, b) => a - b) : null,
        start: input.dayStart ?? null, end: input.dayEnd ?? null, timeZone: input.timeZone?.trim() || null,
      };
      if (next.greetingEnabled && !next.greetingText) throw new UnprocessableEntityException("Write the greeting message");
      if (next.awayEnabled && !next.awayText) throw new UnprocessableEntityException("Write the away message");
      const unknown = [...unknownAutoReplyFields(next.greetingText), ...unknownAutoReplyFields(next.awayText)];
      if (unknown.length) throw new UnprocessableEntityException(`Auto replies can't fill {{${unknown[0]}}}`);
      if ((next.start === null) !== (next.end === null)) throw new UnprocessableEntityException("Set both the opening and the closing time");
      if (next.start && next.start === next.end) throw new UnprocessableEntityException("The closing time must differ from the opening time");
      if (next.timeZone && !validTimeZone(next.timeZone)) throw new UnprocessableEntityException("Choose a valid time zone");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`auto-replies:${workspaceId}:${connectionId ?? "workspace"}`]);
      const found = await client.query<Row>(
        `SELECT id, greeting_enabled AS "greetingEnabled", greeting_text AS "greetingText", greeting_silence_days AS "silenceDays",
                away_enabled AS "awayEnabled", away_text AS "awayText", away_window_hours AS "windowHours", working_days AS "workingDays",
                to_char(day_start, 'HH24:MI') AS start, to_char(day_end, 'HH24:MI') AS "end", time_zone AS "timeZone", version
           FROM crm_auto_reply_settings WHERE workspace_id = $1 AND connection_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`, [workspaceId, connectionId]);
      const before = found.rows[0];
      const current: Row | null = before ? { ...before, workingDays: (before.workingDays as number[] | null)?.map(Number) ?? null } : null;
      const same = current && (Object.keys(next) as Array<keyof typeof next>).every((key) => JSON.stringify(current[key] ?? null) === JSON.stringify(next[key]));
      if (same) return this.readAutoReplies(client, workspaceId, actorUser.userId);
      if (Number(current?.version ?? 0) !== input.version) throw new ConflictException("Auto replies changed; reload and try again");
      const values = [workspaceId, connectionId, next.greetingEnabled, next.greetingText, next.silenceDays, next.awayEnabled, next.awayText, next.windowHours, next.workingDays, next.start, next.end, next.timeZone, actorUser.userId];
      const saved = current
        ? await client.query<{ id: string; version: number }>(
          `UPDATE crm_auto_reply_settings SET greeting_enabled = $3, greeting_text = $4, greeting_silence_days = $5, away_enabled = $6, away_text = $7,
                  away_window_hours = $8, working_days = $9::smallint[], day_start = $10::time, day_end = $11::time, time_zone = $12, updated_by = $13,
                  version = version + 1, updated_at = now()
            WHERE workspace_id = $1 AND connection_id IS NOT DISTINCT FROM $2::uuid RETURNING id, version`, values)
        : await client.query<{ id: string; version: number }>(
          `INSERT INTO crm_auto_reply_settings (workspace_id, connection_id, greeting_enabled, greeting_text, greeting_silence_days, away_enabled, away_text,
                  away_window_hours, working_days, day_start, day_end, time_zone, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::smallint[], $10::time, $11::time, $12, $13) RETURNING id, version`, values);
      const previous = current ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== "id")) : null;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.auto_replies.updated.v1", entityType: "crm_auto_reply_settings", entityId: saved.rows[0].id,
        before: previous, after: { connectionId, ...next, version: saved.rows[0].version } });
      return this.readAutoReplies(client, workspaceId, actorUser.userId);
    });
  }

  /** A number goes back to the workspace's auto replies (its own are removed); safe to repeat. */
  removeAutoRepliesOverride(actor: RequestActor, workspaceId: string, connectionId: string, input: RemoveAutoRepliesDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const found = await client.query<{ id: string; version: number }>(`SELECT id, version FROM crm_auto_reply_settings WHERE workspace_id = $1 AND connection_id = $2 FOR UPDATE`, [workspaceId, connectionId]);
      const row = found.rows[0];
      if (!row) return this.readAutoReplies(client, workspaceId, actorUser.userId);
      if (Number(row.version) !== input.version) throw new ConflictException("Auto replies changed; reload and try again");
      await client.query(`DELETE FROM crm_auto_reply_settings WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.auto_replies.override_removed.v1", entityType: "crm_auto_reply_settings", entityId: row.id,
        before: { connectionId, version: row.version }, after: { connectionId, followsWorkspace: true } });
      return this.readAutoReplies(client, workspaceId, actorUser.userId);
    });
  }

  /** Approved WhatsApp templates (latest version per name and language) with their variables and mapping. */
  templates(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const result = await client.query<Row>(
        // Every WhatsApp template (latest version per name and language) with Meta's status; only approved ones can be sent.
        `SELECT DISTINCT ON (template.code, template.locale) template.id, template.code, template.locale, template.body_template AS body,
                template.provider_template_id AS "providerTemplateId", template.approved_at AS "approvedAt",
                template.status = 'approved' AND COALESCE(template.provider_status, 'approved') = 'approved' AS approved,
                COALESCE(template.provider_status, CASE WHEN template.status = 'approved' THEN 'approved' ELSE 'pending' END) AS "providerStatus",
                template.provider_reason AS "providerReason", template.provider_category AS category, template.provider_quality AS quality,
                template.starter_key AS "starterKey"
           FROM notification_templates template
          WHERE template.workspace_id = $1 AND template.channel = 'whatsapp' AND template.status <> 'archived'
          ORDER BY template.code, template.locale, template.version_number DESC`, [workspaceId]);
      const mappings = await client.query<{ code: string; position: number; source: string; version: number }>(
        `SELECT template_code AS code, position, source, version FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' ORDER BY position`, [workspaceId]);
      return result.rows.map((row) => {
        const positions = templatePlaceholders(String(row.body));
        const mapped = mappings.rows.filter((mapping) => mapping.code === row.code);
        return {
          ...row, positions, usable: placeholdersAreContiguous(positions),
          variables: mapped.map(({ position, source }) => ({ position: Number(position), source })),
          mappingVersion: mapped.reduce((highest, mapping) => Math.max(highest, Number(mapping.version)), 0),
        };
      });
    });
  }

  /** Which field fills each {{n}} of a template (every language of the template shares it). */
  setTemplateVariables(actor: RequestActor, workspaceId: string, templateId: string, input: SetTemplateVariablesDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const template = await client.query<{ code: string; body: string }>(`SELECT code, body_template AS body FROM notification_templates WHERE workspace_id = $1 AND id = $2 AND channel = 'whatsapp'`, [workspaceId, templateId]);
      if (!template.rowCount) throw new NotFoundException("Template not found");
      const { code, body } = template.rows[0];
      const positions = templatePlaceholders(body);
      const requested = new Map(input.variables.map((variable) => [variable.position, variable.source]));
      if (requested.size !== input.variables.length) throw new UnprocessableEntityException("Each variable can be mapped once");
      const outside = [...requested.keys()].find((position) => !positions.includes(position));
      if (outside) throw new UnprocessableEntityException(`This template has no {{${outside}}}`);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:template-variables:${code}`]);
      const current = await client.query<{ position: number; source: string; version: number }>(`SELECT position, source, version FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' AND template_code = $2`, [workspaceId, code]);
      const currentVersion = current.rows.reduce((highest, row) => Math.max(highest, Number(row.version)), 0);
      const unchanged = current.rows.length === requested.size && current.rows.every((row) => requested.get(Number(row.position)) === row.source);
      if (unchanged) return { templateId, code, variables: input.variables, mappingVersion: currentVersion };
      if (currentVersion !== input.version) throw new ConflictException("The mapping changed; reload and try again");
      await client.query(`DELETE FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' AND template_code = $2`, [workspaceId, code]);
      for (const [position, source] of requested) {
        await client.query(`INSERT INTO crm_template_variables (workspace_id, channel, template_code, position, source, version, updated_by) VALUES ($1, 'whatsapp', $2, $3, $4, $5, $6)`, [workspaceId, code, position, source, currentVersion + 1, actorUser.userId]);
      }
      const after = { templateId, code, variables: [...requested].map(([position, source]) => ({ position, source })), mappingVersion: currentVersion + 1 };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.template_variables.updated.v1", entityType: "notification_template", entityId: templateId, before: { variables: current.rows }, after });
      return after;
    });
  }

  /**
   * The client's records beside a chat (each part only when the person may see that module) and every
   * variable value for templates and quick replies, filled from those records.
   */
  context(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => {
      const chat = await client.query<Row>(`SELECT id, party_id, lead_id FROM crm_conversations WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId]);
      if (!chat.rowCount) throw new NotFoundException("Conversation not found");
      const partyId = (chat.rows[0].party_id as string | null) ?? null;
      const leadId = (chat.rows[0].lead_id as string | null) ?? null;
      const can = async (permission: string) => this.access.hasPermission(client, workspaceId, actorUser.userId, permission);
      const party = partyId ? (await client.query<Row>(
        `SELECT party.id, party.display_name AS name, party.type,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('type', contact.type, 'value', contact.raw_value) ORDER BY contact.is_primary DESC, contact.created_at)
                            FROM crm_contact_points contact WHERE contact.workspace_id = party.workspace_id AND contact.party_id = party.id AND contact.status = 'active'), '[]'::jsonb) AS contacts
           FROM crm_parties party WHERE party.workspace_id = $1 AND party.id = $2`, [workspaceId, partyId])).rows[0] ?? null : null;
      const name = (alias: string) => `coalesce(nullif(btrim(${alias}.display_name), ''), ${alias}.primary_email)`;
      const enquiries = partyId && await can("crm.leads.view") ? (await client.query(
        `SELECT lead.id, enquiry.reference, lead.status, lead.created_at AS "createdAt", ${name("owner_user")} AS "ownerName"
           FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
           LEFT JOIN workspace_memberships owner ON owner.workspace_id = lead.workspace_id AND owner.id = lead.owner_membership_id
           LEFT JOIN users owner_user ON owner_user.id = owner.user_id
          WHERE lead.workspace_id = $1 AND (lead.party_id = $2 OR lead.id = $3::uuid)
          ORDER BY (lead.id IS NOT DISTINCT FROM $3::uuid) DESC, lead.created_at DESC LIMIT 5`, [workspaceId, partyId, leadId])).rows : null;
      const opportunities = partyId && await can("crm.opportunities.view") ? (await client.query(
        `SELECT opportunity.id, opportunity.reference, opportunity.title, opportunity.status, stage.name AS "stageName", ${name("owner_user")} AS "ownerName"
           FROM crm_opportunities opportunity
           LEFT JOIN crm_pipeline_stages stage ON stage.workspace_id = opportunity.workspace_id AND stage.id = opportunity.stage_id
           LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id
           LEFT JOIN users owner_user ON owner_user.id = owner.user_id
          WHERE opportunity.workspace_id = $1 AND opportunity.party_id = $2
          ORDER BY (opportunity.status = 'open') DESC, opportunity.updated_at DESC LIMIT 5`, [workspaceId, partyId])).rows : null;
      const projects = partyId && await can("projects.view") ? (await client.query(
        `SELECT project.id, project.reference, project.name, project.status, project.promise_date AS "promiseDate",
                (SELECT ${name("manager_user")} FROM project_assignments assignment JOIN workspace_memberships manager ON manager.workspace_id = assignment.workspace_id AND manager.id = assignment.membership_id
                   JOIN users manager_user ON manager_user.id = manager.user_id
                  WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.is_manager AND assignment.active LIMIT 1) AS "managerName"
           FROM delivery_projects project
          WHERE project.workspace_id = $1 AND project.case_id IN (
            SELECT pc.id FROM pre_project_cases pc JOIN crm_opportunities opportunity ON opportunity.workspace_id = pc.workspace_id AND opportunity.id = pc.opportunity_id
             WHERE pc.workspace_id = $1 AND opportunity.party_id = $2)
          ORDER BY (project.status = 'active') DESC, project.created_at DESC LIMIT 3`, [workspaceId, partyId])).rows : null;
      const variables = await resolveTemplateSources(client, { workspaceId, partyId, leadId, staffUserId: actorUser.userId, config: this.config }, TEMPLATE_VARIABLE_SOURCES);
      return { conversationId, leadId, party, enquiries, opportunities, projects, variables };
    });
  }

  /** The worker's run: snoozed chats whose time has come are open again, and their owner is told. */
  async wakeSnoozedInternal(workspaceId: string, limit = 50) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const due = await client.query<Row>(
        `SELECT * FROM crm_conversations WHERE workspace_id = $1 AND status = 'snoozed' AND snoozed_until <= now()
          ORDER BY snoozed_until, id LIMIT $2 FOR UPDATE SKIP LOCKED`, [workspaceId, Math.min(Math.max(limit, 1), 100)]);
      for (const chat of due.rows) {
        const conversationId = String(chat.id);
        const woke = await client.query<{ version: number }>(`UPDATE crm_conversations SET status = 'open', snoozed_until = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING version`, [workspaceId, conversationId]);
        await recordChatEvent(client, { workspaceId, conversationId, kind: "woke", actorUserId: null, method: "schedule", snoozedUntil: chat.snoozed_until as Date });
        await this.events.record(client, { workspaceId, actorUserId: null, source: "automation", action: "crm.conversation.woke.v1", entityType: "crm_conversation", entityId: conversationId, after: { status: "open", snoozedUntil: chat.snoozed_until, version: woke.rows[0].version } });
        const clientName = (await client.query<{ name: string | null }>(`SELECT display_name AS name FROM crm_parties WHERE workspace_id = $1 AND id = $2`, [workspaceId, chat.party_id ?? null])).rows[0]?.name ?? "A client";
        const owner = await userOfMembership(client, workspaceId, (chat.owner_membership_id as string | null) ?? null);
        const recipients = owner ? [owner.userId] : await unassignedAudience(client, workspaceId, null);
        for (const userId of recipients) {
          await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "crm.inbox_woke", eventType: "crm.inbox.woke", variables: { clientName }, deepLink: inboxLink(conversationId), idempotencyKey: `crm:inbox:woke:${conversationId}:${woke.rows[0].version}:${userId}` });
        }
      }
      return { woken: due.rowCount ?? 0 };
    });
  }

  private async readSettings(client: PoolClient, workspaceId: string, userId: string) {
    const row = (await client.query<Row>(`SELECT auto_assign AS "autoAssign", queue_id AS "queueId", signature_enabled AS "signatureEnabled", version FROM crm_inbox_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const queues = await client.query(`SELECT id, name, is_fallback AS "isFallback" FROM crm_queues WHERE workspace_id = $1 AND status = 'active' ORDER BY is_fallback DESC, lower(name)`, [workspaceId]);
    const number = await client.query<{ number: string | null; accountName: string | null; health: string | null; quality: string | null; limit: string | null }>(
      `SELECT configuration->>'displayPhoneNumber' AS number, configuration->>'accountName' AS "accountName", configuration->'health'->>'state' AS health, configuration->'health'->>'quality' AS quality, configuration->'health'->>'limit' AS "limit"
         FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
        ORDER BY COALESCE((configuration->>'isDefault')::boolean, false) DESC, updated_at DESC, id LIMIT 1`, [workspaceId]);
    const seats = await client.query<{ seats: number }>(
      `SELECT count(*)::int AS seats FROM (${INBOX_MEMBERS_SQL}) inbox
        WHERE EXISTS (SELECT 1 FROM effective_member_roles assigned JOIN role_permissions granted ON granted.role_id = assigned.role_id
                        JOIN permissions permission ON permission.id = granted.permission_id
                       WHERE assigned.workspace_id = $1 AND assigned.membership_id = inbox."membershipId" AND permission.code = 'crm.communications.send')`, [workspaceId]);
    const business = await client.query<{ name: string }>(`SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) AS name FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId]);
    const calendar = await client.query<{ dayStart: string; workingDays: number[] }>(`SELECT to_char(day_start, 'HH24:MI') AS "dayStart", working_days AS "workingDays" FROM hrms_calendars WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, [workspaceId]);
    return {
      autoAssign: row ? row.autoAssign === true : true, queueId: (row?.queueId as string | null) ?? null, signatureEnabled: row?.signatureEnabled === true,
      version: Number(row?.version ?? 0), canManage: await this.access.hasPermission(client, workspaceId, userId, "crm.settings.manage"),
      queues: queues.rows, whatsapp: { connected: Boolean(number.rowCount), number: number.rows[0]?.number ?? null, accountName: number.rows[0]?.accountName ?? null, health: number.rows[0]?.health ?? null, quality: number.rows[0]?.quality ?? null, limit: number.rows[0]?.limit ?? null },
      seats: seats.rows[0]?.seats ?? 0, businessName: business.rows[0]?.name ?? null,
      workday: { start: calendar.rows[0]?.dayStart ?? null, days: calendar.rows[0]?.workingDays ?? null },
    };
  }

  private async readAutoReplies(client: PoolClient, workspaceId: string, userId: string) {
    const scopes = await readAutoReplyScopes(client, workspaceId);
    const numbers = await client.query<{ connectionId: string; number: string | null; accountName: string | null; isDefault: boolean }>(
      `SELECT id AS "connectionId", configuration->>'displayPhoneNumber' AS number, configuration->>'accountName' AS "accountName",
              COALESCE((configuration->>'isDefault')::boolean, false) AS "isDefault"
         FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
        ORDER BY COALESCE((configuration->>'isDefault')::boolean, false) DESC, created_at, id`, [workspaceId]);
    const business = await client.query<{ name: string }>(`SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) AS name FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId]);
    const hours = await workspaceHours(client, workspaceId);
    return {
      canManage: await this.access.hasPermission(client, workspaceId, userId, "crm.settings.manage"),
      businessName: business.rows[0]?.name ?? null,
      workspace: scopes.workspace,
      numbers: numbers.rows.map((row) => ({ ...row, override: scopes.numbers.find((scope) => scope.connectionId === row.connectionId) ?? null })),
      defaults: { workingDays: hours.workingDays, start: hours.start, end: hours.end, timeZone: hours.timeZone },
      fields: AUTO_REPLY_FIELDS,
    };
  }

  private async changeLabel(client: PoolClient, workspaceId: string, conversationId: string, labelId: string, add: boolean, actorUserId: string, method: "manual" | "bulk") {
    const result = add
      ? await client.query(`INSERT INTO crm_conversation_label_links (workspace_id, conversation_id, label_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [workspaceId, conversationId, labelId, actorUserId])
      : await client.query(`DELETE FROM crm_conversation_label_links WHERE workspace_id = $1 AND conversation_id = $2 AND label_id = $3`, [workspaceId, conversationId, labelId]);
    if (!result.rowCount) return false;
    await recordChatEvent(client, { workspaceId, conversationId, kind: add ? "labelled" : "unlabelled", actorUserId, labelId, method });
    await this.events.record(client, { workspaceId, actorUserId, source: "user", action: add ? "crm.conversation.labelled.v1" : "crm.conversation.unlabelled.v1", entityType: "crm_conversation", entityId: conversationId, after: { labelId, method } });
    return true;
  }

  private async requireActiveLabel(client: PoolClient, workspaceId: string, labelId: string) {
    const label = await client.query(`SELECT 1 FROM crm_conversation_labels WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, labelId]);
    if (!label.rowCount) throw new UnprocessableEntityException("Choose an active label");
  }

  private async membership(client: PoolClient, workspaceId: string, userId: string) {
    const result = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId]);
    return result.rows[0]?.id ?? null;
  }
}
