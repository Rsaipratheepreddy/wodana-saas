/**
 * The sandbox command's plan, as data and pure functions (ops-sandbox.ts runs it): who the test members are, which of
 * the workspace's roles and teams each one gets, and what a profile or teams file loses before it reaches a sandbox.
 * Nothing here names a tenant: members map to the firm kit's role codes and to whichever team holds the permission
 * their work needs.
 */

/** The deal-first design & build kit: an interior design and furniture firm's roles, pipeline and project route. */
export const SANDBOX_DEFAULT_KIT = "design_build_deal_first";
export const SANDBOX_PLAN = "starter";
/** Seats beyond the test members, so testers can invite people of their own. */
export const SANDBOX_SPARE_SEATS = 10;

export type Persona = {
  /** The member's role key: their address is <key>@<slug>.test, or --email-pattern with {role} as the key. */
  key: string;
  displayName: string;
  /** Kit role codes, given when the workspace has them. */
  roles: readonly string[];
  /**
   * Teams to join, one per entry: the first team (in the teams file's order) that holds the first of these permissions
   * any team holds. "*" is a team with every permission.
   */
  teams: ReadonlyArray<readonly string[]>;
};

export const SANDBOX_PERSONAS: readonly Persona[] = [
  { key: "owner", displayName: "Olivia Owner", roles: ["owner"], teams: [] },
  { key: "manager", displayName: "Max Manager", roles: ["administrator", "project_manager", "operations_approver"], teams: [["*"], ["projects.manage"]] },
  { key: "sales", displayName: "Sam Sales", roles: ["sales"], teams: [["crm.opportunities.manage"]] },
  { key: "designer", displayName: "Dana Designer", roles: [], teams: [["pre_projects.record_client_design_decisions", "pre_projects.edit"]] },
  { key: "design-manager", displayName: "Diego Design Manager", roles: [], teams: [["pre_projects.review_designs"]] },
  { key: "qs", displayName: "Quinn QS", roles: ["quantity_surveyor"], teams: [["commercial.estimate"]] },
  { key: "purchasing", displayName: "Paula Purchasing", roles: ["buyer"], teams: [["purchasing.manage"]] },
  { key: "factory", displayName: "Fred Factory Lead", roles: ["factory_lead"], teams: [["factory.approve"]] },
  { key: "logistics", displayName: "Leo Logistics", roles: [], teams: [["logistics.manage", "factory.report"]] },
  { key: "site", displayName: "Sid Site Supervisor", roles: ["site_supervisor"], teams: [] },
  { key: "finance", displayName: "Fiona Finance", roles: ["finance"], teams: [["payables.manage"]] },
  { key: "accountant", displayName: "Adam Accountant", roles: ["finance_approver"], teams: [["accounting.manage"]] },
];

/**
 * Fictional suppliers for --seed: the showcase buys from approved suppliers, and a sandbox never gets a real firm's
 * register. No contact details.
 */
export const SANDBOX_SUPPLIERS: ReadonlyArray<{ key: string; name: string; categories: string[] }> = [
  { key: "timber", name: "Sandbox Timber & Boards", categories: ["Timber", "Boards"] },
  { key: "hardware", name: "Sandbox Hardware Trading", categories: ["Hardware", "Lighting"] },
];

/** The role every workspace has, for a member the kit and the teams give nothing more. */
export const FALLBACK_ROLE = "member";

export const sandboxExternalTenantId = (slug: string) => `sandbox-${slug}`;
/**
 * The key of the request for an organization added to a sandbox's account (--organization-of): it makes the request
 * idempotent and marks the organization as the sandbox command's, as sandbox-<slug> marks a sandbox's first one.
 */
export const sandboxOrganizationKey = (slug: string) => `sandbox-organization:${slug}`;
export const sandboxEmail = (key: string, slug: string) => `${key}@${slug}.test`;
/** Where a member's role key goes in an --email-pattern (exactly once, before the @). */
export const ROLE_PLACEHOLDER = "{role}";
/** A member's address from an --email-pattern, e.g. wodanatechnology+{role}@gmail.com → wodanatechnology+sales@gmail.com. */
export const patternEmail = (pattern: string, key: string) => pattern.replace(ROLE_PLACEHOLDER, key);
/** Each member's address: the pattern's, or <role>@<slug>.test without one. */
export const sandboxAddress = (slug: string, pattern: string | null) => (key: string) => (pattern ? patternEmail(pattern, key) : sandboxEmail(key, slug));
/** The first company's code from the slug (A-Z, 0-9 and dashes, at most 24). */
export const sandboxLegalEntityCode = (slug: string) => slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 24);
export const sandboxSeatLimit = (planSeats: number) => Math.max(planSeats, SANDBOX_PERSONAS.length + SANDBOX_SPARE_SEATS);

export type TeamSpec = { code: string; name: string; permissions: string[] };
export type MemberPlan = { key: string; email: string; displayName: string; roleCodes: string[]; teamCodes: string[]; missingRoles: string[] };

