import type { PoolClient } from "pg";
import { priceHolds } from "../purchasing/price-hold";
import { opportunityWonAreas, type WonArea } from "../crm/flows/flow-won-areas";
import { loadDealClosing } from "../crm/opportunities/deal-closing";
import { STAGE_LABELS, type JourneyStage } from "../design/design-journey.domain";
import { casePlan } from "../pre-projects/case-plan";
import { readItemProofFacts } from "../project-core/project-item-proof";
import { loadJobTeam, type Person, type StepOwner } from "./job-team";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P2 (on the P1 read): one job's journey from enquiry to warranty, read from the records each module already
 * keeps (the enquiry, the opportunity, the Planning case with its design stages, quotations, agreement, payments and
 * Deal File, the project with its stages, the warranty). Nothing is stored here: every step is done when its record
 * says so. Chapters are Win · Design · Price · Make · Install · Care; lanes are who does the step.
 */
export const JOURNEY_CHAPTERS = ["win", "design", "price", "make", "install", "care"] as const;
export type JourneyChapter = (typeof JOURNEY_CHAPTERS)[number];
export const JOURNEY_LANES = ["client", "sales", "design", "finance", "delivery"] as const;
export type JourneyLane = (typeof JOURNEY_LANES)[number];
export type JourneyStepState = "done" | "now" | "next" | "upcoming" | "skipped";

export type JourneyStep = {
  key: string; chapter: JourneyChapter; lane: JourneyLane; label: string;
  state: JourneyStepState;
  /** When it was done, by whom; when it is due (a date or a time). */
  doneAt: string | null; doneBy: string | null; dueAt: string | null;
  /** Where the step is worked, in the staff app. */
  href: string | null;
  /** Why a step is skipped (not part of this job), or the role it waits on that nobody holds. */
  note?: string | null;
  /** Who owns the step, from the job's team: by name to show, by membership to match (two people may share a name). */
  owner: string | null; ownerId: string | null;
};
export type JourneyView = {
  jobId: string; reference: string; title: string | null; client: string | null;
  chapters: Array<{ key: JourneyChapter; state: "done" | "now" | "upcoming" | "skipped"; done: number; total: number }>;
  lanes: JourneyLane[];
  steps: JourneyStep[];
  /** The step now, with who owns it and what finishes it. */
  now: (JourneyStep & { doneWhen: string }) | null;
  /** The two steps after the current one. */
  next: JourneyStep[];
  value: { amount: string; currency: string } | null;
  targetDate: string | null;
};

type Links = { leadId: string | null; opportunityId: string | null; caseId: string | null; projectId: string | null };
type Draft = Omit<JourneyStep, "state" | "owner" | "ownerId"> & {
  done: boolean; skipped?: boolean; doneWhen: string; owner?: string | null; ownerId?: string | null;
  /** The role the step waits on, in the firm's words: said on the step when nobody holds it. */
  ownerRole?: string | null;
};

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

const DESIGN_LANE: Record<JourneyStage, JourneyLane> = {
  inspiration: "client", kickoff: "design", site_visit: "design", moodboards: "design", concepts: "design", space_planning: "design",
  material_selection: "design", renders: "design", samples: "design", final_render: "design", approval: "client",
};

/** A project stage's chapter, from its key: buying, drawings and production are Make; site work and handover are Install. */
export function chapterOfProjectStage(key: string): JourneyChapter {
  if (/warrant|aftercare|defect/.test(key)) return "care";
  if (/permit|deliver|install|site|snag|handover|inspect/.test(key)) return "install";
  return "make";
}

/**
 * The steps a later step can't happen without, in each chain: once the later one is done, these count as done too,
 * so the step now never sits behind work already finished (e.g. a deal approved off a proposal sent outside the portal).
 */
const REQUIRES: Record<string, string[]> = {
  proposal_1_accepted: ["proposal_1"],
  design_fee: ["proposal_1_accepted"],
  design_deal: ["design_fee"],
  quotation_sent: ["manager_approval"],
  manager_approval: ["qs_estimate"],
  qs_estimate: ["quotation"],
  quotation_accepted: ["quotation_sent"],
  agreement: ["quotation_accepted"],
  upfront: ["agreement"],
  deal: ["upfront"],
};

/** What a furniture-only job's path decides about its steps (its fulfilment rule, the areas it uses after Won, its closing). */
export type FurnitureFacts = {
  /** The path's order needs a BOQ (bespoke): the QS, the material list, drawings and the site steps apply. */
  boq: boolean;
  /** Ready-made goods (taken home, in stock, ordered from a supplier): fulfilled from the deal, no project. */
  fulfilment: boolean;
  areas: readonly WonArea[];
  /** The goods were delivered (or collected), and the deal's closing event is met. */
  delivered: boolean;
  closed: boolean;
};
const NOT_ON_PATH = "Not on this furniture path";
const NO_BOQ_STEPS = new Set(["qs_estimate", "manager_approval", "material_list", "margin", "technical", "drawings", "pre_install", "site_reports", "snagging"]);
const PRODUCTION_STEPS = new Set(["technical", "drawings", "factory"]);

/**
 * A furniture-only job follows its path (A–E): no intro (qualified at once); standard furniture skips the QS and the
 * site steps; the areas the path doesn't use after Won are skipped (A, taken home, ends at handover); ready-made goods
 * are fulfilled from the deal, so delivery and handover are done when the deal's closing records say so. A step
 * already done always stays done.
 */
