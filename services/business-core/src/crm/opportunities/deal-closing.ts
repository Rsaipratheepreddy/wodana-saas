import type { PoolClient } from "pg";
import { closingEventFor, ensureClosingRules, type ClosingEvent } from "../flows/flow-closing";
import { opportunityFlow } from "../flows/flow-store";
import type { FurniturePath } from "./flow-gates";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-102: Deal Closed, computed from the records the enquiry type's closing event names — never typed in.
 * Collection, delivery and installation are recorded as fulfilment events (with who received it); design handover
 * is the client's design approval in the design journey; production is the project's work orders; completion is
 * the accepted handover pack.
 */
export const FULFILMENT_EVENTS = ["collected", "delivered", "installed"] as const;
export type FulfilmentEvent = (typeof FULFILMENT_EVENTS)[number];

export type ClosingCheckKey = "collected" | "delivered" | "collected_or_delivered" | "installed" | "produced" | "design_approved" | "handover_accepted";
export type ClosingCheck = { key: ClosingCheckKey; done: boolean; at: string | null };

export type ClosingFacts = {
  collectedAt: string | null;
  deliveredAt: string | null;
  installedAt: string | null;
  workOrders: { total: number; open: number; lastReadyAt: string | null };
  designApprovedAt: string | null;
  handoverAcceptedAt: string | null;
  /** Guide J: the job had site work (a handover pack or site reports): its signed handover is then part of closing. */
  siteWork?: boolean;
};

export type DealClosing = {
  event: ClosingEvent | null;
  furniturePath: FurniturePath | null;
  closed: boolean;
  closedAt: string | null;
  checks: ClosingCheck[];
};

const check = (key: ClosingCheckKey, at: string | null): ClosingCheck => ({ key, done: Boolean(at), at });
const latest = (values: Array<string | null>) => values.every(Boolean) ? values.reduce<string>((max, value) => (value! > max ? value! : max), "") : null;
const earliest = (values: Array<string | null>) => values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;

/** What the closing event asks for, and whether the records show it. Closed when every check is done. */
export function closingState(event: ClosingEvent | null, facts: ClosingFacts, furniturePath: FurniturePath | null = null): DealClosing {
  const produced = facts.workOrders.open === 0 ? (facts.workOrders.lastReadyAt ?? (facts.workOrders.total === 0 ? facts.deliveredAt : null)) : null;
  const checks: ClosingCheck[] =
    event === "collected" ? [check("collected", facts.collectedAt)]
    : event === "delivered" ? [check("delivered", facts.deliveredAt)]
    : event === "collected_or_delivered" ? [check("collected_or_delivered", earliest([facts.collectedAt, facts.deliveredAt]))]
    : event === "design_handover" ? [check("design_approved", facts.designApprovedAt)]
    // Guide J: every item delivered or installed (installation only where it applies), and the signed handover only with site work.
    : event === "all_produced_delivered_installed" ? [check("produced", produced), check("delivered", earliest([facts.deliveredAt, facts.installedAt])),
      ...(facts.siteWork ? [check("handover_accepted", facts.handoverAcceptedAt)] : [])]
    : event === "completion_handover" ? [check("handover_accepted", facts.handoverAcceptedAt)]
    : [];
  const closed = checks.length > 0 && checks.every((item) => item.done);
  return { event, furniturePath, closed, closedAt: closed ? latest(checks.map((item) => item.at)) : null, checks };
}

const iso = (value: Date | string | null | undefined) => (value instanceof Date ? value.toISOString() : value ?? null);

