"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { HrmsBootstrap, HrmsPerson } from "@wodana/contracts";
import {
  Button, EmptyState, InlineNotice, NoAccessState, NumericInput, PageSkeleton, SelectField, SettingsPage, SettingsRow, Skeleton, Tabs,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi, type HrmsApi } from "@/lib/hrms/api";
import { HRMS_SETTINGS_TABS, type HrmsSettingsTab } from "@/lib/hrms/sections";
import { CalendarSettings } from "./calendar-settings";
import { useHrmsFormat } from "./hrms-format";
import { LeaveTypeSettings } from "./leave-type-settings";
import { WorkplaceSettings } from "./workplace-settings";
import styles from "./hrms.module.css";

const PATH = "/workspace/settings/attendance";

/** Settings → Attendance & leave: work calendars and their holidays, kinds of leave, workplaces, and the rules attendance is checked by. */
export function AttendanceSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const format = useHrmsFormat();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const [boot, setBoot] = useState<HrmsBootstrap | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<HrmsSettingsTab | null>(null);
  const load = useCallback(async () => {
    try { setBoot(await api.bootstrap()); setError(""); } catch (cause) { setError(format.failure(cause, t("Could not load the settings."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const requested = params.get("tab");
  const tab: HrmsSettingsTab = HRMS_SETTINGS_TABS.includes(requested as HrmsSettingsTab) ? requested as HrmsSettingsTab : "calendars";
  if (error && !boot) return <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!boot) return <PageSkeleton variant="form" />;
  if (!boot.permissions.manage) return <SettingsPage title={t("Attendance & leave")}><NoAccessState /></SettingsPage>;
  const done = () => setCreating(null);
  // One primary action, for the tab it belongs to.
  const newLabel: Partial<Record<HrmsSettingsTab, string>> = { calendars: t("New calendar"), "leave-types": t("New leave type"), workplaces: t("New workplace") };
  return <SettingsPage title={t("Attendance & leave")} width="wide"
    actions={newLabel[tab] ? <Button variant="primary" onPress={() => setCreating(tab)}>{newLabel[tab]}</Button> : undefined}>
    <Tabs selectedKey={tab} onSelectionChange={(key) => { setCreating(null); router.replace(key === "calendars" ? PATH : `${PATH}?tab=${key}`, { scroll: false }); }} items={[
      { id: "calendars", label: t("Calendars"), panel: <CalendarSettings api={api} boot={boot} creating={creating === "calendars"} onCreateDone={done} onChanged={() => void load()} /> },
      { id: "leave-types", label: t("Leave types"), panel: <LeaveTypeSettings api={api} creating={creating === "leave-types"} onCreateDone={done} /> },
      { id: "workplaces", label: t("Workplaces"), panel: <WorkplaceSettings api={api} creating={creating === "workplaces"} onCreateDone={done} /> },
      { id: "rules", label: t("Rules"), panel: <RuleSettings key={boot.settings?.version ?? 0} api={api} boot={boot} onSaved={() => void load()} /> },
    ]} />
  </SettingsPage>;
}

/** Which calendar people follow unless given another, who decides when someone has no manager, and how strictly attendance evidence is checked. */
function RuleSettings({ api, boot, onSaved }: { api: HrmsApi; boot: HrmsBootstrap; onSaved: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const initial = {
    defaultCalendarId: boot.settings?.defaultCalendarId ?? boot.calendars[0]?.id ?? "",
    fallbackApproverId: boot.settings?.fallbackApproverId ?? null,
    maxGpsAccuracyM: boot.settings?.maxGpsAccuracyM ?? 100,
    maxCaptureAgeSeconds: boot.settings?.maxCaptureAgeSeconds ?? 120,
    mediaRetentionDays: boot.settings?.mediaRetentionDays ?? 365,
  };
  const [form, setForm] = useState(initial);
  const [people, setPeople] = useState<HrmsPerson[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.people().then((rows) => { if (live) setPeople(rows); }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [api]);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const within = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  const valid = Boolean(form.defaultCalendarId) && within(form.maxGpsAccuracyM, 5, 500) && within(form.maxCaptureAgeSeconds, 30, 600) && within(form.mediaRetentionDays, 30, 3650);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return <div className={styles.stack}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className="wd-settings-rows">
    <SettingsRow label={t("Default calendar")}>
      <SelectField aria-label={t("Default calendar")} label={null} selectedKey={form.defaultCalendarId || null} placeholder={t("Choose")}
        onSelectionChange={(key) => set("defaultCalendarId", key ? String(key) : "")} items={boot.calendars.map((calendar) => ({ id: calendar.id, label: calendar.name }))} />
    </SettingsRow>
    <SettingsRow label={t("When someone has no manager")}>
      {people ? <SelectField aria-label={t("When someone has no manager")} label={null} selectedKey={form.fallbackApproverId ?? "anyone"}
        onSelectionChange={(key) => set("fallbackApproverId", key && key !== "anyone" ? String(key) : null)}
        items={[{ id: "anyone", label: t("Anyone who manages HR") }, ...people.filter((person) => person.status === "active" || person.membershipId === form.fallbackApproverId)
          .map((person) => ({ id: person.membershipId, label: person.name }))]} /> : <Skeleton lines={1} />}
    </SettingsRow>
    <SettingsRow label={t("Location accuracy")}>
      <NumericInput aria-label={t("Location accuracy")} label={null} suffix={format.unit("meter")} minValue={5} maxValue={500} step={1} value={form.maxGpsAccuracyM} onChange={(value) => set("maxGpsAccuracyM", value)} />
    </SettingsRow>
    <SettingsRow label={t("Photo must be sent within")}>
      <NumericInput aria-label={t("Photo must be sent within")} label={null} suffix={format.unit("second")} minValue={30} maxValue={600} step={1} value={form.maxCaptureAgeSeconds}
        onChange={(value) => set("maxCaptureAgeSeconds", value)} />
    </SettingsRow>
    <SettingsRow label={t("Keep photos for")}>
      <NumericInput aria-label={t("Keep photos for")} label={null} suffix={format.unit("day")} minValue={30} maxValue={3650} step={1} value={form.mediaRetentionDays}
        onChange={(value) => set("mediaRetentionDays", value)} />
    </SettingsRow>
    </div>
    <div className={styles.actions}>
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={async () => {
        setBusy(true); setError("");
        try { await api.saveSettings({ version: boot.settings?.version ?? 0, ...form }); onSaved(); }
        catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
      }}>{t("Save")}</Button>
    </div>
  </div>;
}
