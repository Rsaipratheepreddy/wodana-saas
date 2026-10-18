import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currentTemplate, quotationPageData } from "./proposal-data";
import { acceptFile, readBytes, type ObjectStore, type UploadedFile } from "./proposal-files";
import { readPortalSettings } from "../client-portal/portal-settings";
import { browserPrinter, printQuotation, type QuotationPrinter } from "./portal-print";
import { composeProposal, composeProposalWithPrinted, sha256, templatePageCount, type QuotationPage, type TemplatePage } from "./proposal-pdf";
import { documentFileName } from "../documents/pdf-layout";

type Db = PoolClient;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";
/** PLM-085: only whoever manages the firm's settings changes the proposal template. */
const MANAGE = ["workspace.settings.manage", "finance.settings.manage"];
const SLOTS = [1, 2, 3, 5] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DocumentVersion = { number: number; purpose: "upload" | "issued" | "signed"; fileName: string; mimeType: string; byteSize: number; sha256: string; note: string; createdAt: string; createdByName: string | null };
export type DocumentCard = {
  id: string; kind: "proposal" | "external_quotation"; title: string; reference: string | null; amount: string | null; currency: string | null; quoteId: string | null;
  currentVersion: number; version: number; createdAt: string; versions: DocumentVersion[];
  signing: Array<{ id: string; status: "pending" | "signed" | "revoked"; state: string; signerName: string; documentVersion: number; expiresAt: string; signedAt: string | null; signedDocumentVersion: number | null; version: number }>;
};

/** The template pages' bytes, in slot order, for composing a proposal. */
export async function templatePages(db: Db, store: ObjectStore, workspaceId: string) {
  const template = await currentTemplate(db, workspaceId);
  const pages: TemplatePage[] = [];
  for (const page of template.pages) pages.push({ slot: page.slot, mimeType: page.mimeType, bytes: await readBytes(store, page.objectKey) });
  return { version: template.version, pages };
}

