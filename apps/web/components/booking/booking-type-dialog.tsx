"use client";

import { useState } from "react";
import type { Key } from "react-aria-components";
import { Checkbox, FormDialog, FormSection, MoreDetails, MultiSelectField, NumericInput, SelectField, Switch, TextInput } from "@/design-system";
import type { BookingQuestion, BookingQuestionField, BookingTypeRecord, BookingTypesData, LocationKind } from "@/lib/booking/booking";
import { useT } from "@/lib/i18n/i18n-provider";
import { bookingRequest } from "@/lib/booking/client";
import styles from "./booking.module.css";

type Draft = {
  name: string; durationMinutes: number; locationKind: LocationKind; locationDetail: string; hostsMode: BookingTypeRecord["hostsMode"]; hosts: string[];
  enquiryType: string; questions: BookingQuestion[]; confirmation: BookingTypeRecord["confirmation"]; slotStepMinutes: number;
  bufferBeforeMinutes: number; bufferAfterMinutes: number; minimumNoticeHours: number; windowDays: number; maxPerDay: number | null; cancelNoticeHours: number;
  source: string; channel: string; color: string; active: boolean;
};

const fromRecord = (record: BookingTypeRecord | null, hasRegions: boolean): Draft => record ? {
  name: record.name, durationMinutes: record.durationMinutes, locationKind: record.locationKind, locationDetail: record.locationDetail ?? "", hostsMode: record.hostsMode,
  hosts: record.hosts.map((host) => host.membershipId), enquiryType: record.enquiryType ?? "", questions: record.questions, confirmation: record.confirmation,
  slotStepMinutes: record.slotStepMinutes, bufferBeforeMinutes: record.bufferBeforeMinutes, bufferAfterMinutes: record.bufferAfterMinutes,
  minimumNoticeHours: record.minimumNoticeMinutes / 60, windowDays: record.windowDays, maxPerDay: record.maxPerDay, cancelNoticeHours: record.cancelNoticeMinutes / 60,
  source: record.source, channel: record.channel, color: record.color, active: record.active,
} : {
  name: "", durationMinutes: 60, locationKind: "our_location", locationDetail: "", hostsMode: "one", hosts: [], enquiryType: "",
  questions: [...(hasRegions ? [{ field: "emirate" as const, required: true }] : []), { field: "summary", required: false }], confirmation: "automatic", slotStepMinutes: 30,
  bufferBeforeMinutes: 0, bufferAfterMinutes: 15, minimumNoticeHours: 4, windowDays: 30, maxPerDay: null, cancelNoticeHours: 4, source: "company", channel: "website", color: "viz-1", active: true,
};

