"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, InlineNotice, SaveBar, SettingsPage, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import type { NoticeChoicesInput, NoticeChoicesView } from "@/lib/workspace/notification-modules";
import { NoticeChannelGrid, PersonNotificationSettings } from "./notification-person-settings";
import styles from "./notification-settings.module.css";

const endpoint = (workspaceId: string) => `/api/workspace/notification-choices?workspaceId=${workspaceId}`;

/** What a view saves: every cell shown, the quiet hours, the digest and the zone, with the version it was read at. */
const draftOf = (view: NoticeChoicesView): NoticeChoicesInput => ({
  choices: view.choices.map((cell) => ({ ...cell })), quietHours: view.quietHours, digestEnabled: view.digestEnabled, digestTime: view.digestTime, timeZone: view.timeZone, version: view.version,
});
/** The same draft written the same way, whatever order the switches were touched in. */
const sameDraft = (left: NoticeChoicesInput, right: NoticeChoicesInput) => {
  const plain = (draft: NoticeChoicesInput) => JSON.stringify({ ...draft, choices: [...draft.choices].sort((a, b) => `${a.group}:${a.channel}`.localeCompare(`${b.group}:${b.channel}`)) });
  return plain(left) === plain(right);
};

/**
 * Settings → Notifications, the person's own: for each group, which channels they are told on (only the workspace's
 * channels), the alerts that always arrive, quiet hours, the daily digest and their zone. One Save, version-checked.
 */
export function NotificationSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [view, setView] = useState<NoticeChoicesView | null>(null);
  const [draft, setDraft] = useState<NoticeChoicesInput | null>(null);
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint(workspaceId), { cache: "no-store" });
      const data = await response.json().catch(() => null) as NoticeChoicesView | { message?: string } | null;
      if (!response.ok || !data || !("choices" in data)) throw new Error(data && "message" in data && typeof data.message === "string" ? data.message : "");
      setView(data); setDraft(draftOf(data)); setFailed(""); setProblem(null);
    } catch (cause) { setFailed(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Notification settings didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true); setProblem(null);
    try {
      const response = await fetch(endpoint(workspaceId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json().catch(() => null) as NoticeChoicesView | { message?: string } | null;
      if (!response.ok || !data || !("choices" in data)) {
        const message = data && "message" in data && typeof data.message === "string" && data.message ? translateKnown(t, data.message) : t("Could not save.");
        setProblem({ conflict: response.status === 409, message });
        return;
      }
      setView(data); setDraft(draftOf(data)); setSaved(true);
    } catch { setProblem({ conflict: false, message: t("Could not save.") }); } finally { setSaving(false); }
  };

  if (failed && !view) return <EmptyState illustration="error" title={t("Notification settings didn't load")} description={failed} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!view || !draft) return <Skeleton lines={6} shape="form" />;
  const dirty = !sameDraft(draft, draftOf(view));
  const change = (next: NoticeChoicesInput) => { setDraft(next); setSaved(false); };
  const invalidQuiet = Boolean(draft.quietHours && draft.quietHours.start === draft.quietHours.end);
  return <SettingsPage title={t("Notifications")}>
    {problem ? problem.conflict
      ? <div className={styles.conflict} role="alert"><span>{t("Changed by someone else")}</span><Button size="compact" variant="quiet" onPress={() => void load()}>{t("Reload")}</Button></div>
      : <InlineNotice tone="error" message={problem.message} /> : null}
    <NoticeChannelGrid view={view} draft={draft} onChange={change} isDisabled={saving} />
    <PersonNotificationSettings view={view} draft={draft} onChange={change} isDisabled={saving} />
    <SaveBar isDirty={dirty} isSaving={saving} saved={saved && !dirty} isDisabled={invalidQuiet} onDiscard={() => { setDraft(draftOf(view)); setProblem(null); }} onSave={() => void save()} />
  </SettingsPage>;
}
