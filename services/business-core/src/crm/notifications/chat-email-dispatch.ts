import type { PoolClient } from "pg";
import type { DatabaseService } from "../../database/database.service";
import type { EmailAttachment, EmailDeliveryResult, EmailSendOptions, TransactionalEmailService } from "../../email/transactional-email.service";
import { CLAIMED_EMAIL_COLUMNS, emailDisposition, expiredRetry, recordEmailDisposition, releaseClaimedEmails, type ClaimedEmail } from "../../notifications/email-dispatch-outcome";
import type { CrmMessageReceiptService } from "../conversations/crm-message-receipt.service";
import { baseSubject, replySubject, subjectKey } from "../conversations/email/email-content";
import { inboundDomain } from "../conversations/email/mailgun-inbound";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** The most a reply's file may weigh when it goes by email (the chat keeps up to 20 MB; email providers take ~25 MB). */
const MAX_EMAIL_FILE_BYTES = 20 * 1024 * 1024;

/**
 * A team reply in an email conversation of a workspace that has an inbound address: it goes out through the
 * platform mailer (not the worker's Google connector), so the client's answer comes back to the inbound address.
 * `notification` is the alias of the notifications row.
 */
export const CHAT_EMAIL_SQL = `(notification.recipient_type = 'party' AND notification.channel = 'email' AND notification.idempotency_key LIKE 'message:%'
  AND EXISTS (SELECT 1 FROM crm_inbound_email_addresses address WHERE address.workspace_id = notification.workspace_id AND address.status = 'active'))`;

type Storage = { read(objectKey: string): Promise<{ body: Buffer }> };
type Receipts = Pick<CrmMessageReceiptService, "record">;
export type ChatEmailDeps = { database: DatabaseService; mailer?: TransactionalEmailService; storage?: Storage; receipts: Receipts; inboundDomain?: string | null };

type Claimed = { id: string; messageId: string } & ClaimedEmail;
type Reply = {
  conversationId: string; bodyText: string | null; subject: string | null; localPart: string | null; to: string | null;
  lastSubject: string | null; parentId: string | null; parentReferences: string[] | null;
  attachmentKey: string | null; attachmentName: string | null; attachmentType: string | null; attachmentBytes: number | null;
};

/** The reply's Message-Id, built from our message id on the inbound domain: stable across retries. */
export const replyMessageId = (messageId: string, domain: string) => `<m.${messageId}@${domain}>`;

/** The threading headers of a reply to `parent` (its Message-ID and the chain before it, the last 20 ids). */
export function threadHeaders(messageId: string, parent: { id: string | null; references: string[] | null }) {
  const chain = [...(parent.references ?? []), ...(parent.id ? [parent.id] : [])].filter((id, index, all) => all.indexOf(id) === index).slice(-20);
  return { "Message-Id": messageId, ...(parent.id ? { "In-Reply-To": parent.id } : {}), ...(chain.length ? { References: chain.join(" ") } : {}) };
}

async function load(client: PoolClient, workspaceId: string, messageId: string) {
  return (await client.query<Reply>(
    `SELECT message.conversation_id AS "conversationId", message.body_text AS "bodyText", conversation.subject,
            (SELECT local_part FROM crm_inbound_email_addresses WHERE workspace_id = message.workspace_id AND status = 'active') AS "localPart",
            -- To whoever last wrote in this conversation, else the client's primary email.
            coalesce((SELECT email.from_address FROM crm_email_messages email WHERE email.workspace_id = message.workspace_id AND email.conversation_id = message.conversation_id AND email.direction = 'inbound' ORDER BY email.created_at DESC LIMIT 1),
                     (SELECT contact.normalized_value FROM crm_contact_points contact WHERE contact.workspace_id = message.workspace_id AND contact.party_id = conversation.party_id AND contact.type = 'email' AND contact.status = 'active'
                       ORDER BY contact.is_primary DESC, contact.is_verified DESC, contact.created_at LIMIT 1)) AS "to",
            parent.subject AS "lastSubject", parent.internet_message_id AS "parentId", parent.reference_ids AS "parentReferences",
            attachment.object_key AS "attachmentKey", attachment.file_name AS "attachmentName", attachment.content_type AS "attachmentType", attachment.byte_size AS "attachmentBytes"
       FROM crm_messages message
       JOIN crm_conversations conversation ON conversation.workspace_id = message.workspace_id AND conversation.id = message.conversation_id
       LEFT JOIN LATERAL (SELECT email.subject, email.internet_message_id, email.reference_ids FROM crm_email_messages email
                           WHERE email.workspace_id = message.workspace_id AND email.conversation_id = message.conversation_id AND email.message_id <> message.id
                           ORDER BY (email.direction = 'inbound') DESC, email.created_at DESC LIMIT 1) parent ON true
       LEFT JOIN crm_message_attachments attachment ON attachment.workspace_id = message.workspace_id AND attachment.message_id = message.id AND attachment.status = 'stored' AND attachment.position = 0
      WHERE message.workspace_id = $1 AND message.id = $2 AND message.direction = 'outbound'`, [workspaceId, messageId])).rows[0] ?? null;
}

/**
 * Claim the due chat email replies, send each through the platform mailer with Reply-To on the inbound address and
 * the threading headers, then record the outcome on the notification, its delivery attempts and the chat message.
 * One bad reply never holds up the rest. A throttled or transiently failed reply stays scheduled for its retry (the
 * chat message keeps waiting); one the send limit can't fit before `notAfter` goes back with the rest, untried.
 */
