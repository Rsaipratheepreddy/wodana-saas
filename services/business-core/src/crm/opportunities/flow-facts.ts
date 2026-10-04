import type { PoolClient } from "pg";
import { hasResolvedEnquiryType } from "../leads/lead-options";
import type { OpportunityDiscoveryService } from "./discovery.service";
import { clientTypeDecided, type FurniturePath } from "./flow-gates";
import { WON_COLUMN } from "../flows/flow-definition";
import {
  columnOfStage, columnOptional, flowAsks, flowProgress, legacyStepName, nextColumnPlan, requirementsUpTo, type CheckFacts,
} from "../flows/flow-interpreter";
import { opportunityFlow, type ResolvedFlow } from "../flows/flow-store";

type Db = Pick<PoolClient, "query">;

type FactsRow = {
  hasLead: boolean; enquiryType: string | null; enquiryTypeLabel: string | null; flow: string | null; flowVersionId: string | null; clientType: string | null;
  partyEmail: string | null; discoveryEmail: string | null; discoveryLocation: string | null; enquiryLocation: string | null; budgetRange: string | null;
  floorPlan: string | null; area: string | null; introStatus: string | null; introAt: Date | null; introBy: string | null; contactLogged: boolean;
  packageCode: string | null;
  furniturePath: FurniturePath | null; feasibilityAt: Date | null; feasibilityBy: string | null; materialsChange: boolean;
  clientApprovedAt: Date | null; clientApprovedBy: string | null;
  caseId: string | null; quotationExists: boolean; qsApproved: boolean; quoteSent: boolean; quoteAccepted: boolean;
  proofCount: number; proofAt: Date | null; proofBy: string | null; verifiedPayment: boolean; dealApproved: boolean;
  designStagesDone: string[] | null; siteVisitAt: Date | null; siteVisitBy: string | null; materialListSignedOff: boolean;
};

export type FlowContext = CheckFacts & {
  /** The code of the flow the job runs. */
  flow: string;
  /** The flow (pinned version or built-in starter) the job runs. */
  flowDefinition: ResolvedFlow;
  enquiryType: string | null; enquiryTypeLabel: string | null; caseId: string | null;
  feasibilityAt: Date | null; feasibilityBy: string | null; materialsChange: boolean;
  clientApproved: boolean; clientApprovedAt: Date | null; clientApprovedBy: string | null;
  proofCount: number; verifiedPayment: boolean;
};

/**
 * The facts the flow checks read, loaded in one place from the records each step produces: the enquiry and its
 * type's flow, the discovery form, the intro meeting, the Planning case's design stages, quotations, payments and
 * Deal File, the project's material list, and the payment proofs attached to the opportunity. The job's flow is
 * resolved (and its version pinned) here too.
 */