export function applyFurniturePath<T extends Pick<Draft, "key" | "done" | "skipped" | "note">>(drafts: T[], facts: FurnitureFacts): T[] {
  const uses = (area: WonArea) => facts.areas.includes(area);
  const off = (key: string): string | null => {
    if (["intro_booked", "intro_held", "outcome"].includes(key)) return "Not part of furniture-only jobs";
    if (!facts.boq && NO_BOQ_STEPS.has(key)) return NOT_ON_PATH;
    if (PRODUCTION_STEPS.has(key) && (!uses("production") || facts.fulfilment)) return NOT_ON_PATH;
    if (["project", "kickoff_project"].includes(key) && facts.fulfilment) return NOT_ON_PATH;
    if (key === "kickoff_project" && !uses("planning")) return NOT_ON_PATH;
    if (key === "release" && (facts.fulfilment || (!uses("supply") && !uses("production")))) return NOT_ON_PATH;
    if (key === "install" && !uses("delivery")) return NOT_ON_PATH;
    return null;
  };
  return drafts.map((step) => {
    const done = step.done || (facts.fulfilment && step.key === "install" && facts.delivered) || (step.key === "handover" && facts.closed);
    const reason = done ? null : off(step.key);
    return reason ? { ...step, skipped: true, note: reason } : done !== step.done ? { ...step, done } : step;
  });
}

/** Every step a done step implies, through the chains above (skipped steps stay skipped). */
export function impliedDone(drafts: Array<Pick<Draft, "key" | "done" | "skipped">>): Set<string> {
  const done = new Set(drafts.filter((draft) => draft.done && !draft.skipped).map((draft) => draft.key));
  const queue = [...done];
  while (queue.length) {
    for (const before of REQUIRES[queue.pop()!] ?? []) if (!done.has(before)) { done.add(before); queue.push(before); }
  }
  return done;
}

/** Marks each step done, now (the first required step not done), next (the two after it) or upcoming. */
export function resolveStates(drafts: Draft[]): JourneyStep[] {
  let nowAt = -1;
  const implied = impliedDone(drafts);
  const states = drafts.map((draft, index): JourneyStepState => {
    if (draft.skipped) return "skipped";
    if (draft.done || implied.has(draft.key)) return "done";
    if (nowAt < 0) { nowAt = index; return "now"; }
    return "upcoming";
  });
  let following = 0;
  for (let index = nowAt + 1; nowAt >= 0 && index < states.length && following < 2; index += 1) {
    if (states[index] === "upcoming") { states[index] = "next"; following += 1; }
  }
  return drafts.map(({ done: _done, skipped: _skipped, doneWhen: _doneWhen, owner, ownerId, ownerRole: _ownerRole, ...step }, index) =>
    ({ ...step, owner: owner ?? null, ownerId: ownerId ?? null, state: states[index] }));
}

