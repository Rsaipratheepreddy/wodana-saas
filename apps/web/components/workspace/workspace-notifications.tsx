"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./workspace-notifications.module.css";

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
  const [items, setItems] = useState<Notification[]>([]);
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
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
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

  return <div className={styles.wrap}>
    <button type="button" className={styles.trigger} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); void load(); }}>
      <Bell aria-hidden="true" size={18} />{unread ? <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
    </button>
    {open ? <section className={styles.panel} role="dialog" aria-label="Notifications">
      <header><strong>Notifications</strong><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={17} /></button></header>
      {failure ? <p className={styles.message} role="alert">Notifications could not be refreshed. <button type="button" onClick={() => void load()}>Retry</button></p> : null}
      <div className={styles.list}>
        {!items.length && !failure ? <p className={styles.message}>No notifications yet.</p> : null}
        {items.map(item => <div className={styles.item} data-unread={!item.readAt || undefined} key={item.id}>
          {item.deepLink?.startsWith("/workspace/") ? <Link href={item.deepLink} onClick={() => { void markRead(item); setOpen(false); }}><strong>{item.subject || "Update"}</strong><span>{item.body}</span></Link> : <button type="button" onClick={() => void markRead(item)}><strong>{item.subject || "Update"}</strong><span>{item.body}</span></button>}
        </div>)}
      </div>
    </section> : null}
  </div>;
}
