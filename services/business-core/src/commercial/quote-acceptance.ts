import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { thankForDeal } from "../crm/conversations/inbox/client-followups";
import { tellDealOutcome } from "../crm/leads/sales-attention";

type Db = Pick<PoolClient, "query">;

type OpportunityRow = {
  id: string; status: string; stageId: string | null; pipelineId: string; partyId: string | null; ownerMembershipId: string | null;
  amount: string | null; currencyCode: string | null; reportingAmount: string | null; reportingCurrencyCode: string | null; version: number;
};

/**
 * The client's acceptance is the sale. When a quotation is accepted (in the portal or recorded by staff) the
 * linked opportunity becomes Won, on the pipeline's Won stage, with the quote as the reason; the client becomes
 * a customer, and the planning case moves to Agree (a design-fee round keeps its phase: design comes next).
 * Nobody has to "mark it Won" before submitting the deal. Idempotent: an opportunity already Won is left alone.
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
  if (opportunity.status !== "won") {
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
    // The client is thanked on WhatsApp and told what happens next (once per opportunity).
    await thankForDeal(db, input.workspaceId, String(opportunity.id), { actorUserId: input.actorUserId });
    // The Sales admin and the Owners hear the deal is won (S-23).
    await tellDealOutcome(db, input.workspaceId, { opportunityId: String(opportunity.id), outcome: "won", reason, actorUserId: input.actorUserId });
  }
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
  }
  return { won, phase };
}

/** An approved main-round deal releases the case: the phase moves to Release (the project starts from it). */
export async function releasePhaseOnDealApproval(db: Db, input: { workspaceId: string; caseId: string; actorUserId: string }) {
  const moved = (await db.query(
    `UPDATE pre_project_cases SET phase = 'release', version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND status = 'active' AND phase <> 'release' RETURNING id`,
    [input.workspaceId, input.caseId])).rowCount;
  if (moved) await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "pre_project.phase_advanced.v1",
    entityType: "pre_project_case", entityId: input.caseId, after: { phase: "release", reason: "Deal approved" } });
  return Boolean(moved);
}
