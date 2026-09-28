import { BadRequestException, ConflictException, HttpException, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { prepareReferenceUpload, REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import type { Grant, PortalContact } from "./portal-auth";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const logger = new Logger("ClientPortalFiles");

/** What the portal needs of file storage: whether an object is there, and its bytes. */
export type FileStore = { head(key: string): Promise<unknown>; read(key: string): Promise<{ body: Buffer }>; put(key: string, body: Buffer, contentType: string): Promise<void> };

/**
 * Whether stored files are really there, remembered for a while, so the client is never shown a picture that
 * can't load (a photo whose file went missing is left out and logged once).
 */
export class FilePresence {
  private readonly seen = new Map<string, { ok: boolean; at: number }>();
  constructor(private readonly store: Pick<FileStore, "head"> | undefined, private readonly now = () => Date.now()) {}

  async has(key: string | null | undefined) {
    if (!key || !this.store) return false;
    const known = this.seen.get(key);
    // A file that is there stays there (10 minutes); a missing one is checked again after a minute.
    if (known && this.now() - known.at < (known.ok ? 600_000 : 60_000)) return known.ok;
    const ok = await this.store.head(key).then(() => true, () => false);
    if (!ok && (!known || known.ok)) logger.warn(`A file shared with a client is missing from storage: ${key}`);
    if (this.seen.size > 5000) this.seen.clear();
    this.seen.set(key, { ok, at: this.now() });
    return ok;
  }

  /** The files (by id) whose preview or original is there, keeping their order. */
  async present<T extends { objectKey: string; previewKey: string | null }>(files: T[]) {
    const kept: T[] = [];
    for (const file of files) if ((await this.has(file.previewKey)) || (await this.has(file.objectKey))) kept.push(file);
    return kept;
  }
}

/** Always "there": for reads where no storage is wired (a staff preview without files). */
export const ASSUME_PRESENT = { present: async <T>(files: T[]) => files, has: async () => true } as unknown as FilePresence;

export type ClientFile = { id: string; name: string; mimeType: string; hasPreview: boolean };

/** The contact's id for what's theirs (reactions, what they read); the team's preview reads as nobody (null). */
export function contactId(grant: Pick<Grant, "id">) {
  return UUID.test(grant.id) ? grant.id : null;
}

/** Up to ten uploads the client made on this project (by this household), not yet attached to anything. */
export async function ownUploads(db: Db, workspaceId: string, contact: PortalContact, caseId: string, value: unknown, max = 10) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || !value.every((id) => typeof id === "string" && UUID.test(id)))
    throw new BadRequestException(`Attach up to ${max} photos or PDFs.`);
  const ids = [...new Set(value as string[])];
  if (!ids.length) return [];
  const grants = contact.grants.filter((grant) => grant.caseId === caseId).map((grant) => grant.id);
  const rows = (await db.query<ClientFile & { attached: boolean }>(
    `SELECT asset.id, asset.original_name AS name, asset.mime_type AS "mimeType", asset.preview_key IS NOT NULL AS "hasPreview",
            EXISTS (SELECT 1 FROM client_portal_attachments attachment WHERE attachment.workspace_id = asset.workspace_id AND attachment.asset_id = asset.id)
              OR EXISTS (SELECT 1 FROM pre_project_entry_assets link WHERE link.workspace_id = asset.workspace_id AND link.asset_id = asset.id) AS attached
       FROM pre_project_brief_assets asset
      WHERE asset.workspace_id = $1 AND asset.case_id = $2 AND asset.id = ANY($3::uuid[]) AND asset.client_grant_id = ANY($4::uuid[])`,
    [workspaceId, caseId, ids, grants])).rows;
  if (rows.length !== ids.length) throw new BadRequestException("One of your files isn't there any more. Add it again.");
  if (rows.some((row) => row.attached)) throw new ConflictException("One of your files was already sent. Add it again to send it here too.");
  return ids.map((id) => rows.find((row) => row.id === id)!).map(({ attached: _attached, ...file }) => file);
}

