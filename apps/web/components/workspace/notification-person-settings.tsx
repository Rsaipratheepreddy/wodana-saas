"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseTime } from "@internationalized/date";
import type { HoursWindow, NotificationPersonSettingsInput, NotificationPersonSettingsView, ReminderKind } from "@wodana/contracts";
import { Button, ComboboxField, InlineNotice, SettingsRow, SettingsSection, Skeleton, Switch, TimeField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { isVersionConflict, remindersApi } from "@/lib/reminders/client";
import { CRITICAL_REMINDER_EVENT_TYPES, REMINDER_KIND_INFO } from "@/lib/reminders/contract";
import { REMINDER_KIND_LABELS } from "@/lib/reminders/labels";
import { timeZoneOptions } from "@/lib/workspace/regional-options";
import styles from "./notification-settings.module.css";

const timeValue = (value: string | null | undefined) => { try { return value ? parseTime(value) : null; } catch { return null; } };
const timeText = (value: { hour: number; minute: number } | null) => (value ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}` : null);

/** The reminder an always-on event belongs to, named as Settings › Reminders names it. */
function criticalLabel(eventType: string) {
  const kind = (Object.keys(REMINDER_KIND_INFO) as ReminderKind[]).find((item) => REMINDER_KIND_INFO[item].eventType === eventType);
  return kind ? REMINDER_KIND_LABELS[kind] : null;
}

/** Notices that can't be switched off (critical reminders): shown "Always on", never as a switch that does nothing. */
export function AlwaysOnSection({ eventTypes = CRITICAL_REMINDER_EVENT_TYPES }: { eventTypes?: readonly string[] }) {
  const t = useT();
  return <SettingsSection id="critical" title={t("Critical notices")}>
    {[...new Set(eventTypes)].map((eventType) => {
      const label = criticalLabel(eventType);
      const name = label ? t(label) : eventType;
      return <SettingsRow key={eventType} label={name}>
        <Switch aria-label={t("{name}: always on", { name })} isSelected isDisabled>{t("Always on")}</Switch>
      </SettingsRow>;
    })}
  </SettingsSection>;
}

/**
 * The person's own reminder settings (notification-person-settings/me): the daily digest and its time, quiet hours
 * for every channel and the time zone their reminders use. Unset values follow the workspace's.
 */
export function PersonNotificationSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => remindersApi(workspaceId), [workspaceId]);
  const [view, setView] = useState<NotificationPersonSettingsView | null>(null);
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const [digestDraft, setDigestDraft] = useState<string | null>(null);
  const [quietDraft, setQuietDraft] = useState<HoursWindow | null>(null);
  const zones = useMemo(() => timeZoneOptions(), []);
  const load = useCallback(async () => {
    try { setView(await api.personSettings()); setFailed(""); setProblem(null); }
    catch (cause) { setFailed(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Notification settings didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const save = async (patch: Partial<NotificationPersonSettingsInput>) => {
    if (!view) return;
    const input: NotificationPersonSettingsInput = { digestEnabled: view.digestEnabled, digestTime: view.digestTime, quietHours: view.quietHours, timeZone: view.timeZone, version: view.version, ...patch };
    setSaving(true); setProblem(null);
    try {
      const next = await api.savePersonSettings(input);
      setView((current) => (current ? { ...current, ...input, ...next } : current));
    } catch (cause) {
      setProblem({ conflict: isVersionConflict(cause), message: cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Could not save.") });
    } finally { setSaving(false); }
  };

  if (failed && !view) return <InlineNotice tone="error" message={<>{failed} <Button size="compact" variant="quiet" onPress={() => void load()}>{t("Retry")}</Button></>} />;
  if (!view) return <Skeleton lines={4} shape="form" />;
  const quiet = view.quietHours;
  const commitDigest = () => {
    if (digestDraft === null) return;
    const value = digestDraft;
    setDigestDraft(null);
    if (value !== view.digestTime) void save({ digestTime: value });
  };
  const commitQuiet = () => {
    if (!quietDraft || !quiet) return;
    const value = quietDraft;
    setQuietDraft(null);
    if (value.start !== value.end && (value.start !== quiet.start || value.end !== quiet.end)) void save({ quietHours: value });
  };
  return <>
    {problem ? problem.conflict
      ? <div className={styles.conflict} role="alert"><span>{t("Changed by someone else")}</span><Button size="compact" variant="quiet" onPress={() => void load()}>{t("Reload")}</Button></div>
      : <InlineNotice tone="error" message={problem.message} /> : null}
    <SettingsSection id="digest" title={t("Daily digest")}>
      <SettingsRow label={t("Send me a daily digest")}>
        <Switch aria-label={t("Send me a daily digest")} isDisabled={saving} isSelected={view.digestEnabled} onChange={(on) => void save({ digestEnabled: on })} />
      </SettingsRow>
      {view.digestEnabled ? <SettingsRow label={t("Digest time")} hint={view.digestTime ? undefined : t("Workspace time {time}", { time: view.firm.digestTime })}>
        <div className={styles.times}>
          <TimeField aria-label={t("Digest time")} label={undefined} hourCycle={24} isDisabled={saving} value={timeValue(digestDraft ?? view.digestTime)}
            placeholderValue={timeValue(view.firm.digestTime) ?? undefined} onChange={(value) => setDigestDraft(timeText(value))} onBlur={commitDigest} />
          {view.digestTime ? <Button size="compact" variant="quiet" isDisabled={saving} onPress={() => void save({ digestTime: null })}>{t("Use the workspace time")}</Button> : null}
        </div>
      </SettingsRow> : null}
    </SettingsSection>
    <SettingsSection id="quiet-hours" title={t("Quiet hours")}>
      <SettingsRow label={t("My own quiet hours")} hint={quiet ? undefined : t("Workspace hours {start}–{end}", { start: view.firm.quietStart, end: view.firm.quietEnd })}>
        <Switch aria-label={t("My own quiet hours")} isDisabled={saving} isSelected={Boolean(quiet)}
          onChange={(on) => void save({ quietHours: on ? { start: view.firm.quietStart, end: view.firm.quietEnd } : null })} />
      </SettingsRow>
      {quiet ? <SettingsRow label={t("Between")} hint={view.effectiveTimeZone}>
        <div className={styles.times}>
          {/* Saved when a field is left, not on every digit. */}
          <TimeField aria-label={t("From")} label={undefined} hourCycle={24} isDisabled={saving} value={timeValue(quietDraft?.start ?? quiet.start)}
            onChange={(value) => setQuietDraft({ start: timeText(value) ?? quiet.start, end: quietDraft?.end ?? quiet.end })} onBlur={commitQuiet} />
          <TimeField aria-label={t("To")} label={undefined} hourCycle={24} isDisabled={saving} value={timeValue(quietDraft?.end ?? quiet.end)}
            onChange={(value) => setQuietDraft({ start: quietDraft?.start ?? quiet.start, end: timeText(value) ?? quiet.end })} onBlur={commitQuiet} />
        </div>
      </SettingsRow> : null}
    </SettingsSection>
    <SettingsSection id="time-zone" title={t("Time zone")}>
      <SettingsRow label={t("Time zone")} hint={view.timeZone ? undefined : t("Now {zone}", { zone: view.effectiveTimeZone })}>
        <ComboboxField aria-label={t("Time zone")} label={null} isDisabled={saving} selectedKey={view.timeZone ?? "auto"}
          items={[{ id: "auto", label: t("Automatic") }, ...zones.filter((zone) => zone.id !== "auto")]}
          onSelectionChange={(key) => { if (key && (key === "auto" ? null : String(key)) !== view.timeZone) void save({ timeZone: key === "auto" ? null : String(key) }); }} />
      </SettingsRow>
    </SettingsSection>
  </>;
}
