import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { approvalStatus, decideApproval, type ApprovalDecision } from "../approvals/approval-engine.api";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { contactEmailSql } from "../client-portal/contact-email";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { EsignService } from "../proposals/esign.service";
import { addDocumentVersion } from "../proposals/proposal-documents.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { composeChangeDocument } from "./change-request-pdf";
import {
  applyChangeApproval, createChange, readChange, readChangeEvents, readChanges, readPoImpacts, recordSent, saveDraft, submitChange, withdrawChange,
  type ChangeRow, type CreateInput,
} from "./change-request.store";

const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The team's side of change requests (plan §6.20, R11): assess a change (lines from the accepted quotation, the
 * materials ledger, allowances or new work; the handover it moves), send it for approval on E3, send it to the
 * client to sign by link (e-sign, no login) or decide in the portal, withdraw it. Every command is validated,
 * idempotent by its ids, version-checked and audited.
 */
@Injectable()
export class ChangeRequestsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly esign: EsignService, private readonly storage: BrandAssetStorageService) {}

  list(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => ({
      ...await this.view(client, workspaceId, caseId),
      canEdit: await this.access.hasPermission(client, workspaceId, user.userId, EDIT),
    }));
  }

  create(actor: RequestActor, workspaceId: string, caseId: string, input: Record<string, unknown>) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await createChange(client, workspaceId, caseId, { ...input, id: typeof input.id === "string" ? input.id : "" } as CreateInput, { userId });
      return this.view(client, workspaceId, caseId);
    });
  }

  save(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: Record<string, unknown>) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await saveDraft(client, workspaceId, caseId, id, input, userId);
      return this.view(client, workspaceId, caseId);
    });
  }

  submit(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: Record<string, unknown>) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await submitChange(client, workspaceId, caseId, id, input, userId);
      return this.view(client, workspaceId, caseId);
    });
  }

  /** A person decides the change's E3 approval at its current step; the engine says who may (and when). */
  decide(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: Record<string, unknown>) {
    const decision = ["approve", "return", "reject"].includes(input.decision as string) ? input.decision as ApprovalDecision : null;
    if (!decision) throw new BadRequestException("Approve, return or reject");
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await readChange(client, workspaceId, caseId, id);
      const note = typeof input.note === "string" ? input.note : null;
      const status = await decideApproval(client, { workspaceId, kind: "change_request", subjectId: id, deciderUserId: user.userId, decision, note,
        expectedVersion: typeof input.approvalVersion === "number" ? input.approvalVersion : null, commandId: typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId : null });
      await applyChangeApproval(client, workspaceId, status, decision, user.userId, note?.trim() || null);
      return this.view(client, workspaceId, caseId);
    });
  }

  /**
   * R11: the change as a PDF (a new immutable version of its document), and a signing link by email to the project's
   * decision-maker. The same command id returns the link already made; a new send replaces an open link.
   */
  async send(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: Record<string, unknown>) {
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId.toLowerCase() : null;
    if (!commandId) throw new BadRequestException("Send a command id.");
    const outcome = await this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const change = await readChange(client, workspaceId, caseId, id, true);
      if (change.status !== "with_client") throw new ConflictException(change.status === "draft" || change.status === "pending_approval"
        ? "Approve the change inside the firm first." : "This change isn't waiting for the client.");
      const signer = (await client.query<{ id: string; name: string; phone: string; email: string | null }>(
        `SELECT grant_row.id, coalesce(grant_row.confirmed_name, grant_row.name) AS name, grant_row.phone, ${contactEmailSql("grant_row")} AS email
           FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.active AND grant_row.role = 'approver'
            AND ($3::uuid IS NULL OR grant_row.id = $3) ORDER BY grant_row.created_at LIMIT 1`,
        [workspaceId, caseId, typeof input.grantId === "string" && UUID.test(input.grantId) ? input.grantId : null])).rows[0];
      if (!signer) throw new ConflictException("Add the client's decision-maker to the project first.");
      if (!signer.email) throw new ConflictException(`Add ${signer.name}'s email first: the signing link is sent by email.`);
      const document = await this.document(client, workspaceId, change, userId);
      const opened = await this.esign.openLink(client, { workspaceId, subjectKind: "change_request", caseId, grantId: signer.id, documentId: document.documentId,
        documentVersion: document.number, documentSha256: document.sha256, signer: { name: signer.name, email: signer.email, phone: signer.phone }, actorUserId: userId, commandId });
      if (opened.link) {
        await recordSent(client, workspaceId, caseId, id, { documentId: document.documentId, esignRequestId: opened.request.id, userId });
        await recordAudit(client, { workspaceId, actorUserId: userId, action: "change_request.signature_requested.v1", entityType: "change_request", entityId: id,
          after: { requestId: opened.request.id, documentId: document.documentId, documentVersion: document.number, sha256: document.sha256, signer: signer.name } });
      }
      return { view: await this.view(client, workspaceId, caseId), link: opened.link, request: opened.request,
        email: opened.link ? { to: signer.email, name: signer.name, title: change.title, reference: change.reference } : null };
    });
    const emailed = outcome.link && outcome.email ? await this.esign.sendLink({ workspaceId, to: outcome.email.to, signerName: outcome.email.name, title: outcome.email.title,
      reference: outcome.email.reference, link: outcome.link, expiresAt: new Date(outcome.request.expiresAt) }) : false;
    return { ...outcome.view, link: outcome.link, emailed: emailed ? outcome.email?.to ?? null : null };
  }

  withdraw(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: Record<string, unknown>) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      await withdrawChange(client, workspaceId, caseId, id, input, userId);
      return this.view(client, workspaceId, caseId);
    });
  }

  /** The change's PDF, issued once per change version (sending again reuses the same file). */
  private async document(client: PoolClient, workspaceId: string, change: ChangeRow, userId: string) {
    let documentId = change.documentId;
    if (!documentId) {
      documentId = randomUUID();
      const amount = change.priceImpact.startsWith("-") ? null : change.priceImpact;
      await client.query(`INSERT INTO quote_documents (workspace_id, id, case_id, quote_id, kind, title, reference, amount, currency, created_by) VALUES ($1, $2, $3, NULL, 'change_request', $4, $5, $6, $7, $8)`,
        [workspaceId, documentId, change.caseId, change.title.slice(0, 240), change.reference, amount, amount === null ? null : change.currency, userId]);
    }
    const marker = `change:${change.id}:v${change.version}`;
    const existing = (await client.query<{ number: number; sha256: string }>(
      `SELECT number, sha256 FROM quote_document_versions WHERE workspace_id = $1 AND document_id = $2 AND purpose = 'issued' AND quote_hash = $3 ORDER BY number DESC LIMIT 1`,
      [workspaceId, documentId, marker])).rows[0];
    if (existing) return { documentId, number: existing.number, sha256: existing.sha256 };
    const facts = (await client.query<{ project: string; clientName: string; today: string; decimals: number | null }>(
      `SELECT coalesce(project.reference || ' · ' || project.name, opportunity.title) AS project, coalesce(party.display_name, opportunity.title) AS "clientName",
              (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today, NULL::int AS decimals
         FROM pre_project_cases pre_case JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
         LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 LIMIT 1`, [workspaceId, change.caseId])).rows[0];
    const brand = await effectivePortalBrand(client, workspaceId);
    const bytes = Buffer.from(await composeChangeDocument({
      brandName: brand.name, reference: change.reference, title: change.title, description: change.description, designImpact: change.designImpact,
      project: facts?.project ?? "", clientName: facts?.clientName ?? "", issuedOn: facts?.today ?? "", currency: change.currency, decimals: currencyDecimals(change.currency),
      lines: change.lines.map((line) => ({ action: line.action, title: line.title, room: line.roomName, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount })),
      priceImpact: change.priceImpact, timeImpactDays: change.timeImpactDays, handoverBefore: change.handoverBefore, handoverAfter: change.handoverAfter,
    }));
    const version = await addDocumentVersion(client, this.storage, { workspaceId, caseId: change.caseId, documentId, purpose: "issued", bytes,
      fileName: `${change.reference} ${change.title}.pdf`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 200), mimeType: "application/pdf", quoteHash: marker, actorUserId: userId });
    return { documentId, number: version.number, sha256: version.sha256 };
  }

  /** The case's changes with their E3 approval, history, signing link and listed orders, and what new lines can come from. */
  private async view(client: PoolClient, workspaceId: string, caseId: string) {
    const exists = (await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rowCount;
    if (!exists) throw new NotFoundException("Case not found");
    const changes = await readChanges(client, workspaceId, caseId);
    const detailed = [];
    for (const change of changes) {
      const signing = change.esignRequestId ? (await client.query<{ id: string; status: string; state: string; signerName: string; expiresAt: string; signedAt: string | null; version: number }>(
        `SELECT id, status, CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' WHEN status = 'pending' THEN 'open' ELSE status END AS state,
                signer_name AS "signerName", expires_at AS "expiresAt", signed_at AS "signedAt", version FROM esign_requests WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, change.esignRequestId])).rows[0] ?? null : null;
      detailed.push({ ...change, approval: await approvalStatus(client, workspaceId, "change_request", change.id), events: await readChangeEvents(client, workspaceId, change.id),
        purchaseOrders: await readPoImpacts(client, workspaceId, change.id), signing });
    }
    const quoteLines = (await client.query<{ quoteId: string; id: string; title: string; room: string | null; quantity: string; unit: string; rate: string; kind: string }>(
      `SELECT line.quote_id AS "quoteId", line.id, line.title, room.name AS room, line.quantity::text AS quantity, line.unit, line.rate::text AS rate, line.kind
         FROM commercial_quote_lines line
         JOIN commercial_quotes quote ON quote.workspace_id = line.workspace_id AND quote.case_id = line.case_id AND quote.id = line.quote_id AND quote.status = 'accepted' AND quote.kind = 'quotation'
         LEFT JOIN pre_project_rooms room ON room.id = line.area_id
        WHERE line.workspace_id = $1 AND line.case_id = $2 ORDER BY quote.number, line.sort_order`, [workspaceId, caseId])).rows;
    const ledgerChanges = (await client.query<{ entryId: string; versionId: string; title: string; number: number; priceImpact: string; status: string }>(
      `SELECT entry.id AS "entryId", version.id AS "versionId", version.title, version.number, version.price_impact::text AS "priceImpact", version.status
         FROM design_ledger_entries entry
         JOIN design_ledger_versions version ON version.workspace_id = entry.workspace_id AND version.entry_id = entry.id AND version.number = entry.current_number
        WHERE entry.workspace_id = $1 AND entry.case_id = $2 AND entry.archived_at IS NULL AND version.after_lock AND version.status IN ('proposed', 'confirmed')
        ORDER BY entry.position`, [workspaceId, caseId])).rows;
    return { changes: detailed, sources: { quoteLines, ledgerChanges } };
  }

  private edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient, userId: string) => Promise<T>) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], (client, user) => work(client, user.userId));
  }
}

/** Decimals a currency is written with (ISO 4217 minor units, through Intl). */
function currencyDecimals(currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}
