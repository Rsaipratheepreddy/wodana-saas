"use client";

import { Bell, X, CheckCheck, BriefcaseBusiness, FolderKanban, Inbox } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useRef } from "react";
import styles from "./workspace-notifications.module.css";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";

type Notification = {
  id: string;
  subject: string | null;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function WorkspaceNotifications({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [items, setItems] = useState<Notification[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState('all');
  const [marking, setMarking] = useState(false);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState(false);
  const endpoint = `/api/workspace/crm/data/notifications?workspaceId=${workspaceId}`;
  const load = useCallback(async () => {
    if (!UUID.test(workspaceId)) return;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Notifications unavailable");
      const data: unknown = await response.json();
      setItems(Array.isArray(data) ? data as Notification[] : []);
      setFailure(false);
    } catch {
      setFailure(true);
    }
  }, [endpoint, workspaceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    const refresh = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  const markRead = async (item: Notification) => {
    if (item.readAt) return;
    try {
      const response = await fetch(`/api/workspace/crm/data/notifications/${item.id}/read?workspaceId=${workspaceId}`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark notification as read");
      setItems(current => current.map(row => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch {
      setFailure(true);
    }
  };
  const unread = items.filter(item => !item.readAt).length;

  const markAllRead = async () => {
    if (marking || !unread) return;
    setMarking(true);
    try {
      const response = await fetch(`/api/workspace/crm/data/notifications/read-all?workspaceId=${workspaceId}`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark notifications as read");
      setItems(current => current.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      setFailure(false);
    } catch { setFailure(true); } finally { setMarking(false); }
  };
  const category = (item: Notification) => item.deepLink?.startsWith('/workspace/crm/') ? 'crm' : item.deepLink?.startsWith('/workspace/projects/') || item.deepLink?.startsWith('/workspace/pre-projects/') ? 'projects' : 'other';
  const filters = [{ id: 'all', label: t('View all'), count: items.length }, { id: 'unread', label: t('Unread'), count: unread }, { id: 'crm', label: t('CRM'), count: items.filter(item => category(item) === 'crm').length }, { id: 'projects', label: t('Projects'), count: items.filter(item => category(item) === 'projects').length }];
  const visible = items.filter(item => filter === 'all' || (filter === 'unread' ? !item.readAt : category(item) === filter));
  return <div className={styles.wrap} data-notifications="" ref={wrapper}>
    <button ref={trigger} type="button" className={styles.trigger} data-tour="notifications" aria-label={unread ? t("Notifications, {count} unread", { count: unread }) : t("Notifications")} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); void load(); }}>
      <Bell aria-hidden="true" size={18} />{unread ? <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
    </button>
    {open ? <section className={styles.panel} role="dialog" aria-label={t("Notifications")}>
      <header className={styles.header}><h2>{t("Your notifications")}</h2><button className={styles.markAll} type="button" disabled={!unread || marking} onClick={() => void markAllRead()}><CheckCheck size={17} aria-hidden="true" />{marking ? t('Marking…') : t('Mark all as read')}</button><button className={styles.close} type="button" aria-label={t("Close notifications")} onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={17} /></button></header>
      <div className={styles.filters} role="group" aria-label={t("Filter notifications")}>{filters.map(tab => <button type="button" key={tab.id} aria-label={`${tab.label} ${tab.count}`} aria-pressed={filter === tab.id} onClick={() => setFilter(tab.id)}>{tab.label}<span data-pending={tab.id === "unread" && tab.count > 0 || undefined}>{tab.count}</span></button>)}</div>
      {failure ? <p className={styles.message} role="alert">{t("Notifications could not be updated.")} <button type="button" onClick={() => void load()}>{t("Retry")}</button></p> : null}
      <div className={styles.list}>
        {!visible.length && !failure ? <div className={styles.empty}><Inbox size={28} aria-hidden="true" /><strong>{filter === 'unread' ? t('You’re all caught up') : t('No notifications yet')}</strong><p>{filter === 'unread' ? t('New updates will appear here.') : t('Updates for this view will appear here.')}</p></div> : null}
        {visible.map(item => {
          const kind = category(item);
          const Icon = kind === 'crm' ? BriefcaseBusiness : kind === 'projects' ? FolderKanban : Bell;
          const date = new Date(item.createdAt);
          const content = <><span className={styles.avatar} data-kind={kind}><Icon size={20} aria-hidden="true" /></span><span className={styles.content}><strong>{item.subject || t("Update")}</strong><span className={styles.meta}><time dateTime={item.createdAt}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale, { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time><span>{relativeTime(item.createdAt, t, locale)}</span></span>{item.body && <span className={styles.body}>{item.body}</span>}</span>{!item.readAt && <span className={styles.unread} aria-label={t("Unread")} />}</>;
          return <div className={styles.item} data-unread={!item.readAt || undefined} key={item.id}>
            {item.deepLink?.startsWith("/workspace/") ? <Link href={item.deepLink} onClick={() => { void markRead(item); setOpen(false); }}>{content}</Link> : <button type="button" onClick={() => void markRead(item)}>{content}</button>}
          </div>;
        })}
      </div>
    </section> : null}
  </div>;
}

function relativeTime(value: string, t: Translate, locale: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return t('Just now');
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-amount, unit);
}
