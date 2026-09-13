export type LeadOption = { id: string; label: string };
export type LeadOptions = {
  sources: LeadOption[];
  channels: Record<string, LeadOption[]>;
  enquiryTypes: LeadOption[];
  budgetRanges: LeadOption[];
  customerTypes: LeadOption[];
};
export type LeadContact = {
  displayName: string; email?: string; phone?: string; mobile?: string;
  company?: string; jobPosition?: string; website?: string; address?: string;
};
export type EnquiryDetails = {
  location?: string; customerType?: string; budgetRange?: string; campaign?: string;
  internalNotes?: string; contact?: LeadContact;
  formAnswers?: Array<{ questionId: string; title: string; value: string | string[] }>;
};
export function leadOptionLabel(options: LeadOption[] | undefined, value: string | null | undefined) {
  return options?.find(option => option.id === value)?.label ?? (value ? value.replaceAll("_", " ") : "Not set");
}
