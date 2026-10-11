import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import { approvalStatus, decideApproval, type ApprovalDecision } from "../approvals/approval-engine.api";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { contactEmailSql } from "../client-portal/contact-email";
import { EsignService } from "../proposals/esign.service";
import { QuotationBuilderService, readSettings } from "../quotation/quotation-builder.service";
import { searchCatalog } from "../quotation/quote-catalog";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { projectViewer } from "../project-core/project-access";
import { membershipOf, readProject } from "../project-core/project-core.store";
import { signedAmount } from "./change-request-flow";
import { applyChangeApproval, event, readChangeEvents, readPoImpacts, readProjectChangeRows, recordSent, type ChangeRow } from "./change-request.store";
import { ChangeRequestsService } from "./change-requests.service";
import {
  actionsFor, applyProjectChange, approvedVariations, changeRightsFor, changeSettings, previewFor, priceOf, priceProjectChange, qsStateOf, raiseProjectChange,
  readProjectChange, readStageImpacts, saveProjectChange, scheduleInputs, sendProjectChange, submitProjectChange, withdrawProjectChange, type ProjectViewerRights,
} from "./project-changes.store";
import { cleanStageImpacts, scheduleImpact } from "./change-request-schedule";

const EDIT = "pre_projects.edit";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Changes on a started project (plan §6.20): raise, price as a variation quotation, approve on E3, send to the client,
 * apply. Anyone on the project raises one; the project manager or whoever prices and sends quotations moves it on; the
 * approval engine says who approves. Every command is validated, idempotent by its ids, version-checked and audited.
 */
