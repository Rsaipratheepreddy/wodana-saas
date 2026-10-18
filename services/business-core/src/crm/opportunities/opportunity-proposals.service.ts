import { ConflictException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { syncOpportunityProposals } from "../../commercial/case-proposal-sync";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../../workspaces/reference-upload";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { bindEvidence, evidenceIds } from "../../evidence/decision-evidence";
import { approvalStatus, canDecideApproval } from "../../approvals/approval-engine";
import { isCurrencyCode } from "../../common/regional.validators";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CLOSING_EVENTS, ensureClosingRules, loadClosingRules, type ClosingEvent } from "../flows/flow-closing";
import { latestFlowVersion } from "../flows/flow-store";
import { effectiveWonAreas, loadWonAreas, parseWonAreas, WON_AREAS } from "../flows/flow-won-areas";
import { FULFILMENT_EVENTS, loadDealClosing, loadFulfilment, type FulfilmentEvent } from "./deal-closing";
import { FURNITURE_PATHS, type FurniturePath } from "./flow-gates";
import { assertDeliveryCleared } from "../../factory/factory-inspections";
import { takeForDeal } from "../../fulfilment/stock-reservations";
import { permissionHolders } from "../../commercial/commercial-notices";
import { notifyUserInApp } from "../../notifications/default-templates";
import {
  decideProposalValue, loadProposals, loadValueEvents, parseProposalAmount, parseProposalKind, setProposalValue, valueStatusFrom, VALUE_KIND,
} from "./opportunity-proposals";

const VIEW = "crm.opportunities.view";
const ENTER = ["crm.opportunities.manage", "commercial.finance.verify"];
const SENSITIVE = "crm.opportunities.sensitive_values";
const FULFIL = ["crm.opportunities.manage", "projects.manage", "fulfilment.deliver"];
const SETTINGS = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLM-101 / PLM-103 / PLM-102 on the opportunity: Proposal 1 and Proposal 2 with their values (entered → Finance
 * verifies → the approver locks, on the E3 engine; a later change is a new approval with old → new), Won dates, and
 * the deal's closing (configuration per enquiry type, computed from fulfilment and project records).
 */
