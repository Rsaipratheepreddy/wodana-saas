import type { PoolClient } from "pg";
import { hasResolvedEnquiryType } from "../leads/lead-options";
import type { OpportunityDiscoveryService } from "./discovery.service";
import {
  clientTypeDecided, flowOf, nextStepPlan, requirementsUpTo, stepForStage,
  type FlowFacts, type FlowStep, type FurniturePath,
} from "./flow-gates";

type Db = Pick<PoolClient, "query">;

type FactsRow = {
  hasLead: boolean; enquiryType: string | null; enquiryTypeLabel: string | null; flow: string | null; clientType: string | null;
  partyEmail: string | null; discoveryEmail: string | null; discoveryLocation: string | null; enquiryLocation: string | null;
  floorPlan: string | null; area: string | null; introStatus: string | null;
  furniturePath: FurniturePath | null; feasibilityAt: Date | null; feasibilityBy: string | null; materialsChange: boolean;
  clientApprovedAt: Date | null; clientApprovedBy: string | null;
  caseId: string | null; quotationExists: boolean; quoteAccepted: boolean; proofCount: number; verifiedPayment: boolean;
};

export type FlowContext = FlowFacts & {
  enquiryType: string | null; enquiryTypeLabel: string | null; caseId: string | null;
  feasibilityAt: Date | null; feasibilityBy: string | null; materialsChange: boolean;
  clientApproved: boolean; clientApprovedAt: Date | null; clientApprovedBy: string | null;
  proofCount: number; verifiedPayment: boolean;
};

/**
 * The facts the pipeline gates read, loaded in one place from the records each step produces: the enquiry and its
 * type's flow, the discovery form, the intro meeting, the Planning case's quotations and payments, and the
 * payment proofs attached to the opportunity.
 */
export async function loadFlowFacts(db: Db, workspaceId: string, opportunityId: string, discovery?: OpportunityDiscoveryService): Promise<FlowContext> {
  const row = (await db.query<FactsRow>(
    `SELECT opportunity.lead_id IS NOT NULL AS "hasLead", enquiry.service_type AS "enquiryType", choice.label AS "enquiryTypeLabel",
            choice.flow, enquiry.details->>'customerType' AS "clientType",
            (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = opportunity.workspace_id AND point.party_id = opportunity.party_id
               AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC LIMIT 1) AS "partyEmail",
            discovery.client_email AS "discoveryEmail", discovery.property_location AS "discoveryLocation", enquiry.details->>'location' AS "enquiryLocation",
            discovery.floor_plan_asset_id::text AS "floorPlan", discovery.area::text AS area, intro.status AS "introStatus",
            opportunity.furniture_path AS "furniturePath", opportunity.feasibility_confirmed_at AS "feasibilityAt",
            feasibility_user.display_name AS "feasibilityBy", opportunity.materials_change AS "materialsChange",
            opportunity.client_approved_at AS "clientApprovedAt", approval_user.display_name AS "clientApprovedBy",
            source_case.id AS "caseId",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status NOT IN ('withdrawn', 'superseded')) AS "quotationExists",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status = 'accepted') AS "quoteAccepted",
            (SELECT count(*)::int FROM crm_opportunity_payment_proofs proof WHERE proof.workspace_id = opportunity.workspace_id AND proof.opportunity_id = opportunity.id) AS "proofCount",
            EXISTS (SELECT 1 FROM commercial_payments payment WHERE payment.workspace_id = opportunity.workspace_id AND payment.case_id = source_case.id
                      AND payment.status = 'verified') AS "verifiedPayment"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = opportunity.workspace_id AND discovery.opportunity_id = opportunity.id
       LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
       LEFT JOIN crm_activities intro ON intro.workspace_id = opportunity.workspace_id AND intro.id = designer.intro_activity_id
       LEFT JOIN pre_project_cases source_case ON source_case.workspace_id = opportunity.workspace_id AND source_case.opportunity_id = opportunity.id
       LEFT JOIN users feasibility_user ON feasibility_user.id = opportunity.feasibility_confirmed_by
       LEFT JOIN users approval_user ON approval_user.id = opportunity.client_approved_by
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`,
    [workspaceId, opportunityId])).rows[0];
  if (!row) throw new Error("Opportunity not found");
  const flow = flowOf(row.flow);
  // Only the design and fit-out flows read the discovery form, so the others skip the query.
  const discoveryMissing = (flow === "design" || flow === "fit_out") && discovery ? await discovery.missing(db as PoolClient, workspaceId, opportunityId) : [];
  return {
    flow,
    // An opportunity opened directly has no enquiry, so there is no "not sure yet" type to replace.
    enquiryTypeResolved: !row.hasLead || hasResolvedEnquiryType(row.enquiryType),
    clientTypeResolved: clientTypeDecided(row.clientType),
    clientEmail: Boolean(row.discoveryEmail || row.partyEmail),
    propertyLocation: Boolean(row.discoveryLocation?.trim() || row.enquiryLocation?.trim()),
    floorPlanOrArea: Boolean(row.floorPlan || row.area),
    introCompleted: row.introStatus === "completed",
    discoveryMissing,
    furniturePath: row.furniturePath,
    feasibilityConfirmed: Boolean(row.feasibilityAt),
    quotationExists: row.quotationExists,
    // A Finance-verified payment in Planning is proof too.
    paymentProof: row.proofCount > 0 || row.verifiedPayment,
    enquiryType: row.enquiryType, enquiryTypeLabel: row.enquiryTypeLabel, caseId: row.caseId,
    feasibilityAt: row.feasibilityAt, feasibilityBy: row.feasibilityBy, materialsChange: row.materialsChange,
    clientApproved: Boolean(row.clientApprovedAt) || row.quoteAccepted, clientApprovedAt: row.clientApprovedAt, clientApprovedBy: row.clientApprovedBy,
    proofCount: row.proofCount, verifiedPayment: row.verifiedPayment,
  };
}

