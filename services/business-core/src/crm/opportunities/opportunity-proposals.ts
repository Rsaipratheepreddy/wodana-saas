import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";
import { Dec } from "../../catalog-core/decimal";
import {
  amendApprovalAmount, approvalStatus, cancelApproval, decideApproval, requestApproval, trim,
} from "../../approvals/approval-engine";
import type { ApprovalDecision, ApprovalStatus } from "../../approvals/approval-policy";
import { PROPOSAL_KIND_TITLE } from "../../approvals/approval-titles";
import type { FlowDefinition } from "../flows/flow-definition";
import { flowCapabilities } from "../flows/flow-capabilities";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-103 / PLM-101 / PLM-009: one opportunity carries up to two proposals — Proposal 1, the design fee, and
 * Proposal 2, the main furniture / joinery / fit-out quotation after design approval. Each has its own value,
 * Finance verification and approver lock (both on the E3 engine, kind `opportunity_value`), proof and Won date,
 * so design and production revenue are reported apart and the opportunity is counted once in conversion.
 * A change to a locked value is a new approval showing the old and the new value; the locked value stays until it
 * is approved.
 */
export const PROPOSAL_KINDS = ["design", "main"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** The value's life: empty → entered → verified (Finance) → approved (the Deal File approver; locked). */
export type ValueStatus = "empty" | "entered" | "verified" | "approved";
export const VALUE_KIND = "opportunity_value" as const;

export type ProposalRow = {
  id: string; kind: ProposalKind; amount: string | null; currencyCode: string | null; valueStatus: ValueStatus;
  enteredAt: string | null; enteredBy: string | null; verifiedAt: string | null; verifiedBy: string | null;
  approvedAt: string | null; approvedBy: string | null; wonAt: string | null; quoteId: string | null; version: number;
};
export type ValueEvent = {
  id: string; kind: ProposalKind; action: "entered" | "changed" | "verified" | "approved" | "returned" | "won";
  fromAmount: string | null; toAmount: string | null; currencyCode: string | null; note: string | null; actor: string | null; at: string;
};

const AMOUNT = /^\d{1,16}(\.\d{1,4})?$/;

/** A money amount as the database keeps it: a decimal text with up to four places, never a float. */
export function parseProposalAmount(value: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!AMOUNT.test(text)) throw new UnprocessableEntityException("Enter the value as a number, for example 125000 or 125000.50");
  return text;
}

export function parseProposalKind(value: unknown): ProposalKind {
  if (value === "design" || value === "main") return value;
  throw new UnprocessableEntityException("Choose Proposal 1 (design) or Proposal 2 (main)");
}

/**
 * Which proposal a Won marks (PLM-009): the round the payment belongs to when known; otherwise the first proposal
 * that is not Won yet, design before main; a deal with no proposal rows yet wins its main proposal.
 */
export function wonProposalKind(existing: Array<Pick<ProposalRow, "kind" | "wonAt">>, round: ProposalKind | null | undefined, designRound = false): ProposalKind {
  if (round) return round;
  const design = existing.find((proposal) => proposal.kind === "design");
  if (design && !design.wonAt) return "design";
  // QA-005: a job with a design round wins Proposal 1 first, even before its value is entered (no proposal row yet).
  if (!design && designRound && !existing.find((proposal) => proposal.kind === "main")?.wonAt) return "design";
  return "main";
}

/**
 * Whether the job has a design round (Proposal 1): its flow (the version it pinned, else its enquiry type's latest) has
 * a design package round, whatever the flow's code, or its Planning case has a design-round quotation (a Design Fee
 * proposal). Read when a Won doesn't name its round. Read only: it never pins a version.
 */
export async function hasDesignRound(db: Db, workspaceId: string, opportunityId: string) {
  const row = (await db.query<{ quote: boolean; typeCode: string | null; code: string | null; definition: FlowDefinition | null }>(
    `SELECT EXISTS (SELECT 1 FROM commercial_quotes quote JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id
                     WHERE quote.workspace_id = $1 AND pre_case.opportunity_id = $2 AND quote.kind = 'quotation' AND quote.round = 'design'
                       AND quote.status NOT IN ('withdrawn', 'superseded')) AS quote,
            choice.flow AS "typeCode", coalesce(pinned_flow.code, choice.flow) AS code, coalesce(pinned.definition, latest.definition) AS definition
       FROM crm_opportunities opportunity
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_flows pinned_flow ON pinned_flow.workspace_id = pinned.workspace_id AND pinned_flow.id = pinned.flow_id
       LEFT JOIN crm_flows typed ON typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow AND typed.status = 'active'
       LEFT JOIN LATERAL (SELECT version.definition FROM crm_flow_versions version WHERE version.workspace_id = typed.workspace_id AND version.flow_id = typed.id
                           ORDER BY version.version DESC LIMIT 1) latest ON pinned.id IS NULL
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`,
    [workspaceId, opportunityId])).rows[0];
  if (!row) return false;
  return row.quote || flowCapabilities(row.definition, row.code).designPackage || flowCapabilities(null, row.typeCode).designPackage;
}

