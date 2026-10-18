import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P0, every verification shows its attachments: the decisions a person records for someone else (or checks
 * against something outside the system) and the module kept only words for. Each names who may add a file and who
 * may open one, from the module's own permissions; the module's command still decides who may record the decision.
 */
export const EVIDENCE_KINDS = {
  receipt: { add: ["pre_projects.edit", "commercial.finance.verify"], open: ["pre_projects.view", "commercial.finance.verify", "receivables.view"] },
  client_credit: { add: ["pre_projects.edit", "commercial.finance.verify"], open: ["pre_projects.view", "commercial.finance.verify", "receivables.view"] },
  proposal_withdrawal: { add: ["crm.opportunities.manage"], open: ["crm.opportunities.view", "crm.opportunities.manage"] },
  design_decision: { add: ["pre_projects.edit"], open: ["pre_projects.view"] },
  handover_acceptance: { add: ["projects.view", "projects.manage"], open: ["projects.view", "projects.manage"] },
  material_decision: { add: ["projects.view", "projects.manage"], open: ["projects.view", "projects.manage"] },
  factory_output: { add: ["factory.report", "factory.manage"], open: ["factory.view", "factory.approve", "factory.manage"] },
  stock_correction: { add: ["stock.adjust", "stock.manage"], open: ["stock.view", "stock.adjust", "stock.manage"] },
  supplier_bank: { add: ["vendors.manage", "purchasing.manage"], open: ["vendors.view", "vendors.approve", "vendors.manage"] },
  warranty_claim: { add: ["projects.view", "projects.manage"], open: ["projects.view", "projects.manage"] },
} as const satisfies Record<string, { add: readonly string[]; open: readonly string[] }>;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;
export const isEvidenceKind = (value: unknown): value is EvidenceKind => typeof value === "string" && Object.hasOwn(EVIDENCE_KINDS, value);

/** At most this many files behind one decision. */
export const EVIDENCE_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Where the files are kept (the workspace's file storage). */
export type EvidenceStorage = { put(objectKey: string, body: Buffer, contentType: string): Promise<void> };

export type EvidenceFile = { id: string; name: string; mimeType: string; hasPreview: boolean; uploadedAt: string };

/** A photo or PDF, checked by its content (never its name), kept unbound until the decision it belongs to is recorded. */
export async function addEvidence(db: Db, storage: EvidenceStorage | undefined, workspaceId: string, userId: string, kind: EvidenceKind, file: ReferenceUpload | undefined) {
  const prepared = await prepareReferenceUpload(file);
  if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new UnprocessableEntityException("Add a photo or a PDF.");
  if (!storage) throw new ConflictException("Files can't be stored here yet.");
  const key = ["decision-evidence", workspaceId, kind, prepared.digest].join("/");
  await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
  if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
  const row = (await db.query<{ id: string; uploadedAt: Date }>(
    `INSERT INTO decision_evidence_files (workspace_id, kind, storage_key, file_name, mime_type, byte_size, sha256, has_preview, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, uploaded_at AS "uploadedAt"`,
    [workspaceId, kind, key, prepared.name, prepared.mimeType, prepared.body.length, prepared.digest, Boolean(prepared.preview), userId])).rows[0];
  return { id: row.id, name: prepared.name, mimeType: prepared.mimeType, hasPreview: Boolean(prepared.preview), uploadedAt: row.uploadedAt.toISOString() } satisfies EvidenceFile;
}

/** The file ids a command was sent, checked for shape (the binding checks they are this person's). */
export function evidenceIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > EVIDENCE_LIMIT || value.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Attach up to 10 photos or PDFs.");
  return [...new Set(value as string[])];
}

/**
 * Ties the files a person uploaded to the record their decision is about, in the decision's transaction. Replay-safe:
 * a file already on this record stays; a file on another record, of another kind or someone else's is refused.
 */
export async function bindEvidence(db: Db, workspaceId: string, userId: string, kind: EvidenceKind, subjectId: string, ids: string[]) {
  if (!ids.length) return 0;
  const rows = (await db.query<{ id: string; subjectId: string | null; uploadedBy: string }>(
    `SELECT id, subject_id AS "subjectId", uploaded_by AS "uploadedBy" FROM decision_evidence_files WHERE workspace_id = $1 AND kind = $2 AND id = ANY($3::uuid[]) FOR UPDATE`,
    [workspaceId, kind, ids])).rows;
  if (rows.length !== ids.length || rows.some((row) => (row.subjectId !== null && row.subjectId !== subjectId) || (row.subjectId === null && row.uploadedBy !== userId)))
    throw new ConflictException("A file couldn't be attached; add it again.");
  await db.query(`UPDATE decision_evidence_files SET subject_id = $4, bound_at = coalesce(bound_at, now()) WHERE workspace_id = $1 AND kind = $2 AND id = ANY($3::uuid[])`,
    [workspaceId, kind, ids, subjectId]);
  return ids.length;
}

/** The files behind each record of one kind, oldest first. */
export async function evidenceFor(db: Db, workspaceId: string, kind: EvidenceKind, subjectIds: string[]) {
  const map = new Map<string, EvidenceFile[]>();
  if (!subjectIds.length) return map;
  const rows = (await db.query<EvidenceFile & { subjectId: string; uploadedAt: Date }>(
    `SELECT id, subject_id AS "subjectId", file_name AS name, mime_type AS "mimeType", has_preview AS "hasPreview", uploaded_at AS "uploadedAt"
       FROM decision_evidence_files WHERE workspace_id = $1 AND kind = $2 AND subject_id = ANY($3::text[]) ORDER BY uploaded_at, id`, [workspaceId, kind, subjectIds])).rows;
  for (const { subjectId, uploadedAt, ...file } of rows) map.set(subjectId, [...(map.get(subjectId) ?? []), { ...file, uploadedAt: new Date(uploadedAt).toISOString() }]);
  return map;
}

/** One file's row (its kind decides who may open it); an unbound file opens only for the person who added it. */
export async function evidenceRow(db: Db, workspaceId: string, id: string) {
  if (!UUID.test(id)) throw new NotFoundException("File not found.");
  const row = (await db.query<{ kind: EvidenceKind; subjectId: string | null; uploadedBy: string; key: string; name: string; mimeType: string; hasPreview: boolean }>(
    `SELECT kind, subject_id AS "subjectId", uploaded_by AS "uploadedBy", storage_key AS key, file_name AS name, mime_type AS "mimeType", has_preview AS "hasPreview"
       FROM decision_evidence_files WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  if (!row) throw new NotFoundException("File not found.");
  return row;
}
