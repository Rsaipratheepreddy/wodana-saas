import type { PoolClient } from "pg";
import { FURNITURE_PATHS, type FurniturePath } from "../crm/opportunities/flow-gates";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-083 / PLM-125 / PLM-126: what an order on one enquiry type (its flow) and furniture path does after it is quoted,
 * as configuration (crm_flow_fulfilment_rules), next to the closing rule and the areas after Won:
 *   boqRequired      the order needs a BOQ priced by the QS by default (null: the firm's quotation setting decides)
 *   reserveOn        the event that holds stock for it: the quotation accepted, the supplier order received, production booked
 *   deductOn         the event that takes it out: Won, the collection or delivery, production started
 *   lead time        working days (from the region's working week) from Won or the drawing approval, at least the
 *                    catalogue's own production or supplier time when `leadFromCatalogue`
 */
export const RESERVE_EVENTS = ["none", "quote_accepted", "supplier_received", "production_booked"] as const;
export type ReserveEvent = (typeof RESERVE_EVENTS)[number];
export const DEDUCT_EVENTS = ["none", "won", "fulfilled", "production_started"] as const;
export type DeductEvent = (typeof DEDUCT_EVENTS)[number];
export const LEAD_FROM = ["won", "drawing_approved"] as const;
export type LeadFrom = (typeof LEAD_FROM)[number];

export type RuleSettings = {
  boqRequired: boolean | null; reserveOn: ReserveEvent; deductOn: DeductEvent;
  leadMinDays: number | null; leadMaxDays: number | null; leadFrom: LeadFrom; leadFromCatalogue: boolean;
  /** Where the deal's goods are held and taken from first (e.g. the showroom); null: the default places. */
  takeFromLocationId: string | null;
};
export type FulfilmentRule = RuleSettings & { furniturePath: FurniturePath | null; version: number };

/** Nothing happens to stock and no lead time: what a flow without rules does. */
export const NO_RULE: RuleSettings = { boqRequired: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFrom: "won", leadFromCatalogue: false,
  takeFromLocationId: null };

/**
 * The product defaults for a furniture flow, from the Enquiry Types Flow table (PLM-121/125/126): A and B are held
 * when the quotation is accepted and taken out at Won; C comes in with the supplier's delivery and goes out at
 * collection or delivery; D and E hold their materials when production is booked and use them when it starts.
 * Only bespoke pieces need the QS. A firm changes any of it per enquiry type.
 */
export const FURNITURE_RULES: Array<{ furniturePath: FurniturePath | null } & RuleSettings> = [
  { ...NO_RULE, furniturePath: null, boqRequired: false },
  { furniturePath: "take_home_now", boqRequired: false, reserveOn: "quote_accepted", deductOn: "won", leadMinDays: 0, leadMaxDays: 0, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null },
  { furniturePath: "in_stock_delivery", boqRequired: false, reserveOn: "quote_accepted", deductOn: "won", leadMinDays: 3, leadMaxDays: 4, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null },
  { furniturePath: "supplier_order", boqRequired: false, reserveOn: "supplier_received", deductOn: "fulfilled", leadMinDays: 3, leadMaxDays: 4, leadFrom: "won", leadFromCatalogue: true, takeFromLocationId: null },
  { furniturePath: "core_collection_factory", boqRequired: false, reserveOn: "production_booked", deductOn: "production_started", leadMinDays: null, leadMaxDays: null, leadFrom: "won", leadFromCatalogue: true, takeFromLocationId: null },
  { furniturePath: "bespoke", boqRequired: true, reserveOn: "production_booked", deductOn: "production_started", leadMinDays: 20, leadMaxDays: 30, leadFrom: "drawing_approved", leadFromCatalogue: false, takeFromLocationId: null },
];

/** The rule for a path: its own row, else the flow's, else nothing. */
export function ruleFor(rules: FulfilmentRule[], path: FurniturePath | null): RuleSettings {
  const rule = (path ? rules.find((item) => item.furniturePath === path) : undefined) ?? rules.find((item) => item.furniturePath === null);
  if (!rule) return { ...NO_RULE };
  const { furniturePath: _path, version: _version, ...settings } = rule;
  return settings;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null => (options as readonly unknown[]).includes(value) ? value as T : null;
const days = (value: unknown) => value === null || value === undefined || value === "" ? null : Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 365 ? Number(value) : NaN;

/** Parses an editor's save: one rule per path (null is the whole type), known events, a lead time from min to max. */
export function parseRules(input: unknown): Array<{ furniturePath: FurniturePath | null } & RuleSettings> | string {
  if (!Array.isArray(input) || input.length > FURNITURE_PATHS.length + 1) return "Set the rules per path";
  const out: Array<{ furniturePath: FurniturePath | null } & RuleSettings> = [];
  for (const item of input) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const path = value.furniturePath === null || value.furniturePath === undefined || value.furniturePath === "" ? null : oneOf(value.furniturePath, FURNITURE_PATHS);
    if (path === null && value.furniturePath) return "Choose a furniture path";
    const boqRequired = value.boqRequired === true ? true : value.boqRequired === false ? false : value.boqRequired === null || value.boqRequired === undefined ? null : undefined;
    if (boqRequired === undefined) return "Say whether a BOQ is needed";
    const reserveOn = oneOf(value.reserveOn ?? "none", RESERVE_EVENTS);
    const deductOn = oneOf(value.deductOn ?? "none", DEDUCT_EVENTS);
    if (!reserveOn || !deductOn) return "Choose when stock is held and taken out";
    const min = days(value.leadMinDays), max = days(value.leadMaxDays);
    if (Number.isNaN(min) || Number.isNaN(max)) return "Lead times are whole working days, up to 365";
    if ((min === null) !== (max === null)) return "Give the lead time from and to";
    if (min !== null && max !== null && min > max) return "The lead time's first day comes before its last";
    const leadFrom = oneOf(value.leadFrom ?? "won", LEAD_FROM);
    if (!leadFrom) return "Choose what the lead time counts from";
    const place = value.takeFromLocationId === null || value.takeFromLocationId === undefined || value.takeFromLocationId === "" ? null : String(value.takeFromLocationId);
    if (place !== null && !UUID.test(place)) return "Choose a place stock is kept";
    out.push({ furniturePath: path, boqRequired, reserveOn, deductOn, leadMinDays: min, leadMaxDays: max, leadFrom, leadFromCatalogue: value.leadFromCatalogue === true, takeFromLocationId: place });
  }
  if (new Set(out.map((rule) => rule.furniturePath ?? "")).size !== out.length) return "One rule per path";
  return out;
}

export async function loadRules(db: Db, workspaceId: string, flowId: string): Promise<FulfilmentRule[]> {
  return (await db.query<FulfilmentRule>(
    `SELECT furniture_path AS "furniturePath", boq_required AS "boqRequired", reserve_on AS "reserveOn", deduct_on AS "deductOn", lead_min_days AS "leadMinDays",
            lead_max_days AS "leadMaxDays", lead_from AS "leadFrom", lead_from_catalogue AS "leadFromCatalogue", take_from_location_id AS "takeFromLocationId", version
       FROM crm_flow_fulfilment_rules WHERE workspace_id = $1 AND flow_id = $2 ORDER BY furniture_path NULLS FIRST`, [workspaceId, flowId])).rows;
}

/** A flow with furniture paths: the furniture starter, or a flow whose definition branches on the sub-path. */
export async function isFurnitureFlow(db: Db, workspaceId: string, flowId: string) {
  const row = (await db.query<{ code: string; furniture: boolean }>(
    `SELECT flow.code, coalesce((SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(version.definition->'branches', '[]'::jsonb)) branch WHERE branch->>'question' = 'subPath')
                                   FROM crm_flow_versions version WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id ORDER BY version.version DESC LIMIT 1), false) AS furniture
       FROM crm_flows flow WHERE flow.workspace_id = $1 AND flow.id = $2`, [workspaceId, flowId])).rows[0];
  return Boolean(row && (row.code === "furniture" || row.furniture));
}

export async function writeRules(db: Db, workspaceId: string, flowId: string, rules: Array<{ furniturePath: FurniturePath | null } & RuleSettings>, actorUserId: string | null, replace: boolean) {
  for (const rule of rules) {
    await db.query(
      `INSERT INTO crm_flow_fulfilment_rules (workspace_id, flow_id, furniture_path, boq_required, reserve_on, deduct_on, lead_min_days, lead_max_days, lead_from, lead_from_catalogue,
         take_from_location_id, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (workspace_id, flow_id, coalesce(furniture_path, '')) DO ${replace ? `UPDATE SET boq_required = EXCLUDED.boq_required, reserve_on = EXCLUDED.reserve_on,
         deduct_on = EXCLUDED.deduct_on, lead_min_days = EXCLUDED.lead_min_days, lead_max_days = EXCLUDED.lead_max_days, lead_from = EXCLUDED.lead_from,
         lead_from_catalogue = EXCLUDED.lead_from_catalogue, take_from_location_id = EXCLUDED.take_from_location_id, updated_by = EXCLUDED.updated_by, version = crm_flow_fulfilment_rules.version + 1` : "NOTHING"}`,
      [workspaceId, flowId, rule.furniturePath, rule.boqRequired, rule.reserveOn, rule.deductOn, rule.leadMinDays, rule.leadMaxDays, rule.leadFrom, rule.leadFromCatalogue, rule.takeFromLocationId, actorUserId]);
  }
}

/** A flow's rules, seeded once from the product defaults (furniture flows) when it has none. Never overwrites a firm's own. */
export async function ensureRules(db: Db, workspaceId: string, flowId: string) {
  const rules = await loadRules(db, workspaceId, flowId);
  if (rules.length || !(await isFurnitureFlow(db, workspaceId, flowId))) return rules;
  await writeRules(db, workspaceId, flowId, FURNITURE_RULES, null, false);
  return loadRules(db, workspaceId, flowId);
}

/** The rules a flow would have, without seeding anything (reports read; they never write). */
async function peekRules(db: Db, workspaceId: string, flowId: string): Promise<FulfilmentRule[]> {
  const rules = await loadRules(db, workspaceId, flowId);
  if (rules.length || !(await isFurnitureFlow(db, workspaceId, flowId))) return rules;
  return FURNITURE_RULES.map((rule) => ({ ...rule, version: 1 }));
}

export type DealRule = RuleSettings & {
  opportunityId: string; flowId: string | null; furniturePath: FurniturePath | null;
  /** The order's own choice (null: the rule's). */
  boqOverride: boolean | null;
  status: string; caseId: string | null; projectId: string | null; cancelledAt: string | null;
};

/**
 * The rule that applies to one deal: its flow (the version it pinned, else its enquiry type's, else the basic one)
 * and its furniture path, and the order's own BOQ choice. Read only: it never pins a flow version; with `readOnly` it
 * doesn't seed a furniture flow's default rules either (it reads them as they would be).
 */
export async function dealRule(db: Db, workspaceId: string, opportunityId: string, options: { readOnly?: boolean } = {}): Promise<DealRule | null> {
  const row = (await db.query<{ flowId: string | null; furniturePath: FurniturePath | null; boqOverride: boolean | null; status: string; caseId: string | null;
    projectId: string | null; cancelledAt: Date | null }>(
    `SELECT coalesce(pinned.flow_id, typed.id, basic.id) AS "flowId", opportunity.furniture_path AS "furniturePath", deal.boq_required AS "boqOverride",
            opportunity.status::text AS status, pre_case.id AS "caseId", project.id AS "projectId", deal.cancelled_at AS "cancelledAt"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flows typed ON typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow AND typed.status = 'active'
       LEFT JOIN crm_flows basic ON basic.workspace_id = opportunity.workspace_id AND basic.code = 'basic' AND basic.status = 'active'
       LEFT JOIN crm_deal_fulfilment deal ON deal.workspace_id = opportunity.workspace_id AND deal.opportunity_id = opportunity.id
       LEFT JOIN pre_project_cases pre_case ON pre_case.workspace_id = opportunity.workspace_id AND pre_case.opportunity_id = opportunity.id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.status <> 'cancelled'
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2
      ORDER BY pre_case.created_at DESC NULLS LAST LIMIT 1`, [workspaceId, opportunityId])).rows[0];
  if (!row) return null;
  const settings = row.flowId ? ruleFor(await (options.readOnly ? peekRules : ensureRules)(db, workspaceId, row.flowId), row.furniturePath) : { ...NO_RULE };
  return {
    ...settings, opportunityId, flowId: row.flowId, furniturePath: row.furniturePath, boqOverride: row.boqOverride,
    boqRequired: row.boqOverride ?? settings.boqRequired, status: row.status, caseId: row.caseId, projectId: row.projectId,
    cancelledAt: row.cancelledAt instanceof Date ? row.cancelledAt.toISOString() : row.cancelledAt,
  };
}

/** The deal a planning case or a project belongs to. */
export async function opportunityOfCase(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string | null }>(`SELECT opportunity_id AS id FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rows[0]?.id ?? null;
}

export async function opportunityOfProject(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ id: string | null }>(
    `SELECT pre_case.opportunity_id AS id FROM delivery_projects project JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0]?.id ?? null;
}

/**
 * PLM-083: whether this case's order needs a BOQ priced by the QS. The order's own choice, else its path's (or enquiry
 * type's) default, else the firm's quotation setting (`fallback`). A case without a deal follows the setting.
 */
export async function boqRequiredForCase(db: Db, workspaceId: string, caseId: string, fallback: boolean) {
  const opportunityId = await opportunityOfCase(db, workspaceId, caseId);
  if (!opportunityId) return fallback;
  return (await dealRule(db, workspaceId, opportunityId))?.boqRequired ?? fallback;
}

export async function boqRequiredForProject(db: Db, workspaceId: string, projectId: string, fallback: boolean) {
  const opportunityId = await opportunityOfProject(db, workspaceId, projectId);
  if (!opportunityId) return fallback;
  return (await dealRule(db, workspaceId, opportunityId))?.boqRequired ?? fallback;
}
