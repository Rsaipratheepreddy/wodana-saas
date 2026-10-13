import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CLOSE_CHATS, CrmConversationsService } from "./crm-conversations.service";
import { UpdateClosingMessagesDto } from "./dto/inbox.dto";
import { approvedTemplate, clientMessageRule } from "./inbox/client-messages";
import {
  CLOSING_FIELDS, CLOSING_KINDS, CLOSING_STATE, CLOSING_TEMPLATE_CODES, closingFacts, closingFieldsOf, closingTemplate, DEFAULT_CLOSING_AFTER_HOURS,
  DEFAULT_CLOSING_TEXTS, readClosingSettings, renderClosing, unknownClosingFields, type ClosingKind,
} from "./inbox/closing-messages";
import { applyConversationChange, recordChatEvent } from "./inbox/inbox-commands";
import { firstName } from "./inbox/inbox-rules";
import { conversationVisible, INBOX_MANAGE, loadInboxViewer } from "./inbox/inbox-visibility";
import { closingFormLink } from "./inbox/template-variables";
import { metaBodyProblem } from "./inbox/whatsapp-starter-pack";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The inbox's three closing messages (PLM-137): the firm's texts in Settings › Inbox › Closing messages, and sending
 * one from a chat. Each send is version-checked against the chat the person saw (a client message or a teammate's
 * action in between refuses it), re-checks every rule at that moment, puts the message in the chat and moves the chat
 * to its state (Resolved, or Unresolved while the form is awaited), with a history line and an audit event.
 */