export async function dispatchChatEmails(deps: ChatEmailDeps, workspaceId: string, limit = 50, options: EmailSendOptions = {}) {
  const domain = inboundDomain(deps.inboundDomain);
  const claimed = await deps.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => (await client.query<Claimed>(
    `WITH due AS (
       SELECT notification.id FROM notifications notification
        WHERE notification.workspace_id = $1 AND ${CHAT_EMAIL_SQL}
          AND ((notification.status IN ('pending', 'scheduled') AND notification.scheduled_for <= now())
            OR (notification.status = 'processing' AND notification.processing_started_at < now() - interval '5 minutes'))
        ORDER BY notification.scheduled_for FOR UPDATE OF notification SKIP LOCKED LIMIT $2)
     UPDATE notifications notification SET status = 'processing', processing_started_at = now(), version = version + 1
       FROM due WHERE notification.id = due.id
     RETURNING notification.id, substring(notification.idempotency_key FROM 9) AS "messageId", ${CLAIMED_EMAIL_COLUMNS}`, [workspaceId, Math.min(Math.max(limit, 1), 100)])).rows);
  let delivered = 0;
  let deferred = false;
  for (const [index, row] of claimed.entries()) {
    const expired = expiredRetry(row);
    if (expired) {
      await deps.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
        await recordEmailDisposition(client, { workspaceId, notificationId: row.id, disposition: expired, provider: deps.mailer?.provider() ?? null, messageId: null, attempted: true });
        await deps.receipts.record(client, row.messageId, { workspaceId, status: "failed", failureCode: "EMAIL_RETRY_EXPIRED" }, { ignoreMissing: true, ignoreNonOutbound: true });
      });
      continue;
    }
    const reply = await deps.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => load(client, workspaceId, row.messageId));
    const ownId = domain ? replyMessageId(row.messageId, domain) : null;
    const headers = ownId ? threadHeaders(ownId, { id: reply?.parentId ?? null, references: reply?.parentReferences ?? null }) : null;
    // A reply is "Re: " the client's subject; the first email of a conversation we started carries its own subject.
    const subject = reply?.parentId ? replySubject(reply.lastSubject ?? reply.subject, "Message") : baseSubject(reply?.subject) || "Message";
    let outcome: EmailDeliveryResult & { reason?: string };
    if (!reply || !reply.to) outcome = { status: "failed", provider: null, messageId: null, errorCode: "EMAIL_DESTINATION_MISSING" };
    else if (!domain || !reply.localPart || !deps.mailer || !headers) outcome = { status: "not_configured", provider: null, messageId: null };
    else {
      let attachments: EmailAttachment[] | undefined;
      try {
        if (reply.attachmentKey) {
          if (Number(reply.attachmentBytes ?? 0) > MAX_EMAIL_FILE_BYTES || !deps.storage) throw new Error("EMAIL_FILE_UNAVAILABLE");
          const stored = await deps.storage.read(reply.attachmentKey);
          attachments = [{ filename: reply.attachmentName ?? "file", contentType: reply.attachmentType ?? "application/octet-stream", content: stored.body }];
        }
        outcome = await deps.mailer.sendConversationReply({ workspaceId, to: reply.to, subject, body: reply.bodyText ?? "", replyTo: `${reply.localPart}@${domain}`, headers, attachments }, options);
      } catch (error) {
        outcome = { status: "failed", provider: null, messageId: null, errorCode: error instanceof Error && error.message === "EMAIL_FILE_UNAVAILABLE" ? "EMAIL_FILE_UNAVAILABLE" : "MAILER_ERROR" };
      }
    }
    const disposition = emailDisposition(outcome, row);
    if (disposition.kind === "deferred") {
      // Out of time or slots: this reply and the rest go back to the queue, untried.
      deferred = true;
      await deps.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
        releaseClaimedEmails(client, workspaceId, claimed.slice(index).map((item) => item.id), disposition.until));
      break;
    }
    const status = disposition.kind === "delivered" ? "delivered" : disposition.kind === "suppressed" ? "suppressed" : disposition.kind === "retry" ? "retry" : "failed";
    if (status === "delivered") delivered += 1;
    await deps.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      await recordEmailDisposition(client, { workspaceId, notificationId: row.id, disposition, provider: outcome.provider, messageId: outcome.messageId, attempted: outcome.status !== "not_configured" });
      // A reply waiting for its retry stays queued in the chat; only its final outcome is recorded there.
      if (status === "retry") return;
      if (status === "delivered" && reply && ownId) {
        // The reply's email facts: the client's answer names this Message-Id (or the provider's) and threads back here.
        await client.query(
          `INSERT INTO crm_email_messages (workspace_id, message_id, conversation_id, direction, internet_message_id, provider_message_id, in_reply_to, reference_ids,
             from_address, to_addresses, subject, subject_key, sent_at)
           VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, ARRAY[$9::text], $10, $11, now()) ON CONFLICT DO NOTHING`,
          [workspaceId, row.messageId, reply.conversationId, ownId, outcome.messageId && outcome.messageId !== ownId ? outcome.messageId.slice(0, 998) : null,
            headers?.["In-Reply-To"] ?? null, headers?.References ? headers.References.split(" ") : [], `${reply.localPart}@${domain}`, reply.to, subject, subjectKey(subject)]);
      }
      await deps.receipts.record(client, row.messageId, {
        workspaceId, status: status === "delivered" ? "sent" : "failed",
        ...(outcome.messageId ? { providerMessageId: outcome.messageId.slice(0, 500) } : {}),
        ...(status !== "delivered" ? { failureCode: (outcome.errorCode ?? (status === "suppressed" ? "email_not_configured" : "EMAIL_SEND_FAILED")).slice(0, 120) } : {}),
      }, { ignoreMissing: true, ignoreNonOutbound: true });
    });
  }
  return { claimed: claimed.length, delivered, ...(deferred ? { deferred: true } : {}) };
}