/** Each test member's address, roles (those the workspace has) and teams (from the teams file, when given). */
export function planMembers(slug: string, workspaceRoles: ReadonlySet<string>, teams: readonly TeamSpec[], emailPattern: string | null = null): MemberPlan[] {
  const address = sandboxAddress(slug, emailPattern);
  return SANDBOX_PERSONAS.map((persona) => {
    const roleCodes = persona.roles.filter((code) => workspaceRoles.has(code));
    const teamCodes: string[] = [];
    for (const alternatives of persona.teams) {
      for (const permission of alternatives) {
        const team = teams.find((candidate) => candidate.permissions.includes(permission));
        if (!team) continue;
        if (!teamCodes.includes(team.code)) teamCodes.push(team.code);
        break;
      }
    }
    if (!roleCodes.length && !teamCodes.length) roleCodes.push(FALLBACK_ROLE);
    return { key: persona.key, email: address(persona.key), displayName: persona.displayName, roleCodes, teamCodes,
      missingRoles: persona.roles.filter((code) => !workspaceRoles.has(code)) };
  });
}

// ---------- what never reaches a sandbox ----------

export type Dropped = { path: string; reason: string };

/** Words in a setting's name that make it an integration, a credential or an address of the real firm. */
const INTEGRATION_WORDS = new Set(["webhook", "webhooks", "api", "secret", "secrets", "token", "tokens", "password", "passwords", "credential", "credentials",
  "oauth", "shopify", "meta", "facebook", "instagram", "whatsapp", "google", "gmail", "outlook", "mailgun", "smtp", "imap", "quickbooks", "xero", "zoho",
  "stripe", "paypal", "razorpay", "tabby", "tamara", "gateway", "gateways", "integration", "integrations", "connector", "connectors", "connection",
  "connections", "callback", "endpoint", "endpoints", "url", "urls", "uri", "domain", "domains", "email", "emails", "mailbox", "phone", "iban"]);
const EMAIL = /[^\s@<>()"',;:]+@([^\s@<>()"',;:]+\.[a-z]{2,})/gi;
/** Reserved for tests and documentation: nobody receives mail there. */
const SAFE_EMAIL_DOMAIN = /(^|\.)(test|example|invalid|localhost)$|^example\.(com|org|net)$/i;
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)\S+/i;
const PHONE = /\+\d[\d\s().-]{6,}\d/;
const BANK_ACCOUNT = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const join = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

function textReason(text: string): string | null {
  for (const match of text.matchAll(EMAIL)) if (!SAFE_EMAIL_DOMAIN.test(match[1])) return "an email address";
  if (WEB_ADDRESS.test(text)) return "a web address";
  if (PHONE.test(text)) return "a phone number";
  if (BANK_ACCOUNT.test(text)) return "a bank account number";
  return null;
}

/**
 * A copy of a JSON document without the real firm's addresses and integrations: every setting whose name is an
 * integration, credential or contact, and every text holding an email address (other than a reserved test domain), a
 * web address, a phone number or a bank account. Notes ("_…", "description") are left out. Each removal is listed.
 */
export function scrubForSandbox(raw: unknown): { value: unknown; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const walk = (value: unknown, path: string): { keep: boolean; value?: unknown } => {
    if (typeof value === "string") {
      const reason = textReason(value);
      if (reason) { dropped.push({ path, reason }); return { keep: false }; }
      return { keep: true, value };
    }
    if (Array.isArray(value)) {
      const kept: unknown[] = [];
      value.forEach((entry, index) => { const result = walk(entry, join(path, index)); if (result.keep) kept.push(result.value); });
      return { keep: true, value: kept };
    }
    if (isObject(value)) {
      const kept: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key.startsWith("_") || key === "$schema" || (path === "" && key === "description")) continue;
        if (words(key).some((word) => INTEGRATION_WORDS.has(word))) { dropped.push({ path: join(path, key), reason: "an integration or contact setting" }); continue; }
        const result = walk(entry, join(path, key));
        if (result.keep) kept[key] = result.value;
      }
      return { keep: true, value: kept };
    }
    return { keep: true, value };
  };
  return { value: walk(raw, "").value, dropped };
}

/** Settings a sandbox always has, whatever the profile says: finance requests stay inside Wodana (no outside inbox). */
const SANDBOX_OVERRIDES: Array<{ section: string; key: string; value: unknown }> = [{ section: "financeRequests", key: "inbox", value: null }];

/** A configuration profile ready for a sandbox: scrubbed, then the sandbox overrides on the sections it has. */
export function sandboxProfile(raw: unknown): { profile: unknown; dropped: Dropped[] } {
  const { value, dropped } = scrubForSandbox(raw);
  if (!isObject(value)) return { profile: value, dropped };
  for (const override of SANDBOX_OVERRIDES) {
    const section = value[override.section];
    if (isObject(section)) section[override.key] = override.value;
  }
  return { profile: value, dropped };
}