@Injectable()
export class CrmClosingMessagesService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly conversations: CrmConversationsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, actorUser) => this.read(client, workspaceId, actorUser.userId));
  }

  /** Saves the three texts (null = the product's wording), the form link and the quiet hours as a whole; safe to repeat. */
  update(actor: RequestActor, workspaceId: string, input: UpdateClosingMessagesDto) {
    return this.access.withAnyPermission(actor, workspaceId, [...INBOX_MANAGE], async (client, actorUser) => {
      const current = await readClosingSettings(client, workspaceId);
      const own = (kind: ClosingKind) => {
        const value = input.texts?.[kind];
        const text = value === undefined ? (current.custom[kind] ? current.texts[kind] : null) : value === null ? null : value.trim().replace(/[ \t]+\n/g, "\n");
        return text && text !== DEFAULT_CLOSING_TEXTS[kind] ? text : null;
      };
      const next = { received: own("received"), form: own("form"), closing: own("closing"), formUrl: input.formUrl === undefined ? current.formUrl : input.formUrl?.trim() || null,
        afterHours: input.afterHours ?? current.afterHours };
      for (const kind of CLOSING_KINDS) {
        const text = next[kind];
        if (text === null) continue;
        if (!text) throw new UnprocessableEntityException("Write the message, or use the standard wording");
        const unknown = unknownClosingFields(text);
        if (unknown.length) throw new UnprocessableEntityException(`Closing messages can fill {{name}} and {{form_link}}, not {{${unknown[0]}}}`);
      }
      const same = CLOSING_KINDS.every((kind) => next[kind] === (current.custom[kind] ? current.texts[kind] : null)) && next.formUrl === current.formUrl && next.afterHours === current.afterHours;
      if (same) return this.read(client, workspaceId, actorUser.userId);
      if (current.version !== input.version) throw new ConflictException("The closing messages changed; reload and try again");
      await client.query(
        `INSERT INTO crm_inbox_settings (workspace_id, closing_received_text, closing_form_text, closing_close_text, closing_form_url, closing_after_hours, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id) DO UPDATE SET closing_received_text = EXCLUDED.closing_received_text, closing_form_text = EXCLUDED.closing_form_text,
           closing_close_text = EXCLUDED.closing_close_text, closing_form_url = EXCLUDED.closing_form_url, closing_after_hours = EXCLUDED.closing_after_hours,
           updated_by = EXCLUDED.updated_by, updated_at = now(), closing_version = crm_inbox_settings.closing_version + 1`,
        [workspaceId, next.received, next.form, next.closing, next.formUrl, next.afterHours, actorUser.userId]);
      const after = await readClosingSettings(client, workspaceId);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.inbox.closing_messages.updated.v1", entityType: "crm_inbox_settings", entityId: workspaceId,
        before: current, after });
      return this.read(client, workspaceId, actorUser.userId);
    });
  }

  /**
   * Sends one closing message to a chat. "Closing the chat" needs crm.inbox.close_chats and is refused unless the
   * chat is still work, nobody is waiting on us, and the client has been quiet for the firm's working hours since our
   * last reply. On WhatsApp outside the 24-hour window it goes as its approved template, else it is refused saying so.
   */
  send(actor: RequestActor, workspaceId: string, conversationId: string, input: { version: number; kind: string }) {
    const kind = input.kind as ClosingKind;
    if (!(CLOSING_KINDS as readonly string[]).includes(kind)) throw new UnprocessableEntityException("Choose a closing message");
    return this.access.withPermission(actor, workspaceId, kind === "closing" ? CLOSE_CHATS : "crm.communications.send", async (client, actorUser) => {
      const viewer = await loadInboxViewer((permission) => this.access.hasPermission(client, workspaceId, actorUser.userId, permission));
      const membership = (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, actorUser.userId])).rows[0]?.id ?? null;
      if (!(await conversationVisible(client, workspaceId, conversationId, viewer, membership))) throw new NotFoundException("Conversation not found");
      if (kind !== "closing" && !(await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.send"))) throw new ForbiddenException("You can't reply in this chat");
      const chat = (await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, conversationId])).rows[0];
      if (!chat) throw new NotFoundException("Conversation not found");
      // The chat as the person saw it: a client message or a teammate's action since then changes its version.
      if (Number(chat.version) !== input.version) throw new ConflictException("This chat changed since you opened it. Check it before sending.");
      if (!chat.party_id || chat.channel === "internal") throw new UnprocessableEntityException("This chat has no client to message");
      if (chat.status === "closed") throw new ConflictException("This chat is already resolved.");
      if (chat.status === "spam") throw new ConflictException("This chat is marked as spam.");
      if (chat.status === "snoozed") throw new ConflictException("Wake this chat before closing it.");
      if (kind === "closing") {
        const facts = await closingFacts(client, workspaceId, chat);
        if (facts.problem) throw new ConflictException(facts.problem);
      }
      const settings = await readClosingSettings(client, workspaceId);
      const text = settings.texts[kind];
      const party = (await client.query<{ name: string | null }>(`SELECT display_name AS name FROM crm_parties WHERE workspace_id = $1 AND id = $2`, [workspaceId, chat.party_id])).rows[0];
      const formLink = closingFieldsOf(text).includes("form_link") ? await closingFormLink(client, workspaceId, this.config) : null;
      if (closingFieldsOf(text).includes("form_link") && !formLink) throw new UnprocessableEntityException("Add the enquiry form link in Settings › Inbox › Closing messages.");
      const body = renderClosing(text, { name: firstName(party?.name), form_link: formLink });

      // "We have everything" already went automatically when the chat's enquiry was created: it isn't sent twice.
      const leadId = (chat.lead_id as string | null) ?? (chat.job_kind === "enquiry" ? chat.job_id as string : null);
      const already = kind === "received" && leadId ? (await client.query(`SELECT 1 FROM crm_messages WHERE workspace_id = $1 AND metadata->>'eventKey' = $2 LIMIT 1`,
        [workspaceId, `crm.enquiry.created:${leadId}:${chat.party_id}`])).rowCount : 0;
      let messageId: string | null = null;
      let template: string | null = null;
      if (!already) {
        const lastInbound = chat.last_inbound_at ? new Date(chat.last_inbound_at as string | Date).getTime() : null;
        const windowOpen = chat.channel !== "whatsapp" || (lastInbound !== null && Date.now() - lastInbound < WINDOW_MS);
        const message: Record<string, unknown> = { direction: "outbound", clientMessageId: randomUUID(), metadata: { closing: kind } };
        if (windowOpen) message.bodyText = body;
        else {
          const found = await this.template(client, workspaceId, kind);
          if (!found) {
            const name = CLOSING_TEMPLATE_CODES[kind];
            throw new UnprocessableEntityException(`WhatsApp's 24-hour window has closed, and the template ${name} isn't approved by Meta yet, so this message can't go. Submit it in Settings › Inbox › WhatsApp templates, or wait for the client to write.`);
          }
          message.templateId = found.id;
          template = found.code;
        }
        const sent = await this.conversations.insertMessageWithClient(client, workspaceId, conversationId, message as never, actorUser.userId, "user") as { id: string };
        messageId = sent.id;
      }
      const fresh = (await client.query<Record<string, unknown>>(`SELECT * FROM crm_conversations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, conversationId])).rows[0];
      const { after } = await applyConversationChange(client, this.events, { workspaceId, before: fresh, change: { status: CLOSING_STATE[kind] }, actorUserId: actorUser.userId, method: "manual", closing: kind });
      await recordChatEvent(client, { workspaceId, conversationId, kind: "closing_sent", actorUserId: actorUser.userId, method: "manual", reason: kind });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.conversation.closing_sent.v1", entityType: "crm_conversation", entityId: conversationId,
        after: { kind, messageId, template, alreadySent: Boolean(already), status: after.status, note: already ? null : body } });
      return { conversationId, kind, sent: !already, messageId, template, status: after.status, version: after.version };
    });
  }

  /** The approved template a closing message goes as outside the window; "We have everything" may also use the enquiry welcome the firm chose. */
  private async template(client: PoolClient, workspaceId: string, kind: ClosingKind) {
    const codes = [CLOSING_TEMPLATE_CODES[kind]];
    if (kind === "received") {
      const rule = await clientMessageRule(client, workspaceId, "crm.enquiry.created");
      if (rule.templateCode && !codes.includes(rule.templateCode)) codes.push(rule.templateCode);
    }
    for (const code of codes) {
      const found = await approvedTemplate(client, workspaceId, code, ["en"]);
      if (found) return { id: found.id, code };
    }
    return null;
  }

  private async read(client: PoolClient, workspaceId: string, userId: string) {
    const settings = await readClosingSettings(client, workspaceId);
    const canManage = await this.hasAny(client, workspaceId, userId, INBOX_MANAGE);
    const templates = await client.query<{ code: string; providerStatus: string; approved: boolean; body: string }>(
      `SELECT DISTINCT ON (code) code, body_template AS body,
              COALESCE(provider_status, CASE WHEN status = 'approved' THEN 'approved' ELSE 'pending' END) AS "providerStatus",
              status = 'approved' AND COALESCE(provider_status, 'approved') = 'approved' AS approved
         FROM notification_templates WHERE workspace_id = $1 AND channel = 'whatsapp' AND code = ANY($2::text[]) AND status <> 'archived'
        ORDER BY code, (status = 'approved') DESC, version_number DESC`, [workspaceId, Object.values(CLOSING_TEMPLATE_CODES)]);
    const welcome = await clientMessageRule(client, workspaceId, "crm.enquiry.created");
    return {
      version: settings.version, canManage, formUrl: settings.formUrl, formLink: await closingFormLink(client, workspaceId, this.config),
      afterHours: settings.afterHours, defaultAfterHours: DEFAULT_CLOSING_AFTER_HOURS, fields: Object.keys(CLOSING_FIELDS),
      /** "We have everything" also goes when an enquiry is created, while the firm keeps that client message on. */
      sentOnEnquiry: welcome.enabled,
      messages: CLOSING_KINDS.map((kind) => {
        const template = templates.rows.find((row) => row.code === CLOSING_TEMPLATE_CODES[kind]) ?? null;
        const submitted = template ? closingTemplate(settings.texts[kind]).body : null;
        return {
          kind, text: settings.texts[kind], custom: settings.custom[kind], defaultText: DEFAULT_CLOSING_TEXTS[kind], templateCode: CLOSING_TEMPLATE_CODES[kind],
          template: template ? { providerStatus: template.providerStatus, approved: template.approved, matchesText: template.body.trim() === submitted } : null,
          /** Why Meta would refuse this text as a template (it can't start or end with a field), or null. */
          templateProblem: metaBodyProblem(closingTemplate(settings.texts[kind]).body, closingTemplate(settings.texts[kind]).sources.length),
        };
      }),
    };
  }

  private async hasAny(client: PoolClient, workspaceId: string, userId: string, permissions: readonly string[]) {
    for (const permission of permissions) if (await this.access.hasPermission(client, workspaceId, userId, permission)) return true;
    return false;
  }
}