/** The headline opportunity value: the sum of the proposal values, when they share a currency. Exact decimals. */
export function headlineValue(proposals: Array<Pick<ProposalRow, "amount" | "currencyCode">>): { amount: string; currencyCode: string } | null {
  const priced = proposals.filter((proposal) => proposal.amount && proposal.currencyCode);
  if (!priced.length) return null;
  const currency = priced[0].currencyCode!;
  if (priced.some((proposal) => proposal.currencyCode !== currency)) return null;
  return { amount: trim(priced.reduce((sum, proposal) => sum.add(proposal.amount!), Dec.ZERO).toFixed(4))!, currencyCode: currency };
}

/** The status a value shows from its approval request (E3): Finance's step done → verified; approved → locked. */
export function valueStatusFrom(approval: Pick<ApprovalStatus, "status" | "currentStep" | "previousAmount"> | null, current: ValueStatus): ValueStatus {
  if (!approval) return current;
  if (approval.status === "approved") return "approved";
  // A change to a locked value waits for approval; the locked value stays.
  if (approval.previousAmount !== null && current === "approved") return "approved";
  if (approval.status === "pending") return approval.currentStep > 1 ? "verified" : "entered";
  return current === "approved" ? "approved" : "entered";
}

const PROPOSAL_SELECT = `proposal.id, proposal.kind, proposal.amount::text AS amount, proposal.currency_code AS "currencyCode", proposal.value_status AS "valueStatus",
  proposal.entered_at AS "enteredAt", entered.display_name AS "enteredBy", proposal.verified_at AS "verifiedAt", verified.display_name AS "verifiedBy",
  proposal.approved_at AS "approvedAt", approved.display_name AS "approvedBy", proposal.won_at AS "wonAt", proposal.quote_id AS "quoteId", proposal.version`;
const PROPOSAL_FROM = `crm_opportunity_proposals proposal
  LEFT JOIN users entered ON entered.id = proposal.entered_by LEFT JOIN users verified ON verified.id = proposal.verified_by LEFT JOIN users approved ON approved.id = proposal.approved_by`;

const isoRow = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as T;

export async function loadProposals(db: Db, workspaceId: string, opportunityId: string): Promise<ProposalRow[]> {
  return (await db.query<ProposalRow>(
    `SELECT ${PROPOSAL_SELECT} FROM ${PROPOSAL_FROM} WHERE proposal.workspace_id = $1 AND proposal.opportunity_id = $2
      ORDER BY CASE proposal.kind WHEN 'design' THEN 1 ELSE 2 END`, [workspaceId, opportunityId])).rows
    .map((row) => isoRow({ ...row, amount: trim(row.amount) }));
}

async function lockProposal(db: Db, workspaceId: string, opportunityId: string, kind: ProposalKind) {
  const row = (await db.query<ProposalRow>(
    `SELECT ${PROPOSAL_SELECT} FROM ${PROPOSAL_FROM} WHERE proposal.workspace_id = $1 AND proposal.opportunity_id = $2 AND proposal.kind = $3 FOR UPDATE OF proposal`,
    [workspaceId, opportunityId, kind])).rows[0];
  return row ? isoRow({ ...row, amount: trim(row.amount) }) : null;
}

export async function loadValueEvents(db: Db, workspaceId: string, opportunityId: string): Promise<ValueEvent[]> {
  return (await db.query<ValueEvent>(
    `SELECT event.id, event.kind, event.action, event.from_amount::text AS "fromAmount", event.to_amount::text AS "toAmount", event.currency_code AS "currencyCode",
            event.note, account.display_name AS actor, event.at
       FROM crm_opportunity_value_events event LEFT JOIN users account ON account.id = event.actor_user_id
      WHERE event.workspace_id = $1 AND event.opportunity_id = $2 ORDER BY event.at DESC, event.id DESC LIMIT 100`, [workspaceId, opportunityId])).rows
    .map((row) => isoRow({ ...row, fromAmount: trim(row.fromAmount), toAmount: trim(row.toAmount) }));
}

