"use client";

import { useState } from "react";
import { parseDate, parseTime } from "@internationalized/date";
import { DateField, FormDialog, FormRow, SegmentedControl, SelectField, Switch, TextInput, TimeField } from "@/design-system";
import { bookingRequest } from "@/lib/booking/client";
import { useT } from "@/lib/i18n/i18n-provider";

export type OverrideRecord = { id: string; membershipId: string; memberName: string; startsOn: string; endsOn: string; kind: "extra" | "blocked"; startTime: string | null; endTime: string | null; reason: string | null; version: number };

/** Extra hours or blocked time for one person, on a date or a range. Leave and holidays are already counted. */
export function OverrideDialog({ workspaceId, members, onClose, onSaved }: { workspaceId: string; members: Array<{ membershipId: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({ membershipId: "", kind: "blocked" as "extra" | "blocked", startsOn: today, endsOn: today, allDay: true, startTime: "09:00", endTime: "13:00", reason: "" });
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const date = (value: string) => { try { return parseDate(value); } catch { return null; } };
  const time = (value: string) => { try { return parseTime(value); } catch { return null; } };
  const timed = draft.kind === "extra" || !draft.allDay;
  const submit = async () => {
    await bookingRequest(workspaceId, "overrides", "POST", { membershipId: draft.membershipId, kind: draft.kind, startsOn: draft.startsOn, endsOn: draft.endsOn < draft.startsOn ? draft.startsOn : draft.endsOn,
      ...(timed ? { startTime: draft.startTime, endTime: draft.endTime } : {}), reason: draft.reason || null });
    onSaved();
  };
  return <FormDialog title={t("Add hours")} submitLabel={t("Save")} onClose={onClose} onSubmit={submit} isSubmitDisabled={!draft.membershipId}>
    <SelectField label={t("Person")} isRequired items={members.map((member) => ({ id: member.membershipId, label: member.name }))} selectedKey={draft.membershipId || null} onSelectionChange={(key) => set("membershipId", String(key ?? ""))} />
    <SegmentedControl label={t("Hours")} value={draft.kind} onChange={(value) => set("kind", value as "extra" | "blocked")} options={[{ id: "blocked", label: t("Blocked") }, { id: "extra", label: t("Extra hours") }]} />
    <FormRow>
      <DateField label={t("From")} isRequired value={date(draft.startsOn)} onChange={(value) => set("startsOn", value?.toString() ?? today)} />
      <DateField label={t("To")} isRequired value={date(draft.endsOn)} onChange={(value) => set("endsOn", value?.toString() ?? draft.startsOn)} />
    </FormRow>
    {draft.kind === "blocked" ? <Switch isSelected={draft.allDay} onChange={(on) => set("allDay", on)}>{t("All day")}</Switch> : null}
    {timed ? <FormRow>
      <TimeField label={t("Start")} isRequired value={time(draft.startTime)} onChange={(value) => set("startTime", value ? value.toString().slice(0, 5) : draft.startTime)} />
      <TimeField label={t("End")} isRequired value={time(draft.endTime)} onChange={(value) => set("endTime", value ? value.toString().slice(0, 5) : draft.endTime)} />
    </FormRow> : null}
    <TextInput label={t("Reason")} value={draft.reason} onChange={(value) => set("reason", value)} maxLength={240} />
  </FormDialog>;
}
