"use client";

import { useCallback, useEffect, useState } from "react";
import { parseTime } from "@internationalized/date";
import { Button, EmptyState, InlineNotice, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TimeField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { NOTIFICATION_MODULES, PREFERENCE_CHANNELS, moduleEnabled, type NotificationModule, type NotificationPreference, type PreferenceChannel } from "@/lib/workspace/notification-modules";
import styles from "./notification-settings.module.css";

const CHANNEL_LABELS: Record<PreferenceChannel, string> = { in_app: tKey("In the app"), email: tKey("Email"), push: tKey("Phone") };
const endpoint = (workspaceId: string, path = "") => `/api/workspace/crm/data/notification-preferences${path}?workspaceId=${workspaceId}`;

/** Settings → Notifications: what each module tells you, on which channel, and quiet hours for the phone. */
export function NotificationSettingsPage({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint(workspaceId, "/me"), { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : t("Notification settings didn't load."));
      setPreferences(Array.isArray(data) ? data as NotificationPreference[] : []);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Notification settings didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const save = async (key: string, rows: Array<{ eventType: string; channel: string; enabled: boolean; quietHours?: Record<string, unknown> }>) => {
    setSaving(key); setError("");
    try {
      for (const row of rows) {
        const response = await fetch(endpoint(workspaceId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientType: "user", recipientId: userId, ...row }) });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? t("Could not save."));
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); } finally { setSaving(null); }
  };

  if (error && !preferences) return <EmptyState illustration="error" title={t("Notification settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!preferences) return <Skeleton lines={6} shape="form" />;
  const setModule = (module: NotificationModule, channel: PreferenceChannel, enabled: boolean) => {
    const prefixes = NOTIFICATION_MODULES.find((item) => item.id === module)?.prefixes ?? [];
    void save(`${module}:${channel}`, prefixes.map((prefix) => ({ eventType: `${prefix}.*`, channel, enabled })));
  };
  const phone = preferences.find((row) => row.eventType === "*" && row.channel === "push");
  const quiet = phone?.quietHours && typeof phone.quietHours.start === "string" && typeof phone.quietHours.end === "string" ? phone.quietHours as { start: string; end: string; timezone?: string } : null;
  // Quiet hours keep the time zone they were set in; new ones use the workspace's.
  const setQuiet = (value: { start: string; end: string } | null) => void save("quiet", [{
    eventType: "*", channel: "push", enabled: phone?.enabled ?? true, quietHours: value ? { start: value.start, end: value.end, timezone: quiet?.timezone ?? timeZone } : {},
  }]);
  const time = (value: string) => { try { return parseTime(value); } catch { return null; } };
  const text = (value: { hour: number; minute: number } | null) => (value ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}` : null);
  const commitDraft = () => {
    if (!draft || !quiet) return;
    setDraft(null);
    if (draft.start !== draft.end && (draft.start !== quiet.start || draft.end !== quiet.end)) setQuiet(draft);
  };
  return <SettingsPage title={t("Notifications")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="modules" title={t("What you're told")}>
      <div className={styles.header} aria-hidden="true"><span />{PREFERENCE_CHANNELS.map((channel) => <span key={channel}>{t(CHANNEL_LABELS[channel] as never)}</span>)}</div>
      {NOTIFICATION_MODULES.map((module) => <SettingsRow key={module.id} label={t(module.label as never)}>
        <div className={styles.switches}>{PREFERENCE_CHANNELS.map((channel) => <Switch key={channel} aria-label={t("{module}: {channel}", { module: t(module.label as never), channel: t(CHANNEL_LABELS[channel] as never) })}
          isDisabled={saving !== null} isSelected={moduleEnabled(preferences, module.id, channel)} onChange={(enabled) => setModule(module.id, channel, enabled)} />)}</div>
      </SettingsRow>)}
    </SettingsSection>
    <SettingsSection id="quiet-hours" title={t("Quiet hours")}>
      <SettingsRow label={t("Hold phone notifications")} hint={t("They arrive when quiet hours end. The inbox still has them.")}>
        <Switch aria-label={t("Hold phone notifications")} isDisabled={saving !== null} isSelected={Boolean(quiet)} onChange={(on) => setQuiet(on ? { start: "22:00", end: "07:00" } : null)} />
      </SettingsRow>
      {quiet ? <SettingsRow label={t("Between")} hint={quiet.timezone ?? timeZone}>
        <div className={styles.times}>
          {/* Saved when a field is left, not on every digit. */}
          <TimeField aria-label={t("From")} label={undefined} hourCycle={24} value={time(draft?.start ?? quiet.start)} isDisabled={saving !== null}
            onChange={(value) => setDraft({ start: text(value) ?? quiet.start, end: draft?.end ?? quiet.end })} onBlur={commitDraft} />
          <TimeField aria-label={t("To")} label={undefined} hourCycle={24} value={time(draft?.end ?? quiet.end)} isDisabled={saving !== null}
            onChange={(value) => setDraft({ start: draft?.start ?? quiet.start, end: text(value) ?? quiet.end })} onBlur={commitDraft} />
        </div>
      </SettingsRow> : null}
    </SettingsSection>
  </SettingsPage>;
}