async function logValue(db: Db, input: { workspaceId: string; opportunityId: string; proposalId: string; kind: ProposalKind; action: ValueEvent["action"];
  from: string | null; to: string | null; currency: string | null; note?: string | null; actorUserId: string | null; at?: string }) {
  await db.query(
    `INSERT INTO crm_opportunity_value_events (workspace_id, opportunity_id, proposal_id, kind, action, from_amount, to_amount, currency_code, note, actor_user_id, at)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10, coalesce($11::timestamptz, now()))`,
    [input.workspaceId, input.opportunityId, input.proposalId, input.kind, input.action, input.from, input.to, input.currency, input.note ?? null, input.actorUserId, input.at ?? null]);
}

/** The opportunity's headline value follows its proposals (their sum in one currency); the pipeline and forecasts read it. */
export async function syncHeadline(db: Db, workspaceId: string, opportunityId: string) {
  const headline = headlineValue(await loadProposals(db, workspaceId, opportunityId));
  if (!headline) return;
  await db.query(
    `UPDATE crm_opportunities SET amount = $3::numeric, currency_code = $4,
            reporting_amount = CASE WHEN reporting_currency_code = $4 THEN $3::numeric ELSE reporting_amount END, version = version + 1
      WHERE workspace_id = $1 AND id = $2 AND (amount IS DISTINCT FROM $3::numeric OR currency_code IS DISTINCT FROM $4)`,
    [workspaceId, opportunityId, headline.amount, headline.currencyCode]);
}

// The same words the approval engine reads the live title with (approval-titles), so a renamed client shows its current name.
const KIND_TITLE: Record<ProposalKind, string> = PROPOSAL_KIND_TITLE;
const href = (opportunityId: string) => `/workspace/crm/opportunities?record=${opportunityId}`;

/**
 * Enters or changes a proposal's value (PLM-101). Before the lock it is saved and goes to Finance to verify (any
 * earlier verification resets, E3-3). After the lock the locked value stays and the change waits for approval with
 * old → new. The same value again changes nothing (idempotent) unless its approval was sent back.
 */
