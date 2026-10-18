import { BadRequestException, ConflictException, Injectable, Logger, NotAcceptableException, Optional, PayloadTooLargeException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { TransactionalEmailService } from "../../email/transactional-email.service";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmConversationsService } from "./crm-conversations.service";
import { baseSubject, htmlToText, isAutomatic, sanitizeEmailHtml, stripQuotedText, subjectKey } from "./email/email-content";
import { DEFAULT_WEBHOOK_MAX_AGE_SECONDS, generateLocalPart, inboundDomain, inboundLocalParts, MAX_EMAIL_ATTACHMENTS, readMailgunInbound, verifyMailgunSignature, type InboundEmail, type InboundFile } from "./email/mailgun-inbound";
import { ATTACHMENT_MAX_BYTES, safeFileName, sniffEmailAttachment } from "./inbox/attachment-rules";
import { INBOX_MANAGE } from "./inbox/inbox-visibility";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** How long the fallback thread (same sender, same subject) stays open. */
const SUBJECT_THREAD_DAYS = 30;

type KeptFile = { id: string; position: number; kind: string; contentType: string; fileName: string; byteSize: number | null; checksum: string | null; objectKey: string | null; status: "stored" | "failed"; failureCode: string | null };
export type InboundResult = { status: "stored" | "duplicate" | "ignored"; reason?: string; workspaceId?: string; conversationId?: string; messageId?: string };
type Storage = Pick<BrandAssetStorageService, "put">;

/**
 * Email into the team inbox (PLM-025). A workspace forwards its enquiries mailbox to its own generated inbound
 * address; Mailgun receives it and posts each email here. The post is verified (signature, freshness, a token seen
 * only once), the recipient names the workspace (a SECURITY DEFINER lookup), and everything else happens in that
 * workspace's tenant transaction: the same email twice is one message, a reply joins its conversation by Message-ID
 * (else by sender and subject), the sender is matched to a client by email or becomes a new contact, and the
 * message goes through the same intake as a WhatsApp one (owner chosen and told, the job's owner told).
 */
@Injectable()
export class CrmInboundEmailService {
  private readonly logger = new Logger(CrmInboundEmailService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly conversations: CrmConversationsService,
    private readonly storage: BrandAssetStorageService,
    private readonly config: ConfigService,
    @Optional() private readonly mailer?: TransactionalEmailService,
  ) {}

  private domain() { return inboundDomain(this.config.get<string>("INBOUND_EMAIL_DOMAIN")); }
  private maxAge() {
    const value = Number(this.config.get<string>("MAILGUN_WEBHOOK_MAX_AGE_SECONDS") ?? DEFAULT_WEBHOOK_MAX_AGE_SECONDS);
    return Number.isFinite(value) && value >= 60 ? Math.min(value, 24 * 60 * 60) : DEFAULT_WEBHOOK_MAX_AGE_SECONDS;
  }

