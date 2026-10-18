import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { startClientCalls } from "../client-calls/client-calls.store";
import { thankForDeal } from "../crm/conversations/inbox/client-followups";
import { tellDealOutcome } from "../crm/leads/sales-attention";
import { cancelOpenFollowUps } from "../crm/opportunities/follow-ups";
import { markProposalWon } from "../crm/opportunities/opportunity-proposals";
import { noticeReadyToStart } from "../project-core/project-release";
import { reserveForAcceptedQuote, takeForDeal } from "../fulfilment/stock-reservations";

type Db = Pick<PoolClient, "query">;

type OpportunityRow = {
  id: string; status: string; stageId: string | null; pipelineId: string; partyId: string | null; ownerMembershipId: string | null;
  amount: string | null; currencyCode: string | null; reportingAmount: string | null; reportingCurrencyCode: string | null; version: number;
};

/**
 * When a quotation is accepted (in the portal or recorded by staff) the planning case moves to Agree (a design-fee
 * round keeps its phase: design comes next). The linked opportunity becomes Won, on the pipeline's Won stage with
 * the quote as the reason, only when a payment proof already exists (PLM-122); otherwise attaching the proof wins it.
 * Idempotent: an opportunity already Won, or closed, is left alone.
 * Runs in the caller's tenant transaction and is audited like a manual transition.
 */
