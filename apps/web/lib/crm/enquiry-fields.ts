import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { crmRequest } from "./client";
import type { LeadFormQuestion } from "./lead-forms";

/** Fixed enquiry fields that can be hidden; the rest are always shown. */
export const OPTIONAL_ENQUIRY_FIELDS = ["email", "customerType", "area", "budgetRange", "summary", "projectType", "floorPlan"] as const;
export type OptionalEnquiryField = (typeof OPTIONAL_ENQUIRY_FIELDS)[number];
export type EnquiryFieldType = "text" | "paragraph" | "email" | "phone" | "number" | "date" | "select" | "multi_select";

export type CustomEnquiryField = {
  id: string; key: string; label: string; dataType: "text" | "number" | "date" | "select" | "multi_select";
  configuration: { options?: string[]; multiline?: boolean }; visible: boolean; position: number; version: number; valueCount?: number;
};
/** Fields added later are missing from older settings: they show until someone hides them. */
export type EnquiryFieldsState = { system: Partial<Record<OptionalEnquiryField, { visible: boolean; version: number }>>; custom: CustomEnquiryField[] };

/** One field an enquiry captures: fixed (built in) or the workspace's own. */
export type EnquiryField = {
  key: string; label: string; type: EnquiryFieldType; kind: "fixed" | "custom";
  /** Always shown; can't be hidden. */ locked: boolean; visible: boolean; version: number;
  /** The option lists that feed its choices (Settings option groups). */ lists?: string[];
  /** How a capture form links to it; absent when forms can't ask it. */ formField?: string;
  custom?: CustomEnquiryField;
};

type Fixed = Omit<EnquiryField, "kind" | "visible" | "version" | "locked"> & { locked?: boolean };
/** Fixed labels are i18n keys: translate them with t() where they render. */
const FIXED: Fixed[] = [
  { key: "displayName", label: tKey("Customer name"), type: "text", locked: true, formField: "displayName" },
  { key: "mobile", label: tKey("Mobile"), type: "phone", locked: true, formField: "mobile" },
  { key: "email", label: tKey("Email"), type: "email", formField: "email" },
  { key: "region", label: tKey("Region"), type: "select", locked: true, lists: ["emirate"], formField: "emirate" },
  { key: "area", label: tKey("Area / city"), type: "select", lists: ["lead_area_"], formField: "area" },
  { key: "serviceType", label: tKey("Enquiry type"), type: "select", locked: true, lists: ["enquiry_type"], formField: "serviceType" },
  { key: "customerType", label: tKey("Customer type"), type: "select", lists: ["customer_type"] },
  { key: "projectType", label: tKey("Project type"), type: "select", lists: ["project_type"] },
  { key: "budgetRange", label: tKey("Budget"), type: "select", lists: ["budget_range"], formField: "budgetRange" },
  { key: "floorPlan", label: tKey("Floor plan"), type: "select" },
  { key: "summary", label: tKey("Project details"), type: "paragraph", formField: "summary" },
  // PLM-155: the client's target date, required before the intro when the enquiry type asks for it.
  { key: "targetCompletion", label: tKey("Target completion"), type: "date", locked: true },
  { key: "source", label: tKey("Source & channel"), type: "select", locked: true, lists: ["lead_source", "lead_channel_"] },
];

export const customFieldRef = (id: string) => `cf:${id}`;
export const customFieldId = (field?: string) => field && /^cf:[0-9a-f-]{36}$/.test(field) ? field.slice(3) : null;
const customType = (field: CustomEnquiryField): EnquiryFieldType => field.dataType === "text" && field.configuration.multiline ? "paragraph" : field.dataType;

/** Every enquiry field in display order; `regionLabel` is the workspace's region word (Emirate, State…). */
export function enquiryFields(state: EnquiryFieldsState | undefined, regionLabel: string): EnquiryField[] {
  const fixed = FIXED.map((field): EnquiryField => {
    const setting = state?.system?.[field.key as OptionalEnquiryField];
    return { ...field, label: field.key === "region" ? regionLabel : field.label, kind: "fixed", locked: Boolean(field.locked), visible: field.locked ? true : setting?.visible ?? true, version: setting?.version ?? 0 };
  });
  return [...fixed, ...(Array.isArray(state?.custom) ? state.custom : []).map(customEnquiryField)];
}

export const customEnquiryField = (field: CustomEnquiryField): EnquiryField => ({ key: customFieldRef(field.id), label: field.label, type: customType(field), kind: "custom", locked: false, visible: field.visible, version: field.version, formField: customFieldRef(field.id), custom: field });

export const isShown = (fields: EnquiryField[], key: string) => fields.find((field) => field.key === key)?.visible !== false;

export const FIELD_TYPE_LABELS: Record<EnquiryFieldType, MessageKey> = { text: tKey("Short answer"), paragraph: tKey("Long answer"), email: tKey("Email"), phone: tKey("Phone number"), number: tKey("Number"), date: tKey("Date"), select: tKey("Dropdown"), multi_select: tKey("Checkboxes") };
/** Types a new custom field can take. */
export const NEW_FIELD_TYPES: EnquiryFieldType[] = ["text", "paragraph", "number", "date", "select", "multi_select"];

/** The form question for an enquiry field (fixed choices are filled in by the server on save). */
export function fieldQuestion(field: EnquiryField): LeadFormQuestion {
  const options = (field.custom?.configuration.options ?? []).map((label) => ({ id: label, label }));
  const type = field.type === "select" ? "dropdown" : field.type === "multi_select" ? "checkboxes" : field.type === "phone" ? "tel" : field.type;
  return { id: crypto.randomUUID(), title: field.label, description: "", type, required: false, field: field.formField, options };
}

/** A stored custom value for display: lists joined, blanks as an em dash. */
export function customValueText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export const loadEnquiryFields = (workspaceId: string, signal?: AbortSignal) => crmRequest<EnquiryFieldsState>(workspaceId, "enquiry-fields", "GET", undefined, signal);
export const setFixedFieldShown = (workspaceId: string, key: string, visible: boolean, version: number) =>
  crmRequest<{ key: string; visible: boolean; version: number }>(workspaceId, `enquiry-fields/system/${key}`, "PUT", { visible, version });

export function createCustomField(workspaceId: string, input: { label: string; type: EnquiryFieldType; options: string[]; position: number }) {
  const dataType = input.type === "paragraph" ? "text" : input.type;
  const slug = input.label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "field";
  return crmRequest<CustomEnquiryField>(workspaceId, "custom-fields", "POST", {
    entityType: "enquiry", key: `${/^[a-z]/.test(slug) ? slug : `f_${slug}`}_${crypto.randomUUID().slice(0, 6)}`, label: input.label.trim(), dataType, position: input.position,
    configuration: { ...(input.type === "paragraph" ? { multiline: true } : {}), ...(["select", "multi_select"].includes(input.type) ? { options: input.options } : {}) },
  });
}
export const updateCustomField = (workspaceId: string, field: CustomEnquiryField, changes: Partial<Pick<CustomEnquiryField, "label" | "visible" | "configuration" | "position">> & { status?: "archived" }) =>
  crmRequest<CustomEnquiryField>(workspaceId, `custom-fields/${field.id}`, "PATCH", { version: field.version, ...changes });
