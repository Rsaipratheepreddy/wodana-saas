import { UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { hasResolvedEnquiryType, loadLeadOptions, UNRESOLVED_ENQUIRY_TYPE } from "./lead-options";
import { LEAD_TEAM_ROLES } from "./lead-team";

type Db = Pick<PoolClient, "query">;

/** One thing a save still needs: the field it belongs to and what to do, in plain words. */
export type Problem = { key: string; label: string };

/**
 * PLM-092: a save that fails names every problem at once, so the form can list them in one box and mark each
 * field. The response carries `missing` (the fields) next to the message; nothing fails silently.
 */
export class ProblemList {
  readonly items: Problem[] = [];
  add(key: string, label: string) { if (!this.items.some((item) => item.key === key)) this.items.push({ key, label }); return this; }
  when(condition: unknown, key: string, label: string) { if (condition) this.add(key, label); return this; }
  addAll(problems: Problem[]) { for (const problem of problems) this.add(problem.key, problem.label); return this; }
  get length() { return this.items.length; }
  throwIfAny(lead?: string) { throwProblems(this.items, lead); }
}

/** A 422 that lists every problem, each with its field. `lead` opens the message ("Complete … before converting:"). */
export function throwProblems(problems: Problem[], lead?: string) {
  if (!problems.length) return;
  const list = problems.map((item) => item.label).join(". ");
  throw new UnprocessableEntityException({ statusCode: 422, error: "Unprocessable Entity", message: lead ? `${lead}: ${list}` : list, missing: problems });
}

/* ── Required fields per enquiry type (PLM-096) ──────────────────────────────────────────────────────── */

/** The gates an enquiry passes, in order. A field required at one gate is required at every later one. */
export const REQUIREMENT_GATES = ["create", "convert", "book_intro"] as const;
export type RequirementGate = (typeof REQUIREMENT_GATES)[number];
/** What a firm stores per type and field: a gate, or `never` (a product default switched off). */
export type RequiredAt = RequirementGate | "never";
export const REQUIRED_AT: readonly RequiredAt[] = [...REQUIREMENT_GATES, "never"];

/**
 * The fields a firm can require. Name, mobile, enquiry type, source, channel and the region (when the workspace lists
 * regions) are always required when an enquiry is created, so they are not configured here. `emirate` stays the data
 * key of the region; labels come from the region pack in the web. `team:<role>` is a team role tagged on the enquiry
 * (a member, or Not applicable); `cf:<id>` is one of the workspace's own enquiry fields.
 */
export const REQUIRABLE_FIELDS = ["email", "area", "address", "budgetRange", "customerType", "summary", "targetCompletion"] as const;
export type RequirementRules = Record<string, RequiredAt>;

/**
 * The product defaults, today's rules: the intro meeting needs the client's email (PLM-043). A type a firm has
 * not configured uses these; the first save for a type stores its whole set.
 */
export const DEFAULT_REQUIREMENTS: RequirementRules = { email: "book_intro" };

const LABELS: Record<string, string> = {
  email: "Enter the client's email",
  area: "Enter the area",
  address: "Enter the address",
  budgetRange: "Choose the budget range",
  customerType: "Choose the client type",
  summary: "Describe the project",
  targetCompletion: "Enter the client's target completion date",
};

export function isRequirableKey(key: string) {
  return (REQUIRABLE_FIELDS as readonly string[]).includes(key)
    || /^cf:[0-9a-f-]{36}$/.test(key)
    || (key.startsWith("team:") && (LEAD_TEAM_ROLES as readonly string[]).includes(key.slice(5)));
}

/** True when a field required `at` applies at `gate` (create < convert < book_intro). */
export function requiredBy(at: RequiredAt | undefined, gate: RequirementGate) {
  if (!at || at === "never") return false;
  return REQUIREMENT_GATES.indexOf(at) <= REQUIREMENT_GATES.indexOf(gate);
}

export type EnquiryFacts = {
  serviceType: string | null;
  email: string | null; area: string | null; address: string | null; budgetRange: string | null; customerType: string | null; summary: string | null;
  /** PLM-155: the date the client wants it finished (Sales collect it; the design team and Production say what is possible). */
  targetCompletion?: string | null;
  /** Team roles answered on the enquiry (a member or Not applicable). */
  team: ReadonlySet<string>;
  /** The workspace's own fields that hold a value, by `cf:<id>`. */
  custom: ReadonlySet<string>;
  /** Labels of the workspace's own fields, by `cf:<id>`. */
  customLabels?: ReadonlyMap<string, string>;
};
export type RequirementContext = {
  rules: RequirementRules;
  /** Fixed fields the workspace hides: never required. */
  hidden: ReadonlySet<string>;
  hasBudgetRanges: boolean; hasCustomerTypes: boolean;
  /** Team roles the enquiry type asks for; another role is never required. */
  teamRoles: readonly string[];
};

const blank = (value: string | null | undefined) => !value?.trim();

/** What the enquiry still needs at this gate, in a stable order. Converting always needs a real enquiry type. */
export function requirementProblems(facts: EnquiryFacts, context: RequirementContext, gate: RequirementGate): Problem[] {
  const problems = new ProblemList();
  if (gate !== "create") problems.when(!hasResolvedEnquiryType(facts.serviceType), "serviceType", "Choose the enquiry type; Not sure yet can't be converted");
  const needs = (key: string) => requiredBy(context.rules[key], gate) && !context.hidden.has(key);
  for (const key of REQUIRABLE_FIELDS) {
    if (!needs(key)) continue;
    if (key === "budgetRange" && !context.hasBudgetRanges) continue;
    if (key === "customerType" && !context.hasCustomerTypes) continue;
    problems.when(blank(facts[key] ?? null), key, LABELS[key]);
  }
  for (const role of context.teamRoles) {
    const key = `team:${role}`;
    if (needs(key)) problems.when(!facts.team.has(role), key, `Tag the ${role.replace(/_/g, " ")}, or choose Not applicable`);
  }
  for (const key of Object.keys(context.rules).filter((item) => item.startsWith("cf:")).sort()) {
    if (!needs(key) || !facts.customLabels?.has(key)) continue;
    problems.when(!facts.custom.has(key), key, `Fill in ${facts.customLabels.get(key)}`);
  }
  return problems.items;
}

type RequirementRow = { enquiryType: string; fieldKey: string; requiredAt: RequiredAt; version: number };

/** The stored rules of every configured type; a type without rows uses `DEFAULT_REQUIREMENTS`. */
export async function loadRequirementRows(db: Db, workspaceId: string) {
  return (await db.query<RequirementRow>(
    `SELECT enquiry_type AS "enquiryType", field_key AS "fieldKey", required_at AS "requiredAt", version
       FROM crm_enquiry_requirements WHERE workspace_id = $1 ORDER BY enquiry_type, field_key`, [workspaceId])).rows;
}

/** The effective rules per enquiry type id, for every type the workspace lists (Not sure yet has only the defaults). */
export function rulesByType(rows: RequirementRow[], typeIds: readonly string[]): Record<string, RequirementRules> {
  const stored = new Map<string, RequirementRules>();
  for (const row of rows) stored.set(row.enquiryType, { ...(stored.get(row.enquiryType) ?? {}), [row.fieldKey]: row.requiredAt });
  return Object.fromEntries(typeIds.map((id) => [id, id === UNRESOLVED_ENQUIRY_TYPE ? {} : { ...DEFAULT_REQUIREMENTS, ...(stored.get(id) ? onlyStored(stored.get(id)!) : {}) }]));
}
/** Once a type has rows, they are its whole set: defaults it did not store are off. */
function onlyStored(rules: RequirementRules): RequirementRules {
  return { ...Object.fromEntries(Object.keys(DEFAULT_REQUIREMENTS).map((key) => [key, "never" as RequiredAt])), ...rules };
}

export async function hiddenEnquiryFields(db: Db, workspaceId: string) {
  return new Set((await db.query<{ fieldKey: string }>(
    `SELECT field_key AS "fieldKey" FROM crm_enquiry_field_settings WHERE workspace_id = $1 AND visible = false`, [workspaceId])).rows.map((row) => row.fieldKey));
}

type StoredEnquiry = { serviceType: string | null; summary: string | null; details: Record<string, any> | null; email: string | null; enquiryId: string };

/** The facts of a stored enquiry that requirements read: contact email, details, team and the workspace's own fields. */
export async function loadEnquiryFacts(db: Db, workspaceId: string, leadId: string, extraEmail?: string | null): Promise<EnquiryFacts | null> {
  const row = (await db.query<StoredEnquiry>(
    `SELECT enquiry.id AS "enquiryId", enquiry.service_type AS "serviceType", enquiry.summary, enquiry.details,
            (SELECT cp.raw_value FROM crm_contact_points cp WHERE cp.workspace_id = lead.workspace_id AND cp.party_id = lead.party_id
              AND cp.type = 'email' AND cp.status = 'active' ORDER BY cp.is_primary DESC, cp.created_at DESC LIMIT 1) AS email
       FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
      WHERE lead.workspace_id = $1 AND lead.id = $2`, [workspaceId, leadId])).rows[0];
  if (!row) return null;
  const details = row.details ?? {};
  const team = (await db.query<{ role: string }>(`SELECT role_code AS role FROM crm_lead_team WHERE workspace_id = $1 AND lead_id = $2`, [workspaceId, leadId])).rows;
  const custom = (await db.query<{ id: string; label: string; filled: boolean }>(
    `SELECT definition.id, definition.label,
            EXISTS (SELECT 1 FROM crm_custom_field_values value WHERE value.workspace_id = definition.workspace_id AND value.definition_id = definition.id
              AND value.entity_type = 'enquiry' AND value.entity_id = $2
              AND (NULLIF(btrim(value.value_text), '') IS NOT NULL OR value.value_number IS NOT NULL OR value.value_timestamp IS NOT NULL
                OR value.value_boolean IS NOT NULL OR (value.value_json IS NOT NULL AND value.value_json NOT IN ('[]'::jsonb, 'null'::jsonb)))) AS filled
       FROM crm_custom_field_definitions definition
      WHERE definition.workspace_id = $1 AND definition.entity_type = 'enquiry' AND definition.status = 'active'`, [workspaceId, row.enquiryId])).rows;
  const text = (value: unknown) => typeof value === "string" ? value : null;
  return {
    serviceType: row.serviceType, summary: row.summary,
    // An email left empty on the enquiry form is no email: one given on Discovery still counts.
    email: row.email || text(details.contact?.email)?.trim() || extraEmail || null,
    area: text(details.area) || text(details.location), address: text(details.contact?.address),
    budgetRange: text(details.budgetRange), customerType: text(details.customerType), targetCompletion: text(details.targetCompletion),
    team: new Set(team.map((entry) => entry.role)),
    custom: new Set(custom.filter((field) => field.filled).map((field) => `cf:${field.id}`)),
    customLabels: new Map(custom.map((field) => [`cf:${field.id}`, field.label])),
  };
}

/** The workspace's requirement context for one enquiry type. */
export async function requirementContext(db: Db, workspaceId: string, serviceType: string | null, teamRoles: readonly string[]): Promise<RequirementContext> {
  const options = await loadLeadOptions(db as PoolClient, workspaceId);
  const type = serviceType ?? UNRESOLVED_ENQUIRY_TYPE;
  const rules = rulesByType(await loadRequirementRows(db, workspaceId), [type])[type] ?? {};
  return { rules, hidden: await hiddenEnquiryFields(db, workspaceId), hasBudgetRanges: options.budgetRanges.length > 0, hasCustomerTypes: options.customerTypes.length > 0, teamRoles };
}
