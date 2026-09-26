"use client";

import { MultiSelectField, NumericInput, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest } from "@/lib/crm/client";
import type { EnquiryField } from "@/lib/crm/enquiry-fields";

export type CustomValues = Record<string, unknown>;

/** Inputs for the workspace's own enquiry fields, one per shown field, keyed by field id. */
export function EnquiryCustomInputs({ fields, values, onChange, className }: { fields: EnquiryField[]; values: CustomValues; onChange: (id: string, value: unknown) => void; className?: string }) {
  const t = useT();
  const shown = fields.filter((field) => field.custom && field.visible);
  if (!shown.length) return null;
  return <div className={className}>{shown.map((field) => {
    const id = field.custom!.id;
    const value = values[id];
    const choices = (field.custom!.configuration.options ?? []).map((label) => ({ id: label, label }));
    if (field.type === "select") return <SelectField key={id} label={field.label} items={[{ id: "", label: t("Not set") }, ...choices]} selectedKey={typeof value === "string" ? value : ""} onSelectionChange={(key) => onChange(id, String(key ?? ""))} />;
    if (field.type === "multi_select") return <MultiSelectField key={id} label={field.label} items={choices} selectedKeys={new Set(Array.isArray(value) ? value as string[] : [])} onSelectionChange={(keys) => onChange(id, [...keys].map(String))} />;
    if (field.type === "number") return <NumericInput key={id} label={field.label} value={value === undefined || value === null || value === "" ? Number.NaN : Number(value)} onChange={(next) => onChange(id, Number.isFinite(next) ? next : "")} />;
    if (field.type === "date") return <TextInput key={id} label={field.label} inputType="date" value={typeof value === "string" ? value : ""} onChange={(next) => onChange(id, next)} />;
    if (field.type === "paragraph") return <TextAreaField key={id} label={field.label} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(id, next)} />;
    return <TextInput key={id} label={field.label} maxLength={10000} value={value === undefined || value === null ? "" : String(value)} onChange={(next) => onChange(id, next)} />;
  })}</div>;
}

/** Only the values that changed; blank means clear. */
export function changedValues(before: CustomValues | null | undefined, after: CustomValues): CustomValues {
  const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
  return Object.fromEntries(Object.entries(after).filter(([id, value]) => blank(value) ? !blank(before?.[id]) : JSON.stringify(value) !== JSON.stringify(before?.[id])).map(([id, value]) => [id, blank(value) ? null : value]));
}

export async function saveLeadFields(workspaceId: string, leadId: string, values: CustomValues) {
  if (!Object.keys(values).length) return null;
  return crmRequest<{ customFields: CustomValues }>(workspaceId, `leads/${leadId}/fields`, "PUT", { values });
}