export async function loadJobJourney(db: Db, workspaceId: string, job: { id: string; reference: string }): Promise<JourneyView> {
  const links = (await db.query<{ type: string; id: string }>(
    `SELECT record_type AS type, record_id::text AS id FROM job_identity_links
      WHERE workspace_id = $1 AND job_id = $2 AND status = 'active' ORDER BY attached_at`, [workspaceId, job.id])).rows;
  const first = (type: string) => links.find((link) => link.type === type)?.id ?? null;
  const ids: Links = { leadId: first("lead"), opportunityId: first("opportunity"), caseId: first("case"), projectId: first("project") };
  // An opportunity opened from an enquiry carries the lead; a case carries its opportunity.
  if (!ids.opportunityId && ids.caseId) ids.opportunityId = (await db.query<{ id: string }>(`SELECT opportunity_id::text AS id FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, ids.caseId])).rows[0]?.id ?? null;
  if (!ids.caseId && ids.opportunityId) ids.caseId = (await db.query<{ id: string }>(`SELECT id::text FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 LIMIT 1`, [workspaceId, ids.opportunityId])).rows[0]?.id ?? null;
  if (!ids.leadId && ids.opportunityId) ids.leadId = (await db.query<{ id: string | null }>(`SELECT lead_id::text AS id FROM crm_opportunities WHERE workspace_id = $1 AND id = $2`, [workspaceId, ids.opportunityId])).rows[0]?.id ?? null;
  if (!ids.projectId && ids.caseId) ids.projectId = (await db.query<{ id: string }>(`SELECT id::text FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT 1`, [workspaceId, ids.caseId])).rows[0]?.id ?? null;

  const lead = ids.leadId ? (await db.query<{ createdAt: Date; owner: string | null; ownerId: string | null; client: string; title: string | null; reference: string; target: string | null; contactedAt: Date | null }>(
    `SELECT lead.created_at AS "createdAt", owner_user.display_name AS owner, owner_member.id::text AS "ownerId", party.display_name AS client, enquiry.title, enquiry.reference,
            NULLIF(enquiry.details->>'targetCompletion', '') AS target,
            (SELECT min(contact.completed_at) FROM crm_activities contact WHERE contact.workspace_id = lead.workspace_id AND contact.lead_id = lead.id
               AND contact.type IN ('call', 'meeting', 'email', 'whatsapp', 'sms') AND contact.status = 'completed') AS "contactedAt"
       FROM crm_leads lead
       JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
       JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN workspace_memberships owner_member ON owner_member.id = lead.owner_membership_id
       LEFT JOIN users owner_user ON owner_user.id = owner_member.user_id
      WHERE lead.workspace_id = $1 AND lead.id = $2`, [workspaceId, ids.leadId])).rows[0] ?? null : null;

  const opportunity = ids.opportunityId ? (await db.query<{
    createdAt: Date; title: string; client: string; status: string; owner: string | null; ownerId: string | null; amount: string | null; currency: string | null;
    introAt: Date | null; introStatus: string | null; introDoneAt: Date | null; designer: string | null; designerId: string | null;
    outcome: string | null; outcomeAt: Date | null; outcomeBy: string | null; designWonAt: Date | null; mainWonAt: Date | null; mainWithdrawn: boolean;
  }>(
    `SELECT opportunity.created_at AS "createdAt", opportunity.title, party.display_name AS client, opportunity.status::text AS status,
            owner_user.display_name AS owner, owner_member.id::text AS "ownerId", opportunity.amount::text AS amount, opportunity.currency_code AS currency,
            intro.due_at AS "introAt", intro.status::text AS "introStatus", intro.completed_at AS "introDoneAt", designer_user.display_name AS designer,
            designer_member.id::text AS "designerId",
            opportunity.qualification_outcome AS outcome, opportunity.qualification_outcome_at AS "outcomeAt", outcome_user.display_name AS "outcomeBy",
            (SELECT won_at FROM crm_opportunity_proposals proposal WHERE proposal.workspace_id = opportunity.workspace_id AND proposal.opportunity_id = opportunity.id AND proposal.kind = 'design') AS "designWonAt",
            (SELECT won_at FROM crm_opportunity_proposals proposal WHERE proposal.workspace_id = opportunity.workspace_id AND proposal.opportunity_id = opportunity.id AND proposal.kind = 'main') AS "mainWonAt",
            EXISTS (SELECT 1 FROM crm_opportunity_proposals proposal WHERE proposal.workspace_id = opportunity.workspace_id AND proposal.opportunity_id = opportunity.id
                     AND proposal.kind = 'main' AND proposal.withdrawal_status = 'confirmed') AS "mainWithdrawn"
       FROM crm_opportunities opportunity
       JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner_member ON owner_member.id = opportunity.owner_membership_id
       LEFT JOIN users owner_user ON owner_user.id = owner_member.user_id
       LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
       LEFT JOIN workspace_memberships designer_member ON designer_member.id = designer.membership_id
       LEFT JOIN users designer_user ON designer_user.id = designer_member.user_id
       LEFT JOIN crm_activities intro ON intro.workspace_id = opportunity.workspace_id AND intro.id = designer.intro_activity_id
       LEFT JOIN users outcome_user ON outcome_user.id = opportunity.qualification_outcome_by
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, ids.opportunityId])).rows[0] ?? null : null;

  const commercial = ids.caseId ? (await db.query<{
    designQuote: string | null; designQuoteAt: Date | null; mainQuote: string | null; mainQuoteAt: Date | null;
    agreement: string | null; agreementAt: string | null; agreementBy: string | null; paidDesign: boolean; paidMain: boolean; dealAt: string | null; dealBy: string | null;
    value: string | null; currency: string | null;
  }>(
    `SELECT (SELECT quote.status FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.kind = 'quotation' AND quote.round = 'design'
               AND quote.status NOT IN ('withdrawn', 'superseded') ORDER BY quote.number DESC LIMIT 1) AS "designQuote",
            (SELECT quote.updated_at FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.kind = 'quotation' AND quote.round = 'design'
               AND quote.status NOT IN ('withdrawn', 'superseded') ORDER BY quote.number DESC LIMIT 1) AS "designQuoteAt",
            (SELECT quote.status FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.kind = 'quotation' AND coalesce(quote.round, 'main') = 'main'
               AND quote.status NOT IN ('withdrawn', 'superseded') ORDER BY quote.number DESC LIMIT 1) AS "mainQuote",
            (SELECT quote.updated_at FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.kind = 'quotation' AND coalesce(quote.round, 'main') = 'main'
               AND quote.status NOT IN ('withdrawn', 'superseded') ORDER BY quote.number DESC LIMIT 1) AS "mainQuoteAt",
            view.content #>> '{agreement,status}' AS agreement, view.content #>> '{agreement,executedAt}' AS "agreementAt", view.content #>> '{agreement,executedBy}' AS "agreementBy",
            EXISTS (SELECT 1 FROM commercial_payments payment JOIN commercial_quotes quote ON quote.workspace_id = payment.workspace_id AND quote.case_id = payment.case_id AND quote.id = payment.source_quote_id
                     WHERE payment.workspace_id = $1 AND payment.case_id = $2 AND payment.status = 'verified' AND quote.round = 'design') AS "paidDesign",
            EXISTS (SELECT 1 FROM commercial_payments payment JOIN commercial_quotes quote ON quote.workspace_id = payment.workspace_id AND quote.case_id = payment.case_id AND quote.id = payment.source_quote_id
                     WHERE payment.workspace_id = $1 AND payment.case_id = $2 AND payment.status = 'verified' AND coalesce(quote.round, 'main') = 'main') AS "paidMain",
            view.content #>> '{dealFile,approvedAt}' AS "dealAt", view.content #>> '{dealFile,approvedBy}' AS "dealBy",
            (SELECT deal.value::text FROM commercial_deal_files deal WHERE deal.workspace_id = $1 AND deal.case_id = $2 ORDER BY deal.revision DESC LIMIT 1) AS value,
            (SELECT quote.currency FROM commercial_quotes quote WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.status = 'accepted' ORDER BY quote.number DESC LIMIT 1) AS currency
       FROM commercial_cases_view view WHERE view.workspace_id = $1 AND view.case_id = $2`, [workspaceId, ids.caseId])).rows[0] ?? null : null;

  const design = ids.caseId ? (await db.query<{ stage: JourneyStage; status: string; dueAt: Date | null; doneAt: Date | null; doneBy: string | null }>(
    `SELECT stage.stage, stage.status, coalesce(stage.client_due_at, stage.due_at) AS "dueAt", stage.completed_at AS "doneAt", person.display_name AS "doneBy"
       FROM design_journey_stages stage LEFT JOIN users person ON person.id = stage.completed_by
      WHERE stage.workspace_id = $1 AND stage.case_id = $2 ORDER BY stage.position`, [workspaceId, ids.caseId])).rows : [];

  const project = ids.projectId ? (await db.query<{ reference: string; startedAt: Date | null; completedAt: Date | null; promise: string | null }>(
    `SELECT reference, started_at AS "startedAt", completed_at AS "completedAt", promise_date::text AS promise FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, ids.projectId])).rows[0] ?? null : null;
  const projectStages = ids.projectId ? (await db.query<{ key: string; name: string; status: string; doneAt: Date | null; doneBy: string | null; skip: string | null; ownerRole: string | null }>(
    `SELECT stage.key, stage.name, stage.status, stage.completed_at AS "doneAt", person.display_name AS "doneBy", stage.skip_reason AS skip, stage.owner_role AS "ownerRole"
       FROM project_stages stage LEFT JOIN users person ON person.id = stage.completed_by
      WHERE stage.workspace_id = $1 AND stage.project_id = $2 ORDER BY stage.position`, [workspaceId, ids.projectId])).rows : [];
  const warranty = ids.projectId ? (await db.query<{ endsOn: string | null }>(
    `SELECT max(ends_on)::text AS "endsOn" FROM warranty_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, ids.projectId])).rows[0]?.endsOn ?? null : null;
  // Shop drawings signed and items delivered, per item, once the project keeps those records (project-item-proof.ts).
  const proof = ids.projectId ? await readItemProofFacts(db, workspaceId, ids.projectId) : null;
  const perItemDrawings = proof?.drawings.tracked && proof.drawings.applicable ? proof.drawings : null;
  const perItemDelivery = proof?.delivery.tracked && proof.delivery.applicable ? proof.delivery : null;

  // What the rest of the guide's steps read: the job's design team, its package, mood boards, reviews, per-item work, site reports, handover.
  const extra = (await db.query<{
    assignedTo: string | null; designTeam: string | null; packageReview: string | null; packageRenders: boolean | null; packageSpacePlanning: boolean | null;
    moodboards: number; reviewed: number; designDealAt: string | null;
    materialList: string | null; materialsReady: Date | null; items: number; drawn: number; released: number; made: number; supplied: number;
    reports: number; lastReport: string | null; handover: string | null; handoverAt: string | null;
  }>(
    `SELECT (SELECT person.display_name FROM crm_leads lead JOIN workspace_memberships member ON member.id = lead.owner_membership_id JOIN users person ON person.id = member.user_id
              WHERE lead.workspace_id = $1 AND lead.id = $2) AS "assignedTo",
            (SELECT string_agg(DISTINCT person.display_name, ', ') FROM crm_opportunity_team team JOIN workspace_memberships member ON member.id = team.membership_id
               JOIN users person ON person.id = member.user_id WHERE team.workspace_id = $1 AND team.opportunity_id = $3 AND team.role = 'designer') AS "designTeam",
            package.review_role_code AS "packageReview", package.includes_renders AS "packageRenders", package.includes_space_planning AS "packageSpacePlanning",
            (SELECT count(*)::int FROM pre_project_moodboard_shares share WHERE share.workspace_id = $1 AND share.case_id = $4) AS moodboards,
            (SELECT count(*)::int FROM pre_project_design_versions version WHERE version.workspace_id = $1 AND version.case_id = $4 AND version.reviewer_id IS NOT NULL
               AND version.status IN ('approved', 'client_review')) AS reviewed,
            (SELECT deal.detail->>'approvedAt' FROM commercial_deal_files deal JOIN commercial_quotes quote ON quote.workspace_id = deal.workspace_id AND quote.case_id = deal.case_id AND quote.id = deal.quote_id
              WHERE deal.workspace_id = $1 AND deal.case_id = $4 AND quote.round = 'design' ORDER BY deal.revision DESC LIMIT 1) AS "designDealAt",
            (SELECT revision.status FROM project_material_revisions revision WHERE revision.workspace_id = $1 AND revision.project_id = $5 ORDER BY revision.number DESC LIMIT 1) AS "materialList",
            (SELECT max(ready.recorded_at) FROM project_materials_ready ready WHERE ready.workspace_id = $1 AND ready.project_id = $5) AS "materialsReady",
            (SELECT count(*)::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = $5) AS items,
            (SELECT count(*)::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = $5 AND work.drawing_approved_at IS NOT NULL) AS drawn,
            (SELECT count(*)::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = $5 AND work.released_at IS NOT NULL) AS released,
            (SELECT count(*)::int FROM project_item_supplies supplies WHERE supplies.workspace_id = $1 AND supplies.project_id = $5) AS supplied,
            (SELECT count(*)::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = $5 AND (work.ready_at IS NOT NULL OR work.closed_at IS NOT NULL)) AS made,
            (SELECT count(*)::int FROM site_reports report WHERE report.workspace_id = $1 AND report.project_id = $5 AND report.submitted_at IS NOT NULL) AS reports,
            (SELECT max(report.report_date)::text FROM site_reports report WHERE report.workspace_id = $1 AND report.project_id = $5 AND report.submitted_at IS NOT NULL) AS "lastReport",
            (SELECT pack.status FROM handover_packs pack WHERE pack.workspace_id = $1 AND pack.project_id = $5 ORDER BY pack.revision DESC LIMIT 1) AS handover,
            (SELECT pack.decided_on::text FROM handover_packs pack WHERE pack.workspace_id = $1 AND pack.project_id = $5 ORDER BY pack.revision DESC LIMIT 1) AS "handoverAt"
       FROM (SELECT 1) one
       LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = $1 AND discovery.opportunity_id = $3
       LEFT JOIN design_packages package ON package.workspace_id = $1 AND package.id = discovery.design_package_id`,
    [workspaceId, ids.leadId, ids.opportunityId, ids.caseId, ids.projectId])).rows[0];

  // Who owns each step: the job's team, read once (the design team on the case, the project team, the QS, the approvers).
  const person = (name: string | null | undefined, membershipId: string | null | undefined): Person | null => membershipId ? { name: name ?? null, membershipId } : null;
  const team = await loadJobTeam(db, workspaceId, {
    caseId: ids.caseId, projectId: ids.projectId, opportunityId: ids.opportunityId,
    accountManager: person(opportunity?.owner, opportunity?.ownerId) ?? person(lead?.owner, lead?.ownerId), designer: person(opportunity?.designer, opportunity?.designerId),
  });
  const enquiryOwner = team.as(person(lead?.owner, lead?.ownerId) ?? person(opportunity?.owner, opportunity?.ownerId), team.accountManager.ownerRole);
  const introDesigner = team.as(person(opportunity?.designer, opportunity?.designerId), team.leadDesigner.ownerRole);

  const leadHref = ids.leadId ? `/workspace/crm/leads?lead=${ids.leadId}` : null;
  const opportunityHref = ids.opportunityId ? `/workspace/crm/opportunities?record=${ids.opportunityId}` : leadHref;
  const caseHref = (section: string) => ids.caseId ? `/workspace/pre-projects/cases/${ids.caseId}/${section}` : opportunityHref;
  const projectHref = (section = "") => ids.projectId ? `/workspace/projects/${ids.projectId}${section ? `/${section}` : ""}` : caseHref("overview");
  const draft = (step: Omit<Draft, "doneAt" | "doneBy" | "dueAt"> & Partial<Pick<Draft, "doneAt" | "doneBy" | "dueAt">>): Draft =>
    ({ doneAt: null, doneBy: null, dueAt: null, ...step });
  const closed = opportunity?.status === "lost";
  const hasDesign = design.length > 0 || Boolean(commercial?.designQuote) || Boolean(opportunity?.designWonAt);
  const noDesign = !hasDesign && Boolean(opportunity);
  const withdrawn = Boolean(opportunity?.mainWithdrawn);
  const stageOf = (key: JourneyStage) => design.find((stage) => stage.stage === key);
  const projectStage = (pattern: RegExp) => projectStages.find((stage) => pattern.test(stage.key));
  const stageDone = (stage?: { status: string }) => stage?.status === "done" || stage?.status === "completed";
  const counted = (done: number, total: number) => total ? `${done} / ${total}` : null;

  // Lead to Won (flowchart 1, sections A–J).
  const drafts: Draft[] = [
    draft({ key: "enquiry", chapter: "win", lane: "sales", label: "Enquiry received", done: Boolean(lead || opportunity), doneAt: iso(lead?.createdAt ?? opportunity?.createdAt), href: leadHref, ...enquiryOwner, doneWhen: "The enquiry is logged" }),
    draft({ key: "assigned", chapter: "win", lane: "sales", label: "Assigned to an account manager", done: Boolean(extra?.assignedTo) || Boolean(opportunity), doneBy: extra?.assignedTo ?? null, href: leadHref, ...enquiryOwner, doneWhen: "An account manager owns the enquiry" }),
    draft({ key: "contact", chapter: "win", lane: "sales", label: "First contact", done: Boolean(lead?.contactedAt) || Boolean(opportunity), doneAt: iso(lead?.contactedAt), href: leadHref, ...enquiryOwner, doneWhen: "A call, message or meeting is logged" }),
    draft({ key: "convert", chapter: "win", lane: "sales", label: "Converted to opportunity", done: Boolean(opportunity), doneAt: iso(opportunity?.createdAt), href: leadHref, ...enquiryOwner, doneWhen: "Everything the convert gate asks for is filled in" }),
    draft({ key: "intro_booked", chapter: "win", lane: "sales", label: "Intro booked", done: Boolean(opportunity?.introAt), dueAt: iso(opportunity?.introAt), href: opportunityHref, ...team.accountManager, doneWhen: "The intro is in the designer's calendar" }),
    draft({ key: "intro_held", chapter: "win", lane: "design", label: "Intro held", done: opportunity?.introStatus === "completed", doneAt: iso(opportunity?.introDoneAt), doneBy: opportunity?.designer ?? null, dueAt: iso(opportunity?.introAt), href: opportunityHref, ...introDesigner, doneWhen: "The intro meeting is marked held" }),
    draft({ key: "outcome", chapter: "win", lane: "sales", label: "Intro outcome", done: opportunity?.outcome === "proceed" || Boolean(opportunity?.designWonAt), doneAt: iso(opportunity?.outcomeAt), doneBy: opportunity?.outcomeBy ?? null, href: opportunityHref, ...team.accountManager, doneWhen: "Going ahead is recorded, with the scope and the target date" }),
    draft({ key: "proposal_1", chapter: "win", lane: "sales", label: "Proposal 1 sent", done: ["issued", "accepted", "changes_requested", "declined"].includes(commercial?.designQuote ?? ""), skipped: noDesign, doneAt: iso(commercial?.designQuoteAt), href: caseHref("quotations"), ...team.accountManager, doneWhen: "The design-fee proposal is in the client's portal" }),
    draft({ key: "proposal_1_accepted", chapter: "win", lane: "client", label: "Proposal 1 accepted", done: commercial?.designQuote === "accepted" || Boolean(opportunity?.designWonAt), skipped: noDesign, href: caseHref("quotations"), ...team.accountManager, doneWhen: "The client accepts the design fee" }),
    draft({ key: "design_fee", chapter: "win", lane: "finance", label: "Design fee paid", done: Boolean(commercial?.paidDesign || opportunity?.designWonAt), skipped: noDesign, doneAt: iso(opportunity?.designWonAt), href: caseHref("payments"), ...team.finance, doneWhen: "Finance verifies the design-fee payment" }),
    draft({ key: "design_deal", chapter: "win", lane: "finance", label: "Design deal approved", done: Boolean(extra?.designDealAt) || design.length > 0, skipped: noDesign, doneAt: extra?.designDealAt ?? null, href: caseHref("approvals"), ...team.finance, doneWhen: "Finance checks the design deal and the owner approves it" }),
  ];

  // After Won, steps 1–11: the design. What finishes each step, in plain words.
  const DESIGN_DONE_WHEN: Record<string, string> = {
    team: "The design lead and the team are assigned",
    inspiration: "The client shares their inspiration in the portal",
    kickoff: "The kick-off is held and its minutes are in the portal",
    site_visit: "The site is measured and photographed",
    moodboards: "The client chooses one of the two mood boards",
    space_planning: "The space plan is shared with the client",
    concepts: "The client approves the 2D concepts",
    renders: "The client approves the renders",
    review: "The creative director approves the renders before the client sees them",
    material_selection: "The client chooses the materials",
    samples: "The samples are confirmed",
    final_render: "The final render is shared",
    approval: "The client signs off the design",
  };
  // Who owns each design step (guide steps 1–11): the Account Manager allocates the team; the lead designer runs the design;
  // the Visualiser the renders, the package's reviewer the review, the Material Coordinator the materials and samples.
  const DESIGN_OWNER: Record<string, StepOwner> = {
    team: team.accountManager, inspiration: team.leadDesigner, kickoff: team.leadDesigner, site_visit: team.leadDesigner, moodboards: team.leadDesigner,
    space_planning: team.leadDesigner, concepts: team.leadDesigner, renders: team.visualiser, review: team.reviewer, material_selection: team.materialCoordinator,
    samples: team.materialCoordinator, final_render: team.visualiser, approval: team.leadDesigner,
  };
  const designStep = (key: string, label: string, lane: JourneyLane, stage: JourneyStage | null, extraState: { done?: boolean; skipped?: boolean; note?: string | null; detail?: string | null } = {}) => {
    const record = stage ? stageOf(stage) : undefined;
    const notInJourney = Boolean(stage) && design.length > 0 && !record;
    drafts.push(draft({
      key: `design:${key}`, chapter: "design", lane, label,
      done: extraState.done ?? stageDone(record), skipped: noDesign || extraState.skipped || record?.status === "skipped" || notInJourney,
      note: noDesign ? "Not part of this job" : extraState.note ?? (notInJourney ? "Not in this package" : null),
      doneAt: iso(record?.doneAt), doneBy: record?.doneBy ?? null, dueAt: iso(record?.dueAt), href: caseHref("designs"), ...(DESIGN_OWNER[key] ?? team.leadDesigner),
      doneWhen: DESIGN_DONE_WHEN[key] ?? "The design lead marks it done",
    }));
  };
  designStep("team", "Design team allocated", "sales", null, { done: Boolean(extra?.designTeam) || design.length > 0 });
  designStep("inspiration", STAGE_LABELS.inspiration, "client", "inspiration");
  designStep("kickoff", STAGE_LABELS.kickoff, "design", "kickoff");
  designStep("site_visit", STAGE_LABELS.site_visit, "design", "site_visit");
  designStep("moodboards", "Mood boards (2 options)", "design", null, { done: (extra?.moodboards ?? 0) > 0 || stageDone(stageOf("concepts")) });
  designStep("space_planning", STAGE_LABELS.space_planning, "design", "space_planning", { skipped: extra?.packageSpacePlanning === false, note: extra?.packageSpacePlanning === false ? "Not in this package" : null });
  designStep("concepts", STAGE_LABELS.concepts, "design", "concepts");
  designStep("renders", STAGE_LABELS.renders, "design", "renders", { skipped: extra?.packageRenders === false, note: extra?.packageRenders === false ? "Not in this package" : null });
  designStep("review", "Creative Director review", "design", null, { done: (extra?.reviewed ?? 0) > 0, skipped: !extra?.packageReview, note: extra?.packageReview ? null : "Creative Director projects only" });
  designStep("material_selection", STAGE_LABELS.material_selection, "design", "material_selection");
  designStep("samples", STAGE_LABELS.samples, "design", "samples");
  designStep("final_render", "Final render", "design", null, { done: false, skipped: true, note: "Only if the client asks" });
  designStep("approval", STAGE_LABELS.approval, "client", "approval");

  // Steps 12–16: the price.
  const mainStatus = commercial?.mainQuote ?? "";
  const priced = ["internal_approved", "issued", "accepted", "changes_requested", "declined"].includes(mainStatus);
  drafts.push(
    draft({ key: "quotation", chapter: "price", lane: "sales", label: "Quotation prepared", done: Boolean(mainStatus), skipped: withdrawn, href: caseHref("quotations"), ...team.salesAdmin, doneWhen: "The quotation is built from the renders and the chosen materials" }),
    draft({ key: "qs_estimate", chapter: "price", lane: "delivery", label: "QS estimate", done: priced || mainStatus === "internal_review", skipped: withdrawn, href: caseHref("quotations"), ...team.qs, doneWhen: "The QS prices every line" }),
    draft({ key: "manager_approval", chapter: "price", lane: "design", label: "Manager approval", done: priced, skipped: withdrawn, href: caseHref("quotations"), ...team.pricingApprover, doneWhen: "The lead designer, creative director or account manager approves the pricing" }),
    draft({ key: "quotation_sent", chapter: "price", lane: "sales", label: "Estimate proposal sent", done: ["issued", "accepted", "changes_requested", "declined"].includes(mainStatus), skipped: withdrawn, doneAt: iso(commercial?.mainQuoteAt), href: caseHref("quotations"), ...team.accountManager, doneWhen: "The estimate proposal is in the client's portal" }),
    draft({ key: "quotation_accepted", chapter: "price", lane: "client", label: "Estimate proposal signed", done: mainStatus === "accepted", skipped: withdrawn, href: caseHref("quotations"), ...team.accountManager, doneWhen: "The client signs the estimate proposal" }),
    draft({ key: "agreement", chapter: "price", lane: "sales", label: "Payment agreement", done: commercial?.agreement === "executed", skipped: withdrawn, doneAt: commercial?.agreementAt ?? null, doneBy: commercial?.agreementBy ?? null, href: caseHref("agreement"), ...team.accountManager, doneWhen: "The signed payment agreement is verified" }),
    draft({ key: "upfront", chapter: "price", lane: "finance", label: "Upfront payment", done: Boolean(commercial?.paidMain || opportunity?.mainWonAt), skipped: withdrawn, doneAt: iso(opportunity?.mainWonAt), href: caseHref("payments"), ...team.finance, doneWhen: "Finance verifies the upfront payment" }),
    draft({ key: "deal", chapter: "price", lane: "finance", label: "Deal approved · quotation locked", done: Boolean(commercial?.dealAt), skipped: withdrawn, doneAt: commercial?.dealAt ?? null, doneBy: commercial?.dealBy ?? null, href: caseHref("approvals"), ...team.finance, doneWhen: "The owner approves the Deal File" }),
  );

  // Steps 17–28: make, install, care. Per-item steps count the job's items; the project's own stages fill the rest.
  const items = extra?.items ?? 0;
  // Step 20: an item whose cost runs above its agreed amount is held until the QS resolves it.
  const priceHeld = ids.projectId ? (await priceHolds(db, workspaceId, { projectId: ids.projectId })).size > 0 : false;
  const used = new Set<string>();
  const fromStage = (pattern: RegExp) => { const stage = projectStage(pattern); if (stage) used.add(stage.key); return stage; };
  const kickoff = fromStage(/kick/);
  const materials = fromStage(/material/);
  const drawings = fromStage(/drawing|technical/);
  const procurement = fromStage(/procure|purchas|order/);
  const production = fromStage(/produc|factory|manufact/);
  const permit = fromStage(/permit|pre.?install|readiness/);
  const install = fromStage(/install|deliver/);
  const snagging = fromStage(/snag/);
  const handover = fromStage(/handover/);
  drafts.push(
    draft({ key: "project", chapter: "make", lane: "delivery", label: "Project started", done: Boolean(project?.startedAt), skipped: withdrawn, doneAt: iso(project?.startedAt), href: projectHref(), ...team.projectManager, doneWhen: "The project manager starts the project" }),
    draft({ key: "kickoff_project", chapter: "make", lane: "delivery", label: kickoff?.name ?? "Project kick-off", done: stageDone(kickoff) || Boolean(project?.startedAt && !kickoff), skipped: withdrawn, doneAt: iso(kickoff?.doneAt), doneBy: kickoff?.doneBy ?? null, href: projectHref(), ...team.projectManager, doneWhen: "The project kick-off is held" }),
    draft({ key: "material_list", chapter: "make", lane: "design", label: "Material list + BOQ", done: extra?.materialList === "signed_off" || stageDone(materials), skipped: withdrawn, doneAt: iso(materials?.doneAt), href: projectHref("scope?view=materials"), ...team.materialCoordinator, doneWhen: "The material list is signed off; the BOQ stays internal" }),
    draft({ key: "technical", chapter: "make", lane: "delivery", label: "Technical delegation", done: Boolean(drawings && drawings.status !== "pending") || items > 0, skipped: withdrawn, href: projectHref("scope?view=drawings"), ...team.technical, doneWhen: "The technical lead assigns each item" }),
    draft({ key: "drawings", chapter: "make", lane: "client", label: "Drawings signed per item", done: perItemDrawings ? perItemDrawings.signed === perItemDrawings.applicable : items ? extra!.drawn === items : stageDone(drawings), skipped: withdrawn, doneAt: iso(drawings?.doneAt), href: projectHref("scope?view=drawings"), note: perItemDrawings ? counted(perItemDrawings.signed, perItemDrawings.applicable) : counted(extra?.drawn ?? 0, items), ...team.technical, doneWhen: "The lead designer checks each drawing and the client signs it" }),
    draft({ key: "margin", chapter: "make", lane: "delivery", label: "QS margin per item", done: items ? extra!.drawn === items && !priceHeld : stageDone(procurement), skipped: withdrawn, href: projectHref("scope?view=items"), ...team.margin, doneWhen: "The QS checks each item's margin against its materials" }),
    draft({ key: "release", chapter: "make", lane: "delivery", label: "Released to procurement", done: items ? extra!.released === items : stageDone(procurement), skipped: withdrawn, doneAt: iso(procurement?.doneAt), href: projectHref("scope?view=drawings"), note: extra?.supplied ? counted(extra.supplied, items || extra.supplied) : counted(extra?.released ?? 0, items), ...team.procurement, doneWhen: "Procurement orders the materials and signs off each item" }),
    draft({ key: "factory", chapter: "make", lane: "delivery", label: "Factory", done: items ? extra!.made === items : stageDone(production), skipped: withdrawn, doneAt: iso(production?.doneAt), href: projectHref("plan"), note: counted(extra?.made ?? 0, items), ...team.factory, doneWhen: "Every item is made, inspected and ready" }),
    draft({ key: "pre_install", chapter: "install", lane: "delivery", label: "Pre-installation checklist", done: stageDone(permit) || Boolean(extra?.materialsReady && stageDone(production)), skipped: withdrawn, doneAt: iso(permit?.doneAt ?? extra?.materialsReady), href: projectHref("site?view=items"), ...team.projectManager, doneWhen: "Everything is ready, the design matches, the permit is in, the crew and vehicle are booked" }),
    draft({ key: "install", chapter: "install", lane: "delivery", label: install?.name ?? "Delivery and installation", done: perItemDelivery ? perItemDelivery.done === perItemDelivery.applicable : stageDone(install), skipped: withdrawn, doneAt: iso(install?.doneAt), href: projectHref("site?view=items"), note: perItemDelivery ? counted(perItemDelivery.done, perItemDelivery.applicable) : null, ...team.installation, doneWhen: "Items are delivered and installed, with delivery photos" }),
    draft({ key: "site_reports", chapter: "install", lane: "delivery", label: "Daily site reports", done: stageDone(handover) || Boolean(project?.completedAt), skipped: withdrawn, href: projectHref("updates"), note: extra?.reports ? `${extra.reports}` : null, ...team.siteReports, doneWhen: "A report goes to the client for every site day" }),
    draft({ key: "snagging", chapter: "install", lane: "delivery", label: snagging?.name ?? "Snagging", done: stageDone(snagging), skipped: withdrawn, doneAt: iso(snagging?.doneAt), href: projectHref("handover"), ...team.projectManager, doneWhen: "Every open snag is closed" }),
    draft({ key: "handover", chapter: "install", lane: "client", label: handover?.name ?? "Handover", done: stageDone(handover) || extra?.handover === "accepted" || Boolean(project?.completedAt), skipped: withdrawn, doneAt: extra?.handoverAt ?? iso(handover?.doneAt ?? project?.completedAt), href: projectHref("handover"), ...team.projectManager, doneWhen: "The client accepts the handover in the portal" }),
  );
  // A firm's own project stages that match none of the guide's steps still show, in their chapter.
  for (const stage of projectStages.filter((item) => !used.has(item.key))) drafts.push(draft({
    key: `project:${stage.key}`, chapter: chapterOfProjectStage(stage.key), lane: "delivery", label: stage.name,
    done: stageDone(stage), skipped: stage.status === "skipped", note: stage.skip, doneAt: iso(stage.doneAt), doneBy: stage.doneBy, href: projectHref(), ...team.stage(stage.ownerRole), doneWhen: `${stage.name}: done`,
  }));
  drafts.push(draft({ key: "warranty", chapter: "care", lane: "delivery", label: "Warranty and claims", done: Boolean(warranty && warranty < new Date().toISOString().slice(0, 10)), skipped: withdrawn,
    dueAt: warranty, href: projectHref("handover"), ...team.projectManager, doneWhen: "The warranty period ends with every claim closed" }));
  // A furniture-only job follows its path (the firm's areas and fulfilment rule per path, else the kit's).
  const won = opportunity && ids.opportunityId ? await opportunityWonAreas(db, workspaceId, ids.opportunityId) : null;
  let pathed: Draft[] = drafts;
  if (won?.furniture) {
    const plan = ids.caseId ? await casePlan(db, workspaceId, ids.caseId) : null;
    const closing = await loadDealClosing(db, workspaceId, ids.opportunityId!);
    pathed = applyFurniturePath(drafts, {
      boq: !plan || plan.source !== "path" || plan.phases.includes("define"),
      fulfilment: plan?.source === "path" && plan.release === "fulfilment",
      areas: won.areas,
      delivered: Boolean(closing?.closed || closing?.checks.some((item) => item.done && ["delivered", "collected", "collected_or_delivered", "installed"].includes(item.key))),
      closed: Boolean(closing?.closed),
    });
  }
  // A lost job keeps what was done; nothing after it is due.
  const finalDrafts = closed ? pathed.map((step) => step.done ? step : { ...step, skipped: true, note: step.note ?? "Lost" }) : pathed;

  // A step still to do whose role nobody holds says so (after any count it shows).
  const steps = resolveStates(finalDrafts).map((step, index) => {
    const role = finalDrafts[index].ownerRole;
    if (step.owner || step.ownerId || !role || step.state === "done" || step.state === "skipped") return step;
    const missing = `No one allocated as ${role}`;
    return { ...step, note: step.note ? `${step.note} · ${missing}` : missing };
  });
  const nowIndex = steps.findIndex((step) => step.state === "now");
  const nowDraft = nowIndex >= 0 ? finalDrafts[nowIndex] : null;
  const chapters = JOURNEY_CHAPTERS.map((key) => {
    const inChapter = steps.filter((step) => step.chapter === key);
    const counted = inChapter.filter((step) => step.state !== "skipped");
    const done = counted.filter((step) => step.state === "done").length;
    const state = !counted.length ? "skipped" as const : done === counted.length ? "done" as const : inChapter.some((step) => step.state === "now") ? "now" as const
      : done > 0 ? "now" as const : "upcoming" as const;
    return { key, state, done, total: counted.length };
  });
  const amount = commercial?.value ?? opportunity?.amount ?? null;
  const currency = commercial?.currency ?? opportunity?.currency ?? null;
  return {
    jobId: job.id, reference: job.reference,
    title: lead?.title ?? opportunity?.title ?? project?.reference ?? null,
    client: lead?.client ?? opportunity?.client ?? null,
    chapters, lanes: [...JOURNEY_LANES], steps,
    now: nowDraft ? { ...steps[nowIndex], doneWhen: nowDraft.doneWhen } : null,
    next: steps.filter((step) => step.state === "next"),
    value: amount && currency ? { amount, currency } : null,
    targetDate: project?.promise ?? lead?.target ?? null,
  };
}
