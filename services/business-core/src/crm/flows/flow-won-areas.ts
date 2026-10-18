import type { PoolClient } from "pg";
import { FURNITURE_PATHS, type FurniturePath } from "../opportunities/flow-gates";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-098: the areas a job uses after Won, set per enquiry type (its flow) and, for furniture, per path (A–E).
 * Configuration rows (crm_flow_won_areas) next to the deal-closing rule. A flow without rows uses every area, so a
 * workspace that never sets this sees exactly what it saw before; a path without its own row uses the flow's.
 *   planning    the project's plan (sprints, tasks)
 *   production  the factory: work orders and the factory slot
 *   supply      buying and delivering materials to the project
 *   delivery    delivery and installation days
 *   selection   the material selection with the client (samples), during design (guide step 10)
 * Hiding an area never hides data: where a record exists in an area the path doesn't use, the area still shows.
 */
export const WON_AREAS = ["planning", "production", "supply", "delivery", "selection"] as const;
export type WonArea = (typeof WON_AREAS)[number];
export const isWonArea = (value: unknown): value is WonArea => typeof value === "string" && (WON_AREAS as readonly string[]).includes(value);

export type WonAreasRule = { furniturePath: FurniturePath | null; areas: WonArea[]; version: number };

/**
 * The starting areas of a furniture flow's paths until the firm sets its own (Settings › the enquiry type's areas):
 * A taken home now ends at handover; B in stock is delivered; C is ordered from the supplier, then delivered; D is
 * made in the factory from the collection; E bespoke is planned, drawn, made and delivered. Shown as the kit value.
 */
export const KIT_FURNITURE_AREAS: Readonly<Record<FurniturePath, readonly WonArea[]>> = {
  take_home_now: [],
  in_stock_delivery: ["delivery"],
  supplier_order: ["supply", "delivery"],
  core_collection_factory: ["production", "supply", "delivery"],
  bespoke: ["planning", "production", "supply", "delivery", "selection"],
};

/** The rules a flow works by: its own; a furniture flow with none uses the kit's per path; any other flow every area. */
export function effectiveWonAreas(rules: WonAreasRule[], furniture: boolean): WonAreasRule[] {
  if (rules.length || !furniture) return rules;
  return [{ furniturePath: null, areas: [...WON_AREAS], version: 0 },
    ...FURNITURE_PATHS.map((path) => ({ furniturePath: path, areas: [...KIT_FURNITURE_AREAS[path]], version: 0 }))];
}

/** The areas of a path: its own rule, else the flow's, else every area. In the product's order. */
export function areasFor(rules: WonAreasRule[], path: FurniturePath | null): WonArea[] {
  const rule = (path ? rules.find((item) => item.furniturePath === path) : undefined) ?? rules.find((item) => item.furniturePath === null);
  return rule ? WON_AREAS.filter((area) => rule.areas.includes(area)) : [...WON_AREAS];
}

/** What shows: the path's areas, plus every area that already holds a record. */
export function shownAreas(configured: WonArea[], present: Partial<Record<WonArea, boolean>>): Record<WonArea, boolean> {
  return Object.fromEntries(WON_AREAS.map((area) => [area, configured.includes(area) || Boolean(present[area])])) as Record<WonArea, boolean>;
}

/** Parses an editor's save: one rule per path (null is the whole type), known areas only, no duplicates. */
export function parseWonAreas(input: unknown): Array<{ furniturePath: FurniturePath | null; areas: WonArea[] }> | string {
  if (!Array.isArray(input) || input.length > FURNITURE_PATHS.length + 1) return "Choose the areas per path";
  const out: Array<{ furniturePath: FurniturePath | null; areas: WonArea[] }> = [];
  for (const item of input) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const path = value.furniturePath === null || value.furniturePath === undefined || value.furniturePath === "" ? null : value.furniturePath;
    if (path !== null && !(FURNITURE_PATHS as readonly unknown[]).includes(path)) return "Choose a furniture path";
    if (!Array.isArray(value.areas) || !value.areas.every(isWonArea)) return "Choose known areas";
    out.push({ furniturePath: path as FurniturePath | null, areas: WON_AREAS.filter((area) => (value.areas as unknown[]).includes(area)) });
  }
  if (new Set(out.map((rule) => rule.furniturePath ?? "")).size !== out.length) return "One rule per path";
  return out;
}

export async function loadWonAreas(db: Db, workspaceId: string, flowId: string): Promise<WonAreasRule[]> {
  return (await db.query<WonAreasRule>(
    `SELECT furniture_path AS "furniturePath", areas, version FROM crm_flow_won_areas WHERE workspace_id = $1 AND flow_id = $2 ORDER BY furniture_path NULLS FIRST`,
    [workspaceId, flowId])).rows.map((row) => ({ ...row, areas: row.areas.filter(isWonArea), version: Number(row.version) }));
}

/** Copies another flow's rules onto a new flow (an enquiry type copied from another). */
export async function copyWonAreas(db: Db, workspaceId: string, fromFlowId: string, toFlowId: string, actorUserId: string) {
  for (const rule of await loadWonAreas(db, workspaceId, fromFlowId)) {
    await db.query(
      `INSERT INTO crm_flow_won_areas (workspace_id, flow_id, furniture_path, areas, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO NOTHING`, [workspaceId, toFlowId, rule.furniturePath, rule.areas, actorUserId]);
  }
}

/** Whether a flow version is a furniture flow: it asks which furniture path (A–E) the job takes. */
export const isFurnitureDefinition = (definition: unknown) =>
  Boolean(definition && typeof definition === "object" && Array.isArray((definition as { branches?: unknown }).branches)
    && ((definition as { branches: Array<{ question?: unknown }> }).branches).some((branch) => branch?.question === "subPath"));

export type JobWonAreas = { areas: WonArea[]; flowId: string | null; furniturePath: FurniturePath | null; furniture: boolean };

/**
 * The areas configured for the job a case belongs to: its opportunity's flow (the version it pinned, else its enquiry
 * type's flow) and furniture path. Read only: it never pins a flow version.
 */
export async function caseWonAreas(db: Db, workspaceId: string, caseId: string): Promise<JobWonAreas> {
  const opportunityId = (await db.query<{ id: string }>(`SELECT opportunity_id::text AS id FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rows[0]?.id;
  return opportunityWonAreas(db, workspaceId, opportunityId ?? null);
}

/** The same for an opportunity (a job before it has a case). */
export async function opportunityWonAreas(db: Db, workspaceId: string, opportunityId: string | null): Promise<JobWonAreas> {
  const row = opportunityId ? (await db.query<{ flowId: string | null; furniturePath: FurniturePath | null; definition: unknown }>(
    `SELECT coalesce(pinned.flow_id, typed.id) AS "flowId", opportunity.furniture_path AS "furniturePath",
            coalesce(pinned.definition, (SELECT latest.definition FROM crm_flow_versions latest WHERE latest.workspace_id = typed.workspace_id AND latest.flow_id = typed.id
               ORDER BY latest.version DESC LIMIT 1)) AS definition
       FROM crm_opportunities opportunity
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flows typed ON typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0] : undefined;
  // A furniture flow is one that asks for the path (as the Settings editor and the case plan read it).
  const furniture = isFurnitureDefinition(row?.definition);
  if (!row?.flowId) return { areas: [...WON_AREAS], flowId: null, furniturePath: row?.furniturePath ?? null, furniture };
  const rules = effectiveWonAreas(await loadWonAreas(db, workspaceId, row.flowId), furniture);
  return { areas: areasFor(rules, row.furniturePath), flowId: row.flowId, furniturePath: row.furniturePath, furniture };
}
