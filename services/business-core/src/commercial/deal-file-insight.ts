import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";
import { loadDealClosing, type DealClosing } from "../crm/opportunities/deal-closing";
import { loadProposals, type ProposalKind, type ValueStatus } from "../crm/opportunities/opportunity-proposals";
import type { FurniturePath } from "../crm/opportunities/flow-gates";
import type { ServicePathScope } from "../projects/service-path-route";
import { acceptedQuoteTotals, acceptedQuoteValue } from "./commercial.domain";
import { qsEstimateCurrent } from "./qs-estimate";
import type { TeamRoleView } from "../project-core/team-types";
import type { CommercialData, Quote } from "./commercial.types";
import { permitRequired, readPermitFacts } from "../logistics/permits";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-123 / PLM-066 / PLM-102: what one Deal File holds and where it stands, read from the records (never typed):
 * the money (agreed, paid, outstanding, next due), what a reviewer should look at, the common contents plus the
 * enquiry type's own sections — each a link to the live record, not a copy — and whether the deal is closed.
 */
export type DealRiskCode = "payment_proof_missing" | "commission_missing" | "margin_below_floor" | "qs_estimate_missing" | "balance_outstanding" | "value_zero";
/** present: the record exists or the step is done · missing: required and absent · open: under way in its module. */
export type DealSectionState = "present" | "missing" | "open";
export type DealSection = {
  key: string;
  group: "common" | "furniture" | "design" | "production";
  state: DealSectionState;
  count?: number;
  /** Where the live record is (a screen path), when there is one. */
  href: string | null;
};
export type DealMoney = { agreed: string; received: string; outstanding: string };
export type DealInsight = DealMoney & {
  currency: string;
  /** Per accepted proposal (Proposal 1 design fee, Proposal 2 main): its own money. */
  rounds: Array<DealMoney & { round: ProposalKind; quoteNumber: number }>;
  nextDue: { title: string; amount: string; dueDate: string | null } | null;
  risks: DealRiskCode[];
  sections: DealSection[];
  closing: DealClosing | null;
  proposals: Array<{ kind: ProposalKind; valueStatus: ValueStatus; wonAt: string | null }>;
  /** PLM-100: who works on the deal, role by role (a person or "not applicable"), as tagged on the enquiry and the opportunity. */
  team?: TeamRoleView[];
};

const text = (value: Dec, currency: string) => value.toFixed(currency ? currencyDecimals(currency) : 2);

/** The accepted quotations the Deal File stands on: the design fee (Proposal 1) and the main quotation (Proposal 2). */
export function acceptedRounds(data: Pick<CommercialData, "quotes">): Array<{ round: ProposalKind; quote: Quote }> {
  return data.quotes.filter((quote) => quote.kind === "quotation" && quote.status === "accepted")
    .map((quote) => ({ round: quote.round === "design" ? "design" as const : "main" as const, quote }))
    .sort((left, right) => (left.round === right.round ? 0 : left.round === "design" ? -1 : 1));
}