export async function winOpportunityOnAcceptance(db: Db, input: {
  workspaceId: string; caseId: string; quoteNumber: number; round?: "design" | "main" | null;
  actorUserId: string | null; source: "user" | "client_portal";
  /** The client contact who accepted in the portal (kept on the audit rows). */
  grantId?: string;
}) {
  const by = input.grantId ? { grantId: input.grantId } : {};
  const opportunity = (await db.query<OpportunityRow>(
    `SELECT opportunity.id, opportunity.status::text AS status, opportunity.stage_id AS "stageId", opportunity.pipeline_id AS "pipelineId",
            opportunity.party_id AS "partyId", opportunity.owner_membership_id AS "ownerMembershipId", opportunity.amount::text AS amount,
            opportunity.currency_code AS "currencyCode", opportunity.reporting_amount::text AS "reportingAmount",
            opportunity.reporting_currency_code AS "reportingCurrencyCode", opportunity.version
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2
      FOR UPDATE OF opportunity`, [input.workspaceId, input.caseId])).rows[0];
  if (!opportunity) return { won: false, phase: null as string | null };
  let won = false;
  // PLM-122: Won is a payment proof. The client's acceptance alone leaves the opportunity open (its quote now reads
  // as accepted); it is won here only when a proof is already attached or Finance verified a payment.
  const paid = (await db.query(
    `SELECT 1 FROM crm_opportunity_payment_proofs WHERE workspace_id = $1 AND opportunity_id = $2
     UNION ALL SELECT 1 FROM commercial_payments WHERE workspace_id = $1 AND case_id = $3 AND status = 'verified' LIMIT 1`,
    [input.workspaceId, opportunity.id, input.caseId])).rowCount;
  if (opportunity.status === "open" && paid) {
    const stage = (await db.query<{ id: string }>(
      `SELECT id FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND code = 'won' AND status = 'active' ORDER BY position LIMIT 1`,
      [input.workspaceId, opportunity.pipelineId])).rows[0];
    const reason = `Client accepted Q-${input.quoteNumber}`;
    const updated = (await db.query(
      `UPDATE crm_opportunities SET stage_id = coalesce($3::uuid, stage_id), status = 'won'::crm_opportunity_status, probability = 100,
              forecast_category = 'closed', outcome_reason = $4, paused_reason = NULL, closed_at = now(), next_action_at = NULL,
              version = version + 1
        WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [input.workspaceId, opportunity.id, stage?.id ?? null, reason])).rows[0] as Record<string, unknown>;
    await db.query(`UPDATE crm_activities SET is_next_action = false, version = version + 1 WHERE workspace_id = $1 AND opportunity_id = $2 AND is_next_action`,
      [input.workspaceId, opportunity.id]);
    // The won deal's open follow-ups are done with (audited, one history line).
    await cancelOpenFollowUps(db, { workspaceId: input.workspaceId, opportunityId: String(opportunity.id), outcome: "won", actorUserId: input.actorUserId, source: input.source });
    if (opportunity.partyId)
      await db.query(`UPDATE crm_parties SET lifecycle = 'customer', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND lifecycle <> 'customer'`,
        [input.workspaceId, opportunity.partyId]);
    await db.query(
      `INSERT INTO crm_stage_history (workspace_id, opportunity_id, from_stage_id, to_stage_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, coalesce($4::uuid, $3::uuid), $5::crm_opportunity_status, 'won', $6, $7)`,
      [input.workspaceId, opportunity.id, opportunity.stageId, stage?.id ?? null, opportunity.status, reason, input.actorUserId]);
    await db.query(
      `INSERT INTO crm_forecast_snapshots (workspace_id, opportunity_id, owner_membership_id, stage_id, status, amount, currency_code,
         reporting_amount, reporting_currency_code, probability, snapshot_reason)
       VALUES ($1, $2, $3, coalesce($4::uuid, $5::uuid), 'won', $6::numeric, $7, $8::numeric, $9, 100, 'quote_accepted')`,
      [input.workspaceId, opportunity.id, opportunity.ownerMembershipId, stage?.id ?? null, opportunity.stageId, opportunity.amount,
        opportunity.currencyCode, opportunity.reportingAmount, opportunity.reportingCurrencyCode]);
    await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, source: input.source, action: "crm.opportunity.won.v1",
      entityType: "crm_opportunity", entityId: opportunity.id, before: opportunity, after: { ...updated, reason, caseId: input.caseId, ...by } });
    won = true;
    // PLM-009: the accepted round's proposal is Won (design fee or main quotation), each with its own date.
    await markProposalWon(db, { workspaceId: input.workspaceId, opportunityId: String(opportunity.id), round: input.round ?? null, actorUserId: input.actorUserId });
    // The client is thanked on WhatsApp and told what happens next (once per opportunity).
    await thankForDeal(db, input.workspaceId, String(opportunity.id), { actorUserId: input.actorUserId });
    // The Sales admin and the Owners hear the deal is won (S-23).
    await tellDealOutcome(db, input.workspaceId, { opportunityId: String(opportunity.id), outcome: "won", reason, actorUserId: input.actorUserId });
  }
  // PLM-125: the accepted quotation holds its stocked items for the deal, and a win takes them out, where the path says so.
  await reserveForAcceptedQuote(db, input.workspaceId, { caseId: input.caseId, actorUserId: input.actorUserId });
  if (won) await takeForDeal(db, input.workspaceId, { opportunityId: String(opportunity.id), event: "won", actorUserId: input.actorUserId });
  let phase: string | null = null;
  if (input.round !== "design") {
    const moved = (await db.query<{ phase: string }>(
      `UPDATE pre_project_cases SET phase = 'agree', version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'active' AND phase IN ('discover', 'define', 'design', 'price') RETURNING phase`,
      [input.workspaceId, input.caseId])).rows[0];
    if (moved) {
      phase = moved.phase;
      await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, source: input.source, action: "pre_project.phase_advanced.v1",
        entityType: "pre_project_case", entityId: input.caseId, after: { phase: "agree", reason: `Client accepted Q-${input.quoteNumber}`, ...by } });
    }
    // PLM-046: a job without design starts the Account Manager's client update calls from its accepted estimate (a design
    // job started them at the design approval). Idempotent.
    const designed = (await db.query(`SELECT 1 FROM design_journeys WHERE workspace_id = $1 AND case_id = $2 AND (package_id IS NOT NULL OR package_name IS NOT NULL)`,
      [input.workspaceId, input.caseId])).rowCount;
    if (!designed) await startClientCalls(db, input.workspaceId, input.caseId, "estimate_accepted", input.actorUserId);
  }
  return { won, phase };
}

/**
 * An approved main-round deal releases the case: the phase moves to Release (the project starts from it), and the
 * people who start projects hear at once to name its project manager and start it (PLM-056).
 */
export async function releasePhaseOnDealApproval(db: Db, input: { workspaceId: string; caseId: string; actorUserId: string }) {
  const moved = (await db.query(
    `UPDATE pre_project_cases SET phase = 'release', version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND status = 'active' AND phase <> 'release' RETURNING id`,
    [input.workspaceId, input.caseId])).rowCount;
  if (moved) await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "pre_project.phase_advanced.v1",
    entityType: "pre_project_case", entityId: input.caseId, after: { phase: "release", reason: "Deal approved" } });
  await noticeReadyToStart(db, input);
  return Boolean(moved);
}