/** Adds an immutable version to a document card and makes it current. */
export async function addDocumentVersion(db: Db, store: ObjectStore, input: {
  workspaceId: string; caseId: string; documentId: string; purpose: DocumentVersion["purpose"]; bytes: Buffer; fileName: string; mimeType: string;
  quoteHash?: string | null; templateVersion?: number | null; note?: string; actorUserId: string | null;
}) {
  const current = (await db.query<{ currentVersion: number }>(`SELECT current_version AS "currentVersion" FROM quote_documents WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [input.workspaceId, input.documentId])).rows[0];
  if (!current) throw new NotFoundException("Document not found.");
  const number = current.currentVersion + 1;
  const digest = sha256(input.bytes);
  const objectKey = `quotation-documents/${input.workspaceId}/${input.caseId}/${input.documentId}/${number}-${digest.slice(0, 12)}`;
  await store.put(objectKey, input.bytes, input.mimeType);
  await db.query(
    `INSERT INTO quote_document_versions (workspace_id, document_id, number, purpose, object_key, file_name, mime_type, byte_size, sha256, quote_hash, template_version, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [input.workspaceId, input.documentId, number, input.purpose, objectKey, input.fileName, input.mimeType, input.bytes.length, digest, input.quoteHash ?? null,
      input.templateVersion ?? null, (input.note ?? "").slice(0, 1000), input.actorUserId]);
  await db.query(`UPDATE quote_documents SET current_version = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, input.documentId, number]);
  return { number, sha256: digest, objectKey };
}

/**
 * The proposal PDF of a sent quote as an immutable document version: the template's pages around the quotation
 * page, composed once per quote revision and template version (asking again returns the same version).
 */
/**
 * The proposal's bytes: the quotation pages printed from the client's portal page when the server prints proposals
 * that way (portal-print.ts), else drawn by the built-in composer; the firm's own pages around them either way.
 */
export async function proposalBytes(db: Db, input: { workspaceId: string; caseId: string; quoteId: string; quoteHash: string | null }, template: TemplatePage[], data: QuotationPage,
  printer: QuotationPrinter | null = browserPrinter()) {
  const printed = printer ? await printQuotation(printer, { ...input, slug: (await readPortalSettings(db, input.workspaceId)).slug }) : null;
  return Buffer.from(printed ? await composeProposalWithPrinted(template, data, printed) : await composeProposal(template, data));
}

export async function issueProposalVersion(db: Db, store: ObjectStore, input: { workspaceId: string; caseId: string; quoteId: string; actorUserId: string },
  printer: QuotationPrinter | null = browserPrinter()) {
  const quote = (await db.query<{ status: string; title: string; hash: string | null; total: string; currency: string }>(
    `SELECT status, title, hash, total::text AS total, currency FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
    [input.workspaceId, input.caseId, input.quoteId])).rows[0];
  if (!quote) throw new NotFoundException("Quote not found.");
  if (quote.status !== "issued") throw new ConflictException("Send the quotation to the client first; the proposal is made from the sent quotation.");
  const data = await quotationPageData(db, input.workspaceId, input.caseId, input.quoteId, store);
  const template = await templatePages(db, store, input.workspaceId);
  let document = (await db.query<{ id: string }>(`SELECT id FROM quote_documents WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND kind = 'proposal' FOR UPDATE`,
    [input.workspaceId, input.caseId, input.quoteId])).rows[0];
  if (!document) {
    document = { id: randomUUID() };
    await db.query(
      `INSERT INTO quote_documents (workspace_id, id, case_id, quote_id, kind, title, reference, amount, currency, created_by) VALUES ($1, $2, $3, $4, 'proposal', $5, $6, $7, $8, $9)`,
      [input.workspaceId, document.id, input.caseId, input.quoteId, quote.title.slice(0, 240), data.reference, quote.total, quote.currency, input.actorUserId]);
  }
  const latest = (await db.query<{ number: number; sha256: string; objectKey: string }>(
    `SELECT number, sha256, object_key AS "objectKey" FROM quote_document_versions
      WHERE workspace_id = $1 AND document_id = $2 AND purpose = 'issued' AND quote_hash IS NOT DISTINCT FROM $3 AND template_version = $4 ORDER BY number DESC LIMIT 1`,
    [input.workspaceId, document.id, quote.hash, template.version])).rows[0];
  if (latest) return { documentId: document.id, number: latest.number, sha256: latest.sha256, reference: data.reference, title: quote.title, reused: true };
  const bytes = await proposalBytes(db, { workspaceId: input.workspaceId, caseId: input.caseId, quoteId: input.quoteId, quoteHash: quote.hash }, template.pages, data, printer);
  const version = await addDocumentVersion(db, store, { workspaceId: input.workspaceId, caseId: input.caseId, documentId: document.id, purpose: "issued", bytes,
    fileName: documentFileName(data.reference, data.client.name || quote.title), mimeType: "application/pdf", quoteHash: quote.hash, templateVersion: template.version, actorUserId: input.actorUserId });
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.proposal_pdf_issued.v1", entityType: "pre_project_case", entityId: input.caseId,
    after: { quoteId: input.quoteId, documentId: document.id, version: version.number, sha256: version.sha256, templateVersion: template.version, reference: data.reference } });
  return { documentId: document.id, number: version.number, sha256: version.sha256, reference: data.reference, title: quote.title, reused: false };
}

export async function documentCards(db: Db, workspaceId: string, caseId: string): Promise<DocumentCard[]> {
  const documents = (await db.query<Omit<DocumentCard, "versions" | "signing">>(
    `SELECT id, kind, title, reference, amount::text AS amount, currency, quote_id AS "quoteId", current_version AS "currentVersion", version, created_at AS "createdAt"
       FROM quote_documents WHERE workspace_id = $1 AND case_id = $2 ORDER BY created_at DESC`, [workspaceId, caseId])).rows;
  if (!documents.length) return [];
  const versions = (await db.query<DocumentVersion & { documentId: string }>(
    `SELECT version.document_id AS "documentId", version.number, version.purpose, version.file_name AS "fileName", version.mime_type AS "mimeType", version.byte_size AS "byteSize",
            version.sha256, version.note, version.created_at AS "createdAt", author.display_name AS "createdByName"
       FROM quote_document_versions version LEFT JOIN users author ON author.id = version.created_by
      WHERE version.workspace_id = $1 AND version.document_id = ANY($2::uuid[]) ORDER BY version.number DESC`, [workspaceId, documents.map((item) => item.id)])).rows;
  const signing = (await db.query<DocumentCard["signing"][number] & { documentId: string }>(
    `SELECT id, document_id AS "documentId", status, signer_name AS "signerName", document_version AS "documentVersion", expires_at AS "expiresAt", signed_at AS "signedAt",
            signed_document_version AS "signedDocumentVersion", version,
            CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' WHEN status = 'pending' THEN 'open' ELSE status END AS state
       FROM esign_requests WHERE workspace_id = $1 AND case_id = $2 ORDER BY created_at DESC`, [workspaceId, caseId])).rows;
  return documents.map((item) => ({
    ...item,
    versions: versions.filter((version) => version.documentId === item.id).map(({ documentId: _id, ...version }) => version),
    signing: signing.filter((request) => request.documentId === item.id).map(({ documentId: _id, ...request }) => request),
  }));
}

