import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Wodana's own "Contact sales" form (the public website, not a tenant form). The configuration is versioned
 * in business-core and edited in Wodana Control; a null label or text means the product's own wording,
 * shown in the visitor's language.
 */
export const SALES_FORM_FIELDS = ["name", "email", "company", "country", "phone", "teamSize", "message"] as const;
export type SalesFormField = typeof SALES_FORM_FIELDS[number];
export type SalesFieldSetting = { enabled: boolean; required: boolean; label: string | null };
export type TeamSizeOption = { id: string; label: string };

export type PublicSalesForm = {
  version: number;
  fields: Record<SalesFormField, SalesFieldSetting>;
  teamSizes: TeamSizeOption[];
  consentLabel: string | null;
  thankYouTitle: string | null;
  thankYouMessage: string | null;
};

/** The configuration operators edit: the public form plus who hears about each enquiry. */
export type SalesFormConfiguration = Omit<PublicSalesForm, "version"> & { recipients: string[] };

/** A reply needs a name and an address, so these two are always on and required. */
export const ALWAYS_REQUIRED: readonly SalesFormField[] = ["name", "email"];

export const FIELD_LABELS: Record<SalesFormField, MessageKey> = {
  name: tKey("Full name"),
  email: tKey("Work email"),
  company: tKey("Company"),
  country: tKey("Country"),
  phone: tKey("Phone"),
  teamSize: tKey("Team size"),
  message: tKey("How can we help?"),
};

export const DEFAULT_CONSENT = tKey("I agree that Wodana may contact me about this enquiry.");
export const DEFAULT_THANK_YOU_TITLE = tKey("Thanks, we'll be in touch.");
export const DEFAULT_THANK_YOU_MESSAGE = tKey("Someone from our team will reply within one working day.");

/** Messages the server may send back for a submission, so they show in the visitor's language. */
export const SALES_FORM_SERVER_MESSAGES = [
  tKey("Confirm that we may contact you about this enquiry."),
  tKey("Enter your name."),
  tKey("Enter a valid work email."),
  tKey("Enter your company."),
  tKey("Choose a valid country."),
  tKey("Choose your country."),
  tKey("Enter a valid phone number for the selected country."),
  tKey("Enter your phone number."),
  tKey("Choose a team size from the list."),
  tKey("Choose your team size."),
  tKey("Tell us a little about what you need."),
  tKey("Please check your details, then send again."),
  tKey("We've received several enquiries from this connection. Please try again later."),
];

/** Used when the form cannot be loaded, so the page still works and the server checks the answers. */
export const DEFAULT_PUBLIC_SALES_FORM: PublicSalesForm = {
  version: 1,
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
};

/** Reads the public form in a server component. The landing reads the form at most once a minute, and never waits long for it: a slow core falls back to the default. */
const FORM_TTL_MS = 60_000;
let cachedForm: { at: number; form: PublicSalesForm } | null = null;

export async function loadPublicSalesForm(apiUrl: string, now = Date.now()): Promise<PublicSalesForm> {
  if (cachedForm && now - cachedForm.at < FORM_TTL_MS) return cachedForm.form;
  try {
    const response = await fetch(apiUrl, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!response.ok) return cachedForm?.form ?? DEFAULT_PUBLIC_SALES_FORM;
    const form = await response.json() as PublicSalesForm;
    if (!form || typeof form !== "object" || !form.fields) return cachedForm?.form ?? DEFAULT_PUBLIC_SALES_FORM;
    cachedForm = { at: now, form };
    return form;
  } catch {
    return cachedForm?.form ?? DEFAULT_PUBLIC_SALES_FORM;
  }
}

/** Test seam: forget the cached form. */
export function resetPublicSalesFormCache() {
  cachedForm = null;
}