export async function setProposalValue(db: Db, input: {
  workspaceId: string; opportunityId: string; title: string; kind: ProposalKind; amount: string; currency: string; note: string | null;
  actorUserId: string; expectedVersion?: number | null;
}) {
  const current = await lockProposal(db, input.workspaceId, input.opportunityId, input.kind);
  if (current && input.expectedVersion !== undefined && input.expectedVersion !== null && input.expectedVersion !== current.version)
    throw new ConflictException("This proposal changed; reload and try again");
  const title = `${input.title} · ${KIND_TITLE[input.kind]}`;
  const open = current ? await approvalStatus(db, input.workspaceId, VALUE_KIND, current.id) : null;
  const same = current?.amount === trim(input.amount) && current?.currencyCode === input.currency;
  if (current?.valueStatus === "approved") {
    // A change after the lock: a new approval with the old and new values; the locked value stays until it is approved.
    if (same && !(open?.status === "pending" && open.previousAmount !== null)) return { changed: false, approval: open };
    if (open?.status === "pending" && open.previousAmount !== null && trim(open.amount) === trim(input.amount) && open.currency === input.currency)
      return { changed: false, approval: open };
    const { status } = await amendApprovalAmount(db, { workspaceId: input.workspaceId, kind: VALUE_KIND, subjectId: current.id, amount: input.amount, currency: input.currency,
      actorUserId: input.actorUserId, title, href: href(input.opportunityId) });
    await logValue(db, { ...input, proposalId: current.id, action: "changed", from: current.amount, to: input.amount, currency: input.currency,
      note: input.note ?? "Waiting for approval" });
    await db.query(`UPDATE crm_opportunity_proposals SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, current.id]);
    return { changed: true, approval: status };
  }
  if (same && open?.status === "pending") return { changed: false, approval: open };
  const saved = (await db.query<{ id: string }>(
    `INSERT INTO crm_opportunity_proposals (workspace_id, opportunity_id, kind, amount, currency_code, value_status, entered_by, entered_at)
     VALUES ($1, $2, $3, $4::numeric, $5, 'entered', $6, now())
     ON CONFLICT (workspace_id, opportunity_id, kind) DO UPDATE SET amount = EXCLUDED.amount, currency_code = EXCLUDED.currency_code, value_status = 'entered',
       entered_by = EXCLUDED.entered_by, entered_at = now(), verified_by = NULL, verified_at = NULL, version = crm_opportunity_proposals.version + 1
     RETURNING id`, [input.workspaceId, input.opportunityId, input.kind, input.amount, input.currency, input.actorUserId])).rows[0];
  await logValue(db, { ...input, proposalId: saved.id, action: current?.amount ? "changed" : "entered", from: current?.amount ?? null, to: input.amount, currency: input.currency });
  const approval = await requestApproval(db, { workspaceId: input.workspaceId, kind: VALUE_KIND, subjectId: saved.id, title, href: href(input.opportunityId),
    amount: input.amount, currency: input.currency, requesterUserId: input.actorUserId });
  await syncHeadline(db, input.workspaceId, input.opportunityId);
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "crm.opportunity.value_set.v1", entityType: "crm_opportunity", entityId: input.opportunityId,
    before: current ? { kind: input.kind, amount: current.amount, valueStatus: current.valueStatus } : null,
    after: { kind: input.kind, amount: input.amount, currencyCode: input.currency, approvalId: approval.id, note: input.note } });
  return { changed: true, approval };
}

/**
 * What an `opportunity_value` decision does to the proposal: Finance's step verifies it, the last step locks it
 * (a change request applies its new value), a return or refusal keeps the locked value or sends an unlocked one
 * back to entered. Called after the engine decided, in the same transaction (from the opportunity or the inbox).
 */
export async function applyValueDecision(db: Db, workspaceId: string, approval: ApprovalStatus, decision: ApprovalDecision, actorUserId: string, note: string | null) {
  const proposal = (await db.query<{ opportunityId: string; kind: ProposalKind; amount: string | null; currencyCode: string | null; valueStatus: ValueStatus }>(
    `SELECT opportunity_id AS "opportunityId", kind, amount::text AS amount, currency_code AS "currencyCode", value_status AS "valueStatus"
       FROM crm_opportunity_proposals WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, approval.subjectId])).rows[0];
  if (!proposal) return;
  const base = { workspaceId, opportunityId: proposal.opportunityId, proposalId: approval.subjectId, kind: proposal.kind, actorUserId, currency: approval.currency, note };
  if (decision === "approve" && approval.status === "approved") {
    await db.query(
      `UPDATE crm_opportunity_proposals SET amount = $3::numeric, currency_code = $4, value_status = 'approved', approved_by = $5, approved_at = now(),
              verified_by = coalesce(verified_by, $5), verified_at = coalesce(verified_at, now()), version = version + 1
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, approval.subjectId, approval.amount, approval.currency, actorUserId]);
    await logValue(db, { ...base, action: "approved", from: approval.previousAmount ?? trim(proposal.amount), to: approval.amount });
    await syncHeadline(db, workspaceId, proposal.opportunityId);
  } else if (decision === "approve") {
    if (proposal.valueStatus !== "approved")
      await db.query(`UPDATE crm_opportunity_proposals SET value_status = 'verified', verified_by = $3, verified_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, approval.subjectId, actorUserId]);
    else await db.query(`UPDATE crm_opportunity_proposals SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, approval.subjectId]);
    await logValue(db, { ...base, action: "verified", from: approval.previousAmount, to: approval.amount });
  } else {
    if (proposal.valueStatus === "verified")
      await db.query(`UPDATE crm_opportunity_proposals SET value_status = 'entered', verified_by = NULL, verified_at = NULL, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, approval.subjectId]);
    else await db.query(`UPDATE crm_opportunity_proposals SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, approval.subjectId]);
    await logValue(db, { ...base, action: "returned", from: approval.previousAmount, to: approval.amount });
  }
  await recordAudit(db, { workspaceId, actorUserId, action: `crm.opportunity.value_${decision === "approve" ? (approval.status === "approved" ? "approved" : "verified") : "returned"}.v1`,
    entityType: "crm_opportunity", entityId: proposal.opportunityId, after: { kind: proposal.kind, approvalId: approval.id, amount: approval.amount, previousAmount: approval.previousAmount, note } });
}

/** Finance verifies, the approver locks, or either sends it back — the engine decides who may (E3). */
export async function decideProposalValue(db: Db, input: {
  workspaceId: string; opportunityId: string; kind: ProposalKind; decision: ApprovalDecision; note: string | null; actorUserId: string;
  expectedVersion?: number | null; commandId?: string | null; waiveSeparation?: boolean;
}) {
  const proposal = await lockProposal(db, input.workspaceId, input.opportunityId, input.kind);
  if (!proposal) throw new UnprocessableEntityException("Enter the value first");
  const approval = await decideApproval(db, { workspaceId: input.workspaceId, kind: VALUE_KIND, subjectId: proposal.id, deciderUserId: input.actorUserId,
    decision: input.decision, note: input.note, expectedVersion: input.expectedVersion, commandId: input.commandId, waiveSeparation: input.waiveSeparation });
  await applyValueDecision(db, input.workspaceId, approval, input.decision, input.actorUserId, input.note);
  return approval;
}

/**
 * Won is a payment proof (PLM-122); this records which proposal it won and when (PLM-009). Idempotent: a proposal
 * already Won keeps its date. A proposal with no value takes the accepted quote's total when the caller knows it.
 * `lockByDealFile`: the round's Deal File was approved (Finance, then the approver), which also locks the value.
 */
export async function markProposalWon(db: Db, input: {
  workspaceId: string; opportunityId: string; round?: ProposalKind | null; actorUserId: string | null;
  quote?: { id: string; number: number; amount: string | number; currencyCode: string } | null; at?: Date; lockByDealFile?: boolean;
}) {
  const existing = await loadProposals(db, input.workspaceId, input.opportunityId);
  const unnamed = !input.round && !existing.some((proposal) => proposal.kind === "design");
  const kind = wonProposalKind(existing, input.round ?? null, unnamed && await hasDesignRound(db, input.workspaceId, input.opportunityId));
  const current = existing.find((proposal) => proposal.kind === kind);
  const at = (input.at ?? new Date()).toISOString();
  const quoteAmount = input.quote ? trim(Dec.of(input.quote.amount).toFixed(4)) : null;
  let changed = false;
  let proposalId = current?.id ?? null;
  if (!current?.wonAt) {
    const amount = current?.amount ?? quoteAmount;
    const currency = current?.currencyCode ?? input.quote?.currencyCode ?? null;
    const row = (await db.query<{ id: string }>(
      `INSERT INTO crm_opportunity_proposals (workspace_id, opportunity_id, kind, amount, currency_code, value_status, entered_by, entered_at, won_at, quote_id)
       VALUES ($1, $2, $3, $4::numeric, $5, CASE WHEN $4::numeric IS NULL THEN 'empty' ELSE 'entered' END, CASE WHEN $4::numeric IS NULL THEN NULL ELSE $6::uuid END,
               CASE WHEN $4::numeric IS NULL THEN NULL ELSE $7::timestamptz END, $7::timestamptz, $8::uuid)
       ON CONFLICT (workspace_id, opportunity_id, kind) DO UPDATE SET won_at = coalesce(crm_opportunity_proposals.won_at, EXCLUDED.won_at),
         quote_id = coalesce(crm_opportunity_proposals.quote_id, EXCLUDED.quote_id), version = crm_opportunity_proposals.version + 1
       RETURNING id`, [input.workspaceId, input.opportunityId, kind, amount, currency, input.actorUserId, at, input.quote?.id ?? null])).rows[0];
    proposalId = row.id;
    await logValue(db, { workspaceId: input.workspaceId, opportunityId: input.opportunityId, proposalId: row.id, kind, action: "won", from: amount, to: amount, currency,
      note: input.quote ? `Q-${input.quote.number}` : "Payment proof attached", actorUserId: input.actorUserId, at });
    changed = true;
  }
  if (input.lockByDealFile && proposalId && input.quote && current?.valueStatus !== "approved") {
    // The Deal File went through Finance and the approver: its value is the proposal's locked value.
    await cancelApproval(db, { workspaceId: input.workspaceId, kind: VALUE_KIND, subjectId: proposalId, actorUserId: input.actorUserId, reason: "Locked by the approved Deal File" });
    await db.query(
      `UPDATE crm_opportunity_proposals SET amount = $3::numeric, currency_code = $4, value_status = 'approved', approved_by = $5, approved_at = now(),
              entered_by = coalesce(entered_by, $5), entered_at = coalesce(entered_at, now()), version = version + 1
        WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, proposalId, quoteAmount, input.quote.currencyCode, input.actorUserId]);
    await logValue(db, { workspaceId: input.workspaceId, opportunityId: input.opportunityId, proposalId, kind, action: "approved", from: current?.amount ?? null, to: quoteAmount,
      currency: input.quote.currencyCode, note: "Deal File approved", actorUserId: input.actorUserId });
    changed = true;
  }
  // Only the Deal File lock moves the headline value; a Won alone leaves the opportunity's version as the caller saved it.
  if (changed && input.lockByDealFile) await syncHeadline(db, input.workspaceId, input.opportunityId);
  return { kind, wonAt: current?.wonAt ?? at, changed };
}