/** Deal Closed for one opportunity: its flow's closing rule for its path, read against its records. */
export async function loadDealClosing(db: Db, workspaceId: string, opportunityId: string): Promise<DealClosing | null> {
  const row = (await db.query<{ flow: string | null; flowVersionId: string | null; furniturePath: FurniturePath | null; caseId: string | null }>(
    `SELECT choice.flow, opportunity.flow_version_id AS "flowVersionId", opportunity.furniture_path AS "furniturePath", source_case.id AS "caseId"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN pre_project_cases source_case ON source_case.workspace_id = opportunity.workspace_id AND source_case.opportunity_id = opportunity.id
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0];
  if (!row) return null;
  const flow = await opportunityFlow(db, { workspaceId, opportunityId, code: row.flow, pinnedVersionId: row.flowVersionId });
  const rules = flow.flowId ? await ensureClosingRules(db, workspaceId, { flowId: flow.flowId, code: flow.code, definition: flow.definition }) : [];
  // Guide J (Q2 withdrawn): once the withdrawal of Proposal 2 is confirmed, the deal completes at design handover.
  const withdrawn = (await db.query(`SELECT 1 FROM crm_opportunity_proposals WHERE workspace_id = $1 AND opportunity_id = $2 AND kind = 'main' AND withdrawal_status = 'confirmed'`,
    [workspaceId, opportunityId])).rowCount;
  const event = withdrawn ? "design_handover" : closingEventFor(rules, row.furniturePath);
  return closingState(event, await closingFacts(db, workspaceId, opportunityId, row.caseId), row.furniturePath);
}

export async function closingFacts(db: Db, workspaceId: string, opportunityId: string, caseId: string | null): Promise<ClosingFacts> {
  const facts = (await db.query<{
    collectedAt: Date | null; deliveredAt: Date | null; installedAt: Date | null; total: number; open: number; lastReadyAt: Date | null;
    designApprovedAt: Date | null; handoverAcceptedAt: Date | null; siteWork: boolean;
  }>(
    `SELECT (SELECT min(event.recorded_at) FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = $2 AND event.event = 'collected') AS "collectedAt",
            (SELECT min(event.recorded_at) FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = $2 AND event.event = 'delivered') AS "deliveredAt",
            (SELECT min(event.recorded_at) FROM crm_deal_fulfilment_events event WHERE event.workspace_id = $1 AND event.opportunity_id = $2 AND event.event = 'installed') AS "installedAt",
            coalesce(work.total, 0) AS total, coalesce(work.open, 0) AS open, work."lastReadyAt",
            (SELECT stage.completed_at FROM design_journey_stages stage WHERE stage.workspace_id = $1 AND stage.case_id = $3::uuid AND stage.stage = 'approval' AND stage.status = 'done') AS "designApprovedAt",
            (SELECT min(pack.decided_on)::timestamptz FROM handover_packs pack JOIN delivery_projects project ON project.workspace_id = pack.workspace_id AND project.id = pack.project_id
              WHERE pack.workspace_id = $1 AND project.case_id = $3::uuid AND pack.status = 'accepted') AS "handoverAcceptedAt",
            EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = $1 AND project.case_id = $3::uuid AND (
              EXISTS (SELECT 1 FROM handover_packs pack WHERE pack.workspace_id = project.workspace_id AND pack.project_id = project.id)
              OR EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id))) AS "siteWork"
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE work_order.status <> 'cancelled')::int AS total,
                count(*) FILTER (WHERE work_order.status NOT IN ('ready', 'short_closed', 'cancelled'))::int AS open,
                max(work_order.ready_at) AS "lastReadyAt"
           FROM work_orders work_order JOIN delivery_projects project ON project.workspace_id = work_order.workspace_id AND project.id = work_order.project_id
          WHERE work_order.workspace_id = $1 AND project.case_id = $3::uuid) work ON true`,
    [workspaceId, opportunityId, caseId])).rows[0];
  return {
    collectedAt: iso(facts?.collectedAt), deliveredAt: iso(facts?.deliveredAt), installedAt: iso(facts?.installedAt),
    workOrders: { total: facts?.total ?? 0, open: facts?.open ?? 0, lastReadyAt: iso(facts?.lastReadyAt) },
    designApprovedAt: iso(facts?.designApprovedAt), handoverAcceptedAt: iso(facts?.handoverAcceptedAt), siteWork: Boolean(facts?.siteWork),
  };
}

export type FulfilmentRow = { id: string; event: FulfilmentEvent; receivedBy: string; note: string; recordedBy: string | null; recordedAt: string; hasProof: boolean; proofIsImage: boolean };

export async function loadFulfilment(db: Db, workspaceId: string, opportunityId: string): Promise<FulfilmentRow[]> {
  return (await db.query<FulfilmentRow>(
    `SELECT event.id, event.event, event.received_by AS "receivedBy", event.note, coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS "recordedBy",
            event.recorded_at AS "recordedAt", event.proof_storage_key IS NOT NULL AS "hasProof", coalesce(event.proof_mime_type LIKE 'image/%', false) AS "proofIsImage"
       FROM crm_deal_fulfilment_events event LEFT JOIN users account ON account.id = event.recorded_by
      WHERE event.workspace_id = $1 AND event.opportunity_id = $2 ORDER BY event.recorded_at, event.id`, [workspaceId, opportunityId])).rows
    .map((row) => ({ ...row, recordedAt: iso(row.recordedAt as unknown as Date)! }));
}