/** Attaches the client's uploads to what they sent (a message, a decision, a payment report, a claim or an issue). */
export async function attach(db: Db, workspaceId: string, input: { caseId: string; grantId: string; kind: "message" | "decision" | "payment" | "warranty_claim" | "issue";
  targetId: string; files: ClientFile[] }) {
  for (const file of input.files)
    await db.query(`INSERT INTO client_portal_attachments (workspace_id, case_id, asset_id, target_kind, target_id, grant_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [workspaceId, input.caseId, file.id, input.kind, input.targetId, input.grantId]);
}

/** The files attached to things on a case, by "kind:target". */
export async function readAttachments(db: Db, workspaceId: string, caseId: string, kinds: string[]) {
  const rows = (await db.query<ClientFile & { key: string }>(
    `SELECT attachment.target_kind || ':' || attachment.target_id AS key, asset.id, asset.original_name AS name, asset.mime_type AS "mimeType",
            asset.preview_key IS NOT NULL AS "hasPreview"
       FROM client_portal_attachments attachment
       JOIN pre_project_brief_assets asset ON asset.workspace_id = attachment.workspace_id AND asset.id = attachment.asset_id
      WHERE attachment.workspace_id = $1 AND attachment.case_id = $2 AND attachment.target_kind = ANY($3::text[]) ORDER BY attachment.created_at, asset.id`,
    [workspaceId, caseId, kinds])).rows;
  const map = new Map<string, ClientFile[]>();
  for (const { key, ...file } of rows) map.set(key, [...(map.get(key) ?? []), file]);
  return map;
}

/** At most this many uploads per client number an hour (a stuck phone retrying can't fill the tenant's storage). */
const UPLOADS_PER_HOUR = 60;

/**
 * A photo or PDF the client adds (an inspiration, proof of payment, a photo of a problem). Checked by content,
 * stored as the case's file under the client's contact, with a preview for images. The id comes from the client,
 * so a retry of the same file returns it; another file under the same id is refused.
 */
export async function uploadClientFile(db: Db, store: FileStore | undefined, workspaceId: string, grant: Grant, id: string, file: ReferenceUpload | undefined) {
  if (!UUID.test(id)) throw new BadRequestException("Try that again.");
  if (!store) throw new HttpException({ message: "Files can't be added right now. Try again later." }, 503);
  if (!file?.buffer?.length || file.buffer.length > REFERENCE_MAX_BYTES) throw new BadRequestException("Choose a photo or PDF up to 20 MB.");
  const digest = createHash("sha256").update(file.buffer).digest("hex");
  const existing = (await db.query<ClientFile & { sha256: string; grantId: string | null; caseId: string }>(
    `SELECT id, original_name AS name, mime_type AS "mimeType", preview_key IS NOT NULL AS "hasPreview", sha256, client_grant_id AS "grantId", case_id AS "caseId"
       FROM pre_project_brief_assets WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  if (existing) {
    if (existing.sha256 !== digest || existing.grantId !== grant.id) throw new ConflictException("This file was already added. Choose it again.");
    const { sha256: _sha, grantId: _grant, caseId: _case, ...found } = existing;
    return found;
  }
  const recent = (await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pre_project_brief_assets asset JOIN client_portal_grants grant_row ON grant_row.workspace_id = asset.workspace_id AND grant_row.id = asset.client_grant_id
      WHERE asset.workspace_id = $1 AND grant_row.phone = (SELECT phone FROM client_portal_grants WHERE workspace_id = $1 AND id = $2) AND asset.created_at > now() - interval '1 hour'`,
    [workspaceId, grant.id])).rows[0].count;
  if (recent >= UPLOADS_PER_HOUR) throw new HttpException({ message: "That's a lot of files for now. Try again in an hour.", retryAfter: 3600 }, 429);
  const prepared = await prepareReferenceUpload(file).catch((error: unknown) => {
    if (error instanceof BadRequestException) throw new BadRequestException("Choose a photo (JPEG, PNG, WebP or HEIC) or a PDF up to 20 MB.");
    throw error;
  });
  const key = `pre-projects/${workspaceId}/${grant.caseId}/${id}`;
  await store.put(`${key}/original`, file.buffer, prepared.mimeType);
  if (prepared.preview) await store.put(`${key}/preview.webp`, prepared.preview, "image/webp");
  await db.query(
    `INSERT INTO pre_project_brief_assets (id, workspace_id, case_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by, client_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)`,
    [id, workspaceId, grant.caseId, prepared.name, prepared.mimeType, file.buffer.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, digest, grant.id]);
  return { id, name: prepared.name, mimeType: prepared.mimeType, hasPreview: Boolean(prepared.preview) };
}

/**
 * Where a file the client may open lives and which portal sections show it: their own uploads (and those of the
 * people on their project), and the photos of moodboard pins the team shared with them.
 */
export async function locateClientAsset(db: Db, workspaceId: string, id: string) {
  const row = (await db.query<{ caseId: string; objectKey: string; previewKey: string | null; mimeType: string; name: string; client: boolean; pinShared: boolean }>(
    `SELECT asset.case_id AS "caseId", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", asset.mime_type AS "mimeType", asset.original_name AS name,
            asset.client_grant_id IS NOT NULL AS client,
            EXISTS (SELECT 1 FROM pre_project_entry_assets link
                      JOIN pre_project_brief_entries entry ON entry.workspace_id = link.workspace_id AND entry.case_id = link.case_id AND entry.id = link.entry_id
                       AND entry.kind = 'inspiration' AND entry.archived_at IS NULL
                      JOIN pre_project_moodboard_shares share ON share.workspace_id = entry.workspace_id AND share.entry_id = entry.id
                     WHERE link.workspace_id = asset.workspace_id AND link.asset_id = asset.id) AS "pinShared"
       FROM pre_project_brief_assets asset WHERE asset.workspace_id = $1 AND asset.id = $2`, [workspaceId, id])).rows[0];
  if (!row || (!row.client && !row.pinShared)) return null;
  // A client's own file is theirs wherever they sent it; a team photo only through the moodboard.
  const sections = row.client ? (["moodboard", "decisions", "payments", "warranty", "messages", "progress"] as const) : (["moodboard"] as const);
  return { caseId: row.caseId, objectKey: row.objectKey, previewKey: row.previewKey, mimeType: row.mimeType, name: row.name, sections: [...sections] };
}

/** The bytes of a stored file: the preview when asked for and there, else the original; missing is "not found", logged. */
export async function readStored(store: Pick<FileStore, "read"> | undefined, file: { objectKey: string; previewKey: string | null; mimeType: string; name: string }, preview: boolean) {
  if (!store) throw new NotFoundException("File not found.");
  if (preview && file.previewKey) {
    const stored = await store.read(file.previewKey).catch(() => null);
    if (stored) return { body: stored.body, mimeType: "image/webp", name: file.name };
  }
  const original = await store.read(file.objectKey).catch(() => null);
  if (!original) {
    logger.warn(`A file shared with a client is missing from storage: ${file.objectKey}`);
    throw new NotFoundException("This file isn't available right now. Ask your project team.");
  }
  return { body: original.body, mimeType: file.mimeType, name: file.name };
}
