import { UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";

type Option = { id: string; label: string; flow?: string; color?: number; /** An enquiry type whose flow is furniture-only (it asks for the path A–E). */ furniture?: boolean };
const options = (entries: [string, string][]): Option[] => entries.map(([id, label]) => ({ id, label }));
export const UNRESOLVED_ENQUIRY_TYPE = "not_sure";
/** The region choice for anywhere outside the workspace's listed regions. */
export const REGION_OTHER = "other";
/** Guide B: "client type can be TBC at intake": once a firm lists its client types, this choice is always offered with them. */
export const CLIENT_TYPE_TBC: Option = { id: "tbc", label: "TBC" };
const CLIENT_TYPE_PLACEHOLDERS = new Set(["tbc", "not_sure", "unknown", "to_be_confirmed"]);
const withClientTypeTbc = (list: Option[]) => !list.length || list.some((option) => CLIENT_TYPE_PLACEHOLDERS.has(option.id)) ? list : [...list, CLIENT_TYPE_TBC];
export function hasResolvedEnquiryType(value: string | null | undefined): boolean {
  return Boolean(value?.trim() && value.trim() !== UNRESOLVED_ENQUIRY_TYPE);
}
export const DEFAULT_LEAD_OPTIONS = {
  sources: options([["self_generated", "Self generated"], ["company", "Company"], ["third_party", "Third party"], ["digital_marketing", "Digital marketing"], ["referral", "Referral"]]),
  channels: {
    self_generated: options([["whatsapp", "WhatsApp"], ["email", "Email"], ["call", "Call"], ["community_drive", "Community drive"], ["event", "Event"], ["instagram", "Instagram"]]),
    company: options([["whatsapp", "WhatsApp"], ["instagram", "Instagram"], ["email", "Email"], ["call", "Call"], ["walk_in", "Walk-in"], ["linkedin", "LinkedIn"], ["website", "Website"], ["tiktok", "TikTok"]]),
    third_party: options([["partner_referral", "Partner referral"], ["marketplace", "Marketplace"], ["other", "Other"]]),
    digital_marketing: options([["search_ads", "Search ads"], ["social_ads", "Social ads"], ["email_campaign", "Email campaign"], ["other", "Other"]]),
    referral: options([["internal", "Internal"], ["external", "External"]]),
  } as Record<string, Option[]>,
  // Enquiry types describe a workspace's own services. Keep the global fallback
  // neutral; workspace administrators add their approved choices in Lead options.
  enquiryTypes: options([[UNRESOLVED_ENQUIRY_TYPE, "Not Sure Yet"]]),
  budgetRanges: options([["not_sure", "Not sure yet"]]),
  customerTypes: [] as Option[],
  // Regions are each workspace's own (Settings → Fields → Region); none are assumed.
  emirates: [] as Option[],
};

export async function loadLeadOptions(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ code: string; options: Option[] }>(`SELECT taxonomy.code,
    COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', choice.code, 'label', choice.label, 'allowedRoles', choice.allowed_role_codes, 'flow', choice.flow, 'color', choice.color,
      'furniture', CASE WHEN choice.flow IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM crm_flows flow
        JOIN LATERAL (SELECT version.definition FROM crm_flow_versions version WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id ORDER BY version.version DESC LIMIT 1) latest ON true
        WHERE flow.workspace_id = choice.workspace_id AND flow.code = choice.flow AND latest.definition->'branches' @> '[{"question":"subPath"}]'::jsonb) END))
      ORDER BY choice.position, choice.label) FILTER (WHERE choice.id IS NOT NULL), '[]'::jsonb) AS options
    FROM crm_taxonomies taxonomy LEFT JOIN crm_taxonomy_options choice ON choice.taxonomy_id=taxonomy.id
      AND choice.workspace_id=taxonomy.workspace_id AND choice.status='active'
    WHERE taxonomy.workspace_id=$1 AND taxonomy.status='active'
    GROUP BY taxonomy.id`, [workspaceId]);
  const configured = new Map(result.rows.map(row => [row.code, row.options]));
  const pick = (key: string, fallback: Option[]) => configured.get(key) ?? fallback;
  const sources = pick("lead_source", DEFAULT_LEAD_OPTIONS.sources);
  // Once a workspace lists its regions, "Other" is always offered for anywhere else (area is then typed).
  const emirates = configured.get("emirate") ?? await regionPackRegions(client, workspaceId);
  const locationChoices = !emirates.length || emirates.some(option => option.id === REGION_OTHER) ? emirates : [...emirates, { id: REGION_OTHER, label: "Other" }];
  return {
    sources,
    channels: Object.fromEntries(sources.map(source => [source.id, pick(`lead_channel_${source.id}`, DEFAULT_LEAD_OPTIONS.channels[source.id] ?? [])])),
    enquiryTypes: pick("enquiry_type", DEFAULT_LEAD_OPTIONS.enquiryTypes),
    budgetRanges: pick("budget_range", DEFAULT_LEAD_OPTIONS.budgetRanges),
    customerTypes: withClientTypeTbc(pick("customer_type", [])),
    // §0.3 P0: what kind of place it is (a villa, an apartment, an office), the firm's own list.
    projectTypes: pick("project_type", []),
    emirates: locationChoices,
    areas: Object.fromEntries(locationChoices.map(emirate => [emirate.id, pick(`lead_area_${emirate.id}`, [])])),
    referralBrokers: pick("referral_broker", []),
    referralPartners: pick("referral_partner", []),
  };
}