/** PLM-066: agreed value less payments Finance verified, per proposal and in total, in exact decimals. */
export function dealMoney(data: Pick<CommercialData, "quotes" | "payments">) {
  const rounds = acceptedRounds(data).map(({ round, quote }) => {
    const agreed = Dec.of(acceptedQuoteValue(quote));
    const received = data.payments.filter((payment) => payment.sourceQuoteId === quote.id && payment.status === "verified").reduce((sum, payment) => sum.add(payment.amount), Dec.ZERO);
    const outstanding = agreed.sub(received);
    return { round, quoteNumber: quote.number, currency: quote.currency, agreed, received, outstanding: outstanding.isNegative() ? Dec.ZERO : outstanding };
  });
  const currency = rounds[0]?.currency ?? data.quotes[0]?.currency ?? "";
  const sum = (pick: (row: (typeof rounds)[number]) => Dec) => rounds.filter((row) => row.currency === currency).reduce((total, row) => total.add(pick(row)), Dec.ZERO);
  const ids = new Set(acceptedRounds(data).map(({ quote }) => quote.id));
  const due = data.payments.filter((payment) => payment.sourceQuoteId && ids.has(payment.sourceQuoteId) && payment.status !== "verified")
    .sort((left, right) => (left.dueDate || "9999").localeCompare(right.dueDate || "9999"))[0];
  return {
    currency,
    agreed: text(sum((row) => row.agreed), currency), received: text(sum((row) => row.received), currency), outstanding: text(sum((row) => row.outstanding), currency),
    rounds: rounds.map((row) => ({ round: row.round, quoteNumber: row.quoteNumber, agreed: text(row.agreed, row.currency), received: text(row.received, row.currency), outstanding: text(row.outstanding, row.currency) })),
    nextDue: due ? { title: due.title, amount: text(Dec.of(due.amount), due.currency ?? currency), dueDate: due.dueDate || null } : null,
  };
}

export function dealRisks(data: CommercialData, options: { marginFloorPercent: string | null; proofCount: number; outstanding: string }): DealRiskCode[] {
  const risks: DealRiskCode[] = [];
  const dealFile = data.dealFile;
  const review = data.ownerReview;
  const quote = data.quotes.find((item) => item.id === (dealFile?.quoteId ?? review?.quoteId));
  const commissions = dealFile?.commissionLines ?? review?.finalCommissionLines ?? review?.commissionLines;
  if (!(dealFile?.paymentProofUrl ?? review?.paymentProofUrl) && options.proofCount === 0 && !data.payments.some((payment) => payment.sourceQuoteId === quote?.id && payment.status === "verified"))
    risks.push("payment_proof_missing");
  if (!commissions?.length) risks.push("commission_missing");
  if (quote && Dec.of(acceptedQuoteValue(quote)).cmp(0) <= 0) risks.push("value_zero");
  if (options.marginFloorPercent !== null && quote && Dec.of(acceptedQuoteTotals(quote).margin).cmp(options.marginFloorPercent) < 0) risks.push("margin_below_floor");
  if (data.servicePath && quote && quote.round !== "design" && !qsEstimateCurrent(quote)) risks.push("qs_estimate_missing");
  if (Dec.of(options.outstanding).cmp(0) > 0) risks.push("balance_outstanding");
  return risks;
}

/** The live records the sections link to, loaded once per Deal File. */
export type DealLive = {
  caseId: string;
  opportunityId: string | null;
  projectId: string | null;
  flow: string | null;
  furniturePath: FurniturePath | null;
  materialsChange: boolean;
  proofCount: number;
  designStages: Record<string, "locked" | "active" | "done">;
  boqLines: number;
  workOrders: { total: number; ready: number; drawingsApproved: number };
  supplierOrders: { total: number; arrived: number };
  fulfilment: { collected: number; delivered: number; installed: number };
  proposals: Array<{ kind: ProposalKind; valueStatus: ValueStatus; wonAt: string | null }>;
  /** PLM-136: the building permit, recorded on the project or the deal: whether it's required, collected, or its collection planned. */
  permit?: { required: boolean; collected: boolean; planned: boolean };
};

const DESIGN_SECTIONS: Array<[string, string]> = [
  ["inspiration", "inspiration"], ["site_visit", "site_visit"], ["concepts", "concepts"], ["space_planning", "space_planning"],
  ["material_list", "material_selection"], ["renders", "renders"], ["design_approval", "approval"],
];

/**
 * The Deal File's contents (PLM-123): what every Deal File holds, then what the enquiry type adds — Furniture (items,
 * collection or delivery, approved drawing for D/E, materials approval when they change, supplier orders for C,
 * proof of delivery), Full ID (design fee proposal and every design stage), ID & Furniture and fit-out (Proposal 2,
 * BOQ, technical drawings, production, delivery and installation).
 */
