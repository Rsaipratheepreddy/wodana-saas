import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import { maskEmail, portalCodes, type PortalCodes } from "../client-portal/portal-auth";
import { deliverPortalOtp } from "../commercial/portal-otp-delivery";
import { deviceLabel, recordSend } from "../documents/document-sends";
import { postJobEvent } from "../jobs/job-thread";

type Db = PoolClient;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";
/** The signing page acts as no staff member; its audit rows carry source "client_portal" and the request id. */
const SIGNER_ACTOR = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestRow = {
  id: string; workspaceId: string; subjectKind: "quote_proposal" | "change_request"; caseId: string; quoteId: string | null; quoteHash: string | null; grantId: string | null;
  documentId: string; documentVersion: number; documentSha256: string; signerName: string; signerEmail: string | null; signerPhone: string | null;
  status: "pending" | "signed" | "revoked"; expiresAt: Date; signedAt: Date | null; signedName: string | null; signedDocumentVersion: number | null; signedSha256: string | null; version: number;
  /** §0.3 P4: the signing code (sent, tries, confirmed) and when the link was first opened. */
  openedAt: Date | null; codeHash: string | null; codeExpiresAt: Date | null; codeSentAt: Date | null; codeChannel: "whatsapp" | "email" | "demo" | null; codeAttempts: number; codeVerifiedAt: Date | null;
};
const REQUEST_SELECT = `SELECT id, workspace_id AS "workspaceId", subject_kind AS "subjectKind", case_id AS "caseId", quote_id AS "quoteId", quote_hash AS "quoteHash",
  grant_id AS "grantId", document_id AS "documentId", document_version AS "documentVersion", document_sha256 AS "documentSha256", signer_name AS "signerName",
  signer_email AS "signerEmail", signer_phone AS "signerPhone", status, expires_at AS "expiresAt", signed_at AS "signedAt", signed_name AS "signedName",
  signed_document_version AS "signedDocumentVersion", signed_sha256 AS "signedSha256", version, opened_at AS "openedAt", code_hash AS "codeHash", code_expires_at AS "codeExpiresAt",
  code_sent_at AS "codeSentAt", code_channel AS "codeChannel", code_attempts AS "codeAttempts", code_verified_at AS "codeVerifiedAt" FROM esign_requests`;
