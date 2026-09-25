import { UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";

type Option = { id: string; label: string };
const options = (entries: [string, string][]): Option[] => entries.map(([id, label]) => ({ id, label }));
export const UNRESOLVED_ENQUIRY_TYPE = "not_sure";
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
  emirates: options([["abu_dhabi", "Abu Dhabi"], ["ajman", "Ajman"], ["dubai", "Dubai"], ["fujairah", "Fujairah"], ["ras_al_khaimah", "Ras Al Khaimah"], ["sharjah", "Sharjah"], ["umm_al_quwain", "Umm Al Quwain"], ["outside_uae", "Outside UAE"]]),
};

export async function loadLeadOptions(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ code: string; options: Option[] }>(`SELECT taxonomy.code,
    COALESCE(jsonb_agg(jsonb_build_object('id', choice.code, 'label', choice.label)
      ORDER BY choice.position, choice.label) FILTER (WHERE choice.id IS NOT NULL), '[]'::jsonb) AS options
    FROM crm_taxonomies taxonomy LEFT JOIN crm_taxonomy_options choice ON choice.taxonomy_id=taxonomy.id
      AND choice.workspace_id=taxonomy.workspace_id AND choice.status='active'
    WHERE taxonomy.workspace_id=$1 AND taxonomy.status='active'
    GROUP BY taxonomy.id`, [workspaceId]);
  const configured = new Map(result.rows.map(row => [row.code, row.options]));
  const pick = (key: string, fallback: Option[]) => configured.get(key) ?? fallback;
  const sources = pick("lead_source", DEFAULT_LEAD_OPTIONS.sources);
  // Keep the required international choice available to workspaces with an older emirate taxonomy.
  const emirates = pick("emirate", DEFAULT_LEAD_OPTIONS.emirates);
  const locationChoices = emirates.some(option => option.id === "outside_uae") ? emirates : [...emirates, { id: "outside_uae", label: "Outside UAE" }];
  return {
    sources,
    channels: Object.fromEntries(sources.map(source => [source.id, pick(`lead_channel_${source.id}`, DEFAULT_LEAD_OPTIONS.channels[source.id] ?? [])])),
    enquiryTypes: pick("enquiry_type", DEFAULT_LEAD_OPTIONS.enquiryTypes),
    budgetRanges: pick("budget_range", DEFAULT_LEAD_OPTIONS.budgetRanges),
    customerTypes: pick("customer_type", []),
    emirates: locationChoices,
    areas: Object.fromEntries(locationChoices.map(emirate => [emirate.id, pick(`lead_area_${emirate.id}`, [])])),
  };
}

export async function validateLeadOptions(client: PoolClient, workspaceId: string, input: {
 source?: string; channel?: string; serviceType?: string; details?: { budgetRange?: string; customerType?: string; emirate?: string };
}, previous?: { serviceType?: string; details?: { budgetRange?: string; customerType?: string; emirate?: string } }, options: { requireEmirate?: boolean } = {}) {
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
  if (options.requireEmirate !== false)
    check(input.details?.emirate, choices.emirates, "emirate", true);
}
