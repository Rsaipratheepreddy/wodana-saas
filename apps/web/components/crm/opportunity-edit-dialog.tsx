"use client";

import { useState, type FormEvent } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, NumericInput, SelectField, TextInput } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
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
const localDate = (value: unknown) => localDateTime(value).slice(0, 10);

/**
 * Edit an opportunity: its name, value, owner and the two dates people plan by. The owner list shows
 * people by name; money and dates follow the workspace's region.
 */
export function OpportunityEditDialog({ workspaceId, opportunity, members, onClose, onSaved }: {
  workspaceId: string; opportunity: RecordData; members: Member[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const currency = String(opportunity.currencyCode ?? opportunity.currency_code ?? "");
  const hasValue = opportunity.amount !== undefined;
  const [title, setTitle] = useState(String(opportunity.title ?? ""));
  const [owner, setOwner] = useState(String(opportunity.ownerMembershipId ?? opportunity.owner_membership_id ?? ""));
  const [amount, setAmount] = useState<number>(opportunity.amount === null || opportunity.amount === undefined ? Number.NaN : Number(opportunity.amount));
  const [closeDate, setCloseDate] = useState(localDate(opportunity.expectedCloseAt ?? opportunity.expected_close_at));
  const [followUp, setFollowUp] = useState(localDateTime(opportunity.nextActionAt ?? opportunity.next_action_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError(t("Give the opportunity a title.")); return; }
    if (hasValue && Number.isFinite(amount) && amount < 0) { setError(t("The value can't be negative.")); return; }
    const [followDate, followTime] = followUp.split("T");
    if (Boolean(followDate) !== Boolean(followTime)) { setError(t("Choose both a date and a time for the follow-up, or clear both.")); return; }
    setSaving(true); setError("");
    try {
      await crmRequest(workspaceId, `opportunities/${opportunity.id}`, "PATCH", {
        version: opportunity.version, title: title.trim(), ...(owner ? { ownerMembershipId: owner } : {}),
        ...(hasValue ? { amount: Number.isFinite(amount) ? amount : null, currencyCode: currency || undefined } : {}),
        // A close date is a day; it is kept at local noon so it reads as the same day in every time zone nearby.
        expectedCloseAt: closeDate ? new Date(`${closeDate}T12:00:00`).toISOString() : null,
        nextActionAt: followDate && followTime ? new Date(followUp).toISOString() : null,
      });
      await onSaved();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? translateKnown(t, cause.message) : t("Could not save.")); setSaving(false); }
  };

  return <ControlledModalDialog isOpen isDismissable={!saving} onOpenChange={(open) => { if (!open && !saving) onClose(); }} size="md" title={t("Edit opportunity")}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose} isDisabled={saving}>{t("Cancel")}</Button><Button type="submit" form="edit-opportunity" variant="primary" isLoading={saving}>{t("Save")}</Button></div>}>
    <form id="edit-opportunity" className={styles.editOpportunity} onSubmit={save}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput isRequired label={t("Title")} maxLength={240} value={title} onChange={setTitle} />
      <div className={styles.editRow}>
        {hasValue ? <NumericInput label={currency ? t("Value ({currency})", { currency }) : t("Value")} minValue={0} value={amount} onChange={setAmount} formatOptions={{ maximumFractionDigits: 2 }} /> : null}
        <SelectField label={t("Sales owner")} items={members} selectedKey={owner || null} onSelectionChange={(key) => setOwner(String(key ?? ""))} />
      </div>
      <div className={styles.editRow}>
        <DateField label={t("Expected close")} value={closeDate ? parseDate(closeDate) : null} onChange={(next) => setCloseDate(next?.toString() ?? "")} />
      </div>
      <CrmDateTimeField label={t("Next follow-up")} value={followUp} onChange={setFollowUp} />
    </form>
  </ControlledModalDialog>;
}