export class SandboxFileError extends Error {
  constructor(readonly problems: string[], what = "teams file") { super(`The ${what} is not valid:\n  - ${problems.join("\n  - ")}`); }
}

/** One of the lead options' lists (Settings → Lead options); `teams` limits who may choose an option by hand. */
export type TaxonomySpec = { code: string; name: string; options: Array<{ code: string; label: string; teams?: string[] }> };

/**
 * A CRM intake profile's lead options (e.g. docs/fixtures/palm-crm-intake-profile.json) as the taxonomies Settings → Lead
 * options keeps: sources and each one's channels, enquiry types, budget ranges, client types and referral lists. The
 * file's queues, forms and connection notes are not part of it. Empty lists are left out.
 */
export function parseCrmFile(raw: unknown): TaxonomySpec[] {
  const what = "CRM intake profile";
  if (!isObject(raw)) throw new SandboxFileError(["It is a JSON object of lead options."], what);
  const problems: string[] = [];
  const list = (path: string, value: unknown, required: boolean): TaxonomySpec["options"] => {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) { problems.push(`${path} is a list of { code, label }.`); return []; }
    const seen = new Set<string>();
    return value.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry)) { problems.push(`${at} is an object.`); return []; }
      const code = typeof entry.code === "string" ? entry.code.trim().toLowerCase() : "";
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      if (!/^[a-z][a-z0-9_-]{0,78}$/.test(code)) { problems.push(`${at}.code is lowercase letters, digits, _ and -.`); return []; }
      if (seen.has(code)) problems.push(`${at}.code repeats ${code}.`);
      seen.add(code);
      if (!label || label.length > 160) problems.push(`${at}.label is 1 to 160 characters.`);
      const teams = entry.allowedRoles;
      if (teams !== undefined && (!Array.isArray(teams) || teams.some((team) => typeof team !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(team))))
        problems.push(`${at}.allowedRoles is a list of team codes.`);
      return [{ code, label, ...(Array.isArray(teams) && teams.length ? { teams: (teams as string[]).map((team) => team.toUpperCase()) } : {}) }];
    });
  };
  const sources = list("sources", raw.sources, true);
  const channels = raw.channels === undefined ? {} : raw.channels;
  if (!isObject(channels)) problems.push("channels is an object of source code → channels.");
  const taxonomies: TaxonomySpec[] = [{ code: "lead_source", name: "Lead source", options: sources }];
  for (const [source, entries] of Object.entries(isObject(channels) ? channels : {})) {
    const owner = sources.find((entry) => entry.code === source.toLowerCase());
    if (!owner) { problems.push(`channels.${source} is not one of the sources.`); continue; }
    taxonomies.push({ code: `lead_channel_${owner.code}`, name: `${owner.label} channels`, options: list(`channels.${source}`, entries, true) });
  }
  taxonomies.push(
    { code: "enquiry_type", name: "Enquiry type", options: list("enquiryTypes", raw.enquiryTypes, true) },
    { code: "customer_type", name: "Client type", options: list("customerTypes", raw.customerTypes, false) },
    { code: "referral_broker", name: "Brokers", options: list("referralBrokers", raw.referralBrokers, false) },
    { code: "referral_partner", name: "Referral partners", options: list("referralPartners", raw.referralPartners, false) },
    { code: "budget_range", name: "Budget range", options: list("budgetRanges", raw.budgetRanges, true) },
  );
  if (problems.length) throw new SandboxFileError(problems, what);
  return taxonomies.filter((taxonomy) => taxonomy.options.length);
}

/** A teams access file: { teams: [{ code, name, permissions }] }; other keys (notes, sources) are ignored. */
export function parseTeamsFile(raw: unknown): TeamSpec[] {
  if (!isObject(raw) || !Array.isArray(raw.teams)) throw new SandboxFileError(["It is a JSON object with a list of teams (\"teams\")."]);
  const problems: string[] = [];
  const teams: TeamSpec[] = [];
  raw.teams.forEach((entry, index) => {
    const path = `teams[${index}]`;
    if (!isObject(entry)) { problems.push(`${path} is an object.`); return; }
    const code = typeof entry.code === "string" ? entry.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) { problems.push(`${path}.code is 2 to 32 capital letters, digits, _ and -.`); return; }
    if (teams.some((team) => team.code === code)) problems.push(`${path}.code repeats ${code}.`);
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (name.length < 2 || name.length > 100) problems.push(`${path}.name is 2 to 100 characters.`);
    const permissions = Array.isArray(entry.permissions) ? entry.permissions : null;
    if (!permissions || permissions.some((code) => typeof code !== "string" || !/^(\*|[a-z][a-z0-9_.]{1,99})$/.test(code)))
      problems.push(`${path}.permissions is a list of permission codes (or "*" for every permission).`);
    teams.push({ code, name, permissions: [...new Set((permissions ?? []) as string[])] });
  });
  if (!teams.length && !problems.length) problems.push("It lists no teams.");
  if (problems.length) throw new SandboxFileError(problems);
  return teams;
}
