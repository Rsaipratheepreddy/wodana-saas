export type LeadFormQuestion = {
  id: string; title: string; description: string; type: string; required: boolean;
  field?: string; options: { id: string; label: string }[];
};
export type LeadFormSchema = { title: string; description: string; source: string; channel: string; questions: LeadFormQuestion[] };
export type LeadFormRecord = { id: string; token: string; draft: LeadFormSchema; published: LeadFormSchema | null; status: string; version: number; updatedAt: string };
export type PublicEnquiryForm = Pick<LeadFormSchema, "title" | "description" | "questions"> & {
  revision: string;
  consentLabel: string;
  branding?: {
    displayName: string; primaryColor: string | null; secondaryColor: string | null;
    headingFont: string | null; bodyFont: string | null; logoUrl: string | null;
  } | null;
};
export const formQuestionTypes = [
  { id: "text", label: "Short answer" }, { id: "paragraph", label: "Paragraph" },
  { id: "radio", label: "Multiple choice" }, { id: "checkboxes", label: "Checkboxes" },
  { id: "dropdown", label: "Dropdown" }, { id: "email", label: "Email" },
  { id: "tel", label: "Phone number" }, { id: "number", label: "Number" }, { id: "date", label: "Date" },
];
