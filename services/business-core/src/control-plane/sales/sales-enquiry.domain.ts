/**
 * Wodana's "Contact sales" form and the enquiries it receives (platform level, not tenant data): the form
 * configuration, how a submission is checked, the status workflow and the CSV export. No database here.
 */
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export class SalesEnquiryRuleError extends Error {}

// ─── Form configuration ──────────────────────────────────────────────────────────────────────────────

export const SALES_FORM_FIELDS = ["name", "email", "company", "country", "phone", "teamSize", "message"] as const;
export type SalesFormField = typeof SALES_FORM_FIELDS[number];

/** A reply needs a name and an address, so these two are always on and required. */
export const ALWAYS_REQUIRED_FIELDS: readonly SalesFormField[] = ["name", "email"];

export type SalesFieldSetting = { enabled: boolean; required: boolean; label: string | null };
export type TeamSizeOption = { id: string; label: string };

/** Null labels and texts mean "the product's own wording", which the form shows in the visitor's language. */
export type SalesFormConfiguration = {
  fields: Record<SalesFormField, SalesFieldSetting>;
  teamSizes: TeamSizeOption[];
  consentLabel: string | null;
  thankYouTitle: string | null;
  thankYouMessage: string | null;
  recipients: string[];
};

export const DEFAULT_SALES_FORM: SalesFormConfiguration = {
  fields: {
    name: { enabled: true, required: true, label: null },
    email: { enabled: true, required: true, label: null },
    company: { enabled: true, required: true, label: null },
    country: { enabled: true, required: true, label: null },
    phone: { enabled: true, required: false, label: null },
    teamSize: { enabled: true, required: false, label: null },
    message: { enabled: true, required: false, label: null },
  },
  teamSizes: [
    { id: "1-10", label: "1–10" },
    { id: "11-50", label: "11–50" },
    { id: "51-200", label: "51–200" },
    { id: "201-plus", label: "201+" },
  ],
  consentLabel: null,
  thankYouTitle: null,
  thankYouMessage: null,
  recipients: [],
};

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const OPTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_RECIPIENTS = 10;
export const MAX_TEAM_SIZES = 12;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function optionalText(value: unknown, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new SalesEnquiryRuleError(`${what} must be text.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new SalesEnquiryRuleError(`${what} can be at most ${max} characters.`);
  return text;
}

/** Checks an operator's form configuration and returns it in its stored shape. */
export function validateFormConfiguration(input: unknown): SalesFormConfiguration {
  const source = record(input);
  const fields = record(source.fields);
  const settings = Object.fromEntries(SALES_FORM_FIELDS.map((key) => {
    const field = record(fields[key]);
    const always = ALWAYS_REQUIRED_FIELDS.includes(key);
    const enabled = always || field.enabled !== false;
    return [key, {
      enabled,
      required: always || (enabled && field.required === true),
      label: optionalText(field.label, 80, "A field label"),
    } satisfies SalesFieldSetting];
  })) as Record<SalesFormField, SalesFieldSetting>;

  const rawSizes = Array.isArray(source.teamSizes) ? source.teamSizes : [];
  const teamSizes = rawSizes.map((option) => {
    const item = record(option);
    const label = optionalText(item.label, 60, "A team size");
    if (!label) throw new SalesEnquiryRuleError("Every team size needs a label.");
    const id = typeof item.id === "string" && OPTION_ID.test(item.id) ? item.id : optionId(label);
    return { id, label };
  });
  if (teamSizes.length > MAX_TEAM_SIZES) throw new SalesEnquiryRuleError(`Keep team sizes to ${MAX_TEAM_SIZES} or fewer.`);
  if (new Set(teamSizes.map((option) => option.id)).size !== teamSizes.length) throw new SalesEnquiryRuleError("Team sizes must be different.");
  if (settings.teamSize.enabled && !teamSizes.length) throw new SalesEnquiryRuleError("Add at least one team size, or turn the field off.");

  const rawRecipients = Array.isArray(source.recipients) ? source.recipients : [];
  const recipients = [...new Set(rawRecipients.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean))];
  const invalid = recipients.find((email) => !EMAIL.test(email) || email.length > 254);
  if (invalid) throw new SalesEnquiryRuleError(`${invalid} is not a valid email address.`);
  if (recipients.length > MAX_RECIPIENTS) throw new SalesEnquiryRuleError(`Add at most ${MAX_RECIPIENTS} recipients.`);

  return {
    fields: settings,
    teamSizes,
    consentLabel: optionalText(source.consentLabel, 300, "The consent text"),
    thankYouTitle: optionalText(source.thankYouTitle, 120, "The thank-you title"),
    thankYouMessage: optionalText(source.thankYouMessage, 500, "The thank-you message"),
    recipients,
  };
}

/** A stored configuration read back leniently: anything missing falls back to the defaults. */
export function readFormConfiguration(stored: unknown): SalesFormConfiguration {
  try {
    const source = record(stored);
    return validateFormConfiguration({ ...DEFAULT_SALES_FORM, ...source, fields: { ...DEFAULT_SALES_FORM.fields, ...record(source.fields) } });
  } catch {
    return DEFAULT_SALES_FORM;
  }
}

function optionId(label: string) {
  const id = label.toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return OPTION_ID.test(id) ? id : `size-${Math.abs(hash(label)) % 100000}`;
}

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return result;
}

/** What the public page receives: never the recipients. */
export function publicFormView(version: number, configuration: SalesFormConfiguration) {
  const { recipients: _recipients, ...visible } = configuration;
  return { version, ...visible };
}

// ─── Submissions ─────────────────────────────────────────────────────────────────────────────────────

/** A person needs a few seconds to read and fill the form; anything faster is a script. */
export const MIN_FILL_MS = 3_000;
/** Per connection and in total, per hour. */
export const REQUESTER_LIMIT_PER_HOUR = 5;
export const TOTAL_LIMIT_PER_HOUR = 300;

export type SalesSubmissionInput = {
  name: string; email: string; company?: string | null; countryCode?: string | null; phone?: string | null;
  phoneCountry?: string | null; teamSize?: string | null; message?: string | null; consent: boolean;
};

export type NormalizedSubmission = {
  name: string; email: string; company: string | null; countryCode: string | null; phone: string | null;
  teamSize: string | null; teamSizeLabel: string | null; message: string | null;
};

/** Spam signals are checked before anything else and never stored. */
export function spamVerdict(input: { website?: string | null; elapsedMs: number }): "honeypot" | "too_fast" | null {
  if (input.website && input.website.trim()) return "honeypot";
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < MIN_FILL_MS) return "too_fast";
  return null;
}

const oneLine = (value: string | null | undefined, max: number) => {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

/** A real ISO 3166 country: not a private-use code (AA, QM–QZ, XA–XZ, ZZ) and one the locale data knows. */
function validCountry(code: string) {
  if (/^(AA|Q[M-Z]|X[A-Z]|ZZ)$/.test(code)) return false;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return Boolean(name && name !== code);
  } catch {
    return false;
  }
}

/** Checks one submission against the current form and returns the values to store. */
export function normalizeSubmission(configuration: SalesFormConfiguration, input: SalesSubmissionInput): NormalizedSubmission {
  const { fields } = configuration;
  if (input.consent !== true) throw new SalesEnquiryRuleError("Confirm that we may contact you about this enquiry.");
  const name = oneLine(input.name, 160);
  if (!name) throw new SalesEnquiryRuleError("Enter your name.");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new SalesEnquiryRuleError("Enter a valid work email.");

  const company = fields.company.enabled ? oneLine(input.company, 200) : null;
  if (fields.company.required && !company) throw new SalesEnquiryRuleError("Enter your company.");

  const countryCode = fields.country.enabled && input.countryCode ? input.countryCode.trim().toUpperCase() : null;
  if (countryCode && (!/^[A-Z]{2}$/.test(countryCode) || !validCountry(countryCode))) throw new SalesEnquiryRuleError("Choose a valid country.");
  if (fields.country.required && !countryCode) throw new SalesEnquiryRuleError("Choose your country.");

  let phone: string | null = null;
  const rawPhone = fields.phone.enabled ? (input.phone ?? "").trim() : "";
  if (rawPhone) {
    const hint = (input.phoneCountry ?? countryCode ?? "").trim().toUpperCase();
    const country = hint && isSupportedCountry(hint) ? hint as CountryCode : undefined;
    const parsed = parsePhoneNumberFromString(rawPhone, { defaultCountry: country, extract: false });
    if (!parsed?.isValid()) throw new SalesEnquiryRuleError("Enter a valid phone number for the selected country.");
    phone = parsed.number;
  }
  if (fields.phone.required && !phone) throw new SalesEnquiryRuleError("Enter your phone number.");

  let teamSize: string | null = null;
  let teamSizeLabel: string | null = null;
  if (fields.teamSize.enabled && input.teamSize) {
    const option = configuration.teamSizes.find((item) => item.id === input.teamSize);
    if (!option) throw new SalesEnquiryRuleError("Choose a team size from the list.");
    teamSize = option.id;
    teamSizeLabel = option.label;
  }
  if (fields.teamSize.required && !teamSize) throw new SalesEnquiryRuleError("Choose your team size.");

  const message = fields.message.enabled
    ? (input.message ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").trim().slice(0, 4000) || null
    : null;
  if (fields.message.required && !message) throw new SalesEnquiryRuleError("Tell us a little about what you need.");

  return { name, email, company, countryCode, phone, teamSize, teamSizeLabel, message };
}

/** The consent wording stored with the enquiry: the configured text, or the default one. */
export const DEFAULT_CONSENT_TEXT = "I agree that Wodana may contact me about this enquiry.";

// ─── Status workflow: new → contacted → qualified → won | lost ───────────────────────────────────────

export const SALES_ENQUIRY_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export type SalesEnquiryStatus = typeof SALES_ENQUIRY_STATUSES[number];

const NEXT: Record<SalesEnquiryStatus, readonly SalesEnquiryStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["won", "lost"],
  // A closed enquiry can be reopened where it stood before it closed.
  won: ["qualified"],
  lost: ["contacted"],
};

export function nextSalesEnquiryStatuses(status: string): SalesEnquiryStatus[] {
  return [...(NEXT[status as SalesEnquiryStatus] ?? [])];
}

/** The change and the milestone timestamps it sets. A move to the current status is a no-op (null). */
export function planStatusChange(current: string, next: SalesEnquiryStatus, now = new Date()) {
  if (current === next) return null;
  if (!nextSalesEnquiryStatuses(current).includes(next)) {
    throw new SalesEnquiryRuleError(`An enquiry that is ${current} cannot move to ${next}.`);
  }
  return {
    status: next,
    contactedAt: next === "contacted" ? now : null,
    qualifiedAt: next === "qualified" ? now : null,
    closedAt: next === "won" || next === "lost" ? now : null,
    reopened: current === "won" || current === "lost",
  };
}

export function salesEnquiryReference(number: number | string) {
  return `SE-${String(number).padStart(4, "0")}`;
}

// ─── CSV export ──────────────────────────────────────────────────────────────────────────────────────

/** One CSV cell; values that a spreadsheet would run as a formula are prefixed with an apostrophe. */
export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>) {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