export async function loadFlowFacts(db: Db, workspaceId: string, opportunityId: string, discovery?: OpportunityDiscoveryService, options: { actorUserId?: string | null } = {}): Promise<FlowContext> {
  const row = (await db.query<FactsRow>(
    `SELECT opportunity.lead_id IS NOT NULL AS "hasLead", enquiry.service_type AS "enquiryType", choice.label AS "enquiryTypeLabel",
            choice.flow, opportunity.flow_version_id AS "flowVersionId", enquiry.details->>'customerType' AS "clientType",
            (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = opportunity.workspace_id AND point.party_id = opportunity.party_id
               AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC LIMIT 1) AS "partyEmail",
            discovery.client_email AS "discoveryEmail", discovery.property_location AS "discoveryLocation", enquiry.details->>'location' AS "enquiryLocation",
            NULLIF(trim(enquiry.details->>'budgetRange'), '') AS "budgetRange",
            discovery.floor_plan_asset_id::text AS "floorPlan", discovery.area::text AS area, intro.status AS "introStatus",
            intro.completed_at AS "introAt", intro_owner.display_name AS "introBy",
            EXISTS (SELECT 1 FROM crm_activities contact WHERE contact.workspace_id = opportunity.workspace_id
                      AND (contact.opportunity_id = opportunity.id OR contact.party_id = opportunity.party_id OR contact.lead_id = opportunity.lead_id)
                      AND contact.type IN ('call', 'meeting', 'email', 'whatsapp', 'sms') AND contact.status = 'completed') AS "contactLogged",
            (SELECT package.code FROM design_packages package WHERE package.workspace_id = opportunity.workspace_id AND package.id = discovery.design_package_id) AS "packageCode",
            opportunity.furniture_path AS "furniturePath", opportunity.feasibility_confirmed_at AS "feasibilityAt",
            feasibility_user.display_name AS "feasibilityBy", opportunity.materials_change AS "materialsChange",
            opportunity.client_approved_at AS "clientApprovedAt", approval_user.display_name AS "clientApprovedBy",
            source_case.id AS "caseId",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status NOT IN ('withdrawn', 'superseded')) AS "quotationExists",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status IN ('internal_approved', 'issued', 'accepted')) AS "qsApproved",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status IN ('issued', 'accepted', 'changes_requested', 'declined')) AS "quoteSent",
            EXISTS (SELECT 1 FROM commercial_quotes quote WHERE quote.workspace_id = opportunity.workspace_id AND quote.case_id = source_case.id
                      AND quote.kind = 'quotation' AND quote.status = 'accepted') AS "quoteAccepted",
            proofs.count AS "proofCount", proofs.at AS "proofAt", proof_user.display_name AS "proofBy",
            EXISTS (SELECT 1 FROM commercial_payments payment WHERE payment.workspace_id = opportunity.workspace_id AND payment.case_id = source_case.id
                      AND payment.status = 'verified') AS "verifiedPayment",
            EXISTS (SELECT 1 FROM commercial_deal_files deal WHERE deal.workspace_id = opportunity.workspace_id AND deal.case_id = source_case.id) AS "dealApproved",
            (SELECT array_agg(stage.stage ORDER BY stage.position) FROM design_journey_stages stage
              WHERE stage.workspace_id = opportunity.workspace_id AND stage.case_id = source_case.id AND stage.status = 'done') AS "designStagesDone",
            site_visit.completed_at AS "siteVisitAt", site_visit_user.display_name AS "siteVisitBy",
            EXISTS (SELECT 1 FROM crm_project_links link JOIN project_material_revisions revision
                      ON revision.workspace_id = link.workspace_id AND revision.project_id = link.project_id AND revision.status = 'signed_off'
                     WHERE link.workspace_id = opportunity.workspace_id AND link.opportunity_id = opportunity.id) AS "materialListSignedOff"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = opportunity.workspace_id AND discovery.opportunity_id = opportunity.id
       LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
       LEFT JOIN crm_activities intro ON intro.workspace_id = opportunity.workspace_id AND intro.id = designer.intro_activity_id
       LEFT JOIN workspace_memberships intro_membership ON intro_membership.id = intro.owner_membership_id
       LEFT JOIN users intro_owner ON intro_owner.id = intro_membership.user_id
       LEFT JOIN pre_project_cases source_case ON source_case.workspace_id = opportunity.workspace_id AND source_case.opportunity_id = opportunity.id
       LEFT JOIN design_journey_stages site_visit ON site_visit.workspace_id = opportunity.workspace_id AND site_visit.case_id = source_case.id
             AND site_visit.stage = 'site_visit' AND site_visit.status = 'done'
       LEFT JOIN users site_visit_user ON site_visit_user.id = site_visit.completed_by
       LEFT JOIN LATERAL (SELECT count(*)::int AS count, min(proof.recorded_at) AS at,
                                 (array_agg(proof.recorded_by ORDER BY proof.recorded_at))[1] AS by
                            FROM crm_opportunity_payment_proofs proof WHERE proof.workspace_id = opportunity.workspace_id AND proof.opportunity_id = opportunity.id) proofs ON true
       LEFT JOIN users proof_user ON proof_user.id = proofs.by
       LEFT JOIN users feasibility_user ON feasibility_user.id = opportunity.feasibility_confirmed_by
       LEFT JOIN users approval_user ON approval_user.id = opportunity.client_approved_by
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`,
    [workspaceId, opportunityId])).rows[0];
  if (!row) throw new Error("Opportunity not found");
  const flow = await opportunityFlow(db, { workspaceId, opportunityId, code: row.flow, pinnedVersionId: row.flowVersionId, actorUserId: options.actorUserId });
  // Only flows that check the discovery form read it, so the others skip the query.
  const discoveryMissing = flowAsks(flow.definition, "discovery_complete") && discovery ? await discovery.missing(db as PoolClient, workspaceId, opportunityId) : [];
  const clientApprovedOnSpot = Boolean(row.clientApprovedAt);
  return {
    flow: flow.code,
    flowDefinition: flow,
    // An opportunity opened directly has no enquiry, so there is no "not sure yet" type to replace.
    enquiryTypeResolved: !row.hasLead || hasResolvedEnquiryType(row.enquiryType),
    clientTypeResolved: clientTypeDecided(row.clientType),
    clientType: row.clientType?.trim().toLowerCase() || null,
    clientEmail: Boolean(row.discoveryEmail || row.partyEmail),
    propertyLocation: Boolean(row.discoveryLocation?.trim() || row.enquiryLocation?.trim()),
    floorPlanOrArea: Boolean(row.floorPlan || row.area),
    budgetBand: row.budgetRange,
    contactLogged: row.contactLogged,
    introCompleted: row.introStatus === "completed",
    discoveryMissing,
    furniturePath: row.furniturePath,
    feasibilityConfirmed: Boolean(row.feasibilityAt),
    packageCode: row.packageCode,
    siteVisitRecorded: Boolean(row.siteVisitAt),
    quotationExists: row.quotationExists,
    qsApproved: row.qsApproved,
    quoteSent: row.quoteSent,
    quoteAccepted: row.quoteAccepted,
    clientApprovedOnSpot,
    // A Finance-verified payment in Planning is proof too.
    paymentProof: row.proofCount > 0 || row.verifiedPayment,
    paymentVerified: row.verifiedPayment,
    dealApproved: row.dealApproved,
    designStagesDone: row.designStagesDone ?? [],
    materialListSignedOff: row.materialListSignedOff,
    evidence: {
      intro_meeting_completed: { at: row.introAt, by: row.introBy },
      feasibility_confirmed: { at: row.feasibilityAt, by: row.feasibilityBy },
      client_approved_on_spot: { at: row.clientApprovedAt, by: row.clientApprovedBy },
      payment_proof_attached: { at: row.proofAt, by: row.proofBy },
      site_visit_recorded: { at: row.siteVisitAt, by: row.siteVisitBy },
    },
    enquiryType: row.enquiryType, enquiryTypeLabel: row.enquiryTypeLabel, caseId: row.caseId,
    feasibilityAt: row.feasibilityAt, feasibilityBy: row.feasibilityBy, materialsChange: row.materialsChange,
    clientApproved: clientApprovedOnSpot || row.quoteAccepted, clientApprovedAt: row.clientApprovedAt, clientApprovedBy: row.clientApprovedBy,
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
 * column and everything still needed for it, read from the job's flow. The flow's own line (each step, the current
 * one, who did what and when) comes with it for the Now card.
 */
export function flowSummary(input: { facts: FlowContext; stages: PipelineStageRow[]; currentStageId: string; status: string }) {
  const { facts, stages, status } = input;
  const definition = facts.flowDefinition.definition;
  const working = stages.filter((stage) => stage.code !== "lost");
  const firstPosition = stages[0]?.position ?? 0;
  const columnOf = (stage: PipelineStageRow) => columnOfStage(definition, stage, firstPosition);
  const codeOf = (column: number | null) => column === null ? null : definition.columns[column] ?? null;
  const wonColumn = definition.columns.indexOf(WON_COLUMN);
  const current = working.find((stage) => stage.id === input.currentStageId) ?? null;
  const currentColumn = status === "won" ? wonColumn : current ? columnOf(current) : null;
  const plan = nextColumnPlan({ definition, facts, current: currentColumn, status });
  const currentIndex = current ? working.indexOf(current) : status === "won" ? working.length - 1 : -1;
  const steps = working.map((stage, index) => {
    const column = columnOf(stage);
    const state = status === "won" || index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
    return { stageId: stage.id, name: stage.name, step: legacyStepName(codeOf(column)), state, optional: column !== null && columnOptional(definition, column) };
  });
  const nextStage = plan.next !== null ? working.find((stage) => columnOf(stage) === plan.next) ?? null : null;
  const progress = flowProgress(definition, facts);
  const negotiation = definition.columns.indexOf("negotiation");
  return {
    flow: facts.flow,
    steps,
    done: steps.filter((step) => step.state === "done").length,
    total: steps.length,
    next: nextStage ? { stageId: nextStage.id, name: nextStage.name, step: legacyStepName(codeOf(plan.next)) } : null,
    missing: plan.missing.map(({ key, label }) => ({ key, label })),
    // Everything Won needs from here (the board checks it before asking for the proof).
    toWon: status === "open" ? requirementsUpTo(definition, facts, wonColumn).map(({ key, label }) => ({ key, label })) : [],
    negotiationOptional: negotiation >= 0 && columnOptional(definition, negotiation),
    flowVersion: { id: facts.flowDefinition.versionId, code: facts.flowDefinition.code, name: facts.flowDefinition.name, version: facts.flowDefinition.version, source: facts.flowDefinition.source },
    now: status === "open" ? progress.current : null,
    line: progress.line,
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
