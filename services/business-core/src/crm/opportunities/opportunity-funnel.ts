import type { PoolClient } from "pg";
import { STAGE_LABELS, type JourneyStage } from "../../design/design-journey.domain";

export type FunnelStepKey = "enquiry" | "discovery" | "intro" | "design" | "quote" | "deal";
export type FunnelStep = { key: FunnelStepKey; state: "done" | "current" | "active" | "upcoming"; detail: string | null; at: string | null };

const QUOTE_STATUS: Record<string, string> = {
  draft: "Draft", internal_review: "In review", internal_approved: "Approved internally", issued: "Sent to the client",
  accepted: "Accepted", changes_requested: "Changes requested", declined: "Declined", superseded: "Superseded", withdrawn: "Withdrawn",
};

/**
 * Where an opportunity really is, read from the records each step produces: the enquiry it came
 * from, the discovery facts, the intro meeting, the design journey in Planning, the main quote and
 * the Deal File. The first step that is not done is the current one.
 */
export async function opportunityFunnel(client: PoolClient, workspaceId: string, opportunityId: string, discoveryMissing: number | null): Promise<FunnelStep[]> {
  const result = await client.query<{
    hasLead: boolean; enquiryReference: string | null; enquiryAt: string | null;
    introStatus: string | null; introAt: string | null; designerName: string | null;
    caseId: string | null; stagesTotal: number; stagesDone: number; currentStage: string | null; designDoneAt: string | null;
    quoteStatus: string | null; quoteAt: string | null; dealReference: string | null;
  }>(`SELECT opportunity.lead_id IS NOT NULL AS "hasLead", enquiry.reference AS "enquiryReference", enquiry.received_at AS "enquiryAt",
      intro.status AS "introStatus", COALESCE(intro.completed_at, intro.due_at) AS "introAt", designer_account.display_name AS "designerName",
      source_case.id AS "caseId",
      (SELECT count(*)::int FROM design_journey_stages stage WHERE stage.workspace_id=opportunity.workspace_id AND stage.case_id=source_case.id) AS "stagesTotal",
      (SELECT count(*)::int FROM design_journey_stages stage WHERE stage.workspace_id=opportunity.workspace_id AND stage.case_id=source_case.id AND stage.status='done') AS "stagesDone",
      (SELECT stage.stage FROM design_journey_stages stage WHERE stage.workspace_id=opportunity.workspace_id AND stage.case_id=source_case.id AND stage.status<>'done' ORDER BY stage.position LIMIT 1) AS "currentStage",
      (SELECT max(stage.completed_at) FROM design_journey_stages stage WHERE stage.workspace_id=opportunity.workspace_id AND stage.case_id=source_case.id) AS "designDoneAt",
      quote.status AS "quoteStatus", quote.updated_at AS "quoteAt", deal.reference AS "dealReference"
    FROM crm_opportunities opportunity
    LEFT JOIN crm_leads lead ON lead.workspace_id=opportunity.workspace_id AND lead.id=opportunity.lead_id
    LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id=opportunity.workspace_id AND enquiry.id=lead.enquiry_id
    LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id=opportunity.workspace_id AND designer.opportunity_id=opportunity.id
    LEFT JOIN crm_activities intro ON intro.workspace_id=opportunity.workspace_id AND intro.id=designer.intro_activity_id
    LEFT JOIN workspace_memberships designer_membership ON designer_membership.id=designer.membership_id
    LEFT JOIN users designer_account ON designer_account.id=designer_membership.user_id
    LEFT JOIN pre_project_cases source_case ON source_case.workspace_id=opportunity.workspace_id AND source_case.opportunity_id=opportunity.id
    LEFT JOIN LATERAL (SELECT q.status, q.updated_at FROM commercial_quotes q WHERE q.workspace_id=opportunity.workspace_id AND q.case_id=source_case.id
      AND q.kind='quotation' AND COALESCE(q.round,'main')<>'design' AND q.status NOT IN ('superseded','withdrawn') ORDER BY q.updated_at DESC LIMIT 1) quote ON true
    LEFT JOIN LATERAL (SELECT d.reference FROM commercial_deal_files d WHERE d.workspace_id=opportunity.workspace_id AND d.case_id=source_case.id ORDER BY d.revision DESC LIMIT 1) deal ON true
    WHERE opportunity.workspace_id=$1 AND opportunity.id=$2`, [workspaceId, opportunityId]);
  const row = result.rows[0];
  if (!row) return [];
  const iso = (value: string | Date | null) => value ? new Date(value).toISOString() : null;
  const done: Record<FunnelStepKey, boolean> = {
    // An opportunity opened directly (no enquiry) has nothing to do at this step.
    enquiry: true,
    discovery: discoveryMissing === 0,
    intro: row.introStatus === "completed",
    design: row.stagesTotal > 0 && row.stagesDone === row.stagesTotal,
    quote: row.quoteStatus === "accepted",
    deal: Boolean(row.dealReference),
  };
  const detail: Record<FunnelStepKey, string | null> = {
    enquiry: row.hasLead ? row.enquiryReference : "Direct",
    discovery: discoveryMissing === null ? null : discoveryMissing === 0 ? "Complete" : `${discoveryMissing} to fill`,
    intro: row.introStatus === "completed" ? row.designerName : row.introStatus === "pending" ? `Scheduled${row.designerName ? ` · ${row.designerName}` : ""}` : null,
    design: !row.caseId ? null : row.stagesTotal === 0 ? "Not started" : done.design ? "Approved" : STAGE_LABELS[row.currentStage as JourneyStage] ?? row.currentStage,
    quote: row.quoteStatus ? QUOTE_STATUS[row.quoteStatus] ?? row.quoteStatus : null,
    deal: row.dealReference,
  };
  const at: Record<FunnelStepKey, string | null> = {
    enquiry: iso(row.enquiryAt), discovery: null, intro: iso(row.introAt), design: done.design ? iso(row.designDoneAt) : null, quote: iso(row.quoteAt), deal: null,
  };
  const order: FunnelStepKey[] = ["enquiry", "discovery", "intro", "design", "quote", "deal"];
  // Steps can be done out of order (an older enquiry-less opportunity); "current" is the first open one.
  const current = order.find((key) => !done[key]);
  // A later step already under way (e.g. design started before the intro meeting was logged) shows as in progress.
  const started: Record<FunnelStepKey, boolean> = {
    enquiry: false, discovery: false,
    intro: row.introStatus === "pending", design: row.stagesTotal > 0, quote: Boolean(row.quoteStatus), deal: false,
  };
  return order.map((key) => ({ key, state: done[key] ? "done" : key === current ? "current" : started[key] ? "active" : "upcoming", detail: detail[key], at: at[key] }));
}