/** Create or edit a booking type: one column, the common fields first, the timing rules under "More details". */
export function BookingTypeDialog({ workspaceId, data, record, onClose, onSaved, onReload }: {
  workspaceId: string; data: BookingTypesData; record: BookingTypeRecord | null; onClose: () => void; onSaved: (record: BookingTypeRecord) => void; onReload: () => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => fromRecord(record, data.options.hasRegions));
  const [version, setVersion] = useState(record?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  const asks = (field: BookingQuestionField) => draft.questions.find((question) => question.field === field);
  const toggle = (field: BookingQuestionField, on: boolean) => set("questions", on ? [...draft.questions, { field, required: field === "emirate" }] : draft.questions.filter((question) => question.field !== field));
  const members = data.members.map((member) => ({ id: member.membershipId, label: member.name }));
  const minutes = (value: number) => ({ id: String(value), label: t("{minutes} min", { minutes: value }) });

  const submit = async () => {
    const body = {
      name: draft.name, durationMinutes: draft.durationMinutes, locationKind: draft.locationKind, locationDetail: draft.locationDetail || null, hostsMode: draft.hostsMode,
      hosts: (draft.hostsMode === "one" ? draft.hosts.slice(0, 1) : draft.hosts).map((membershipId) => ({ membershipId })), enquiryType: draft.enquiryType || null,
      questions: draft.questions, confirmation: draft.confirmation, slotStepMinutes: draft.slotStepMinutes, bufferBeforeMinutes: draft.bufferBeforeMinutes,
      bufferAfterMinutes: draft.bufferAfterMinutes, minimumNoticeMinutes: Math.round(draft.minimumNoticeHours * 60), windowDays: draft.windowDays, maxPerDay: draft.maxPerDay,
      cancelNoticeMinutes: Math.round(draft.cancelNoticeHours * 60), source: draft.source, channel: draft.channel, color: draft.color, active: draft.active,
    };
    const saved = record
      ? await bookingRequest<BookingTypeRecord>(workspaceId, `types/${record.id}`, "PATCH", { ...body, version })
      : await bookingRequest<BookingTypeRecord>(workspaceId, "types", "POST", body);
    onSaved(saved);
  };

  return <FormDialog title={record ? t("Edit booking type") : t("New booking type")} submitLabel={record ? t("Save") : t("Create")} onClose={onClose} onSubmit={submit} isDirty={dirty}
    conflict={{ onReload: async () => { await onReload(); onClose(); }, onKeepMine: async () => { const latest = await bookingRequest<{ data: BookingTypeRecord[] }>(workspaceId, "types"); setVersion(latest.data.find((row) => row.id === record?.id)?.version ?? version); } }}>
    <FormSection>
      <TextInput label={t("Name")} isRequired value={draft.name} onChange={(value) => set("name", value)} description={t("For example: Design consultation, Showroom visit.")} />
      <SelectField label={t("Duration")} isRequired items={[15, 30, 45, 60, 90, 120].map(minutes)} selectedKey={String(draft.durationMinutes)} onSelectionChange={(key) => set("durationMinutes", Number(key))} />
      <SelectField label={t("Where")} isRequired selectedKey={draft.locationKind} onSelectionChange={(key) => set("locationKind", String(key) as LocationKind)}
        items={[{ id: "our_location", label: t("At our studio") }, { id: "client_address", label: t("At the client's address") }, { id: "video", label: t("Video call") }, { id: "phone", label: t("Phone call") }]} />
      {draft.locationKind === "our_location" ? <TextInput label={t("Address")} value={draft.locationDetail} onChange={(value) => set("locationDetail", value)} /> : null}
      {draft.locationKind === "video" ? <TextInput label={t("Meeting link")} inputType="url" value={draft.locationDetail} onChange={(value) => set("locationDetail", value)} description={t("Sent with the confirmation, never shown on the page.")} /> : null}
    </FormSection>
    <FormSection title={t("Hosts")}>
      <SelectField label={t("Who hosts it")} isRequired selectedKey={draft.hostsMode} onSelectionChange={(key) => set("hostsMode", String(key) as Draft["hostsMode"])}
        items={[{ id: "one", label: t("One person") }, { id: "round_robin", label: t("A team, in turn") }, { id: "enquiry_type", label: t("By enquiry type") }]} />
      {draft.hostsMode === "one"
        ? <SelectField label={t("Host")} isRequired items={members} selectedKey={draft.hosts[0] ?? null} onSelectionChange={(key) => set("hosts", key ? [String(key)] : [])} />
        : <MultiSelectField label={t("Hosts")} isRequired items={members} selectedKeys={new Set<Key>(draft.hosts)} onSelectionChange={(keys) => set("hosts", [...keys].map(String))} />}
      <SelectField label={t("Enquiry type")} selectedKey={draft.enquiryType || "visitor"} onSelectionChange={(key) => set("enquiryType", key === "visitor" ? "" : String(key))}
        items={[{ id: "visitor", label: t("The visitor chooses") }, ...data.options.enquiryTypes]} />
    </FormSection>
    <FormSection title={t("Questions")}>
      <fieldset className={styles.questionList}>
        <legend>{t("Besides name, mobile and email, ask for")}</legend>
        {data.options.hasRegions ? <Checkbox isSelected={Boolean(asks("emirate"))} onChange={(on) => toggle("emirate", on)}>{t("Location")}</Checkbox> : null}
        <Checkbox isSelected={Boolean(asks("area"))} onChange={(on) => toggle("area", on)}>{t("Area")}</Checkbox>
        <Checkbox isSelected={Boolean(asks("budgetRange"))} onChange={(on) => toggle("budgetRange", on)}>{t("Estimated budget")}</Checkbox>
        <Checkbox isSelected={Boolean(asks("summary"))} onChange={(on) => toggle("summary", on)}>{t("Anything we should know?")}</Checkbox>
      </fieldset>
      <Switch isSelected={draft.confirmation === "approval"} onChange={(on) => set("confirmation", on ? "approval" : "automatic")}>{t("Confirm each booking yourself")}</Switch>
    </FormSection>
    <MoreDetails>
      <SelectField label={t("Start times every")} items={[15, 30, 60].map(minutes)} selectedKey={String(draft.slotStepMinutes)} onSelectionChange={(key) => set("slotStepMinutes", Number(key))} />
      <NumericInput label={t("Free time before (minutes)")} minValue={0} maxValue={240} value={draft.bufferBeforeMinutes} onChange={(value) => set("bufferBeforeMinutes", Number.isFinite(value) ? value : 0)} />
      <NumericInput label={t("Free time after (minutes)")} minValue={0} maxValue={240} value={draft.bufferAfterMinutes} onChange={(value) => set("bufferAfterMinutes", Number.isFinite(value) ? value : 0)} />
      <NumericInput label={t("Minimum notice (hours)")} minValue={0} maxValue={720} value={draft.minimumNoticeHours} onChange={(value) => set("minimumNoticeHours", Number.isFinite(value) ? value : 0)} />
      <NumericInput label={t("Bookable up to (days ahead)")} minValue={1} maxValue={365} value={draft.windowDays} onChange={(value) => set("windowDays", Number.isFinite(value) ? value : 30)} />
      <NumericInput label={t("Most bookings a day per host")} minValue={1} maxValue={100} value={draft.maxPerDay ?? undefined} onChange={(value) => set("maxPerDay", Number.isFinite(value) ? value : null)} />
      <NumericInput label={t("Clients can move or cancel up to (hours before)")} minValue={0} maxValue={720} value={draft.cancelNoticeHours} onChange={(value) => set("cancelNoticeHours", Number.isFinite(value) ? value : 0)} />
      <SelectField label={t("Source")} items={data.options.sources} selectedKey={draft.source} onSelectionChange={(key) => { const source = String(key); set("source", source); set("channel", data.options.channels[source]?.[0]?.id ?? ""); }} />
      <SelectField label={t("Channel")} items={data.options.channels[draft.source] ?? []} selectedKey={draft.channel || null} onSelectionChange={(key) => set("channel", String(key ?? ""))} />
      <SelectField label={t("Colour")} selectedKey={draft.color} onSelectionChange={(key) => set("color", String(key))}
        items={[1, 2, 3, 4, 5, 6].map((index) => ({ id: `viz-${index}`, label: t("Colour {number}", { number: index }) }))} />
      <Switch isSelected={draft.active} onChange={(on) => set("active", on)}>{t("Open for booking")}</Switch>
    </MoreDetails>
  </FormDialog>;
}
