export type LeadOption = { id: string; label: string; allowedRoles?: string[] };
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
};
export type LeadContact = {
  displayName: string; email?: string; phone?: string; mobile?: string;
  phoneCountryCode?: string; mobileCountryCode?: string;
  company?: string; jobPosition?: string; website?: string; address?: string;
};
export type EnquiryDetails = {
  emirate?: string; area?: string; location?: string; customerType?: string; budgetRange?: string; campaign?: string;
  internalNotes?: string; contact?: LeadContact;
  formAnswers?: Array<{ questionId: string; title: string; value: string | string[] }>;
};
export function leadOptionLabel(options: LeadOption[] | undefined, value: string | null | undefined) {
  return options?.find(option => option.id === value)?.label ?? (value ? value.replaceAll("_", " ") : "Not set");
}