export function dealSections(data: CommercialData, live: DealLive, scope: ServicePathScope | null): DealSection[] {
  const caseHref = (section: string) => `/workspace/pre-projects/cases/${live.caseId}/${section}`;
  const opportunityHref = live.opportunityId ? `/workspace/crm/opportunities?record=${live.opportunityId}` : null;
  const projectHref = (section = "") => (live.projectId ? `/workspace/projects/${live.projectId}${section ? `/${section}` : ""}` : null);
  const dealFile = data.dealFile;
  const review = data.ownerReview;
  const quote = data.quotes.find((item) => item.id === (dealFile?.quoteId ?? review?.quoteId)) ?? acceptedRounds(data).at(-1)?.quote;
  const commissions = dealFile?.commissionLines ?? review?.finalCommissionLines ?? [];
  const state = (present: boolean, open = false): DealSectionState => (present ? "present" : open ? "open" : "missing");
  const sections: DealSection[] = [
    { key: "enquiry", group: "common", state: state(Boolean(dealFile?.enquiryReference ?? live.opportunityId)), href: opportunityHref },
    { key: "client", group: "common", state: "present", href: opportunityHref },
    { key: "quotation", group: "common", state: state(Boolean(quote)), href: caseHref("quotations") },
    { key: "payment_proofs", group: "common", state: state(live.proofCount > 0 || Boolean(dealFile?.paymentProofUrl ?? review?.paymentProofUrl)), count: live.proofCount, href: opportunityHref },
    { key: "finance_values", group: "common", state: state(Boolean(review?.financeReviewedById), Boolean(review)), href: caseHref("execution-release") },
    { key: "commission", group: "common", state: state(commissions.length > 0), count: commissions.length, href: caseHref("execution-release") },
    { key: "approval", group: "common", state: state(Boolean(dealFile?.approvedAt), Boolean(review)), href: caseHref("execution-release") },
    { key: "history", group: "common", state: state(data.audit.length > 0), count: data.audit.length, href: caseHref("execution-release") },
  ];
  const furniture = live.flow === "furniture" || live.furniturePath !== null;
  const design = Boolean(scope?.design) || live.flow === "design" || Object.keys(live.designStages).length > 0;
  const production = Boolean(scope && (scope.manufacturing || scope.siteWorks || scope.installation || (scope.design && scope.mainQuotation)));
  if (furniture) {
    const path = live.furniturePath;
    sections.push({ key: "items", group: "furniture", state: state(Boolean(quote?.lines.length)), count: quote?.lines.length ?? 0, href: caseHref("quotations") });
    sections.push({ key: path === "take_home_now" ? "collection" : "collection_delivery", group: "furniture",
      state: state(live.fulfilment.collected + live.fulfilment.delivered > 0, true), href: opportunityHref });
    if (path === "core_collection_factory" || path === "bespoke")
      sections.push({ key: "approved_drawing", group: "furniture", state: state(live.workOrders.drawingsApproved > 0, true), count: live.workOrders.drawingsApproved, href: projectHref() ?? opportunityHref });
    if (live.materialsChange) sections.push({ key: "materials_approval", group: "furniture", state: state(Boolean(dealFile?.materialEvidence?.length), true), href: caseHref("execution-release") });
    if (path === "supplier_order")
      sections.push({ key: "supplier_orders", group: "furniture", state: state(live.supplierOrders.total > 0 && live.supplierOrders.arrived === live.supplierOrders.total, live.supplierOrders.total > 0),
        count: live.supplierOrders.total, href: "/workspace/purchasing/orders" });
    if (path !== "take_home_now" && (live.permit?.required || live.permit?.collected) && !live.projectId)
      sections.push({ key: "building_permit", group: "furniture", state: state(Boolean(live.permit?.collected), Boolean(live.permit?.planned)), href: opportunityHref });
    if (path !== "take_home_now") sections.push({ key: "proof_of_delivery", group: "furniture", state: state(live.fulfilment.delivered > 0, true), href: opportunityHref });
  }
  if (design) {
    const proposal = live.proposals.find((item) => item.kind === "design");
    sections.push({ key: "design_fee_proposal", group: "design", state: state(Boolean(proposal?.wonAt) || data.quotes.some((item) => item.round === "design" && item.status === "accepted"), Boolean(proposal)), href: caseHref("quotations") });
    for (const [key, stage] of DESIGN_SECTIONS) {
      const status = live.designStages[stage];
      if (!status && ["space_planning", "renders"].includes(stage)) continue;
      sections.push({ key, group: "design", state: state(status === "done", status === "active"), href: caseHref("designs") });
    }
  }
  if (production) {
    if (design) {
      const main = live.proposals.find((item) => item.kind === "main");
      sections.push({ key: "main_quotation", group: "production", state: state(Boolean(main?.wonAt) || data.quotes.some((item) => item.round === "main" && item.status === "accepted"), Boolean(main)), href: caseHref("quotations") });
    }
    sections.push({ key: "boq", group: "production", state: state(live.boqLines > 0, Boolean(live.projectId)), count: live.boqLines, href: projectHref() });
    sections.push({ key: "technical_drawings", group: "production", state: state(live.workOrders.total > 0 && live.workOrders.drawingsApproved === live.workOrders.total, live.workOrders.total > 0),
      count: live.workOrders.drawingsApproved, href: projectHref() });
    sections.push({ key: "production", group: "production", state: state(live.workOrders.total > 0 && live.workOrders.ready === live.workOrders.total, live.workOrders.total > 0),
      count: live.workOrders.total, href: projectHref() });
    if (live.permit?.required || live.permit?.collected)
      sections.push({ key: "building_permit", group: "production", state: state(Boolean(live.permit?.collected), Boolean(live.permit?.planned)), href: projectHref() ?? opportunityHref });
    sections.push({ key: "delivery_installation", group: "production", state: state(live.fulfilment.delivered > 0 && live.fulfilment.installed > 0, live.fulfilment.delivered > 0), href: opportunityHref });
    if (!furniture) sections.push({ key: "proof_of_delivery", group: "production", state: state(live.fulfilment.delivered > 0, true), href: opportunityHref });
  }
  return sections;
}

