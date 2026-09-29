"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { DateField, FormDialog, FormRow, MoneyField, SelectField, TextInput } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { CrmDateTimeField } from "./crm-date-time-field";
import styles from "./crm-workbench.module.css";

type Member = { id: string; label: string };
const pad = (value: number) => String(value).padStart(2, "0");
/** An ISO instant as the local "YYYY-MM-DDTHH:mm" the date-time field edits. */
function localDateTime(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const localDate = (value: unknown) => localDateTime(value).slice(0, 10);

/**
 * Edit an opportunity: its name, value, owner and the two dates people plan by. The owner list shows
 * people by name; money and dates follow the workspace's region. A clash reloads and says so.
 */
export function OpportunityEditDialog({ workspaceId, opportunity, members, onClose, onSaved }: {
  workspaceId: string; opportunity: RecordData; members: Member[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const currency = String(opportunity.currencyCode ?? opportunity.currency_code ?? "");
  const hasValue = opportunity.amount !== undefined;
  const [form, setForm] = useState(() => ({
    title: String(opportunity.title ?? ""), owner: String(opportunity.ownerMembershipId ?? opportunity.owner_membership_id ?? ""),
    amount: opportunity.amount === null || opportunity.amount === undefined ? "" : String(opportunity.amount),
    closeDate: localDate(opportunity.expectedCloseAt ?? opportunity.expected_close_at), followUp: localDateTime(opportunity.nextActionAt ?? opportunity.next_action_at),
  }));
  const [start] = useState(() => JSON.stringify(form));
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.title.trim()) throw new Error(t("Give the opportunity a title."));
    const [followDate, followTime] = form.followUp.split("T");
    if (Boolean(followDate) !== Boolean(followTime)) throw new Error(t("Choose both a date and a time for the follow-up, or clear both."));
    await crmRequest(workspaceId, `opportunities/${opportunity.id}`, "PATCH", {
      version: opportunity.version, title: form.title.trim(), ...(form.owner ? { ownerMembershipId: form.owner } : {}),
      ...(hasValue ? { amount: form.amount ? Number(form.amount) : null, currencyCode: currency || undefined } : {}),
      // A close date is a day; it is kept at local noon so it reads as the same day in every time zone nearby.
      expectedCloseAt: form.closeDate ? new Date(`${form.closeDate}T12:00:00`).toISOString() : null,
      nextActionAt: followDate && followTime ? new Date(form.followUp).toISOString() : null,
    });
    await onSaved();
    onClose();
  };

  return <FormDialog formClassName={styles.editOpportunity} formId="edit-opportunity" isDirty={JSON.stringify(form) !== start} onClose={onClose} onSubmit={save} submitLabel={t("Save")} title={t("Edit opportunity")}>
    <TextInput isRequired label={t("Title")} maxLength={240} value={form.title} onChange={set("title")} />
    <FormRow>
      {hasValue ? <MoneyField currency={currency || undefined} label={t("Value")} min="0" value={form.amount} onChange={set("amount")} /> : null}
      <SelectField label={t("Sales owner")} items={members} selectedKey={form.owner || null} onSelectionChange={(key) => set("owner")(String(key ?? ""))} />
    </FormRow>
    <DateField label={t("Expected close")} value={form.closeDate ? parseDate(form.closeDate) : null} onChange={(next) => set("closeDate")(next?.toString() ?? "")} />
    <CrmDateTimeField label={t("Next follow-up")} value={form.followUp} onChange={set("followUp")} />
  </FormDialog>;
}