/**
 * The firm's five-page proposal (PLM-085) and the quotation documents of a case: proposal PDFs with their
 * signed copies, and quotations made outside Wodana that keep their own number (each a card with its history).
 */
@Injectable()
export class ProposalDocumentsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly storage: BrandAssetStorageService) {}

  template(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const template = await currentTemplate(client, workspaceId);
      return { version: template.version, pages: template.pages.map(({ objectKey: _key, ...page }) => page), canManage: await this.manager(client, workspaceId, user.userId) };
    });
  }

  /** Replaces one locked page (1, 2, 3 or 5). Every change is a new template version; sent proposals keep theirs. */
  async setTemplatePage(actor: RequestActor, workspaceId: string, slotValue: string, input: { version?: unknown }, file?: UploadedFile) {
    const slot = this.slot(slotValue);
    const upload = acceptFile(file, true);
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const current = await this.lockTemplate(client, workspaceId, input.version);
      let pageCount: number;
      try { pageCount = await templatePageCount(upload.mimeType, upload.buffer); } catch { throw new BadRequestException("This file can't be read as a page. Export it again as PDF, PNG or JPEG."); }
      if (pageCount > 20) throw new BadRequestException("Keep each part of the template to 20 pages or fewer.");
      const next = current + 1;
      const digest = sha256(upload.buffer);
      const objectKey = `quotation-templates/${workspaceId}/${next}/${slot}-${digest.slice(0, 16)}`;
      await this.storage.put(objectKey, upload.buffer, upload.mimeType);
      await this.copyPages(client, workspaceId, current, next, slot);
      await client.query(
        `INSERT INTO proposal_template_pages (workspace_id, template_version, slot, object_key, file_name, mime_type, byte_size, sha256, page_count, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [workspaceId, next, slot, objectKey, upload.name, upload.mimeType, upload.buffer.length, digest, pageCount, user.userId]);
      await this.saveVersion(client, workspaceId, next, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.proposal_template_page_set.v1", entityType: "workspace", entityId: workspaceId,
        after: { version: next, slot, fileName: upload.name, sha256: digest, pageCount } });
      const template = await currentTemplate(client, workspaceId);
      return { version: template.version, pages: template.pages.map(({ objectKey: _key, ...page }) => page), canManage: true };
    });
  }

  async removeTemplatePage(actor: RequestActor, workspaceId: string, slotValue: string, input: { version?: unknown }) {
    const slot = this.slot(slotValue);
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const current = await this.lockTemplate(client, workspaceId, input.version);
      const template = await currentTemplate(client, workspaceId);
      if (!template.pages.some((page) => page.slot === slot)) return { version: current, pages: template.pages.map(({ objectKey: _key, ...page }) => page), canManage: true };
      const next = current + 1;
      await this.copyPages(client, workspaceId, current, next, slot);
      await this.saveVersion(client, workspaceId, next, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.proposal_template_page_removed.v1", entityType: "workspace", entityId: workspaceId, after: { version: next, slot } });
      const after = await currentTemplate(client, workspaceId);
      return { version: after.version, pages: after.pages.map(({ objectKey: _key, ...page }) => page), canManage: true };
    });
  }

  async templatePageFile(actor: RequestActor, workspaceId: string, slotValue: string) {
    const slot = this.slot(slotValue);
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const page = (await currentTemplate(client, workspaceId)).pages.find((item) => item.slot === slot);
      if (!page) throw new NotFoundException("This page isn't in the template.");
      return { body: await readBytes(this.storage, page.objectKey), contentType: page.mimeType, name: page.fileName };
    });
  }

  /** The proposal as it would print now (pages 1–3, this quote, page 5), without keeping it. */
  preview(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const data = await quotationPageData(client, workspaceId, caseId, quoteId, this.storage);
      const template = await templatePages(client, this.storage, workspaceId);
      // Only a sent quotation is on the client's portal page; a draft's preview is drawn by the built-in composer.
      const quote = (await client.query<{ hash: string | null; status: string }>(`SELECT hash, status FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
        [workspaceId, caseId, quoteId])).rows[0];
      const printer = quote?.status === "issued" ? browserPrinter() : null;
      return { body: await proposalBytes(client, { workspaceId, caseId, quoteId, quoteHash: quote?.hash ?? null }, template.pages, data, printer), contentType: "application/pdf",
        name: documentFileName(data.reference, data.client.name || data.title) };
    });
  }

  /** Keeps the sent quotation's proposal as a document version (the copy a client signs). */
  issue(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      await issueProposalVersion(client, this.storage, { workspaceId, caseId, quoteId, actorUserId: user.userId });
      return { documents: await documentCards(client, workspaceId, caseId) };
    });
  }

  documents(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => ({
      documents: await documentCards(client, workspaceId, caseId),
      canEdit: await this.access.hasPermission(client, workspaceId, user.userId, EDIT),
    }));
  }

  /**
   * A quotation made outside Wodana: its PDF keeps the firm's own number (never one from the sequence) and becomes
   * a document card. The same id again is the same upload.
   */
  async uploadExternal(actor: RequestActor, workspaceId: string, caseId: string, fields: Record<string, unknown>, file?: UploadedFile) {
    const upload = acceptFile(file, false);
    const id = typeof fields.id === "string" && UUID.test(fields.id) ? fields.id.toLowerCase() : null;
    if (!id) throw new BadRequestException("Upload id is invalid.");
    const reference = typeof fields.reference === "string" ? fields.reference.trim() : "";
    if (!reference || reference.length > 120 || !/^[\p{L}\p{N}{}\-_/. #]+$/u.test(reference)) throw new BadRequestException("Enter the quotation's own number.");
    const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 240) : reference;
    const amount = typeof fields.amount === "string" && fields.amount.trim() ? fields.amount.trim() : null;
    if (amount !== null && !/^\d{1,14}(\.\d{1,4})?$/.test(amount)) throw new BadRequestException("Enter the amount as a number.");
    const currency = typeof fields.currency === "string" && fields.currency.trim() ? fields.currency.trim().toUpperCase() : null;
    if ((amount === null) !== (currency === null) || (currency !== null && !/^[A-Z]{3}$/.test(currency))) throw new BadRequestException("Give the amount with its currency.");
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      await this.caseOf(client, workspaceId, caseId);
      const existing = (await client.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM quote_documents WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing) {
        if (existing.caseId !== caseId) throw new ConflictException("This upload id belongs to another case.");
        return { documents: await documentCards(client, workspaceId, caseId) };
      }
      const taken = (await client.query(
        `SELECT 1 FROM quotation_references WHERE workspace_id = $1 AND lower(reference) = lower($2)
         UNION ALL SELECT 1 FROM quote_documents WHERE workspace_id = $1 AND kind = 'external_quotation' AND lower(reference) = lower($2)`, [workspaceId, reference])).rowCount;
      if (taken) throw new ConflictException(`Quotation ${reference} is already in this workspace.`);
      await client.query(
        `INSERT INTO quote_documents (workspace_id, id, case_id, kind, title, reference, amount, currency, created_by) VALUES ($1, $2, $3, 'external_quotation', $4, $5, $6, $7, $8)`,
        [workspaceId, id, caseId, title, reference, amount, currency, user.userId]);
      const version = await addDocumentVersion(client, this.storage, { workspaceId, caseId, documentId: id, purpose: "upload", bytes: upload.buffer, fileName: upload.name,
        mimeType: upload.mimeType, note: typeof fields.note === "string" ? fields.note.trim() : "", actorUserId: user.userId });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.external_uploaded.v1", entityType: "pre_project_case", entityId: caseId,
        after: { documentId: id, reference, title, amount, currency, sha256: version.sha256 } });
      return { documents: await documentCards(client, workspaceId, caseId) };
    });
  }

  /** A new file for an uploaded quotation (a corrected copy): the card keeps every earlier version. */
  async addVersion(actor: RequestActor, workspaceId: string, caseId: string, documentId: string, fields: Record<string, unknown>, file?: UploadedFile) {
    const upload = acceptFile(file, false);
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const document = (await client.query<{ kind: string; version: number }>(`SELECT kind, version FROM quote_documents WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, caseId, documentId])).rows[0];
      if (!document) throw new NotFoundException("Document not found.");
      if (document.kind !== "external_quotation") throw new ConflictException("A proposal's versions come from its quotation.");
      if (Number(fields.version) !== document.version) throw new ConflictException("Someone changed this document. Reload to see the latest.");
      const version = await addDocumentVersion(client, this.storage, { workspaceId, caseId, documentId, purpose: "upload", bytes: upload.buffer, fileName: upload.name,
        mimeType: upload.mimeType, note: typeof fields.note === "string" ? fields.note.trim() : "", actorUserId: user.userId });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.document_version_added.v1", entityType: "pre_project_case", entityId: caseId,
        after: { documentId, version: version.number, sha256: version.sha256 } });
      return { documents: await documentCards(client, workspaceId, caseId) };
    });
  }

  async file(actor: RequestActor, workspaceId: string, caseId: string, documentId: string, numberValue: string) {
    const number = Number(numberValue);
    if (!Number.isInteger(number) || number < 1) throw new BadRequestException("Version is invalid.");
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const version = (await client.query<{ objectKey: string; fileName: string; mimeType: string }>(
        `SELECT version.object_key AS "objectKey", version.file_name AS "fileName", version.mime_type AS "mimeType" FROM quote_document_versions version
           JOIN quote_documents document ON document.workspace_id = version.workspace_id AND document.id = version.document_id
          WHERE version.workspace_id = $1 AND document.case_id = $2 AND version.document_id = $3 AND version.number = $4`, [workspaceId, caseId, documentId, number])).rows[0];
      if (!version) throw new NotFoundException("Document not found.");
      return { body: await readBytes(this.storage, version.objectKey), contentType: version.mimeType, name: version.fileName };
    });
  }

  private slot(value: string) {
    const slot = Number(value);
    if (!(SLOTS as readonly number[]).includes(slot)) throw new BadRequestException("Choose page 1, 2, 3 or 5. Page 4 is always the quotation.");
    return slot as (typeof SLOTS)[number];
  }

  private async lockTemplate(client: Db, workspaceId: string, expected: unknown) {
    await client.query(`INSERT INTO proposal_templates (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`, [workspaceId]);
    const current = (await client.query<{ version: number }>(`SELECT version FROM proposal_templates WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0].version;
    if (Number(expected) !== current) throw new ConflictException("Someone changed the proposal template. Reload to see the latest.");
    return current;
  }

  /** The new version starts as a copy of the current one without the slot being changed. */
  private async copyPages(client: Db, workspaceId: string, from: number, to: number, except: number) {
    if (!from) return;
    await client.query(
      `INSERT INTO proposal_template_pages (workspace_id, template_version, slot, object_key, file_name, mime_type, byte_size, sha256, page_count, created_by, created_at)
       SELECT workspace_id, $3, slot, object_key, file_name, mime_type, byte_size, sha256, page_count, created_by, created_at
         FROM proposal_template_pages WHERE workspace_id = $1 AND template_version = $2 AND slot <> $4`, [workspaceId, from, to, except]);
  }

  private async saveVersion(client: Db, workspaceId: string, version: number, userId: string) {
    await client.query(`UPDATE proposal_templates SET version = $2, updated_by = $3, updated_at = now() WHERE workspace_id = $1`, [workspaceId, version, userId]);
  }

  private async caseOf(client: Db, workspaceId: string, caseId: string) {
    if (!(await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rowCount) throw new NotFoundException("Case not found.");
  }

  private async manager(client: Db, workspaceId: string, userId: string) {
    for (const permission of MANAGE) if (await this.access.hasPermission(client, workspaceId, userId, permission)) return true;
    return false;
  }
}