/** The live records behind one Deal File's sections, in the caller's tenant transaction. */
async function dealLive(db: Db, workspaceId: string, caseId: string, opportunityId: string | null): Promise<DealLive> {
  const row = (await db.query<{
    projectId: string | null; flow: string | null; furniturePath: FurniturePath | null; materialsChange: boolean | null; proofCount: number;
    stages: Record<string, "locked" | "active" | "done"> | null; boqLines: number; workTotal: number; workReady: number; drawings: number;
    ordersTotal: number; ordersArrived: number; collected: number; delivered: number; installed: number;
  }>(
    `SELECT project.id AS "projectId", choice.flow, opportunity.furniture_path AS "furniturePath", opportunity.materials_change AS "materialsChange",
            (SELECT count(*)::int FROM crm_opportunity_payment_proofs proof WHERE proof.workspace_id = $1 AND proof.opportunity_id = opportunity.id) AS "proofCount",
            (SELECT jsonb_object_agg(stage.stage, stage.status) FROM design_journey_stages stage WHERE stage.workspace_id = $1 AND stage.case_id = $2) AS stages,
            (SELECT count(*)::int FROM project_boq_lines line WHERE line.workspace_id = $1 AND line.project_id = project.id) AS "boqLines",
            (SELECT count(*) FILTER (WHERE work.status <> 'cancelled')::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = project.id) AS "workTotal",
            (SELECT count(*) FILTER (WHERE work.status IN ('ready', 'short_closed'))::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = project.id) AS "workReady",
            (SELECT count(*) FILTER (WHERE work.drawing_approved_at IS NOT NULL AND work.status <> 'cancelled')::int FROM work_orders work WHERE work.workspace_id = $1 AND work.project_id = project.id) AS drawings,
            (SELECT count(DISTINCT line.order_id)::int FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
              WHERE line.workspace_id = $1 AND (line.project_id = project.id OR line.opportunity_id = opportunity.id) AND purchase.status NOT IN ('draft', 'cancelled')) AS "ordersTotal",
            (SELECT count(DISTINCT shipment.order_id)::int FROM purchase_order_shipments shipment JOIN purchase_order_lines line ON line.workspace_id = shipment.workspace_id AND line.order_id = shipment.order_id
              WHERE shipment.workspace_id = $1 AND (line.project_id = project.id OR line.opportunity_id = opportunity.id) AND shipment.status = 'arrived') AS "ordersArrived",
            (SELECT count(*)::int FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = opportunity.id AND event.event = 'collected') AS collected,
            (SELECT count(*)::int FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = opportunity.id AND event.event = 'delivered') AS delivered,
            (SELECT count(*)::int FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = opportunity.id AND event.event = 'installed') AS installed
       FROM (SELECT 1) one
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = $1 AND opportunity.id = $3::uuid
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN delivery_projects project ON project.workspace_id = $1 AND project.case_id = $2`,
    [workspaceId, caseId, opportunityId])).rows[0];
  return {
    caseId, opportunityId, projectId: row?.projectId ?? null, flow: row?.flow ?? null, furniturePath: row?.furniturePath ?? null, materialsChange: Boolean(row?.materialsChange),
    proofCount: row?.proofCount ?? 0, designStages: row?.stages ?? {}, boqLines: row?.boqLines ?? 0,
    workOrders: { total: row?.workTotal ?? 0, ready: row?.workReady ?? 0, drawingsApproved: row?.drawings ?? 0 },
    supplierOrders: { total: row?.ordersTotal ?? 0, arrived: row?.ordersArrived ?? 0 },
    fulfilment: { collected: row?.collected ?? 0, delivered: row?.delivered ?? 0, installed: row?.installed ?? 0 },
    proposals: opportunityId ? (await loadProposals(db, workspaceId, opportunityId)).map((proposal) => ({ kind: proposal.kind, valueStatus: proposal.valueStatus, wonAt: proposal.wonAt })) : [],
    permit: await dealPermit(db, workspaceId, row?.projectId ?? null, opportunityId),
  };
}

