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
 * Hiding an area never hides data: where a record exists in an area the path doesn't use, the area still shows.
 */
export const WON_AREAS = ["planning", "production", "supply", "delivery"] as const;
export type WonArea = (typeof WON_AREAS)[number];
export const isWonArea = (value: unknown): value is WonArea => typeof value === "string" && (WON_AREAS as readonly string[]).includes(value);

export type WonAreasRule = { furniturePath: FurniturePath | null; areas: WonArea[]; version: number };

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

/**
 * The areas configured for the job a case belongs to: its opportunity's flow (the version it pinned, else its enquiry
 * type's flow) and furniture path. Read only: it never pins a flow version.
 */
export async function caseWonAreas(db: Db, workspaceId: string, caseId: string): Promise<{ areas: WonArea[]; flowId: string | null; furniturePath: FurniturePath | null }> {
  const row = (await db.query<{ flowId: string | null; furniturePath: FurniturePath | null }>(
    `SELECT coalesce(pinned.flow_id, typed.id) AS "flowId", opportunity.furniture_path AS "furniturePath"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flows typed ON typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
  if (!row?.flowId) return { areas: [...WON_AREAS], flowId: null, furniturePath: row?.furniturePath ?? null };
  return { areas: areasFor(await loadWonAreas(db, workspaceId, row.flowId), row.furniturePath), flowId: row.flowId, furniturePath: row.furniturePath };
}
