import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, PayloadTooLargeException, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../../workspaces/reference-upload";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { ATTACHMENT_MAX_BYTES, fetchRetryDelayMinutes, safeFileName, sendableProblem, servedAs, sniffSendable } from "./inbox/attachment-rules";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Row = Record<string, unknown>;

export type ChatAttachment = { id: string; kind: string; mimeType: string | null; fileName: string | null; byteSize: number | null; status: string; failureCode: string | null };
const present = (row: Row): ChatAttachment => ({
  id: String(row.id), kind: String(row.kind), mimeType: (row.content_type as string | null) ?? null, fileName: (row.file_name as string | null) ?? null,
  byteSize: row.byte_size == null ? null : Number(row.byte_size), status: String(row.status), failureCode: (row.failure_code as string | null) ?? null,
});
const storageKey = (workspaceId: string, conversationId: string, attachmentId: string, digest: string) => ["crm-inbox", workspaceId, conversationId, attachmentId, digest].join("/");

/**
 * Files in team inbox chats, kept privately in the workspace's object storage (the brand-asset storage, with its
 * quota and safety scan). Our files are uploaded before they are sent; a client's files are fetched from the
 * provider by the worker, retried when the provider fails, and marked unavailable when they can't be had.
 * Reading a file never writes anything, so it works the same while someone views as a colleague.
 */
@Injectable()
export class CrmAttachmentsService {
  private readonly logger = new Logger(CrmAttachmentsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly storage: BrandAssetStorageService,
  ) {}

  /** A file for a reply, checked against WhatsApp's types and sizes by its bytes; the same id and file again is a no-op. */
  async upload(actor: RequestActor, workspaceId: string, conversationId: string, attachmentId: string, file?: ReferenceUpload) {
    if (!file?.buffer?.length) throw new BadRequestException("Choose a file to attach.");
    if (file.buffer.length > ATTACHMENT_MAX_BYTES) throw new PayloadTooLargeException("Files can be up to 20 MB.");
    const fileName = safeFileName(file.originalname);
    const sniffed = sniffSendable(file.buffer, fileName);
    if (!sniffed) throw new UnprocessableEntityException("WhatsApp can't send this type of file. Send a JPEG or PNG photo, an MP4 video, an audio file, a PDF or an Office document.");
    const problem = sendableProblem(sniffed.kind, file.buffer.length);
    if (problem) throw new PayloadTooLargeException(problem);
    const digest = createHash("sha256").update(file.buffer).digest("hex");
    return this.access.withPermission(actor, workspaceId, "crm.communications.send", async (client, user) => {
      const chat = await client.query<{ status: string }>(`SELECT status FROM crm_conversations WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId]);
      if (!chat.rowCount) throw new NotFoundException("Conversation not found");
      if (chat.rows[0].status === "closed") throw new ConflictException("Reopen this conversation before replying");
      const existing = (await client.query<Row>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2`, [workspaceId, attachmentId])).rows[0];
      if (existing) {
        if (existing.conversation_id !== conversationId || existing.checksum !== digest || existing.uploaded_by !== user.userId) throw new ConflictException("This upload id belongs to another file. Choose the file again.");
        return present(existing);
      }
      const key = storageKey(workspaceId, conversationId, attachmentId, digest);
      await this.storage.put(key, file.buffer, sniffed.mimeType);
      const inserted = await client.query<Row>(
        `INSERT INTO crm_message_attachments (id, workspace_id, conversation_id, direction, kind, content_type, file_name, byte_size, checksum, object_key, status, uploaded_by)
         VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, $9, 'stored', $10) RETURNING *`,
        [attachmentId, workspaceId, conversationId, sniffed.kind, sniffed.mimeType, fileName, file.buffer.length, digest, key, user.userId]);
      const attachment = present(inserted.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.message.attachment_uploaded.v1", entityType: "crm_conversation", entityId: conversationId, after: attachment });
      return attachment;
    });
  }