@Injectable()
export class OpportunityProposalsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  list(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client, user) => this.view(client, workspaceId, opportunityId, user.userId));
  }

  private async view(client: PoolClient, workspaceId: string, opportunityId: string, userId: string) {
    await this.facts(client, workspaceId, opportunityId);
    // Guide J: the proposals read linked to the job's sent quotations, however those went out.
    await syncOpportunityProposals(client, workspaceId, opportunityId, null);
    const canSee = await this.access.hasPermission(client, workspaceId, userId, SENSITIVE);
    const proposals = await loadProposals(client, workspaceId, opportunityId);
    const events = await loadValueEvents(client, workspaceId, opportunityId);
    const hasCase = Boolean((await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 LIMIT 1`, [workspaceId, opportunityId])).rowCount);
    const rows = [];
    for (const proposal of proposals) {
      const approval = await approvalStatus(client, workspaceId, VALUE_KIND, proposal.id);
      const pending = approval?.status === "pending" ? approval : null;
      const decide = pending ? await canDecideApproval(client, workspaceId, pending.id, userId) : null;
      // The quotation the value comes from (its number), for the card's "From Q-3".
      const quote = proposal.quoteId ? (await client.query<{ number: number; caseId: string; reference: string | null }>(
        `SELECT quote.number, quote.case_id AS "caseId", reference.reference FROM commercial_quotes quote
           LEFT JOIN quotation_references reference ON reference.workspace_id = quote.workspace_id AND reference.case_id = quote.case_id AND reference.family_id = coalesce(quote.family_id, quote.id)
          WHERE quote.workspace_id = $1 AND quote.id = $2`, [workspaceId, proposal.quoteId])).rows[0] ?? null : null;
      rows.push({
        ...proposal, amount: canSee ? proposal.amount : null, valueStatus: valueStatusFrom(approval, proposal.valueStatus),
        source: quote ? { quoteId: proposal.quoteId, number: quote.number, caseId: quote.caseId, reference: quote.reference } : null,
        approval: pending ? {
          id: pending.id, version: pending.version, step: pending.currentStep, steps: pending.steps.length, label: pending.steps[pending.currentStep - 1]?.label ?? "",
          fromAmount: canSee ? pending.previousAmount : null, toAmount: canSee ? pending.amount : null, currency: pending.currency, waitingFor: pending.waitingFor,
          canDecide: decide?.canDecide ?? false, via: decide?.via ?? null, reason: decide?.reason ?? null,
        } : null,
      });
    }
    return {
      proposals: rows,
      events: canSee ? events : events.map((event) => ({ ...event, fromAmount: null, toAmount: null })),
      valueHidden: !canSee,
      // A job with a planning case prices its proposals with quotations (linked); only a deal without one types its value.
      quoted: hasCase,
      can: { enter: !hasCase && await this.any(client, workspaceId, userId, ENTER), fulfil: await this.any(client, workspaceId, userId, FULFIL),
        // §0.3 P0: record a Proposal 2 withdrawal, and confirm one (whoever approves deals).
        withdraw: await this.any(client, workspaceId, userId, ["crm.opportunities.manage"]), confirmWithdrawal: await this.any(client, workspaceId, userId, ["commercial.deal.approve"]) },
      closing: await loadDealClosing(client, workspaceId, opportunityId),
      fulfilment: await loadFulfilment(client, workspaceId, opportunityId),
    };
  }

  /** Enters or changes a proposal's value; Finance is told to verify it (E3). */
  setValue(actor: RequestActor, workspaceId: string, opportunityId: string, kindInput: unknown, input: { amount: unknown; currencyCode: unknown; version?: unknown; note?: unknown }) {
    const kind = parseProposalKind(kindInput);
    const amount = parseProposalAmount(input.amount);
    const currency = typeof input.currencyCode === "string" ? input.currencyCode.trim().toUpperCase() : "";
    if (!isCurrencyCode(currency)) throw new UnprocessableEntityException("Choose the currency");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) || null : null;
    return this.access.withAnyPermission(actor, workspaceId, ENTER, async (client, user) => {
      const facts = await this.facts(client, workspaceId, opportunityId, true);
      // Guide J: a proposal with its quotation takes the quotation's value; only a deal without one has a typed value.
      const linked = (await loadProposals(client, workspaceId, opportunityId)).find((proposal) => proposal.kind === kind && proposal.quoteId);
      const quoted = (await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 LIMIT 1`, [workspaceId, opportunityId])).rowCount;
      if (linked || quoted) throw new ConflictException("This value comes from the quotation. Change the quotation to change it.");
      await setProposalValue(client, { workspaceId, opportunityId, title: `${facts.reference} · ${facts.clientName ?? facts.title}`, kind, amount, currency, note,
        actorUserId: user.userId, expectedVersion: input.version === undefined || input.version === null ? null : Number(input.version) });
      return this.view(client, workspaceId, opportunityId, user.userId);
    });
  }

  /** Verify (Finance), approve and lock (the approver) or send back: whoever the engine says holds the step. */
  decide(actor: RequestActor, workspaceId: string, opportunityId: string, kindInput: unknown, input: { decision?: unknown; note?: unknown; version?: unknown; commandId?: unknown; waive?: unknown }) {
    const kind = parseProposalKind(kindInput);
    const decision = input.decision === "approve" || input.decision === "return" || input.decision === "reject" ? input.decision : null;
    if (!decision) throw new UnprocessableEntityException("Approve or send it back");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) || null : null;
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId : null;
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await this.facts(client, workspaceId, opportunityId, true);
      await decideProposalValue(client, { workspaceId, opportunityId, kind, decision, note, actorUserId: user.userId,
        expectedVersion: input.version === undefined || input.version === null ? null : Number(input.version), commandId, waiveSeparation: input.waive === true });
      return this.view(client, workspaceId, opportunityId, user.userId);
    });
  }

  /**
   * §0.3 P0 (guide J): the client withdraws from Proposal 2 after Proposal 1 is won. The account manager records it
   * with the reason; whoever approves deals is asked to confirm it. Version-checked through the opportunity lock.
   */
  async requestWithdrawal(actor: RequestActor, workspaceId: string, opportunityId: string, input: { reason?: unknown; evidenceFileIds?: unknown }) {
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
    // The client's message (a screenshot, an email as PDF), which whoever confirms it reads beside the reason.
    const fileIds = evidenceIds(input.evidenceFileIds);
    if (!reason) throw new UnprocessableEntityException({ statusCode: 422, message: "Say why the client is withdrawing", missing: [{ key: "reason", label: "Say why the client is withdrawing" }] });
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const facts = await this.facts(client, workspaceId, opportunityId, true);
      const proposals = await loadProposals(client, workspaceId, opportunityId);
      if (!proposals.find((proposal) => proposal.kind === "design")?.wonAt) throw new ConflictException("Proposal 2 can be withdrawn once Proposal 1 is won");
      const main = proposals.find((proposal) => proposal.kind === "main");
      if (main?.wonAt) throw new ConflictException("Proposal 2 is already won");
      if (main?.withdrawal) throw new ConflictException(main.withdrawal.status === "confirmed" ? "Proposal 2 is already withdrawn" : "The withdrawal is waiting to be confirmed");
      const saved = await client.query<{ id: string }>(
        `INSERT INTO crm_opportunity_proposals (workspace_id, opportunity_id, kind, value_status, withdrawal_status, withdrawal_reason, withdrawal_requested_by, withdrawal_requested_at)
         VALUES ($1, $2, 'main', 'empty', 'requested', $3, $4, now())
         ON CONFLICT (workspace_id, opportunity_id, kind) DO UPDATE
           SET withdrawal_status = 'requested', withdrawal_reason = EXCLUDED.withdrawal_reason, withdrawal_requested_by = EXCLUDED.withdrawal_requested_by,
               withdrawal_requested_at = now(), withdrawal_decided_by = NULL, withdrawal_decided_at = NULL, withdrawal_note = NULL,
               version = crm_opportunity_proposals.version + 1, updated_at = now()
         RETURNING id`, [workspaceId, opportunityId, reason, user.userId]);
      await bindEvidence(client, workspaceId, user.userId, "proposal_withdrawal", saved.rows[0].id, fileIds);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.proposal.withdrawal_requested.v1", entityType: "crm_opportunity", entityId: opportunityId, before: null, after: { kind: "main", reason, files: fileIds.length } });
      const actorName = await this.name(client, user.userId);
      for (const recipient of await permissionHolders(client, workspaceId, "commercial.deal.approve")) {
        if (recipient === user.userId) continue;
        await notifyUserInApp(client, { workspaceId, recipientUserId: recipient, code: "crm.proposal_withdrawal_requested", eventType: "crm.proposal.withdrawal_requested",
          variables: { reference: facts.reference, clientName: facts.clientName ?? facts.title, actor: actorName, reason },
          deepLink: `/workspace/crm/opportunities?record=${opportunityId}`, idempotencyKey: `crm:withdrawal:${opportunityId}:${recipient}:${Date.now()}` });
      }
      return this.view(client, workspaceId, opportunityId, user.userId);
    });
  }

  /** §0.3 P0: whoever approves deals confirms the withdrawal after reviewing it, or sends it back with a note; never their own request. */
  async decideWithdrawal(actor: RequestActor, workspaceId: string, opportunityId: string, input: { decision?: unknown; note?: unknown }) {
    const decision = input.decision === "confirm" || input.decision === "return" ? input.decision : null;
    if (!decision) throw new UnprocessableEntityException("Confirm the withdrawal or send it back");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
    if (decision === "return" && !note) throw new UnprocessableEntityException({ statusCode: 422, message: "Say why it goes back", missing: [{ key: "note", label: "Say why it goes back" }] });
    return this.access.withPermission(actor, workspaceId, "commercial.deal.approve", async (client, user) => {
      const facts = await this.facts(client, workspaceId, opportunityId, true);
      const main = (await client.query<{ status: string | null; requestedBy: string | null }>(
        `SELECT withdrawal_status AS status, withdrawal_requested_by AS "requestedBy" FROM crm_opportunity_proposals WHERE workspace_id = $1 AND opportunity_id = $2 AND kind = 'main' FOR UPDATE`,
        [workspaceId, opportunityId])).rows[0];
      if (main?.status !== "requested") throw new ConflictException("There is no withdrawal waiting to be confirmed");
      if (main.requestedBy === user.userId) throw new ConflictException("Someone else confirms a withdrawal you recorded");
      if (decision === "confirm")
        await client.query(`UPDATE crm_opportunity_proposals SET withdrawal_status = 'confirmed', withdrawal_decided_by = $3, withdrawal_decided_at = now(), withdrawal_note = $4, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND opportunity_id = $2 AND kind = 'main'`, [workspaceId, opportunityId, user.userId, note]);
      else
        await client.query(`UPDATE crm_opportunity_proposals SET withdrawal_status = NULL, withdrawal_reason = NULL, withdrawal_requested_by = NULL, withdrawal_requested_at = NULL,
          withdrawal_decided_by = NULL, withdrawal_decided_at = NULL, withdrawal_note = NULL, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND opportunity_id = $2 AND kind = 'main'`, [workspaceId, opportunityId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: decision === "confirm" ? "crm.proposal.withdrawal_confirmed.v1" : "crm.proposal.withdrawal_returned.v1",
        entityType: "crm_opportunity", entityId: opportunityId, before: { status: "requested" }, after: { status: decision === "confirm" ? "confirmed" : null, note } });
      if (main.requestedBy && main.requestedBy !== user.userId)
        await notifyUserInApp(client, { workspaceId, recipientUserId: main.requestedBy, code: "crm.proposal_withdrawal_decided", eventType: "crm.proposal.withdrawal_decided",
          variables: { reference: facts.reference, clientName: facts.clientName ?? facts.title, actor: await this.name(client, user.userId), decision: decision === "confirm" ? "confirmed" : "sent back", note: note ?? "" },
          deepLink: `/workspace/crm/opportunities?record=${opportunityId}`, idempotencyKey: `crm:withdrawal-decided:${opportunityId}:${Date.now()}` });
      return this.view(client, workspaceId, opportunityId, user.userId);
    });
  }

  private async name(client: PoolClient, userId: string) {
    return (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
  }

  /** PLM-102: collection, delivery or installation, with who received it. Replay-safe per command. */
  async recordFulfilment(actor: RequestActor, workspaceId: string, opportunityId: string, input: { event?: unknown; receivedBy?: unknown; note?: unknown; commandId?: unknown }, file?: ReferenceUpload) {
    const event = FULFILMENT_EVENTS.includes(input.event as FulfilmentEvent) ? input.event as FulfilmentEvent : null;
    if (!event) throw new UnprocessableEntityException("Collected, delivered or installed");
    // Guide J: a delivery or an installation is recorded with its photo, the proof of delivery.
    if (event !== "collected" && !file) throw new UnprocessableEntityException("Add a photo of the delivery as proof");
    const prepared = file ? await prepareReferenceUpload(file) : null;
    if (prepared && !prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new UnprocessableEntityException("Add a photo or a PDF of the delivery note");
    const receivedBy = typeof input.receivedBy === "string" ? input.receivedBy.trim().slice(0, 200) : "";
    if (!receivedBy) throw new UnprocessableEntityException("Who received it?");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId : null;
    return this.access.withAnyPermission(actor, workspaceId, FULFIL, async (client, user) => {
      const facts = await this.facts(client, workspaceId, opportunityId, true);
      if (facts.status !== "won") throw new ConflictException("The deal is won first: attach the payment proof.");
      // PLM-150: goods the factory makes leave once they passed their last design inspection (a replay records nothing new).
      if (event !== "installed" && !(commandId && (await client.query(`SELECT 1 FROM crm_deal_fulfilment_events WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, commandId])).rowCount))
        await assertDeliveryCleared(client, workspaceId, { opportunityId });
      const key = prepared ? ["crm-fulfilment-proofs", workspaceId, opportunityId, prepared.digest].join("/") : null;
      if (prepared && key) {
        if (!this.storage) throw new ConflictException("Files can't be stored here yet.");
        await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      }
      const row = (await client.query<{ id: string }>(
        `INSERT INTO crm_deal_fulfilment_events (workspace_id, opportunity_id, event, received_by, note, command_id, recorded_by, proof_storage_key, proof_file_name, proof_mime_type, proof_has_preview)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (workspace_id, command_id) WHERE command_id IS NOT NULL DO NOTHING RETURNING id`,
        [workspaceId, opportunityId, event, receivedBy, note, commandId, user.userId, key, prepared?.name ?? null, prepared?.mimeType ?? null, Boolean(prepared?.preview)])).rows[0];
      if (row) {
        // PLM-125: collection or delivery takes the goods held for the deal out of stock where its path says so (Furniture C).
        if (event !== "installed") await takeForDeal(client, workspaceId, { opportunityId, event: "fulfilled", actorUserId: user.userId });
        const closing = await loadDealClosing(client, workspaceId, opportunityId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.deal.fulfilment_recorded.v1", entityType: "crm_opportunity", entityId: opportunityId,
          after: { event, receivedBy, note, fulfilmentId: row.id, dealClosed: closing?.closed ?? false, closingEvent: closing?.event ?? null } });
      }
      return this.view(client, workspaceId, opportunityId, user.userId);
    });
  }

  /** A delivery's proof photo (or its preview), for whoever sees the opportunity. */
  fulfilmentProof(actor: RequestActor, workspaceId: string, opportunityId: string, fulfilmentId: string, preview: boolean) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const proof = (await client.query<{ key: string | null; name: string | null; mimeType: string | null; hasPreview: boolean }>(
        `SELECT proof_storage_key AS key, proof_file_name AS name, proof_mime_type AS "mimeType", proof_has_preview AS "hasPreview"
           FROM crm_deal_fulfilment_events WHERE workspace_id = $1 AND opportunity_id = $2 AND id = $3`, [workspaceId, opportunityId, fulfilmentId])).rows[0];
      if (!proof?.key || !this.storage) throw new NotFoundException("No proof on this record.");
      if (preview && !proof.hasPreview) throw new NotFoundException("Preview not available.");
      const stored = await this.storage.read(`${proof.key}/${preview ? "preview.webp" : "original"}`).catch(() => { throw new NotFoundException("This file could not be found in storage."); });
      return { body: stored.body, contentType: preview ? "image/webp" : proof.mimeType ?? "application/octet-stream", name: proof.name ?? "proof", preview };
    });
  }

  /** The closing event per path of one enquiry type's flow (seeded from its template when it has none). */
  closingRules(actor: RequestActor, workspaceId: string, flowId: string) {
    return this.access.withPermission(actor, workspaceId, SETTINGS, (client) => this.rules(client, workspaceId, flowId));
  }

  private async rules(client: PoolClient, workspaceId: string, flowId: string) {
    const flow = (await client.query<{ code: string }>(`SELECT code FROM crm_flows WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId])).rows[0];
    if (!flow) throw new NotFoundException("Flow not found");
    const latest = await latestFlowVersion(client, workspaceId, flow.code);
    const rules = latest?.flowId ? await ensureClosingRules(client, workspaceId, { flowId, code: flow.code, definition: latest.definition }) : await loadClosingRules(client, workspaceId, flowId);
    const furniture = latest ? latest.definition.branches.some((branch) => branch.question === "subPath") : false;
    return { flowId, events: CLOSING_EVENTS, furniturePaths: furniture ? FURNITURE_PATHS : [], rules };
  }

  /** Saves a flow's closing rules as a whole (version-checked against the rows the editor saw; audited). */
  saveClosingRules(actor: RequestActor, workspaceId: string, flowId: string, input: { rules?: unknown; versions?: unknown }) {
    const rules = Array.isArray(input.rules) ? input.rules : [];
    const parsed = rules.map((rule) => {
      const value = rule && typeof rule === "object" ? rule as Record<string, unknown> : {};
      const path = value.furniturePath === null || value.furniturePath === undefined || value.furniturePath === "" ? null : value.furniturePath;
      if (path !== null && !FURNITURE_PATHS.includes(path as FurniturePath)) throw new UnprocessableEntityException("Choose a furniture path");
      if (!CLOSING_EVENTS.includes(value.closingEvent as ClosingEvent)) throw new UnprocessableEntityException("Choose what closes the deal");
      return { furniturePath: path as FurniturePath | null, closingEvent: value.closingEvent as ClosingEvent };
    });
    if (new Set(parsed.map((rule) => rule.furniturePath ?? "")).size !== parsed.length) throw new UnprocessableEntityException("One closing per path");
    const seen = typeof input.versions === "string" ? input.versions : "";
    return this.access.withPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const before = (await this.rules(client, workspaceId, flowId)).rules;
      await client.query(`SELECT 1 FROM crm_flows WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, flowId]);
      const fingerprint = before.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`).join(",");
      if (seen && seen !== fingerprint) throw new ConflictException("Someone changed how this type closes. Reload to see it.");
      const same = before.length === parsed.length && parsed.every((rule) => before.some((row) => row.furniturePath === rule.furniturePath && row.closingEvent === rule.closingEvent));
      if (same) return this.rules(client, workspaceId, flowId);
      for (const rule of parsed) {
        await client.query(
          `INSERT INTO crm_flow_closing_rules (workspace_id, flow_id, furniture_path, closing_event, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO UPDATE SET closing_event = EXCLUDED.closing_event, updated_by = EXCLUDED.updated_by,
             version = crm_flow_closing_rules.version + CASE WHEN crm_flow_closing_rules.closing_event = EXCLUDED.closing_event THEN 0 ELSE 1 END`,
          [workspaceId, flowId, rule.furniturePath, rule.closingEvent, user.userId]);
      }
      const kept = parsed.map((rule) => rule.furniturePath ?? "");
      await client.query(`DELETE FROM crm_flow_closing_rules WHERE workspace_id = $1 AND flow_id = $2 AND NOT (coalesce(furniture_path, '') = ANY($3::text[]))`, [workspaceId, flowId, kept]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.flow.closing_changed.v1", entityType: "crm_flow", entityId: flowId,
        before: before.map(({ furniturePath, closingEvent }) => ({ furniturePath, closingEvent })), after: parsed });
      return this.rules(client, workspaceId, flowId);
    });
  }

  /** PLM-098: the areas a job of this enquiry type uses after Won, per furniture path. No rules = every area (a furniture flow: the kit's per path). */
  wonAreas(actor: RequestActor, workspaceId: string, flowId: string) {
    return this.access.withPermission(actor, workspaceId, SETTINGS, (client) => this.areas(client, workspaceId, flowId));
  }

  private async areas(client: PoolClient, workspaceId: string, flowId: string) {
    const flow = (await client.query<{ code: string }>(`SELECT code FROM crm_flows WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId])).rows[0];
    if (!flow) throw new NotFoundException("Flow not found");
    const latest = await latestFlowVersion(client, workspaceId, flow.code);
    const furniture = latest ? latest.definition.branches.some((branch) => branch.question === "subPath") : false;
    return { flowId, areas: WON_AREAS, furniturePaths: furniture ? FURNITURE_PATHS : [], rules: effectiveWonAreas(await loadWonAreas(client, workspaceId, flowId), furniture) };
  }

  /** Saves a flow's areas as a whole (version-checked against the rows the editor saw; audited). Every area on every path clears the rules. */
  saveWonAreas(actor: RequestActor, workspaceId: string, flowId: string, input: { rules?: unknown; versions?: unknown }) {
    const asked = parseWonAreas(input.rules ?? []);
    if (typeof asked === "string") throw new UnprocessableEntityException(asked);
    const seen = typeof input.versions === "string" ? input.versions : "";
    return this.access.withPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      await client.query(`SELECT 1 FROM crm_flows WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, flowId]);
      const view = await this.areas(client, workspaceId, flowId);
      const before = view.rules;
      // Every area on every path: a furniture flow keeps that as its own rule (no rows would mean the kit's paths again).
      const parsed = !asked.length && view.furniturePaths.length ? [{ furniturePath: null, areas: [...WON_AREAS] }] : asked;
      const fingerprint = before.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`).join(",");
      if (seen !== fingerprint) throw new ConflictException("Someone changed the areas of this type. Reload to see them.");
      const same = before.length === parsed.length && parsed.every((rule) => before.some((row) => row.furniturePath === rule.furniturePath && row.areas.join() === rule.areas.join()));
      if (same) return this.areas(client, workspaceId, flowId);
      for (const rule of parsed) {
        await client.query(
          `INSERT INTO crm_flow_won_areas (workspace_id, flow_id, furniture_path, areas, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO UPDATE SET areas = EXCLUDED.areas, updated_by = EXCLUDED.updated_by, updated_at = now(),
             version = crm_flow_won_areas.version + CASE WHEN crm_flow_won_areas.areas = EXCLUDED.areas THEN 0 ELSE 1 END`,
          [workspaceId, flowId, rule.furniturePath, rule.areas, user.userId]);
      }
      await client.query(`DELETE FROM crm_flow_won_areas WHERE workspace_id = $1 AND flow_id = $2 AND NOT (coalesce(furniture_path, '') = ANY($3::text[]))`,
        [workspaceId, flowId, parsed.map((rule) => rule.furniturePath ?? "")]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.flow.won_areas_changed.v1", entityType: "crm_flow", entityId: flowId,
        before: before.map(({ furniturePath, areas }) => ({ furniturePath, areas })), after: parsed });
      return this.areas(client, workspaceId, flowId);
    });
  }

  private async facts(client: PoolClient, workspaceId: string, opportunityId: string, lock = false) {
    const row = (await client.query<{ title: string; reference: string; clientName: string | null; status: string }>(
      `SELECT opportunity.title, opportunity.reference, party.display_name AS "clientName", opportunity.status::text AS status
         FROM crm_opportunities opportunity LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2 ${lock ? "FOR UPDATE OF opportunity" : ""}`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return row;
  }

  private async any(client: PoolClient, workspaceId: string, userId: string, permissions: string[]) {
    for (const permission of permissions) if (await this.access.hasPermission(client, workspaceId, userId, permission)) return true;
    return false;
  }
}