export async function validateLeadOptions(client: PoolClient, workspaceId: string, input: {
 source?: string; channel?: string; serviceType?: string; details?: { budgetRange?: string; customerType?: string; projectType?: string; emirate?: string };
}, previous?: { serviceType?: string; details?: { budgetRange?: string; customerType?: string; projectType?: string; emirate?: string } }, options: { requireEmirate?: boolean } = {}) {
  const choices = await loadLeadOptions(client, workspaceId);
  const check = (value: string | undefined, entries: Option[], label: string, required = false) => {
    if ((required || value) && !entries.some(item => item.id === value)) throw new UnprocessableEntityException(`Select a valid ${label}`);
  };
  if (input.source !== undefined) {
    check(input.source, choices.sources, "source", true);
    check(input.channel, choices.channels[input.source] ?? [], "channel for this source", true);
  }
  if (!previous || previous.serviceType !== input.serviceType) check(input.serviceType, choices.enquiryTypes, "enquiry type", true);
  if (!previous || previous.details?.budgetRange !== input.details?.budgetRange) check(input.details?.budgetRange, choices.budgetRanges, "budget range");
  if (!previous || previous.details?.customerType !== input.details?.customerType) check(input.details?.customerType, choices.customerTypes, "customer type");
  if (!previous || previous.details?.projectType !== input.details?.projectType) check(input.details?.projectType, choices.projectTypes, "project type");
  // Regions are checked against the workspace's list (its own, or its country's); with no list the value is kept as typed.
  if (choices.emirates.length) check(input.details?.emirate, choices.emirates, "region", options.requireEmirate !== false);
}

/** The first address level of the workspace's country (region pack), e.g. a country's states or emirates. */
async function regionPackRegions(client: PoolClient, workspaceId: string): Promise<Option[]> {
  const result = await client.query<{ options: unknown }>(`SELECT profile.configuration->'address'->'levels'->0->'options' AS options
    FROM workspaces workspace JOIN tenant_setup_profiles profile ON profile.kind='region' AND profile.code=upper(split_part(workspace.default_locale, '-', 2))
    WHERE workspace.id=$1 ORDER BY profile.version DESC LIMIT 1`, [workspaceId]);
  const names = result.rows[0]?.options;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    .map(label => ({ id: label.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""), label: label.trim() })) : [];
}