  /** A chat file's bytes for someone who can read the chat. Only reads: nothing is fetched or written here. */
  content(actor: RequestActor, workspaceId: string, conversationId: string, attachmentId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.communications.view", async (client) => {
      const row = (await client.query<Row>(
        `SELECT attachment.* FROM crm_message_attachments attachment
           LEFT JOIN crm_messages message ON message.workspace_id = attachment.workspace_id AND message.id = attachment.message_id
          WHERE attachment.workspace_id = $1 AND attachment.id = $2 AND attachment.conversation_id = $3 AND message.hidden_at IS NULL`,
        [workspaceId, attachmentId, conversationId])).rows[0];
      if (!row || row.status !== "stored" || !row.object_key) throw new NotFoundException("This file isn't available.");
      return this.readStored(row);
    });
  }

  /** The client's cases a chat file can be filed to (IN-18): their planning cases and the projects started from them. */
  saveTargets(actor: RequestActor, workspaceId: string, conversationId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.edit", async (client) => {
      const cases = await client.query<{ caseId: string; title: string; projectReference: string | null }>(
        `SELECT pre_case.id AS "caseId", coalesce(project.name, opportunity.title) AS title, project.reference AS "projectReference"
           FROM crm_conversations conversation
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = conversation.workspace_id AND opportunity.party_id = conversation.party_id
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = opportunity.workspace_id AND pre_case.opportunity_id = opportunity.id AND pre_case.status IN ('draft', 'active', 'on_hold', 'released')
           LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id
          WHERE conversation.workspace_id = $1 AND conversation.id = $2 ORDER BY pre_case.updated_at DESC LIMIT 20`, [workspaceId, conversationId]);
      return { items: cases.rows };
    });
  }

  /**
   * Save to project (IN-18): a client's photo or PDF from the chat becomes one of the case's files (the same place
   * uploads on the case and the started project read from), only for a case of the chat's own client. The client
   * id makes it idempotent: saving again returns the same file.
   */
  saveToCase(actor: RequestActor, workspaceId: string, conversationId: string, attachmentId: string, input: { caseId: string; fileId: string }) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.edit", async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, "crm.communications.view"))) throw new NotFoundException("This file isn't available.");
      const row = (await client.query<Row>(
        `SELECT attachment.* FROM crm_message_attachments attachment
           LEFT JOIN crm_messages message ON message.workspace_id = attachment.workspace_id AND message.id = attachment.message_id
          WHERE attachment.workspace_id = $1 AND attachment.id = $2 AND attachment.conversation_id = $3 AND message.hidden_at IS NULL`,
        [workspaceId, attachmentId, conversationId])).rows[0];
      if (!row || row.status !== "stored" || !row.object_key) throw new NotFoundException("This file isn't available.");
      const target = await client.query(
        `SELECT 1 FROM crm_conversations conversation
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = conversation.workspace_id AND opportunity.party_id = conversation.party_id
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = opportunity.workspace_id AND pre_case.opportunity_id = opportunity.id
          WHERE conversation.workspace_id = $1 AND conversation.id = $2 AND pre_case.id = $3`, [workspaceId, conversationId, input.caseId]);
      if (!target.rowCount) throw new UnprocessableEntityException("Choose one of this client's projects.");
      const stored = await this.storage.read(String(row.object_key)).catch(() => { throw new NotFoundException("This file isn't available."); });
      const body = Buffer.from(stored.body);
      const digest = createHash("sha256").update(body).digest("hex");
      const existing = await client.query(`SELECT id, sha256 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, input.caseId, input.fileId]);
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== digest) throw new ConflictException("This file id belongs to another file.");
        return { id: input.fileId, caseId: input.caseId, saved: true };
      }
      const prepared = await prepareReferenceUpload({ buffer: body, originalname: String(row.file_name ?? "Client file"), mimetype: String(row.content_type ?? "") } as ReferenceUpload, { allowVideo: true });
      const key = `pre-projects/${workspaceId}/${input.caseId}/${input.fileId}`;
      await this.storage.put(`${key}/original`, body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(
        `INSERT INTO pre_project_brief_assets (id, workspace_id, case_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.fileId, workspaceId, input.caseId, prepared.name, prepared.mimeType, body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, digest, user.userId]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.message.attachment_saved_to_case.v1", entityType: "crm_conversation", entityId: conversationId,
        after: { attachmentId, caseId: input.caseId, fileId: input.fileId, name: prepared.name } });
      return { id: input.fileId, caseId: input.caseId, saved: true };
    });
  }

  /** The worker's next client files to fetch; each is leased for ten minutes so two passes never fetch it twice. */
  claimFetchesInternal(workspaceId: string, limit = 20) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const claimed = await client.query<Row>(
        `UPDATE crm_message_attachments attachment SET attempts = attachment.attempts + 1, next_attempt_at = now() + interval '10 minutes',
                version = attachment.version + 1, updated_at = now()
          WHERE attachment.id IN (
            SELECT id FROM crm_message_attachments WHERE workspace_id = $1 AND status = 'pending' AND next_attempt_at <= now()
             ORDER BY next_attempt_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
          RETURNING attachment.id, attachment.provider_media_id AS "providerMediaId", attachment.connection_id AS "connectionId", attachment.kind,
                    attachment.content_type AS "mimeType", attachment.file_name AS "fileName", attachment.attempts`,
        [workspaceId, Math.min(Math.max(limit, 1), 50)]);
      return { items: claimed.rows };
    });
  }

  /** A client's file the worker fetched: kept in storage and shown in the chat. A second delivery of the same file is a no-op. */
  async storeFetchedInternal(workspaceId: string, attachmentId: string, file?: ReferenceUpload) {
    if (!file?.buffer?.length) throw new BadRequestException("The file is empty");
    const row = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) =>
      (await client.query<Row>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2`, [workspaceId, attachmentId])).rows[0]);
    if (!row) throw new NotFoundException("Attachment not found");
    if (row.status === "stored") return present(row);
    if (row.status !== "pending") throw new ConflictException("This file is no longer waiting to be fetched");
    if (file.buffer.length > ATTACHMENT_MAX_BYTES) return this.fail(workspaceId, attachmentId, "too_large", false);
    const digest = createHash("sha256").update(file.buffer).digest("hex");
    const mimeType = (row.content_type as string | null) || file.mimetype || "application/octet-stream";
    const key = storageKey(workspaceId, String(row.conversation_id), attachmentId, digest);
    try {
      await this.storage.put(key, file.buffer, servedAs(mimeType).contentType);
    } catch (error) {
      // The safety scan or the workspace's storage allowance refused it: the chat says it can't be shown.
      const code = error instanceof PayloadTooLargeException ? "storage_full" : error instanceof BadRequestException ? "blocked_by_safety_scan" : null;
      if (code) return this.fail(workspaceId, attachmentId, code, false);
      throw error;
    }
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const stored = await client.query<Row>(
        `UPDATE crm_message_attachments SET status = 'stored', object_key = $3, byte_size = $4, checksum = $5, content_type = $6,
                failure_code = NULL, next_attempt_at = NULL, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
        [workspaceId, attachmentId, key, file.buffer.length, digest, mimeType.slice(0, 160)]);
      if (!stored.rowCount) return present((await client.query<Row>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2`, [workspaceId, attachmentId])).rows[0]);
      const attachment = present(stored.rows[0]);
      await this.events.record(client, { workspaceId, actorUserId: null, source: "integration", action: "crm.message.attachment_stored.v1", entityType: "crm_message", entityId: String(stored.rows[0].message_id ?? attachmentId), after: attachment });
      return attachment;
    });
  }

  /** A fetch that failed: tried again later (1, 5, 15, 60 minutes) when the provider may recover, else unavailable. */
  failedFetchInternal(workspaceId: string, attachmentId: string, input: { code: string; retryable: boolean }) {
    return this.fail(workspaceId, attachmentId, input.code.slice(0, 120), input.retryable);
  }

  /** Our file's bytes, for the worker to upload to the provider when its message is sent. */
  outboundContentInternal(workspaceId: string, attachmentId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const row = (await client.query<Row>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2 AND direction = 'outbound'`, [workspaceId, attachmentId])).rows[0];
      if (!row || row.status !== "stored" || !row.object_key) throw new NotFoundException("This file isn't available.");
      return this.readStored(row);
    });
  }

  private fail(workspaceId: string, attachmentId: string, code: string, retryable: boolean) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client: PoolClient) => {
      const row = (await client.query<Row>(`SELECT * FROM crm_message_attachments WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, attachmentId])).rows[0];
      if (!row) throw new NotFoundException("Attachment not found");
      if (row.status !== "pending") return present(row);
      const delay = retryable ? fetchRetryDelayMinutes(Number(row.attempts)) : null;
      const updated = await client.query<Row>(
        delay
          ? `UPDATE crm_message_attachments SET failure_code = $3, next_attempt_at = now() + ($4::int * interval '1 minute'), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING *`
          : `UPDATE crm_message_attachments SET status = 'failed', failure_code = $3, next_attempt_at = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING *`,
        delay ? [workspaceId, attachmentId, code, delay] : [workspaceId, attachmentId, code]);
      const attachment = present(updated.rows[0]);
      if (!delay) {
        this.logger.warn(`Chat file ${attachmentId} could not be fetched: ${code}`);
        await this.events.record(client, { workspaceId, actorUserId: null, source: "integration", action: "crm.message.attachment_failed.v1", entityType: "crm_message", entityId: String(row.message_id ?? attachmentId), after: attachment });
      }
      return attachment;
    });
  }

  private async readStored(row: Row) {
    const stored = await this.storage.read(String(row.object_key)).catch(() => { throw new NotFoundException("This file isn't available."); });
    const served = servedAs(row.content_type as string | null);
    return { body: stored.body, contentType: served.contentType, inline: served.inline, name: safeFileName(row.file_name as string | null, `${String(row.kind)}`) };
  }
}
