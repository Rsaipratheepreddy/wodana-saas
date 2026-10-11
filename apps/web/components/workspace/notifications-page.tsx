"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, EmptyState, ErrorState, IconMenuButton, InlineNotice, ListTabs, PageHeader, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { CRITICAL_REMINDER_EVENT_TYPES } from "@/lib/reminders/contract";
import { NoticeGroups, matchesFilter, noticeFilters, useWorkspaceNotices, type NoticeFilter, type WorkspaceNotice } from "./notification-list";
import styles from "./notifications-page.module.css";

/** Home › Notifications: every notice, by day and module; a kind of notice can be muted from here. */
export function NotificationsPage({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const t = useT();
  const notices = useWorkspaceNotices(workspaceId);
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const [muted, setMuted] = useState<string | null>(null);
  const [muteError, setMuteError] = useState("");
  const filters = noticeFilters(t, notices.items);
  const current = filters.some((tab) => tab.id === filter) ? filter : "all";
  const visible = notices.items.filter((item) => matchesFilter(item, current));
  // "Mute notices like this": this kind of notice stops in the app, by email and on the phone.
  const mute = async (item: WorkspaceNotice) => {
    if (!item.eventType) return;
    setMuteError("");
    try {
      for (const channel of ["in_app", "email", "push"]) {
        const response = await fetch(`/api/workspace/crm/data/notification-preferences?workspaceId=${workspaceId}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipientType: "user", recipientId: userId, eventType: item.eventType, channel, enabled: false }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? t("Could not save."));
      }
      setMuted(item.subject ?? item.eventType);
    } catch (cause) { setMuteError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  return <section className={styles.page} aria-label={t("Notifications")}>
    <PageHeader title={t("Notifications")} actions={<Button variant="primary" isDisabled={!notices.unread} isLoading={notices.marking} onPress={() => void notices.markAllRead()}>{t("Mark all as read")}</Button>} />
    <div className={styles.toolbar}>
      <ListTabs label={t("Filter notifications")} items={filters} value={current} onChange={setFilter} />
      <Link className={styles.settings} href="/workspace/settings/notifications">{t("Notification settings")}</Link>
    </div>
    {muted ? <InlineNotice tone="success" message={t("Muted. Turn it back on in Notification settings.")} /> : null}
    {muteError ? <InlineNotice tone="error" message={muteError} /> : null}
    {!notices.loaded ? <Skeleton lines={6} />
      : notices.failure && !notices.items.length ? <ErrorState onRetry={() => void notices.load()} />
        : !visible.length ? <EmptyState illustration={null} title={current === "unread" ? t("You’re all caught up") : t("No notifications yet")} />
          : <div className={styles.list}>
            <NoticeGroups items={visible} onOpen={(item) => void notices.markRead(item)}
              action={(item) => item.eventType && !CRITICAL_REMINDER_EVENT_TYPES.includes(item.eventType) ? <IconMenuButton ariaLabel={t("More for {name}", { name: item.subject || t("Update") })} items={[{ id: "mute", label: t("Mute notices like this") }]} onAction={() => void mute(item)} /> : null} />
          </div>}
  </section>;
}