  /** The workspace's inbound address for Settings → Inbox: the address, whether it can be made here, and its version. */
  address(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client, user) => {
      const row = (await client.query<{ localPart: string; version: number }>(`SELECT local_part AS "localPart", version FROM crm_inbound_email_addresses WHERE workspace_id = $1 AND status = 'active'`, [workspaceId])).rows[0];
      let canManage = false;
      for (const permission of INBOX_MANAGE) if (await this.access.hasPermission(client, workspaceId, user.userId, permission)) { canManage = true; break; }
      return this.present(row ?? null, canManage);
    });
  }

  private present(row: { localPart: string; version: number } | null, canManage: boolean) {
    const domain = this.domain();
    return { available: Boolean(domain), address: row && domain ? `${row.localPart}@${domain}` : null, version: Number(row?.version ?? 0), canManage };
  }

  /**
   * Create the inbound address, or replace it with a new one (the old one stops working at once). Version-checked;
   * the same command id again returns the address it made. Audited.
   */
  setAddress(actor: RequestActor, workspaceId: string, input: { version: number; commandId: string }) {
    return this.access.withAnyPermission(actor, workspaceId, [...INBOX_MANAGE], async (client, user) => {
      if (!this.domain()) throw new UnprocessableEntityException("Email into the inbox isn't available on this server yet");
      const before = (await client.query<{ localPart: string; version: number; lastCommandId: string | null }>(
        `SELECT local_part AS "localPart", version, last_command_id AS "lastCommandId" FROM crm_inbound_email_addresses WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0];
      if (before && before.lastCommandId === input.commandId) return { ...this.present(before, true), idempotentReplay: true };
      if (Number(before?.version ?? 0) !== input.version) throw new ConflictException("The email address changed; reload and try again");
      const slug = (await client.query<{ slug: string | null }>(
        `SELECT coalesce(nullif(branding.login_slug, ''), workspace.slug) AS slug FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`,
        [workspaceId])).rows[0]?.slug ?? null;
      let saved: { localPart: string; version: number } | undefined;
      for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
        await client.query("SAVEPOINT inbound_address");
        try {
          saved = (await client.query<{ localPart: string; version: number }>(
            `INSERT INTO crm_inbound_email_addresses (workspace_id, local_part, status, last_command_id, created_by, updated_by)
             VALUES ($1, $2, 'active', $3, $4, $4)
             ON CONFLICT (workspace_id) DO UPDATE SET local_part = EXCLUDED.local_part, status = 'active', last_command_id = EXCLUDED.last_command_id,
               updated_by = EXCLUDED.updated_by, updated_at = now(), version = crm_inbound_email_addresses.version + 1
             RETURNING local_part AS "localPart", version`, [workspaceId, generateLocalPart(slug), input.commandId, user.userId])).rows[0];
          await client.query("RELEASE SAVEPOINT inbound_address");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT inbound_address");
          // Another workspace drew the same local part (vanishingly rare): draw again.
          if ((error as { code?: string }).code !== "23505") throw error;
        }
      }
      if (!saved) throw new ConflictException("A new address could not be made; try again");
      const after = this.present(saved, true);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: before ? "crm.inbox.email_address.regenerated.v1" : "crm.inbox.email_address.created.v1",
        entityType: "crm_inbound_email_address", entityId: workspaceId, before: before ? this.present(before, true) : undefined, after });
      return after;
    });
  }

  /**
   * Mailgun's post of one received email. 401 for a bad signature; 406 (Mailgun stops retrying) for a stale or
   * replayed one; 200 for stored, duplicate or ignored. A failure before the email is stored gives the token back,
   * so Mailgun's retry is accepted.
   */
  async receiveMailgun(body: Record<string, unknown>, files: Array<{ fieldname?: string; originalname?: string; mimetype?: string; buffer?: Buffer }> = [], now = Date.now()): Promise<InboundResult> {
    const signingKey = this.config.get<string>("MAILGUN_WEBHOOK_SIGNING_KEY")?.trim() ?? "";
    const domain = this.domain();
    if (!signingKey || !domain) throw new ServiceUnavailableException("Inbound email is not set up");
    const email = readMailgunInbound(body ?? {}, files);
    const check = verifyMailgunSignature(email.signature, signingKey, Math.floor(now / 1000), this.maxAge());
    if (check === "invalid") throw new UnauthorizedException("Invalid webhook signature");
    if (check === "stale") throw new NotAcceptableException("Webhook timestamp is outside the accepted window");
    const token = String(email.signature.token);
    const fresh = (await this.database.query<{ fresh: boolean }>(`SELECT public.claim_inbound_webhook_token('mailgun', $1, $2) AS fresh`, [token, this.maxAge() + 600])).rows[0]?.fresh;
    if (!fresh) throw new NotAcceptableException("This webhook was already received");
    try {
      return await this.store(email, domain);
    } catch (error) {
      await this.database.query(`SELECT public.release_inbound_webhook_token('mailgun', $1)`, [token]).catch(() => undefined);
      throw error;
    }
  }

  private async store(email: InboundEmail, domain: string): Promise<InboundResult> {
    let workspaceId: string | null = null;
    for (const local of inboundLocalParts(email.recipient, domain)) {
      workspaceId = (await this.database.query<{ id: string | null }>(`SELECT public.resolve_inbound_email_workspace($1) AS id`, [local])).rows[0]?.id ?? null;
      if (workspaceId) break;
    }
    if (!workspaceId) return { status: "ignored", reason: "unknown_recipient" };
    const from = email.from;
    if (!from) return { status: "ignored", reason: "no_sender", workspaceId };
    // Our own addresses never write to a chat (a forwarding loop, or our reply copied back).
    const sender = this.mailer?.senderAddress() ?? null;
    if (from.address.endsWith(`@${domain}`) || (sender && from.address === sender)) return { status: "ignored", reason: "own_address", workspaceId };
    const messageId = email.messageId ?? syntheticMessageId(email);
    const key = `email:${createHash("sha256").update(messageId).digest("hex").slice(0, 48)}`;
    const known = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => this.known(client, workspaceId!, messageId));
    if (known) return { status: "duplicate", workspaceId, ...known };
    const kept = await this.keepFiles(workspaceId, email.attachments);
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`inbound-email:${workspaceId}:${messageId}`]);
      const again = await this.known(client, workspaceId!, messageId);
      if (again) return { status: "duplicate", workspaceId: workspaceId!, ...again };
      const ids = [...email.inReplyTo, ...[...email.references].reverse()];
      const byId = async () => ids.length ? (await client.query<{ id: string }>(
        `SELECT conversation_id AS id FROM crm_email_messages WHERE workspace_id = $1 AND (internet_message_id = ANY($2::text[]) OR provider_message_id = ANY($2::text[]))
          ORDER BY created_at DESC LIMIT 1`, [workspaceId, ids])).rows[0]?.id ?? null : null;
      const repliedTo = await byId();
      // An out-of-office or a bounce only joins a conversation it answers; it never starts one.
      if (!repliedTo && isAutomatic(email.headers)) return { status: "ignored", reason: "automatic", workspaceId: workspaceId! };
      const subject = baseSubject(email.subject);
      const thread = async (partyId: string) => repliedTo ?? (subjectKey(email.subject) ? (await client.query<{ id: string }>(
        `SELECT email.conversation_id AS id FROM crm_email_messages email
           JOIN crm_conversations conversation ON conversation.workspace_id = email.workspace_id AND conversation.id = email.conversation_id
          WHERE email.workspace_id = $1 AND email.subject_key = $2 AND conversation.party_id = $3 AND conversation.channel = 'email'
            AND email.created_at > now() - make_interval(days => $4)
          ORDER BY email.created_at DESC LIMIT 1`, [workspaceId, subjectKey(email.subject), partyId, SUBJECT_THREAD_DAYS])).rows[0]?.id ?? null : null);
      const fullText = (email.text || htmlToText(email.html)).trim();
      const shown = (email.strippedText?.trim() || stripQuotedText(fullText)).trim();
      const ingested = await this.conversations.ingestEmailWithClient(client, {
        workspaceId: workspaceId!, channel: "email", providerThreadId: key, providerMessageId: key, contact: from.address,
        displayName: from.name ?? undefined, subject: subject.slice(0, 500) || undefined, bodyText: shown.slice(0, 100_000) || "Email received",
        bodyHtml: sanitizeEmailHtml(email.html) ?? undefined, metadata: { provider: "mailgun", subject: subject.slice(0, 500) },
      }, thread);
      const message = ingested.message as { id: string; idempotentReplay?: boolean };
      if (message.idempotentReplay) return { status: "duplicate", workspaceId: workspaceId!, conversationId: ingested.conversationId, messageId: message.id };
      await client.query(
        `INSERT INTO crm_email_messages (workspace_id, message_id, conversation_id, direction, internet_message_id, in_reply_to, reference_ids, from_address, from_name,
           to_addresses, cc_addresses, subject, subject_key, full_text, sent_at)
         VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [workspaceId, message.id, ingested.conversationId, messageId, email.inReplyTo[0] ?? null, email.references.slice(-50), from.address, from.name,
          email.to.map((item) => item.address), email.cc.map((item) => item.address), email.subject.slice(0, 900), subjectKey(email.subject), fullText.slice(0, 100_000) || null, email.date]);
      for (const file of kept) {
        await client.query(
          `INSERT INTO crm_message_attachments (id, workspace_id, conversation_id, message_id, position, direction, kind, content_type, file_name, byte_size, checksum, object_key, status, failure_code)
           VALUES ($1, $2, $3, $4, $5, 'inbound', $6, $7, $8, $9, $10, $11, $12, $13)`,
          [file.id, workspaceId, ingested.conversationId, message.id, file.position, file.kind, file.contentType, file.fileName, file.byteSize, file.checksum, file.objectKey, file.status, file.failureCode]);
      }
      await this.events.record(client, { workspaceId: workspaceId!, actorUserId: null, source: "integration", action: "crm.message.email_received.v1", entityType: "crm_conversation", entityId: ingested.conversationId,
        after: { messageId: message.id, partyId: ingested.partyId, from: from.address, subject, files: kept.length, threaded: Boolean(repliedTo) } });
      return { status: "stored", workspaceId: workspaceId!, conversationId: ingested.conversationId, messageId: message.id };
    });
  }

  private async known(client: PoolClient, workspaceId: string, messageId: string) {
    const row = (await client.query<{ messageId: string; conversationId: string }>(
      `SELECT message_id AS "messageId", conversation_id AS "conversationId" FROM crm_email_messages WHERE workspace_id = $1 AND internet_message_id = $2`, [workspaceId, messageId])).rows[0];
    return row ?? null;
  }

  /**
   * The email's files, each kept in the workspace's private storage after its size, type (read from its bytes),
   * the storage allowance and the safety scan allow it; one that isn't kept is listed as such, and the email is
   * never lost for it. At most ten files per email.
   */
  private async keepFiles(workspaceId: string, files: InboundFile[]): Promise<KeptFile[]> {
    const kept: KeptFile[] = [];
    for (const [position, file] of files.slice(0, 50).entries()) {
      const id = randomUUID();
      const fileName = safeFileName(file.fileName, "Attachment");
      const claimed = file.contentType.toLowerCase().split(";")[0].trim().slice(0, 160) || "application/octet-stream";
      const guess = /^image\//.test(claimed) ? "image" : /^video\//.test(claimed) ? "video" : /^audio\//.test(claimed) ? "audio" : "document";
      const failed = (failureCode: string): KeptFile => ({ id, position, kind: guess, contentType: claimed, fileName, byteSize: file.buffer.length || null, checksum: null, objectKey: null, status: "failed", failureCode });
      if (position >= MAX_EMAIL_ATTACHMENTS) { kept.push(failed("too_many_files")); continue; }
      if (file.buffer.length > ATTACHMENT_MAX_BYTES) { kept.push(failed("too_large")); continue; }
      const sniffed = sniffEmailAttachment(file.buffer, fileName);
      if (!sniffed) { kept.push(failed("type_not_allowed")); continue; }
      const digest = createHash("sha256").update(file.buffer).digest("hex");
      const objectKey = ["crm-inbox", workspaceId, "email", id, digest].join("/");
      try {
        await (this.storage as Storage).put(objectKey, file.buffer, sniffed.mimeType);
      } catch (error) {
        const code = error instanceof PayloadTooLargeException ? "storage_full" : error instanceof BadRequestException ? "blocked_by_safety_scan" : null;
        if (!code) throw error;
        this.logger.warn(`An email file was not kept (${code})`);
        kept.push(failed(code));
        continue;
      }
      kept.push({ id, position, kind: sniffed.kind, contentType: sniffed.mimeType, fileName, byteSize: file.buffer.length, checksum: digest, objectKey, status: "stored", failureCode: null });
    }
    return kept;
  }
}

/** An email without a Message-ID gets one from its content, so a second delivery of it is still one message. */
function syntheticMessageId(email: InboundEmail) {
  const digest = createHash("sha256").update(JSON.stringify([email.from?.address, email.date?.toISOString() ?? null, email.subject, email.text.slice(0, 20_000)])).digest("hex");
  return `<${digest.slice(0, 40)}@no-message-id.invalid>`;
}
