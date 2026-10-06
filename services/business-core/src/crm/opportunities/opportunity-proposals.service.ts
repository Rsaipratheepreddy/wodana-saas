import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { approvalStatus, canDecideApproval } from "../../approvals/approval-engine";
import { isCurrencyCode } from "../../common/regional.validators";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CLOSING_EVENTS, ensureClosingRules, loadClosingRules, type ClosingEvent } from "../flows/flow-closing";
import { latestFlowVersion } from "../flows/flow-store";
import { FULFILMENT_EVENTS, loadDealClosing, loadFulfilment, type FulfilmentEvent } from "./deal-closing";
import { FURNITURE_PATHS, type FurniturePath } from "./flow-gates";
import {
  decideProposalValue, loadProposals, loadValueEvents, parseProposalAmount, parseProposalKind, setProposalValue, valueStatusFrom, VALUE_KIND,
} from "./opportunity-proposals";

const VIEW = "crm.opportunities.view";
const ENTER = ["crm.opportunities.manage", "commercial.finance.verify"];
const SENSITIVE = "crm.opportunities.sensitive_values";
const FULFIL = ["crm.opportunities.manage", "projects.manage"];
const SETTINGS = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLM-101 / PLM-103 / PLM-102 on the opportunity: Proposal 1 and Proposal 2 with their values (entered → Finance
 * verifies → the approver locks, on the E3 engine; a later change is a new approval with old → new), Won dates, and
 * the deal's closing (configuration per enquiry type, computed from fulfilment and project records).
 */
@Injectable()
export class OpportunityProposalsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client, user) => this.view(client, workspaceId, opportunityId, user.userId));
  }

  private async view(client: PoolClient, workspaceId: string, opportunityId: string, userId: string) {
    await this.facts(client, workspaceId, opportunityId);
    const canSee = await this.access.hasPermission(client, workspaceId, userId, SENSITIVE);
    const proposals = await loadProposals(client, workspaceId, opportunityId);
    const events = await loadValueEvents(client, workspaceId, opportunityId);
    const rows = [];
    for (const proposal of proposals) {
      const approval = await approvalStatus(client, workspaceId, VALUE_KIND, proposal.id);
      const pending = approval?.status === "pending" ? approval : null;
      const decide = pending ? await canDecideApproval(client, workspaceId, pending.id, userId) : null;
      rows.push({
        ...proposal, amount: canSee ? proposal.amount : null, valueStatus: valueStatusFrom(approval, proposal.valueStatus),
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
      can: { enter: await this.any(client, workspaceId, userId, ENTER), fulfil: await this.any(client, workspaceId, userId, FULFIL) },
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

  /** PLM-102: collection, delivery or installation, with who received it. Replay-safe per command. */
  recordFulfilment(actor: RequestActor, workspaceId: string, opportunityId: string, input: { event?: unknown; receivedBy?: unknown; note?: unknown; commandId?: unknown }) {
    const event = FULFILMENT_EVENTS.includes(input.event as FulfilmentEvent) ? input.event as FulfilmentEvent : null;
    if (!event) throw new UnprocessableEntityException("Collected, delivered or installed");
    const receivedBy = typeof input.receivedBy === "string" ? input.receivedBy.trim().slice(0, 200) : "";
    if (!receivedBy) throw new UnprocessableEntityException("Who received it?");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId : null;
    return this.access.withAnyPermission(actor, workspaceId, FULFIL, async (client, user) => {
      const facts = await this.facts(client, workspaceId, opportunityId, true);
      if (facts.status !== "won") throw new ConflictException("The deal is won first: attach the payment proof.");
      const row = (await client.query<{ id: string }>(
        `INSERT INTO crm_deal_fulfilment_events (workspace_id, opportunity_id, event, received_by, note, command_id, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, command_id) WHERE command_id IS NOT NULL DO NOTHING RETURNING id`,
        [workspaceId, opportunityId, event, receivedBy, note, commandId, user.userId])).rows[0];
      if (row) {
        const closing = await loadDealClosing(client, workspaceId, opportunityId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.deal.fulfilment_recorded.v1", entityType: "crm_opportunity", entityId: opportunityId,
          after: { event, receivedBy, note, fulfilmentId: row.id, dealClosed: closing?.closed ?? false, closingEvent: closing?.event ?? null } });
      }
      return this.view(client, workspaceId, opportunityId, user.userId);
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

