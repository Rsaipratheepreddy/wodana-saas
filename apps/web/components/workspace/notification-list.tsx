"use client";

import Link from "next/link";
import { Bell, BriefcaseBusiness, Factory, FolderKanban, LayoutGrid, Ruler, Users, Wallet, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { pollEvery, useLiveInvalidate } from "@/lib/workspace/live-events";
import { DAY_GROUP_LABELS, NOTIFICATION_MODULES, dayGroup, notificationModule, type DayGroup, type NotificationModule } from "@/lib/workspace/notification-modules";
import styles from "./workspace-notifications.module.css";

export type WorkspaceNotice = {
  id: string;
  eventType?: string;
  subject: string | null;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_SCOPES = ["notifications", "workspace"] as const;
export const MODULE_ICONS: Record<NotificationModule, LucideIcon> = {
  sales: BriefcaseBusiness, planning: Ruler, projects: FolderKanban, operations: Factory, finance: Wallet, people: Users, workspace: LayoutGrid,
};

/** The signed-in person's notices (newest 200), refreshed every 30 seconds while the page is visible. */
export function useWorkspaceNotices(workspaceId: string) {
  const [items, setItems] = useState<WorkspaceNotice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState(false);
  const [marking, setMarking] = useState(false);
  const load = useCallback(async () => {
    if (!UUID.test(workspaceId)) return;
    try {
      const response = await fetch(`/api/workspace/crm/data/notifications?workspaceId=${workspaceId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Notifications unavailable");
      const data: unknown = await response.json();
      setItems(Array.isArray(data) ? data as WorkspaceNotice[] : []);
      setFailure(false);
    } catch {
      setFailure(true);
    } finally { setLoaded(true); }
  }, [workspaceId]);
  // A new notice arrives with the change that caused it, so any workspace change re-reads the list; polling
  // stays as a fallback (every 30 seconds without the live stream, every minute with it).
  const live = useLiveInvalidate(workspaceId, LIVE_SCOPES, () => void load(), 2_000);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, pollEvery(live, 30_000));
    const refresh = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load, live]);
  const markRead = async (item: WorkspaceNotice) => {
    if (item.readAt) return;
    try {
      const response = await fetch(`/api/workspace/crm/data/notifications/${item.id}/read?workspaceId=${workspaceId}`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark notification as read");
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch { setFailure(true); }
  };
  const unread = items.filter((item) => !item.readAt).length;
  const markAllRead = async () => {
    if (marking || !unread) return;
    setMarking(true);
    try {
      const response = await fetch(`/api/workspace/crm/data/notifications/read-all?workspaceId=${workspaceId}`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark notifications as read");
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      setFailure(false);
    } catch { setFailure(true); } finally { setMarking(false); }
  };
  return { items, loaded, failure, marking, unread, load, markRead, markAllRead };
}

export type NoticeFilter = "all" | "unread" | NotificationModule;

/** All, Unread, then each module that has notices, with counts. */
export function noticeFilters(t: Translate, items: WorkspaceNotice[]) {
  const unread = items.filter((item) => !item.readAt).length;
  const modules = NOTIFICATION_MODULES.map((module) => ({ id: module.id as NoticeFilter, label: t(module.label as never), count: items.filter((item) => notificationModule(item.eventType) === module.id).length }))
    .filter((module) => module.count > 0);
  return [{ id: "all" as NoticeFilter, label: t("View all"), count: items.length }, { id: "unread" as NoticeFilter, label: t("Unread"), count: unread }, ...modules];
}

export const matchesFilter = (item: WorkspaceNotice, filter: NoticeFilter) =>
  filter === "all" || (filter === "unread" ? !item.readAt : notificationModule(item.eventType) === filter);

/** Notices grouped Today / This week / Earlier; each opens its record (inside the workspace only) and is marked read. */
export function NoticeGroups({ items, onOpen, action }: { items: WorkspaceNotice[]; onOpen: (item: WorkspaceNotice) => void; action?: (item: WorkspaceNotice) => ReactNode }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const groups = useMemo(() => {
    const now = new Date();
    const byGroup = new Map<DayGroup, WorkspaceNotice[]>();
    for (const item of items) {
      const group = dayGroup(item.createdAt, timeZone, now);
      byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
    }
    return (["today", "week", "earlier"] as DayGroup[]).filter((group) => byGroup.has(group)).map((group) => ({ group, items: byGroup.get(group)! }));
  }, [items, timeZone]);
  return <>{groups.map(({ group, items: rows }) => <section key={group} className={styles.group} aria-label={t(DAY_GROUP_LABELS[group] as never)}>
    <h3 className={styles.groupTitle}>{t(DAY_GROUP_LABELS[group] as never)}</h3>
    {rows.map((item) => {
      const kind = notificationModule(item.eventType);
      const Icon = MODULE_ICONS[kind] ?? Bell;
      const date = new Date(item.createdAt);
      const content = <><span className={styles.avatar} data-kind={kind}><Icon size={20} aria-hidden="true" /></span><span className={styles.content}><strong>{item.subject || t("Update")}</strong><span className={styles.meta}><time dateTime={item.createdAt}>{Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><span>{relativeTime(item.createdAt, t, locale)}</span></span>{item.body && <span className={styles.body}>{item.body}</span>}</span>{!item.readAt && <span className={styles.unread} aria-label={t("Unread")} />}</>;
      return <div className={styles.item} data-unread={!item.readAt || undefined} key={item.id}>
        {item.deepLink?.startsWith("/workspace/") ? <Link href={item.deepLink} onClick={() => onOpen(item)}>{content}</Link> : <button type="button" onClick={() => onOpen(item)}>{content}</button>}
        {action ? <span className={styles.itemAction}>{action(item)}</span> : null}
      </div>;
    })}
  </section>)}</>;
}

export function relativeTime(value: string, t: Translate, locale: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return t("Just now");
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 3600 ? [Math.floor(seconds / 60), "minute"] : seconds < 86400 ? [Math.floor(seconds / 3600), "hour"] : [Math.floor(seconds / 86400), "day"];
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-amount, unit);
}
