import { tKey } from "@/lib/i18n/keys";

/** `flow` is an enquiry type's pipeline flow (PLM-121/122): furniture, design, fit_out or basic. */
export type LeadOption = { id: string; label: string; allowedRoles?: string[]; flow?: string | null };
export const UNRESOLVED_ENQUIRY_TYPE_ID = "not_sure";
export function hasResolvedEnquiryType(value: string | null | undefined): boolean {
  return Boolean(value?.trim() && value.trim() !== UNRESOLVED_ENQUIRY_TYPE_ID);
}
export type LeadOptions = {
  sources: LeadOption[];
  channels: Record<string, LeadOption[]>;
  enquiryTypes: LeadOption[];
  budgetRanges: LeadOption[];
  customerTypes: LeadOption[];
  emirates: LeadOption[];
  areas: Record<string, LeadOption[]>;
  referralBrokers?: LeadOption[];
  referralPartners?: LeadOption[];
  /** The signed-in member's role and team codes, lower-case (sent with the options). */
  roleKeys?: string[];
  /** PLM-100: the team roles each enquiry type asks for (by enquiry type id), from the type's own steps. */
  teamRoles?: Record<string, string[]>;
  /** PLM-096: the fields each enquiry type requires, and from which gate (by enquiry type id, then field key). */
  requirements?: Record<string, Record<string, RequiredAt>>;
};
/** From which gate a field is required (create < convert < book the intro), or never. */
export type RequiredAt = "create" | "convert" | "book_intro" | "never";
/** One team role tagged on an enquiry: a member, or Not applicable for this enquiry type, with who set it and when. */
export type LeadTeamEntry = { role: string; membershipId: string | null; name: string | null; notApplicable: boolean; setAt: string; setByName: string | null; version: number };
/** The choice that says a role is not needed for this enquiry. */
export const TEAM_NOT_APPLICABLE = "not_applicable";

/**
 * One role vocabulary: a member's roles and teams, lower-case, where a team role (`team_sales`) and its
 * team (`sales`) answer to each other. A source limited to roles is compared against these keys.
 */
export function roleVocabularyKeys(...lists: Array<readonly string[] | null | undefined>) {
  const keys = new Set<string>();
  for (const code of lists.flatMap((list) => list ?? [])) {
    const key = code.trim().toLowerCase();
    if (!key) continue;
    keys.add(key);
    keys.add(key.startsWith("team_") ? key.slice(5) : `team_${key}`);
  }
  return [...keys].sort();
}

/** Whether a member with these roles may pick this source (no limit, or one of its roles; owners and administrators always). */
export function sourceAllowedFor(source: LeadOption, roles: readonly string[]) {
  if (!source.allowedRoles?.length) return true;
  const held = new Set(roleVocabularyKeys(roles));
  if (held.has("owner") || held.has("administrator")) return true;
  return source.allowedRoles.some((role) => held.has(role.trim().toLowerCase()));
}

/** The options with every role limit in the same lower-case vocabulary as `roleVocabularyKeys`. */
export function withRoleVocabulary(options: LeadOptions | undefined): LeadOptions | undefined {
  if (!options) return options;
  return { ...options, sources: options.sources.map((source) => source.allowedRoles?.length
    ? { ...source, allowedRoles: [...new Set(source.allowedRoles.map((role) => role.trim().toLowerCase()))] } : source) };
}
export type LeadContact = {
  displayName: string; email?: string; phone?: string; mobile?: string;
  phoneCountryCode?: string; mobileCountryCode?: string;
  company?: string; jobPosition?: string; website?: string; address?: string;
};
export type EnquiryDetails = {
  emirate?: string; area?: string; location?: string; customerType?: string; budgetRange?: string; campaign?: string;
  /** PLM-155: the date the client wants it finished (YYYY-MM-DD); collected, never promised by Sales. */
  targetCompletion?: string;
  internalNotes?: string; contact?: LeadContact;
  formAnswers?: Array<{ questionId: string; title: string; value: string | string[] }>;
};
/** The option's label; an empty value gives the "Not set" key (translate it with `translateKnown`). */
export function leadOptionLabel(options: LeadOption[] | undefined, value: string | null | undefined) {
  return options?.find(option => option.id === value)?.label ?? (value ? value.replaceAll("_", " ") : tKey("Not set"));
}