/** A signing code lasts 10 minutes, allows 5 tries, can be asked for again after 30 seconds; a confirmed code holds for 30 minutes. */
const CODE_SECONDS = 600, CODE_TRIES = 5, CODE_RESEND_SECONDS = 30, CODE_VALID_MINUTES = 30;

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
  /** One code secret for the service's life (without a configured one it's random, so it must not change between calls). */
  private codeSecret: PortalCodes | null = null;
  private get codes(): PortalCodes { return (this.codeSecret ??= portalCodes(this.config)); }

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
      return { request: this.summary(created), link, userId: user.userId, email: { to: grant.email, signerName: grant.name, title: document.title, reference: document.reference, expiresAt } };
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
      // §0.3 P4: the signing link is a tracked send on the job; a failed email is shown there, with the link to share instead.
      await this.db.tenantTransaction(workspaceId, outcome.userId ?? SIGNER_ACTOR, (client) => recordSend(client, { workspaceId, caseId, kind: "signature_request", ref: outcome.request.id,
        title: outcome.email!.title, channel: "email", recipient: outcome.email!.to, status: delivered ? "sent" : "failed", reason: delivered ? null : "The signing email couldn't be sent",
        esignRequestId: outcome.request.id, sentBy: outcome.userId ?? null }));
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
      // §0.3 P4: the first open of a live link is when the client opened the document.
      if (!row.openedAt && row.status === "pending") await client.query(`UPDATE esign_requests SET opened_at = now() WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.id]);
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
        // §0.3 P4: signing needs a one-time code; where it can be sent, and whether one is confirmed.
        code: { verified: codeConfirmed(row), canEmail: Boolean(row.signerEmail), canWhatsapp: Boolean(row.signerPhone), demo: this.codes.demo },
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
      if (!codeConfirmed(row)) throw new ForbiddenException("Confirm the code we sent you first.");
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
        signer: identity, signedAt, ip: where.ip, userAgent: where.userAgent, device: deviceLabel(where.userAgent),
        verification: row.codeChannel ? { channel: row.codeChannel, at: new Date(row.codeVerifiedAt!).toISOString() } : null, signature: signature.kind === "typed" ? signature : { kind: "drawn", png: signature.png }, brandName: brand.name, brandAccent: brand.primaryColor ?? null,
      }));
      // The signature's effect first: if the quote can't be accepted any more, nothing is signed.
      await this.effects[row.subjectKind](client, { request: row, signedName: identity.name, signedAt });
      const stored = await addDocumentVersion(client, this.store, { workspaceId: row.workspaceId, caseId: row.caseId, documentId: row.documentId, purpose: "signed", bytes: signedBytes,
        fileName: version.fileName.replace(/\.pdf$/i, "") + " (signed).pdf", mimeType: "application/pdf", quoteHash: row.quoteHash, note: `Signed by ${identity.name}`, actorUserId: null });
      await client.query(
        `UPDATE esign_requests SET status = 'signed', signed_at = $3, signed_name = $4, signed_email = $5, signed_phone = $6, signature_kind = $7, signature_text = $8,
                signature_sha256 = $9, signer_ip = $10, signer_user_agent = $11, signed_document_version = $12, signed_sha256 = $13, signer_device = $14, version = version + 1
          WHERE workspace_id = $1 AND id = $2`,
        [row.workspaceId, row.id, signedAt, identity.name, identity.email, identity.phone, signature.kind, signature.kind === "typed" ? signature.text : null,
          signature.kind === "drawn" ? sha256(signature.png) : sha256(Buffer.from(signature.text, "utf8")), where.ip, where.userAgent, stored.number, stored.sha256,
          deviceLabel(where.userAgent)?.slice(0, 120) ?? null]);
      await recordAudit(client, { workspaceId: row.workspaceId, actorUserId: null, source: "client_portal", action: row.subjectKind === "change_request" ? "change_request.signed.v1" : "quotation.signed.v1",
        entityType: "pre_project_case", entityId: row.caseId,
        after: { requestId: row.id, quoteId: row.quoteId, documentId: row.documentId, signedVersion: stored.number, documentSha256: row.documentSha256, signedSha256: stored.sha256,
          signer: identity, ip: where.ip, userAgent: where.userAgent, method: signature.kind, codeChannel: row.codeChannel } });
      await postJobEvent(client, row.workspaceId, { record: { type: "case", id: row.caseId }, code: "document_signed", ref: row.id,
        body: `${identity.name} signed ${document?.title ?? "the document"}${row.codeChannel ? ` (code by ${row.codeChannel === "whatsapp" ? "WhatsApp" : row.codeChannel})` : ""}` });
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

  /**
   * §0.3 P4: sends the signer a one-time code (WhatsApp first, then email), or says the one sent seconds ago is still on
   * its way. In a demonstration environment the code is 123456 and nothing is sent.
   */
  async sendCode(token: string, body: Record<string, unknown>) {
    return this.withToken(token, async (client, row) => {
      if (linkState(row) !== "open") throw new GoneException("This signing link can't be signed any more.");
      if (row.codeSentAt && Date.now() - new Date(row.codeSentAt).getTime() < CODE_RESEND_SECONDS * 1000 && row.codeChannel)
        return { channel: row.codeChannel, resendAfter: CODE_RESEND_SECONDS, expiresIn: CODE_SECONDS, sentTo: row.codeChannel === "email" && row.signerEmail ? maskEmail(row.signerEmail) : null };
      const codes = this.codes;
      const code = codes.next();
      const wanted = body.channel === "email" ? "email" : "whatsapp";
      let channel: "whatsapp" | "email" | "demo" | null = codes.demo ? "demo" : null;
      if (!channel && wanted === "whatsapp" && row.signerPhone) {
        try { await deliverPortalOtp(this.config, row.workspaceId, row.id, row.signerPhone, code); channel = "whatsapp"; }
        catch (error) { this.logger.warn(`Signing code by WhatsApp failed (${error instanceof Error ? error.name : "unknown"}); trying email.`); }
      }
      if (!channel && row.signerEmail) {
        const sent = await this.mailer.sendPortalCode({ workspaceId: row.workspaceId, to: row.signerEmail, code, purpose: "decision" }).catch(() => ({ status: "failed" as const }));
        if (sent.status === "sent") channel = "email";
      }
      if (!channel) throw new ConflictException("We couldn't send your code. Ask the team to check your number and email.");
      await client.query(
        `UPDATE esign_requests SET code_hash = $3, code_expires_at = now() + make_interval(secs => $4), code_sent_at = now(), code_channel = $5, code_attempts = 0, code_verified_at = NULL
          WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.id, codes.hash(row.id, code), CODE_SECONDS, channel]);
      return { channel, resendAfter: CODE_RESEND_SECONDS, expiresIn: CODE_SECONDS, sentTo: channel === "email" && row.signerEmail ? maskEmail(row.signerEmail) : null };
    });
  }

  /** Checks the signing code; a wrong one uses a try (kept even when it's wrong), a right one is confirmed for 30 minutes. */
  async verifyCode(token: string, body: Record<string, unknown>) {
    const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
    return this.withToken(token, async (client, row) => {
      if (linkState(row) !== "open") throw new GoneException("This signing link can't be signed any more.");
      if (!row.codeHash || !row.codeExpiresAt || new Date(row.codeExpiresAt).getTime() <= Date.now()) return { verified: false, message: "This code has expired. Send a new one." };
      if (row.codeAttempts >= CODE_TRIES) return { verified: false, message: "Too many tries. Send a new code." };
      await client.query(`UPDATE esign_requests SET code_attempts = code_attempts + 1 WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.id]);
      const right = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(this.codes.hash(row.id, code), "hex"));
      if (!right) return { verified: false, message: "That code isn't right. Check it and try again." };
      await client.query(`UPDATE esign_requests SET code_verified_at = now() WHERE workspace_id = $1 AND id = $2`, [row.workspaceId, row.id]);
      return { verified: true, message: null };
    });
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

/** A signing code confirmed in the last 30 minutes. */
function codeConfirmed(row: Pick<RequestRow, "codeVerifiedAt">) {
  return Boolean(row.codeVerifiedAt && Date.now() - new Date(row.codeVerifiedAt).getTime() < CODE_VALID_MINUTES * 60_000);
}