/** PLM-136: the order's building permit, on its project or its deal (the same permit shows on both). */
async function dealPermit(db: Db, workspaceId: string, projectId: string | null, opportunityId: string | null) {
  const owner = projectId ? { projectId } : opportunityId ? { opportunityId } : null;
  if (!owner) return undefined;
  const facts = await readPermitFacts(db, workspaceId, owner);
  return { required: await permitRequired(db, workspaceId, owner), collected: facts.some((fact) => fact.status === "collected"), planned: facts.some((fact) => fact.status === "planned") };
}

/** The Deal File insight for the case screen; null until a Deal File is submitted or approved. */
export async function dealInsightFor(db: Db, workspaceId: string, input: { caseId: string; opportunityId: string | null; data: CommercialData; canViewCosts: boolean; team?: TeamRoleView[] }): Promise<DealInsight | null> {
  const { data } = input;
  if (!data.dealFile && !data.ownerReview) return null;
  const live = await dealLive(db, workspaceId, input.caseId, input.opportunityId);
  const money = dealMoney(data);
  const floor = input.canViewCosts
    ? (await db.query<{ floor: string | null }>(`SELECT margin_floor_percent::text AS floor FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.floor ?? null
    : null;
  return {
    ...money,
    risks: dealRisks(data, { marginFloorPercent: floor, proofCount: live.proofCount, outstanding: money.outstanding }),
    sections: dealSections(data, live, data.servicePath?.scope ?? null),
    closing: input.opportunityId ? await loadDealClosing(db, workspaceId, input.opportunityId) : null,
    proposals: live.proposals,
    team: input.team ?? [],
  };
}
