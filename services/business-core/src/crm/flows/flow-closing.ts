import type { PoolClient } from "pg";
import { FURNITURE_PATHS, type FurniturePath } from "../opportunities/flow-gates";
import { allSteps, isMaterialSelectionStep, type FlowDefinition } from "./flow-definition";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-102: what closes a deal, per enquiry type's flow and furniture path. Configuration rows
 * (crm_flow_closing_rules); Deal Closed itself is computed from the records these events name, never typed.
 *   collected                         the client collected it (Furniture A: same day, at handover)
 *   delivered                         delivered, with proof of delivery (Furniture B, D, E)
 *   collected_or_delivered            either (Furniture C, ordered from a supplier)
 *   design_handover                   the client's design approval is recorded (Full ID)
 *   all_produced_delivered_installed  every work order produced, then delivered and installed (ID & Furniture)
 *   completion_handover               the signed completion and handover is accepted (Fit-out)
 */
export const CLOSING_EVENTS = ["collected", "delivered", "collected_or_delivered", "design_handover", "all_produced_delivered_installed", "completion_handover"] as const;
export type ClosingEvent = (typeof CLOSING_EVENTS)[number];

/** A flow's closing: one event for the whole flow, or one per furniture path (a path without its own uses the default). */
export type FlowClosing = { default: ClosingEvent | null; paths?: Partial<Record<FurniturePath, ClosingEvent>> };

const FURNITURE: FlowClosing = {
  default: "delivered",
  paths: { take_home_now: "collected", in_stock_delivery: "delivered", supplier_order: "collected_or_delivered", core_collection_factory: "delivered", bespoke: "delivered" },
};

/**
 * The product defaults, kept with the flow templates and starter flows they belong to (CeCe's Enquiry Types Flow
 * table). A flow made from a template or starter gets its closing from here; a firm changes it per enquiry type.
 */
export const TEMPLATE_CLOSING: Record<string, FlowClosing> = {
  // Starter flows (by code).
  furniture: FURNITURE,
  design: { default: "design_handover" },
  fit_out: { default: "completion_handover" },
  basic: { default: null },
  // Library templates (by key).
  furniture_all_paths: FURNITURE,
  furniture_take_home: { default: "collected" },
  furniture_in_stock_delivery: { default: "delivered" },
  furniture_supplier_order: { default: "collected_or_delivered" },
  furniture_core_collection: { default: "delivered" },
  furniture_bespoke: { default: "delivered" },
  design_concept: { default: "design_handover" },
  design_bespoke: { default: "design_handover" },
  design_creative_director: { default: "design_handover" },
  design_and_furniture: { default: "all_produced_delivered_installed" },
  fit_out_joinery: { default: "completion_handover" },
  full_fit_out: { default: "completion_handover" },
  renovation: { default: "completion_handover" },
  returning_customer: { default: "delivered" },
  architecture: { default: null },
};

/**
 * For a flow whose origin isn't known (made before closing rules existed): read it from its steps the way the
 * templates are built. A sub-path branch is furniture; QS pricing is fit-out; a design round with a site visit is
 * design followed by furniture; a design round alone is design; anything else with a quotation is delivered.
 */
export function inferClosing(definition: FlowDefinition): FlowClosing {
  const checks = new Set(allSteps(definition).map((step) => step.check));
  if (definition.branches.some((branch) => branch.question === "subPath") || checks.has("sub_path_chosen")) return FURNITURE;
  if (checks.has("qs_approved") && checks.has("site_visit_recorded")) return { default: "completion_handover" };
  if (checks.has("package_chosen") && checks.has("site_visit_recorded")) return { default: "all_produced_delivered_installed" };
  // Material selection on a furniture or joinery order (PLM-081) is not a design round.
  if (checks.has("package_chosen") || allSteps(definition).some((step) => step.check === "design_stage_done" && !isMaterialSelectionStep(step))) return { default: "design_handover" };
  if (checks.has("quote_exists")) return { default: "delivered" };
  return { default: null };
}

export type ClosingRule = { furniturePath: FurniturePath | null; closingEvent: ClosingEvent; version: number };

/** The event that closes a deal on this path: the path's own rule, else the flow's. */
export function closingEventFor(rules: ClosingRule[], path: FurniturePath | null): ClosingEvent | null {
  return (path ? rules.find((rule) => rule.furniturePath === path)?.closingEvent : undefined) ?? rules.find((rule) => rule.furniturePath === null)?.closingEvent ?? null;
}

export function closingRows(closing: FlowClosing): Array<{ furniturePath: FurniturePath | null; closingEvent: ClosingEvent }> {
  const rows: Array<{ furniturePath: FurniturePath | null; closingEvent: ClosingEvent }> = [];
  if (closing.default) rows.push({ furniturePath: null, closingEvent: closing.default });
  for (const path of FURNITURE_PATHS) {
    const event = closing.paths?.[path];
    if (event) rows.push({ furniturePath: path, closingEvent: event });
  }
  return rows;
}

export async function loadClosingRules(db: Db, workspaceId: string, flowId: string): Promise<ClosingRule[]> {
  return (await db.query<ClosingRule>(
    `SELECT furniture_path AS "furniturePath", closing_event AS "closingEvent", version FROM crm_flow_closing_rules WHERE workspace_id = $1 AND flow_id = $2
      ORDER BY furniture_path NULLS FIRST`, [workspaceId, flowId])).rows;
}

/** Writes a flow's closing rows when it has none yet (idempotent: a firm's own rules are never overwritten). */
export async function seedClosingRules(db: Db, workspaceId: string, flowId: string, closing: FlowClosing, actorUserId: string | null = null) {
  for (const row of closingRows(closing)) {
    await db.query(
      `INSERT INTO crm_flow_closing_rules (workspace_id, flow_id, furniture_path, closing_event, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO NOTHING`,
      [workspaceId, flowId, row.furniturePath, row.closingEvent, actorUserId]);
  }
}

/**
 * A flow's closing rules, seeded on first read from its template or starter when it has none, else from its steps.
 * Runs in the caller's tenant transaction.
 */
export async function ensureClosingRules(db: Db, workspaceId: string, flow: { flowId: string; code: string; definition: FlowDefinition }, templateKey?: string | null) {
  const rules = await loadClosingRules(db, workspaceId, flow.flowId);
  if (rules.length) return rules;
  const closing = (templateKey ? TEMPLATE_CLOSING[templateKey] : undefined) ?? TEMPLATE_CLOSING[flow.code] ?? inferClosing(flow.definition);
  await seedClosingRules(db, workspaceId, flow.flowId, closing);
  return loadClosingRules(db, workspaceId, flow.flowId);
}

/** Copies another flow's closing rules onto a new flow (an enquiry type copied from another). */
export async function copyClosingRules(db: Db, workspaceId: string, fromFlowId: string, toFlowId: string, actorUserId: string) {
  const rules = await loadClosingRules(db, workspaceId, fromFlowId);
  for (const rule of rules) {
    await db.query(
      `INSERT INTO crm_flow_closing_rules (workspace_id, flow_id, furniture_path, closing_event, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO NOTHING`,
      [workspaceId, toFlowId, rule.furniturePath, rule.closingEvent, actorUserId]);
  }
}
