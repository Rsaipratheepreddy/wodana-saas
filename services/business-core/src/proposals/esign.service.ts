import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { CommercialService } from "../commercial/commercial.service";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { contactEmailSql } from "../client-portal/contact-email";
import { decideQuote, type DecisionContext } from "../client-portal/portal-decisions";
import { readPortalSettings } from "../client-portal/portal-settings";
import { webOrigin } from "../client-portal/portal-site";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { changeRequestSigned } from "../change-requests/change-request-signature";
import { clientNetwork, linkState, newSigningToken, SIGNING_TOKEN, signatureInput, signerIdentity, signingTokenHash } from "./esign.domain";
import { addDocumentVersion, issueProposalVersion } from "./proposal-documents.service";
import { readBytes, type ObjectStore } from "./proposal-files";
import { appendCertificate, sha256 } from "./proposal-pdf";

type Db = PoolClient;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";
/** The signing page acts as no staff member; its audit rows carry source "client_portal" and the request id. */
const SIGNER_ACTOR = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestRow = {
  id: string; workspaceId: string; subjectKind: "quote_proposal" | "change_request"; caseId: string; quoteId: string | null; quoteHash: string | null; grantId: string | null;
  documentId: string; documentVersion: number; documentSha256: string; signerName: string; signerEmail: string | null; signerPhone: string | null;
  status: "pending" | "signed" | "revoked"; expiresAt: Date; signedAt: Date | null; signedName: string | null; signedDocumentVersion: number | null; signedSha256: string | null; version: number;
};
const REQUEST_SELECT = `SELECT id, workspace_id AS "workspaceId", subject_kind AS "subjectKind", case_id AS "caseId", quote_id AS "quoteId", quote_hash AS "quoteHash",
  grant_id AS "grantId", document_id AS "documentId", document_version AS "documentVersion", document_sha256 AS "documentSha256", signer_name AS "signerName",
  signer_email AS "signerEmail", signer_phone AS "signerPhone", status, expires_at AS "expiresAt", signed_at AS "signedAt", signed_name AS "signedName",
  signed_document_version AS "signedDocumentVersion", signed_sha256 AS "signedSha256", version FROM esign_requests`;

/** What the signer did, as handlers of each subject kind need it. */
export type SignedEvent = { request: RequestRow; signedName: string; signedAt: string };
/** A subject kind's effect of a signature (a quote's acceptance; later a change request's approval), in the signing transaction. */
export type SignatureEffect = (db: Db, event: SignedEvent) => Promise<void>;

/**
 * R8, native e-sign: a named signer gets a link (no login) to one exact PDF; they confirm who they are, type or
 * draw their signature and sign. The signed PDF (the original plus a certificate page with identity, time, IP,
 * browser and the original's SHA-256) is stored as a new immutable version, and the signature's effect runs in the
 * same transaction: for a proposal, the client's acceptance through the portal's own decision command.
 * One link signs once; a used link shows the signed copy; an expired, revoked or tampered one signs nothing.
 */
@Injectable()
export class EsignService {
  private readonly logger = new Logger(EsignService.name);
  private readonly effects: Record<RequestRow["subjectKind"], SignatureEffect>;

  constructor(
    private readonly db: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly storage: BrandAssetStorageService,
    private readonly commercial: CommercialService,
    private readonly mailer: TransactionalEmailService,
    private readonly config: ConfigService,
  ) {
    this.effects = {
      quote_proposal: (client, event) => this.acceptQuote(client, event),
      change_request: (client, event) => changeRequestSigned(client, event),
    };
  }

  private get store(): ObjectStore { return this.storage; }

  // ---------- staff ----------

