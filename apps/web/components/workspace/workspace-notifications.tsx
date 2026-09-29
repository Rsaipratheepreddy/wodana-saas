"use client";

import { Bell, X, CheckCheck, Inbox, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import styles from "./workspace-notifications.module.css";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { CHANNEL_LABELS, asDeliveryHealth, deliveryAlert } from "@/lib/workspace/delivery-health";
import { NoticeGroups, matchesFilter, noticeFilters, useWorkspaceNotices, type NoticeFilter } from "./notification-list";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bell: this person's notices grouped by day, filtered by module, with the full page and settings one click away. */
export function WorkspaceNotifications({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const notices = useWorkspaceNotices(workspaceId);
  const { items, unread, failure, marking } = notices;
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const [open, setOpen] = useState(false);
  const [undelivered, setUndelivered] = useState<ReturnType<typeof deliveryAlert>>(null);

  // When the panel opens, the people who run delivery see whether notices reach anyone (others get nothing).
  useEffect(() => {
    if (!open || !UUID.test(workspaceId)) return;
    const controller = new AbortController();
    fetch(`/api/workspace/delivery-health?workspaceId=${workspaceId}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { const health = asDeliveryHealth(data); setUndelivered(health ? deliveryAlert(health) : null); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  const filters = noticeFilters(t, items);
  const current = filters.some(tab => tab.id === filter) ? filter : "all";
  const visible = items.filter(item => matchesFilter(item, current));
  return <div className={styles.wrap} data-notifications="" ref={wrapper}>
    <button ref={trigger} type="button" className={styles.trigger} data-tour="notifications" aria-label={unread ? t("Notifications, {count} unread", { count: unread }) : t("Notifications")} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); void notices.load(); }}>
      <Bell aria-hidden="true" size={18} />{unread ? <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
    </button>
    {open ? <section className={styles.panel} role="dialog" aria-label={t("Notifications")}>
      <header className={styles.header}><h2>{t("Your notifications")}</h2><button className={styles.markAll} type="button" disabled={!unread || marking} onClick={() => void notices.markAllRead()}><CheckCheck size={17} aria-hidden="true" />{marking ? t('Marking…') : t('Mark all as read')}</button><button className={styles.close} type="button" aria-label={t("Close notifications")} onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={17} /></button></header>
      <div className={styles.filters} role="group" aria-label={t("Filter notifications")}>{filters.map(tab => <button type="button" key={tab.id} aria-label={`${tab.label} ${tab.count}`} aria-pressed={current === tab.id} onClick={() => setFilter(tab.id)}>{tab.label}<span data-pending={tab.id === "unread" && tab.count > 0 || undefined}>{tab.count}</span></button>)}</div>
      {undelivered ? <p className={styles.message} role="status" data-undelivered="">{undeliveredText(t, undelivered, locale, timeZone)} <Link href="/workspace/settings/delivery" onClick={() => setOpen(false)}>{t("Open delivery")}</Link></p> : null}
      {failure ? <p className={styles.message} role="alert">{t("Notifications could not be updated.")} <button type="button" onClick={() => void notices.load()}>{t("Retry")}</button></p> : null}
      <div className={styles.list}>
        {!visible.length && !failure ? <div className={styles.empty}><Inbox size={28} aria-hidden="true" /><strong>{current === 'unread' ? t('You’re all caught up') : t('No notifications yet')}</strong><p>{current === 'unread' ? t('New updates will appear here.') : t('Updates for this view will appear here.')}</p></div> : null}
        <NoticeGroups items={visible} onOpen={item => { void notices.markRead(item); if (item.deepLink?.startsWith("/workspace/")) setOpen(false); }} />
      </div>
      <footer className={styles.footer}>
        <Link href="/workspace/notifications" onClick={() => setOpen(false)}>{t("See all notifications")}</Link>
        <Link href="/workspace/settings/notifications" aria-label={t("Notification settings")} onClick={() => setOpen(false)}><Settings size={16} aria-hidden="true" /></Link>
      </footer>
    </section> : null}
  </div>;
}

/** "Email notices not delivered since 28 Sep, 10:40", or every notice when the delivery service is silent. */
function undeliveredText(t: Translate, alert: NonNullable<ReturnType<typeof deliveryAlert>>, locale: string, timeZone: string) {
  const time = alert.since ? new Date(alert.since).toLocaleString(locale, { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  if (!alert.channel) return time ? t("Notices not delivered since {time}", { time }) : t("Notices aren't being delivered");
  const channel = t(CHANNEL_LABELS[alert.channel] as never);
  return time ? t("{channel} notices not delivered since {time}", { channel, time }) : t("{channel} notices aren't being delivered", { channel });
}