export type PipelineStageRow = { id: string; code: string; name: string; position: number };

/** The opportunity's pipeline stages (active, ordered), which the gates and the step line read. */
export async function pipelineStages(db: Db, workspaceId: string, pipelineId: string): Promise<PipelineStageRow[]> {
  return (await db.query<PipelineStageRow>(
    `SELECT id, code, name, position FROM crm_pipeline_stages WHERE workspace_id = $1 AND pipeline_id = $2 AND status = 'active' ORDER BY position`,
    [workspaceId, pipelineId])).rows;
}

/**
 * The opportunity's "Next step": the step line (one entry per working column and Won), where it stands, the next
 * column and everything still needed for it.
 */
export function flowSummary(input: { facts: FlowContext; stages: PipelineStageRow[]; currentStageId: string; status: string }) {
  const { facts, stages, status } = input;
  const working = stages.filter((stage) => stage.code !== "lost");
  const firstPosition = stages[0]?.position ?? 0;
  const current = working.find((stage) => stage.id === input.currentStageId) ?? null;
  const currentStep: FlowStep | null = status === "won" ? "won" : current ? stepForStage(current, firstPosition) : null;
  const plan = nextStepPlan({ facts, current: currentStep, status });
  const currentIndex = current ? working.indexOf(current) : status === "won" ? working.length - 1 : -1;
  const steps = working.map((stage, index) => {
    const step = stepForStage(stage, firstPosition);
    const state = status === "won" || index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
    return { stageId: stage.id, name: stage.name, step, state, optional: facts.flow === "furniture" && step === "negotiation" };
  });
  const nextStage = plan.next ? working.find((stage) => stepForStage(stage, firstPosition) === plan.next) ?? null : null;
  return {
    flow: facts.flow,
    steps,
    done: steps.filter((step) => step.state === "done").length,
    total: steps.length,
    next: nextStage ? { stageId: nextStage.id, name: nextStage.name, step: plan.next } : null,
    missing: plan.missing.map(({ key, label }) => ({ key, label })),
    // Everything Won needs from here (the board checks it before asking for the proof).
    toWon: status === "open" ? requirementsUpTo(facts.flow, "won", facts).map(({ key, label }) => ({ key, label })) : [],
    negotiationOptional: facts.flow === "furniture",
  };
}

/** The proofs attached to an opportunity, newest first, for its detail view. */
export async function paymentProofs(client: Pick<PoolClient, "query">, workspaceId: string, opportunityId: string) {
  return (await client.query(
    `SELECT proof.id, proof.kind, proof.file_name AS "fileName", proof.mime_type AS "mimeType", proof.has_preview AS "hasPreview", proof.note,
            proof.recorded_at AS "recordedAt", account.display_name AS "recordedBy"
       FROM crm_opportunity_payment_proofs proof LEFT JOIN users account ON account.id = proof.recorded_by
      WHERE proof.workspace_id = $1 AND proof.opportunity_id = $2 ORDER BY proof.recorded_at DESC`,
    [workspaceId, opportunityId])).rows;
}