  /**
   * Sends the sent quotation's proposal to its client decision-maker for signature. A new link replaces any open one
   * for the same quote; the same command id again returns the request it made (without a second email).
   */
  async request(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { commandId?: unknown }) {
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId.toLowerCase() : null;
    if (!commandId) throw new BadRequestException("Send a command id.");
    const outcome = await this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const replay = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, commandId])).rows[0];
      if (replay) return { request: this.summary(replay), link: null, email: null };
      const quote = (await client.query<{ status: string; kind: string; hash: string | null; approverId: string | null }>(
        `SELECT status, kind, hash, detail->>'approverId' AS "approverId" FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, caseId, quoteId])).rows[0];
      if (!quote) throw new NotFoundException("Quote not found.");
      if (quote.kind !== "quotation") throw new ConflictException("Variations are signed from their change case.");
      if (quote.status !== "issued") throw new ConflictException("Send the quotation to the client first; only a sent quotation can be signed.");
      const grant = quote.approverId ? (await client.query<{ id: string; name: string; phone: string; email: string | null }>(
        `SELECT grant_row.id, grant_row.name, grant_row.phone, ${contactEmailSql("grant_row")} AS email FROM client_portal_grants grant_row
          WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.id = $3 AND grant_row.active AND grant_row.role = 'approver'`,
        [workspaceId, caseId, quote.approverId])).rows[0] : undefined;
      if (!grant) throw new ConflictException("The quotation's decision-maker is no longer active. Send it again to the right person.");
      if (!grant.email) throw new ConflictException(`Add ${grant.name}'s email first: the signing link is sent by email.`);
      const document = await issueProposalVersion(client, this.store, { workspaceId, caseId, quoteId, actorUserId: user.userId });
      const days = (await client.query<{ days: number }>(`SELECT signing_link_days AS days FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.days ?? 14;
      const revoked = (await client.query<{ id: string }>(
        `UPDATE esign_requests SET status = 'revoked', revoked_at = now(), revoked_by = $3, version = version + 1
          WHERE workspace_id = $1 AND quote_id = $2 AND case_id = $4 AND status = 'pending' RETURNING id`, [workspaceId, quoteId, user.userId, caseId])).rows.map((row) => row.id);
      const token = newSigningToken();
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + days * 86_400_000);
      await client.query(
        `INSERT INTO esign_requests (workspace_id, id, subject_kind, case_id, quote_id, quote_hash, grant_id, document_id, document_version, document_sha256, token_hash,
           signer_name, signer_email, signer_phone, expires_at, created_by, command_id)
         VALUES ($1, $2, 'quote_proposal', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [workspaceId, id, caseId, quoteId, quote.hash, grant.id, document.documentId, document.number, document.sha256, token.hash, grant.name, grant.email, grant.phone,
          expiresAt, user.userId, commandId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.signature_requested.v1", entityType: "pre_project_case", entityId: caseId,
        after: { requestId: id, quoteId, documentId: document.documentId, documentVersion: document.number, sha256: document.sha256, signer: grant.name, expiresAt, revoked } });
      const created = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      const link = new URL(`/sign/${token.token}`, webOrigin(this.config)).toString();
      return { request: this.summary(created), link, email: { to: grant.email, signerName: grant.name, title: document.title, reference: document.reference, expiresAt } };
    });
    // The email leaves after the link exists; a failed delivery leaves the link for the team to share.
    let delivered = false;
    if (outcome.link && outcome.email) {
      const result = await this.mailer.sendSignatureRequest({ workspaceId, to: outcome.email.to, signerName: outcome.email.signerName, documentTitle: outcome.email.title,
        reference: outcome.email.reference, signUrl: outcome.link, expiresAt: outcome.email.expiresAt }).catch((error: unknown) => {
        this.logger.warn(`Signature email failed: ${error instanceof Error ? error.message : String(error)}`);
        return { status: "failed" as const };
      });
      delivered = result.status === "sent";
    }
    return { request: outcome.request, link: outcome.link, emailed: delivered ? outcome.email?.to ?? null : null };
  }

  /** Closes an open link (sent to the wrong person, or superseded); a signed one can't be revoked. */
  async revoke(actor: RequestActor, workspaceId: string, caseId: string, requestId: string, input: { version?: unknown }) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const row = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, requestId])).rows[0];
      if (!row) throw new NotFoundException("Signing link not found.");
      if (row.status === "revoked") return this.summary(row);
      if (row.status === "signed") throw new ConflictException("This was already signed.");
      if (Number(input.version) !== row.version) throw new ConflictException("This link changed. Reload to see the latest.");
      await client.query(`UPDATE esign_requests SET status = 'revoked', revoked_at = now(), revoked_by = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, requestId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.signature_revoked.v1", entityType: "pre_project_case", entityId: caseId, after: { requestId } });
      return this.summary((await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND id = $2`, [workspaceId, requestId])).rows[0]);
    });
  }

  /**
   * A signing link for another module's document (a change request, R11): one exact document version for a named
   * signer, in the caller's transaction. A new link for the same document replaces an open one; the same command id
   * returns the request it made. The caller emails the link with `sendLink` once its transaction is committed.
   */
  async openLink(client: Db, input: { workspaceId: string; subjectKind: "change_request"; caseId: string; grantId: string | null; documentId: string; documentVersion: number;
    documentSha256: string; signer: { name: string; email: string | null; phone: string | null }; actorUserId: string; commandId: string; days?: number }) {
    const replay = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND command_id = $2`, [input.workspaceId, input.commandId])).rows[0];
    if (replay) return { request: this.summary(replay), link: null as string | null };
    await client.query(`UPDATE esign_requests SET status = 'revoked', revoked_at = now(), revoked_by = $3, version = version + 1 WHERE workspace_id = $1 AND document_id = $2 AND status = 'pending'`,
      [input.workspaceId, input.documentId, input.actorUserId]);
    const days = input.days ?? (await client.query<{ days: number }>(`SELECT signing_link_days AS days FROM workspace_quotation_settings WHERE workspace_id = $1`, [input.workspaceId])).rows[0]?.days ?? 14;
    const token = newSigningToken();
    const id = randomUUID();
    await client.query(
      `INSERT INTO esign_requests (workspace_id, id, subject_kind, case_id, quote_id, quote_hash, grant_id, document_id, document_version, document_sha256, token_hash,
         signer_name, signer_email, signer_phone, expires_at, created_by, command_id)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [input.workspaceId, id, input.subjectKind, input.caseId, input.grantId, input.documentId, input.documentVersion, input.documentSha256, token.hash, input.signer.name,
        input.signer.email, input.signer.phone, new Date(Date.now() + days * 86_400_000), input.actorUserId, input.commandId]);
    const created = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, id])).rows[0];
    return { request: this.summary(created), link: new URL(`/sign/${token.token}`, webOrigin(this.config)).toString() };
  }

  /** Emails a signing link in the tenant's brand; a failed delivery leaves the link for the team to share. */
  async sendLink(input: { workspaceId: string; to: string; signerName: string; title: string; reference: string; link: string; expiresAt: Date }) {
    const result = await this.mailer.sendSignatureRequest({ workspaceId: input.workspaceId, to: input.to, signerName: input.signerName, documentTitle: input.title,
      reference: input.reference, signUrl: input.link, expiresAt: input.expiresAt }).catch((error: unknown) => {
      this.logger.warn(`Signature email failed: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "failed" as const };
    });
    return result.status === "sent";
  }

  // ---------- the signer (no login; the token is the key) ----------

  async view(token: string) {
    return this.withToken(token, async (client, row) => {
      const document = (await client.query<{ title: string; reference: string | null; amount: string | null; currency: string | null }>(
        `SELECT title, reference, amount::text AS amount, currency FROM quote_documents WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.documentId])).rows[0];
      const brand = await effectivePortalBrand(client, row.workspaceId);
      return {
        state: linkState(row),
        brand: { name: brand.name, logo: brand.logo || null, primaryColor: brand.primaryColor },
        document: { title: document?.title ?? "", reference: document?.reference ?? "", amount: document?.amount ?? null, currency: document?.currency ?? null, sha256: row.documentSha256 },
        signer: { name: row.signerName, email: row.signerEmail, phone: row.signerPhone },
        expiresAt: row.expiresAt,
        signed: row.status === "signed" ? { at: row.signedAt, name: row.signedName, sha256: row.signedSha256 } : null,
      };
    });
  }

  /** The exact PDF to sign (what its SHA-256 names), or once signed, the signed copy. */
  async document(token: string, signedCopy: boolean) {
    return this.withToken(token, async (client, row) => {
      const state = linkState(row);
      if (state === "revoked") throw new GoneException("This signing link was withdrawn.");
      const number = signedCopy ? row.signedDocumentVersion : row.documentVersion;
      if (!number) throw new NotFoundException("There is no signed copy yet.");
      if (!signedCopy && state === "expired") throw new GoneException("This signing link has expired. Ask for a new one.");
      const version = (await client.query<{ objectKey: string; fileName: string }>(
        `SELECT object_key AS "objectKey", file_name AS "fileName" FROM quote_document_versions WHERE workspace_id = $1 AND document_id = $2 AND number = $3`,
        [row.workspaceId, row.documentId, number])).rows[0];
      if (!version) throw new NotFoundException("Document not found.");
      return { body: await readBytes(this.store, version.objectKey), contentType: "application/pdf", name: signedCopy ? version.fileName.replace(/\.pdf$/i, " (signed).pdf") : version.fileName };
    });
  }

  /**
   * Signs once. The signer names the SHA-256 they were shown; the stored PDF must still hash to it (tamper check);
   * the quote must still be the one sent. A second submission of a used link returns the signature already made.
   */
  async sign(token: string, body: Record<string, unknown>, network: { ip?: unknown; userAgent?: unknown }) {
    const result = await this.withToken(token, async (client, row) => {
      const state = linkState(row);
      if (state === "signed") return { replayed: true, row, copy: null };
      if (state === "revoked") throw new GoneException("This signing link was withdrawn. Ask for a new one.");
      if (state === "expired") throw new GoneException("This signing link has expired. Ask for a new one.");
      if (body.documentSha256 !== row.documentSha256) throw new ConflictException("The document changed since you opened it. Reload to read the latest.");
      const identity = signerIdentity(body, { name: row.signerName, email: row.signerEmail, phone: row.signerPhone });
      const signature = signatureInput(body.signature);
      const where = clientNetwork(network.ip, network.userAgent);
      const version = (await client.query<{ objectKey: string; fileName: string; sha256: string }>(
        `SELECT object_key AS "objectKey", file_name AS "fileName", sha256 FROM quote_document_versions WHERE workspace_id = $1 AND document_id = $2 AND number = $3`,
        [row.workspaceId, row.documentId, row.documentVersion])).rows[0];
      if (!version) throw new NotFoundException("Document not found.");
      const original = await readBytes(this.store, version.objectKey);
      // The file must be byte for byte what was sent: the stored copy and its record both match the link's hash.
      if (sha256(original) !== row.documentSha256 || version.sha256 !== row.documentSha256)
        throw new ConflictException("This document can't be verified, so it can't be signed. Ask for a new link.");
      const document = (await client.query<{ title: string; reference: string | null }>(`SELECT title, reference FROM quote_documents WHERE workspace_id = $1 AND id = $2`,
        [row.workspaceId, row.documentId])).rows[0];
      const signedAt = new Date().toISOString();
      const brand = await effectivePortalBrand(client, row.workspaceId);
      const signedBytes = Buffer.from(await appendCertificate(original, {
        requestId: row.id, documentTitle: document?.title ?? "", reference: document?.reference ?? "", documentSha256: row.documentSha256,
        signer: identity, signedAt, ip: where.ip, userAgent: where.userAgent, signature: signature.kind === "typed" ? signature : { kind: "drawn", png: signature.png }, brandName: brand.name, brandAccent: brand.primaryColor ?? null,
      }));
      // The signature's effect first: if the quote can't be accepted any more, nothing is signed.
      await this.effects[row.subjectKind](client, { request: row, signedName: identity.name, signedAt });
      const stored = await addDocumentVersion(client, this.store, { workspaceId: row.workspaceId, caseId: row.caseId, documentId: row.documentId, purpose: "signed", bytes: signedBytes,
        fileName: version.fileName.replace(/\.pdf$/i, "") + " (signed).pdf", mimeType: "application/pdf", quoteHash: row.quoteHash, note: `Signed by ${identity.name}`, actorUserId: null });
      await client.query(
        `UPDATE esign_requests SET status = 'signed', signed_at = $3, signed_name = $4, signed_email = $5, signed_phone = $6, signature_kind = $7, signature_text = $8,
                signature_sha256 = $9, signer_ip = $10, signer_user_agent = $11, signed_document_version = $12, signed_sha256 = $13, version = version + 1
          WHERE workspace_id = $1 AND id = $2`,
        [row.workspaceId, row.id, signedAt, identity.name, identity.email, identity.phone, signature.kind, signature.kind === "typed" ? signature.text : null,
          signature.kind === "drawn" ? sha256(signature.png) : sha256(Buffer.from(signature.text, "utf8")), where.ip, where.userAgent, stored.number, stored.sha256]);
      await recordAudit(client, { workspaceId: row.workspaceId, actorUserId: null, source: "client_portal", action: row.subjectKind === "change_request" ? "change_request.signed.v1" : "quotation.signed.v1",
        entityType: "pre_project_case", entityId: row.caseId,
        after: { requestId: row.id, quoteId: row.quoteId, documentId: row.documentId, signedVersion: stored.number, documentSha256: row.documentSha256, signedSha256: stored.sha256,
          signer: identity, ip: where.ip, userAgent: where.userAgent, method: signature.kind } });
      const after = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.id])).rows[0];
      return { replayed: false, row: after, copy: { to: identity.email, name: identity.name, title: document?.title ?? "", reference: document?.reference ?? "" } };
    });
    if (result.copy?.to) {
      await this.mailer.sendSignedCopy({ workspaceId: result.row.workspaceId, to: result.copy.to, signerName: result.copy.name, documentTitle: result.copy.title, reference: result.copy.reference,
        copyUrl: new URL(`/sign/${token}`, webOrigin(this.config)).toString(), sha256: result.row.signedSha256 ?? "" }).catch((error: unknown) =>
        this.logger.warn(`Signed-copy email failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    return { state: "signed" as const, replayed: result.replayed, signedAt: result.row.signedAt, signedSha256: result.row.signedSha256 };
  }

  // ---------- internals ----------

  /** The signature accepts the quote exactly as the client accepts in the portal: the same decision command. */
  private async acceptQuote(client: Db, event: SignedEvent) {
    const { request } = event;
    if (!request.quoteId || !request.grantId) throw new ConflictException("This link isn't for a quotation.");
    const quote = (await client.query<{ hash: string | null; status: string }>(`SELECT hash, status FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
      [request.workspaceId, request.caseId, request.quoteId])).rows[0];
    if (!quote || quote.hash !== request.quoteHash) throw new ConflictException("This quotation changed after it was sent for signature. Ask for a new link.");
    const grant = (await client.query<{ id: string; name: string; phone: string; email: string | null; role: "approver" | "viewer" }>(
      `SELECT id, name, phone, email, role FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND active`,
      [request.workspaceId, request.caseId, request.grantId])).rows[0];
    if (!grant) throw new ForbiddenException("You're no longer this project's decision-maker. Ask the team for a new link.");
    const ctx: DecisionContext = {
      db: client, workspaceId: request.workspaceId, today: new Date().toISOString().slice(0, 10),
      settings: await readPortalSettings(client, request.workspaceId),
      contact: { sessionId: `esign:${request.id}`, phone: grant.phone, name: event.signedName, nameConfirmed: true,
        grants: [{ id: grant.id, caseId: request.caseId, name: grant.name, role: grant.role, email: grant.email, confirmed: true, demo: false }] },
      commercial: { load: (c, w, caseId) => this.commercial.load(c, w, caseId), persist: (c, w, caseId, data, actor, action, quoteId, note) =>
        this.commercial.persist(c, w, caseId, data, actor, action, quoteId, note) },
      definitions: {
        assertPortalDecisionAvailable: async () => { throw new ConflictException("Not a definition."); },
        decidePortal: async () => { throw new ConflictException("Not a definition."); },
      },
      // The signature is the confirmation: it answers exactly this quote's acceptance, under this request.
      verify: async (purpose, challengeId) => purpose === `quote:${request.caseId}:${request.quoteId}:accept` && challengeId === request.id,
    };
    await decideQuote(ctx, { caseId: request.caseId, quoteId: request.quoteId, decision: "accept", hash: request.quoteHash, challengeId: request.id, code: "e-signature", selectedOptionLineIds: [] });
  }

  /** Finds the workspace of a link from its token's hash, then works inside that workspace only. */
  private async withToken<T>(token: string, work: (client: Db, row: RequestRow) => Promise<T>) {
    if (!SIGNING_TOKEN.test(token)) throw new NotFoundException("This signing link isn't valid.");
    const hash = signingTokenHash(token);
    const workspaceId = (await this.db.query<{ workspaceId: string | null }>(`SELECT esign_request_workspace($1) AS "workspaceId"`, [hash])).rows[0]?.workspaceId;
    if (!workspaceId) throw new NotFoundException("This signing link isn't valid.");
    return this.db.tenantTransaction(workspaceId, SIGNER_ACTOR, async (client) => {
      const row = (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE workspace_id = $1 AND token_hash = $2 FOR UPDATE`, [workspaceId, hash])).rows[0];
      if (!row) throw new NotFoundException("This signing link isn't valid.");
      return work(client, row);
    });
  }

  private summary(row: RequestRow) {
    return { id: row.id, status: row.status, state: linkState(row), signerName: row.signerName, signerEmail: row.signerEmail, documentId: row.documentId,
      documentVersion: row.documentVersion, documentSha256: row.documentSha256, expiresAt: row.expiresAt, signedAt: row.signedAt, signedDocumentVersion: row.signedDocumentVersion, version: row.version };
  }
}