@Injectable()
export class ProjectChangesService {
  constructor(private readonly access: WorkspaceAccessService, private readonly builder: QuotationBuilderService, private readonly esign: EsignService,
    private readonly changes: ChangeRequestsService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  /** The project's changes with their value, days, status and next step; the sealed value and the variations beside it. */
  list(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const rows = await readProjectChangeRows(client, workspaceId, projectId);
      const changes = [];
      for (const change of rows) {
        const qs = change.status === "pricing" && change.quoteId ? await qsStateOf(client, workspaceId, change.caseId, change.quoteId) : "not_needed";
        const { next } = actionsFor(change, qs, await changeRightsFor(client, workspaceId, change, viewer, user.userId));
        const price = change.quoteId && change.status !== "draft" ? await this.total(client, workspaceId, change) : null;
        changes.push({ id: change.id, reference: change.reference, title: change.title, reason: change.reason, status: change.status, currency: change.currency,
          value: price, days: change.timeImpactDays, handoverBefore: change.handoverBefore, handoverAfter: change.handoverAfter, raisedByName: change.raisedByName,
          raisedByClient: change.raisedByClient, updatedAt: change.updatedAt, next, applyProblem: change.status === "approved" ? change.applyProblem : null });
      }
      // Variations made in the builder before changes were raised on the project (no change request): still listed, opened in the builder.
      const legacy = (await client.query<{ id: string; number: number; title: string; status: string; total: string; appliedAs: string | null }>(
        `SELECT quote.id, quote.number, quote.title, quote.status, quote.total::text AS total, seal.revision_label AS "appliedAs"
           FROM commercial_quotes quote
           LEFT JOIN project_scope_seals seal ON seal.workspace_id = quote.workspace_id AND seal.project_id = $3 AND seal.quote_id = quote.id
          WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.kind = 'variation' AND NOT (quote.detail ? 'changeRequestId')
            AND quote.status NOT IN ('superseded', 'withdrawn') ORDER BY quote.number DESC`, [workspaceId, viewer.project.caseId, projectId])).rows;
      return { changes, legacy, money: await approvedVariations(client, workspaceId, projectId), canRaise: viewer.all || viewer.onTeam || viewer.commercial,
        projectOpen: ["active", "on_hold"].includes(viewer.project.status) };
    });
  }

  /** What a change can be made of: the project's stages, rooms and live scope, and catalogue items matching a search. */
  sources(actor: RequestActor, workspaceId: string, projectId: string, search: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const { stages } = await scheduleInputs(client, workspaceId, projectId);
      const rooms = (await client.query<{ id: string; name: string }>(`SELECT id, name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY name`,
        [workspaceId, viewer.project.caseId])).rows;
      const scope = (await client.query<{ id: string; title: string; unit: string; quantity: string; areaId: string | null; areaName: string | null; origin: string }>(
        `SELECT line.id, line.title, line.unit, line.quantity::text AS quantity, line.area_id AS "areaId", room.name AS "areaName", seal.revision_label AS origin
           FROM project_boq_lines line
           JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
           LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
          WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' ORDER BY room.name NULLS LAST, line.position`, [workspaceId, projectId, viewer.project.caseId])).rows;
      const settings = await readSettings(client, workspaceId);
      const catalog = search.trim() ? (await searchCatalog(client, workspaceId, { search: search.slice(0, 120), currency: viewer.project.currency, priceBookId: settings.priceBookId, limit: 20 }))
        .map((item) => ({ id: item.id, name: item.name, code: item.code, unit: item.unitCode, rate: item.rate })) : [];
      return { stages: stages.map(({ ownerRole: _role, ...stage }) => stage), rooms, scope, catalog };
    });
  }

  /** One change, everything its record shows: scope, price, timeline impact, approvals, activity, and what this person may do. */
  get(actor: RequestActor, workspaceId: string, projectId: string, id: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.record(client, workspaceId, await this.viewer(client, workspaceId, projectId, user.userId), id, user.userId));
  }

  raise(actor: RequestActor, workspaceId: string, projectId: string, input: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      if (!viewer.all && !viewer.onTeam && !viewer.commercial) throw new ForbiddenException("Only the project's team raises changes on it.");
      const { change } = await raiseProjectChange(client, workspaceId, projectId, input, { userId: user.userId });
      return this.record(client, workspaceId, viewer, change.id, user.userId);
    });
  }

  save(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    return this.step(actor, workspaceId, projectId, id, "edit", async (client, userId) => { await saveProjectChange(client, workspaceId, projectId, id, input, userId); });
  }

  price(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    return this.step(actor, workspaceId, projectId, id, "price", async (client, userId) => {
      if (!(await this.access.hasPermission(client, workspaceId, userId, EDIT))) throw new ForbiddenException("Pricing a change needs quotation editing (Sales or the QS).");
      await priceProjectChange(client, workspaceId, projectId, id, input, userId, this.builder);
    });
  }

  submit(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    return this.step(actor, workspaceId, projectId, id, "submit", async (client, userId) => { await submitProjectChange(client, workspaceId, projectId, id, input, userId); });
  }

  /** A person decides the change's E3 approval at its current step (the engine says who may, and when). */
  decide(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    const decision = ["approve", "return", "reject"].includes(input.decision as string) ? input.decision as ApprovalDecision : null;
    if (!decision) throw new BadRequestException("Approve, return or reject");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      await readProjectChange(client, workspaceId, projectId, id);
      const note = typeof input.note === "string" ? input.note : null;
      const status = await decideApproval(client, { workspaceId, kind: "change_request", subjectId: id, deciderUserId: user.userId, decision, note,
        expectedVersion: typeof input.approvalVersion === "number" ? input.approvalVersion : null, commandId: typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId : null });
      await applyChangeApproval(client, workspaceId, status, decision, user.userId, note?.trim() || null);
      return this.record(client, workspaceId, viewer, id, user.userId);
    });
  }

  /**
   * Sends the approved change to the client: the variation is issued and frozen, the client's decision-maker hears it in
   * the portal, and (with their email) gets a signing link to approve by signature without a login (R11).
   */
  async send(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId.toLowerCase() : null;
    if (!commandId) throw new BadRequestException("Send a command id.");
    const outcome = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const current = await readProjectChange(client, workspaceId, projectId, id);
      if (current.status === "with_client" && current.sentAt) return { view: await this.record(client, workspaceId, viewer, id, user.userId), link: null, mail: null };
      await this.allow(client, workspaceId, viewer, current, user.userId, "send");
      const { change, signer } = await sendProjectChange(client, workspaceId, projectId, id, input, user.userId);
      const link = signer.email ? await this.openLink(client, workspaceId, change, signer.id, commandId, user.userId) : null;
      return { view: await this.record(client, workspaceId, viewer, id, user.userId), link: link?.link ?? null,
        mail: link?.link && signer.email ? { to: signer.email, name: signer.name, title: change.title, reference: change.reference, expiresAt: link.expiresAt } : null };
    });
    const emailed = outcome.link && outcome.mail ? await this.esign.sendLink({ workspaceId, to: outcome.mail.to, signerName: outcome.mail.name, title: outcome.mail.title,
      reference: outcome.mail.reference, link: outcome.link, expiresAt: new Date(outcome.mail.expiresAt) }) : false;
    return { ...outcome.view, link: outcome.link, emailed: emailed ? outcome.mail?.to ?? null : null };
  }

  /** A new signing link for a change with the client (the open one closes). */
  async sendLink(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId.toLowerCase() : null;
    if (!commandId) throw new BadRequestException("Send a command id.");
    const outcome = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const change = await readProjectChange(client, workspaceId, projectId, id, true);
      await this.allow(client, workspaceId, viewer, change, user.userId, "send_link");
      const signer = (await client.query<{ id: string; name: string; email: string | null }>(
        `SELECT grant_row.id, coalesce(grant_row.confirmed_name, grant_row.name) AS name, ${contactEmailSql("grant_row")} AS email FROM client_portal_grants grant_row
          WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.active AND grant_row.role = 'approver' ORDER BY grant_row.created_at LIMIT 1`,
        [workspaceId, change.caseId])).rows[0];
      if (!signer) throw new ConflictException("Add the client's decision-maker to the project first.");
      if (!signer.email) throw new ConflictException(`Add ${signer.name}'s email first: the signing link is sent by email.`);
      const link = await this.openLink(client, workspaceId, change, signer.id, commandId, user.userId);
      return { view: await this.record(client, workspaceId, viewer, id, user.userId), link: link.link, mail: link.link ? { to: signer.email, name: signer.name, expiresAt: link.expiresAt, change } : null };
    });
    const emailed = outcome.link && outcome.mail ? await this.esign.sendLink({ workspaceId, to: outcome.mail.to, signerName: outcome.mail.name, title: outcome.mail.change.title,
      reference: outcome.mail.change.reference, link: outcome.link, expiresAt: new Date(outcome.mail.expiresAt) }) : false;
    return { ...outcome.view, link: outcome.link, emailed: emailed ? outcome.mail?.to ?? null : null };
  }

  /** Applies an approved change (one command: value, finance, dates, scope); applying it again changes nothing. */
  apply(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const change = await readProjectChange(client, workspaceId, projectId, id);
      if (change.status !== "applied") await this.allow(client, workspaceId, viewer, change, user.userId, "apply");
      await applyProjectChange(client, workspaceId, id, user.userId, { version: typeof input.version === "number" ? input.version : undefined });
      return this.record(client, workspaceId, viewer, id, user.userId);
    });
  }

  withdraw(actor: RequestActor, workspaceId: string, projectId: string, id: string, input: Record<string, unknown>) {
    return this.step(actor, workspaceId, projectId, id, "withdraw", async (client, userId) => {
      await withdrawProjectChange(client, workspaceId, await readProjectChange(client, workspaceId, projectId, id, true), input, userId);
    });
  }

  /** The timeline a set of days per stage would give, before saving them. */
  preview(actor: RequestActor, workspaceId: string, projectId: string, input: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.viewer(client, workspaceId, projectId, user.userId);
      const inputs = await scheduleInputs(client, workspaceId, projectId);
      let impacts;
      try { impacts = cleanStageImpacts(input.stageImpacts, inputs.stages); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Check the days."); }
      return scheduleImpact({ ...inputs, impacts });
    });
  }

  /** A photo or file with a change (site photos from the mobile app); the same upload id again is the same file. */
  async upload(actor: RequestActor, workspaceId: string, projectId: string, id: string, fileId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    if (!UUID.test(fileId)) throw new BadRequestException("Send the file's id.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const change = await readProjectChange(client, workspaceId, projectId, id, true);
      const existing = (await client.query<{ sha256: string; changeId: string }>(`SELECT sha256, change_request_id AS "changeId" FROM change_request_files WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, fileId])).rows[0];
      if (existing && (existing.sha256 !== prepared.digest || existing.changeId !== id)) throw new ConflictException("This upload id belongs to another file.");
      if (!existing) {
        await this.allow(client, workspaceId, viewer, change, user.userId, "upload");
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM change_request_files WHERE workspace_id = $1 AND change_request_id = $2`, [workspaceId, id])).rows[0].count;
        if (count >= 20) throw new BadRequestException("A change takes up to 20 photos and files.");
        const key = `projects/changes/${workspaceId}/${fileId}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO change_request_files (id, workspace_id, change_request_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fileId, workspaceId, id, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await event(client, workspaceId, id, "file_added", { userId: user.userId }, prepared.name.slice(0, 200));
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "change_request.file_added.v1", entityType: "change_request", entityId: id,
          after: { fileId, name: prepared.name, mimeType: prepared.mimeType, bytes: prepared.body.length } });
      }
      return this.record(client, workspaceId, viewer, id, user.userId);
    });
  }

  /** One of a change's files (or its preview) for someone who sees the project. */
  file(actor: RequestActor, workspaceId: string, projectId: string, fileId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.viewer(client, workspaceId, projectId, user.userId);
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string; name: string }>(
        `SELECT file.object_key AS "objectKey", file.preview_key AS "previewKey", file.mime_type AS "mimeType", file.original_name AS name
           FROM change_request_files file JOIN change_requests change ON change.workspace_id = file.workspace_id AND change.id = file.change_request_id
          WHERE file.workspace_id = $1 AND file.id = $2 AND change.project_id = $3`, [workspaceId, fileId, projectId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("File not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
    });
  }

  /** The project's approved variations as separate revenue lines (for the Money view and the project P&L). */
  variations(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.viewer(client, workspaceId, projectId, user.userId);
      return approvedVariations(client, workspaceId, projectId);
    });
  }

  // ---------- internals ----------

  private async viewer(client: PoolClient, workspaceId: string, projectId: string, userId: string) {
    const commercial = await this.access.hasPermission(client, workspaceId, userId, EDIT);
    try {
      const viewer = await projectViewer(client, this.access, workspaceId, projectId, userId);
      return { ...viewer, commercial };
    } catch (error) {
      // Whoever prices and sends quotations works the project's changes without being on its team; approvers read them.
      if (!commercial && !(await this.access.hasPermission(client, workspaceId, userId, "commercial.approve"))) throw error;
      const project = await readProject(client, workspaceId, projectId);
      if (!project) throw new NotFoundException("Project not found.");
      return { project, all: false, onTeam: false, lead: false, membershipId: await membershipOf(client, workspaceId, userId), commercial };
    }
  }

  private async allow(client: PoolClient, workspaceId: string, viewer: ProjectViewerRights, change: ChangeRow, userId: string, action: string) {
    const qs = change.status === "pricing" && change.quoteId ? await qsStateOf(client, workspaceId, change.caseId, change.quoteId) : "not_needed";
    const { actions } = actionsFor(change, qs, await changeRightsFor(client, workspaceId, change, viewer, userId));
    if (!actions.includes(action as never)) {
      if (action === "submit" && change.status === "pricing" && (qs === "needed" || qs === "with_qs"))
        throw new ConflictException(qs === "with_qs" ? "The QS is pricing this change." : "Send it to the QS first: the firm's QS rules name this change.");
      if (["approved", "applied", "declined", "withdrawn"].includes(change.status) || (action === "send" && change.status !== "to_send") || (action === "submit" && change.status !== "pricing")
        || (action === "price" && change.status !== "draft") || (action === "apply" && change.status !== "approved"))
        throw new ConflictException(`${change.reference} can't do that now: it's ${change.status.replace(/_/g, " ")}.`);
      throw new ForbiddenException(action === "apply" ? "Only the project manager applies a change." : "You can't do that on this change.");
    }
  }

  private step(actor: RequestActor, workspaceId: string, projectId: string, id: string, action: string, work: (client: PoolClient, userId: string) => Promise<void>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await this.viewer(client, workspaceId, projectId, user.userId);
      const change = await readProjectChange(client, workspaceId, projectId, id);
      // A replay of a step already taken returns the change as it is (the command's id made it once).
      if (!(action === "price" && change.status === "pricing")) await this.allow(client, workspaceId, viewer, change, user.userId, action);
      await work(client, user.userId);
      return this.record(client, workspaceId, viewer, id, user.userId);
    });
  }

  private async total(client: PoolClient, workspaceId: string, change: ChangeRow) {
    const row = (await client.query<{ total: string }>(`SELECT total::text AS total FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
      [workspaceId, change.caseId, change.quoteId])).rows[0];
    return row ? Dec.of(row.total).toFixed(2) : null;
  }

  private async openLink(client: PoolClient, workspaceId: string, change: ChangeRow, grantId: string, commandId: string, userId: string) {
    const price = await priceOf(client, workspaceId, change.caseId, change.quoteId!);
    const document = await this.changes.document(client, workspaceId, change, userId, {
      priceImpact: price.total,
      lines: price.lines.map((line) => ({ action: line.op, title: line.title, room: line.area, quantity: line.quantity, unit: line.unit, unitPrice: line.rate, amount: line.total })),
    });
    const signer = (await client.query<{ name: string; phone: string; email: string | null }>(
      `SELECT coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.phone, ${contactEmailSql("grant_row")} AS email FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.id = $2`,
      [workspaceId, grantId])).rows[0];
    const opened = await this.esign.openLink(client, { workspaceId, subjectKind: "change_request", caseId: change.caseId, grantId, documentId: document.documentId,
      documentVersion: document.number, documentSha256: document.sha256, signer: { name: signer.name, email: signer.email, phone: signer.phone }, actorUserId: userId, commandId });
    if (opened.link) {
      await recordSent(client, workspaceId, change.caseId, change.id, { documentId: document.documentId, esignRequestId: opened.request.id, userId });
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "change_request.signature_requested.v1", entityType: "change_request", entityId: change.id,
        after: { requestId: opened.request.id, documentId: document.documentId, documentVersion: document.number, sha256: document.sha256, signer: signer.name } });
    }
    return { link: opened.link, expiresAt: opened.request.expiresAt };
  }

  /** Everything a change's record shows, for this person. */
  private async record(client: PoolClient, workspaceId: string, viewer: ProjectViewerRights & { project: { id: string; caseId: string; status: string; currency: string; reference: string; name: string } }, id: string, userId: string) {
    const change = await readProjectChange(client, workspaceId, viewer.project.id, id);
    const qs = change.status === "pricing" && change.quoteId ? await qsStateOf(client, workspaceId, change.caseId, change.quoteId) : "not_needed";
    const { actions, next } = actionsFor(change, qs, await changeRightsFor(client, workspaceId, change, viewer, userId));
    const impacts = await readStageImpacts(client, workspaceId, id);
    const { stages } = await scheduleInputs(client, workspaceId, viewer.project.id);
    // Before it's sent the preview is live; once sent, the frozen one the client saw; once applied, what moved.
    const preview = ["draft", "pricing", "pending_approval", "to_send"].includes(change.status) || (change.status === "approved" && !change.appliedAt)
      ? await previewFor(client, workspaceId, viewer.project.id, impacts) : null;
    const approval = await approvalStatus(client, workspaceId, "change_request", id);
    const signing = change.esignRequestId ? (await client.query<{ id: string; state: string; signerName: string; expiresAt: string; signedAt: string | null }>(
      `SELECT id, CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' WHEN status = 'pending' THEN 'open' ELSE status END AS state,
              signer_name AS "signerName", expires_at AS "expiresAt", signed_at AS "signedAt" FROM esign_requests WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, change.esignRequestId])).rows[0] ?? null : null;
    const files = (await client.query<{ id: string; name: string; mimeType: string; hasPreview: boolean; createdAt: string; byName: string | null }>(
      `SELECT file.id, file.original_name AS name, file.mime_type AS "mimeType", file.preview_key IS NOT NULL AS "hasPreview", file.created_at AS "createdAt", person.display_name AS "byName"
         FROM change_request_files file LEFT JOIN users person ON person.id = file.uploaded_by
        WHERE file.workspace_id = $1 AND file.change_request_id = $2 ORDER BY file.created_at`, [workspaceId, id])).rows;
    const settings = await changeSettings(client, workspaceId);
    const price = change.quoteId ? await priceOf(client, workspaceId, change.caseId, change.quoteId) : null;
    return {
      change: {
        id: change.id, reference: change.reference, title: change.title, reason: change.reason, description: change.description, status: change.status, kind: change.kind,
        currency: change.currency, version: change.version, raisedByName: change.raisedByName, raisedByClient: change.raisedByClient, createdAt: change.createdAt, updatedAt: change.updatedAt,
        decidedAt: change.decidedAt, decidedByName: change.decidedByName, decisionMethod: change.decisionMethod, declineNote: change.declineNote,
        withdrawReason: change.withdrawReason, appliedAt: change.appliedAt, applyProblem: change.applyProblem, quoteId: change.quoteId,
        timeImpactDays: change.timeImpactDays, handoverBefore: change.handoverBefore, handoverAfter: change.handoverAfter,
        lines: change.lines.map((line) => ({ id: line.id, source: line.source, action: line.action, title: line.title, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice,
          roomId: line.roomId, roomName: line.roomName, catalogItemId: line.catalogItemId ?? null, boqLineId: line.boqLineId ?? null })),
      },
      project: { id: viewer.project.id, reference: viewer.project.reference, name: viewer.project.name, status: viewer.project.status },
      price: price ? { ...price, value: signedAmount(price.total), paymentRule: change.paymentRule ?? settings.paymentRule, holdsWork: settings.requireVariationPayment } : null,
      qs,
      timeline: { impacts, stages: stages.map(({ ownerRole: _role, ...stage }) => stage), preview, sent: change.scheduleSnapshot ?? null, applied: change.appliedSchedule ?? null },
      approval, signing, files,
      events: await readChangeEvents(client, workspaceId, id),
      purchaseOrders: await readPoImpacts(client, workspaceId, id),
      actions, next,
    };
  }
}
