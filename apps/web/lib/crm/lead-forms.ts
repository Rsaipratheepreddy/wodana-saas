import { tKey } from "@/lib/i18n/keys";

export type LeadFormQuestion = {
  id: string; title: string; description: string; type: string; required: boolean;
  field?: string; options: { id: string; label: string }[];
};
export type LeadFormSchema = { title: string; description: string; source: string; channel: string; questions: LeadFormQuestion[] };
export type LeadFormRecord = { id: string; token: string; draft: LeadFormSchema; published: LeadFormSchema | null; status: string; version: number; updatedAt: string };
export type PublicEnquiryForm = Pick<LeadFormSchema, "title" | "description" | "questions"> & {
  revision: string;
  consentLabel: string;
  defaultLocale?: string | null;
  defaultCountryCode?: string | null;
  areas?: Record<string, { id: string; label: string }[]>;
  branding?: {
    displayName: string; primaryColor: string | null; secondaryColor: string | null;
    headingFont: string | null; bodyFont: string | null; logoUrl: string | null;
  } | null;
};
/** Labels are i18n keys: translate them with t() where they render. */
export const formQuestionTypes = [
  { id: "text", label: tKey("Short answer") }, { id: "paragraph", label: tKey("Paragraph") },
  { id: "radio", label: tKey("Multiple choice") }, { id: "checkboxes", label: tKey("Checkboxes") },
  { id: "dropdown", label: tKey("Dropdown") }, { id: "email", label: tKey("Email") },
  { id: "tel", label: tKey("Phone number") }, { id: "number", label: tKey("Number") }, { id: "date", label: tKey("Date") },
];
