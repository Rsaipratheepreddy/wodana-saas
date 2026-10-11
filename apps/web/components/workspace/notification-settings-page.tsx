"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, InlineNotice, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { NOTIFICATION_MODULES, PREFERENCE_CHANNELS, moduleEnabled, type NotificationModule, type NotificationPreference, type PreferenceChannel } from "@/lib/workspace/notification-modules";
import { AlwaysOnSection, PersonNotificationSettings } from "./notification-person-settings";
import styles from "./notification-settings.module.css";

const CHANNEL_LABELS: Record<PreferenceChannel, string> = { in_app: tKey("In the app"), email: tKey("Email"), push: tKey("Phone") };
const endpoint = (workspaceId: string, path = "") => `/api/workspace/crm/data/notification-preferences${path}?workspaceId=${workspaceId}`;

/**
 * Settings → Notifications: what each module tells you and on which channel, the critical notices that are always on,
 * the daily digest, quiet hours for every channel and the time zone reminders use.
 */
export function NotificationSettingsPage({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const t = useT();
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
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

  const save = async (key: string, rows: Array<{ eventType: string; channel: string; enabled: boolean }>) => {
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
  return <SettingsPage title={t("Notifications")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="modules" title={t("What you're told")}>
      <div className={styles.header} aria-hidden="true"><span />{PREFERENCE_CHANNELS.map((channel) => <span key={channel}>{t(CHANNEL_LABELS[channel] as never)}</span>)}</div>
      {NOTIFICATION_MODULES.map((module) => <SettingsRow key={module.id} label={t(module.label as never)}>
        <div className={styles.switches}>{PREFERENCE_CHANNELS.map((channel) => <Switch key={channel} aria-label={t("{module}: {channel}", { module: t(module.label as never), channel: t(CHANNEL_LABELS[channel] as never) })}
          isDisabled={saving !== null} isSelected={moduleEnabled(preferences, module.id, channel)} onChange={(enabled) => setModule(module.id, channel, enabled)} />)}</div>
      </SettingsRow>)}
    </SettingsSection>
    <AlwaysOnSection />
    <PersonNotificationSettings workspaceId={workspaceId} />
  </SettingsPage>;
}
