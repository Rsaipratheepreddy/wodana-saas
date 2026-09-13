"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BellRing, CalendarDays, Check, Clock3, Phone, Plus, RefreshCw, Search } from "lucide-react";
import { Avatar, Button, Callout, IconButton } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell } from "./crm-product-shell";
import { FollowUpSheet, NewFollowUpDialog } from "./follow-up-editor";
import styles from "./crm-follow-ups.module.css";

type FollowUpView = "todo" | "completed" | "all";
const groups = ["Overdue", "Today", "Upcoming", "No date yet", "Completed", "Cancelled"] as const;
const subscribe = () => () => {};
const subscribeToClock = (update: () => void) => { const timer = window.setInterval(update, 60_000); return () => window.clearInterval(timer); };
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function followUpGroup(item: RecordData, now: number, timeZone: string): typeof groups[number] {
  if (item.status === "completed") return "Completed";
  if (item.status === "cancelled") return "Cancelled";
  const due = Date.parse(String(item.dueAt ?? ""));
  if (!Number.isFinite(due)) return "No date yet";
  if (due < now) return "Overdue";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return day.format(due) === day.format(now) ? "Today" : "Upcoming";
}

export function CrmFollowUps({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const [items, setItems] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [view, setView] = useState<FollowUpView>("todo");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(initialRecordId);
  const [busy, setBusy] = useState(false);
  const fetching = useRef(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const now = useSyncExternalStore(subscribeToClock, currentMinute, () => Date.parse(initialData.referenceTime));
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const timeZone = ready ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  const reload = async (more = false) => {
    if (fetching.current) return;
    fetching.current = true; setBusy(true); setFailure("");
    try {
      const payload = await crmRequest<{ data: RecordData[]; nextCursor: string | null }>(initialData.workspaceId, `activities?limit=100${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setItems((old) => more ? [...old, ...payload.data.filter((item) => !old.some((existing) => existing.id === item.id))] : payload.data);
      setCursor(payload.nextCursor ?? null);
    } catch (error) { setFailure((error as Error).message); }
    finally { fetching.current = false; setBusy(false); }
  };
  const saved = (record: RecordData) => {
    setItems((old) => old.some((item) => item.id === record.id) ? old.map((item) => item.id === record.id ? { ...item, ...record } : item) : [record, ...old]);
    setNotice(record.status === "completed" ? "Follow-up completed." : "Follow-up saved. Its reminder is available in Overview and Calendar.");
  };
  const followUps = useMemo(() => items.filter((item) => item.type !== "note"), [items]);
  const counts = { todo: followUps.filter((item) => item.status === "pending").length, completed: followUps.filter((item) => item.status === "completed").length, all: followUps.length };
  const visible = useMemo(() => followUps.filter((item) => view === "all" || item.status === (view === "todo" ? "pending" : "completed"))
    .filter((item) => !search.trim() || [item.title, item.description, item.partyName, item.leadTitle, item.ownerName].some((value) => String(value ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    .sort((a, b) => {
      if (view === "completed") return (Date.parse(String(b.completedAt ?? b.updatedAt)) || 0) - (Date.parse(String(a.completedAt ?? a.updatedAt)) || 0);
      return (Date.parse(String(a.dueAt)) || Infinity) - (Date.parse(String(b.dueAt)) || Infinity);
    }), [followUps, search, view]);

  return <div className={styles.workspace}><CrmProductShell title="Follow-ups" description="" canView={initialData.canView} useWorkspaceColors headerClassName={styles.heading} actions={<>
    <label className={styles.search}><Search size={16} /><input aria-label="Search follow-ups" placeholder="Search client or notes…" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <IconButton aria-label="Refresh follow-ups" isDisabled={busy} onPress={() => void reload()}><RefreshCw size={16} /></IconButton>
    <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus size={15} />Add follow-up</Button>
  </>}>
    <div className={styles.toolbar}><div className={styles.views} aria-label="Follow-up views" role="group">{(["todo", "completed", "all"] as const).map((item) => <button aria-pressed={view === item} key={item} onClick={() => setView(item)} type="button">{item === "todo" ? "To do" : item === "completed" ? "Completed" : "All"} <span>{counts[item]}{cursor ? "+" : ""}</span></button>)}</div><Link href="/workspace/crm/calendar"><CalendarDays size={15} />Open calendar</Link></div>
    {failure ? <Callout title="Could not load follow-ups" tone="warning">{failure}<Button size="compact" onPress={() => void reload()}>Retry</Button></Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {visible.length ? <div className={styles.groups} role="group" aria-label="Follow-up board">{groups.filter(group => view === "all" || (view === "completed" ? group === "Completed" : !["Completed", "Cancelled"].includes(group))).map((group) => {
      const groupItems = visible.filter((item) => followUpGroup(item, now, timeZone) === group);
      return <section className={styles.group} data-group={group} key={group} aria-label={`${group} follow-ups`}><h2 data-overdue={group === "Overdue" || undefined}>{group}<span>{groupItems.length}</span></h2><ul>{groupItems.map((item) => {
        const Icon = item.status === "completed" ? Check : item.type === "call" ? Phone : item.type === "meeting" ? CalendarDays : BellRing;
        const due = Date.parse(String(item.dueAt));
        return <li key={item.id}><button className={styles.row} type="button" onClick={() => setSelected(item.id)} aria-label={`Open follow-up: ${String(item.title)}${item.partyName ? ` · ${String(item.partyName)}` : ""}`}>
          <span className={styles.cardTop}><span className={styles.icon} data-overdue={group === "Overdue" || undefined}><Icon size={14} /></span><small>{item.type === 'call' ? 'Call' : item.type === 'meeting' ? 'Meeting' : 'Follow-up'}</small></span>
          <span className={styles.identity}><strong>{String(item.partyName ?? item.leadTitle ?? item.title)}</strong><span>{String(item.title)}</span></span>
          {item.description ? <span className={styles.note}>{String(item.description)}</span> : null}
          <span className={styles.cardBottom}><span className={styles.due} data-overdue={group === 'Overdue' || undefined}>{Number.isFinite(due) ? <time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(due)}</time> : <span>No date yet</span>}</span>{item.ownerName ? <Avatar size="sm" name={String(item.ownerName)} /> : null}</span>
        </button></li>;
      })}</ul>{!groupItems.length ? <p className={styles.columnEmpty}>No follow-ups</p> : null}</section>;
    })}</div> : <div className={styles.empty}><Clock3 size={26} /><h2>{search ? "No matching follow-ups" : view === "todo" ? "You're all caught up" : "No follow-ups here yet"}</h2><p>{search ? "Try a client name or a word from your notes." : cursor ? "Load more to check older reminders." : "Add a follow-up when there’s a next step with a client."}</p>{!search && view === "todo" && !cursor ? <Button size="compact" onPress={() => setCreating(true)}>Add follow-up</Button> : null}</div>}
    <div className={styles.footer}><small>Times in {timeZone}{cursor ? " · More follow-ups are available" : ""}</small>{cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>Load more follow-ups</Button> : null}</div>
    {creating ? <NewFollowUpDialog workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onCreated={(record) => { saved(record); setView("todo"); setSearch(""); setCreating(false); }} /> : null}
    {selected ? <FollowUpSheet key={selected} recordId={selected} summary={items.find((item) => item.id === selected)} workspaceId={initialData.workspaceId} onClose={() => setSelected(undefined)} onSaved={saved} /> : null}
  </CrmProductShell></div>;
}
