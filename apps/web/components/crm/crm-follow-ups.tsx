"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, DataGrid, IconButton, type DataGridColumn } from "@/design-system";
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

function columnsFor(now: number, timeZone: string): DataGridColumn<RecordData>[] {
  return [
    { accessorKey: "title", header: "Follow-up", size: 285, meta: { primary: true }, cell: ({ row }) => <span className={styles.identity}><strong>{String(row.original.title ?? "Untitled follow-up")}</strong><small>{String(row.original.description ?? "")}</small></span> },
    { accessorKey: "partyName", header: "Customer", size: 200, cell: ({ row }) => String(row.original.partyName ?? row.original.leadTitle ?? "Not linked") },
    { accessorKey: "type", header: "Type", size: 115, cell: ({ row }) => String(row.original.type === "call" ? "Call" : row.original.type === "meeting" ? "Meeting" : "Task") },
    { id: "when", accessorFn: (row) => String(row.dueAt ?? ""), header: "Due", size: 170, cell: ({ row }) => { const item = row.original; const due = Date.parse(String(item.dueAt ?? "")); return Number.isFinite(due) ? <time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(due)}</time> : <span className={styles.muted}>No date yet</span>; } },
    { id: "priority", accessorFn: (row) => followUpGroup(row, now, timeZone), header: "Status", size: 125, cell: ({ row }) => { const group = followUpGroup(row.original, now, timeZone); return <Badge tone={group === "Overdue" ? "danger" : group === "Completed" ? "success" : group === "Today" ? "info" : "neutral"}>{group}</Badge>; } },
    { accessorKey: "ownerName", header: "Owner", size: 160, cell: ({ row }) => String(row.original.ownerName ?? "Unassigned") },
  ];
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
    if (fetching.current || more && !cursor) return;
    fetching.current = true; setBusy(true); setFailure("");
    try {
      const payload = await crmRequest<{ data: RecordData[]; nextCursor: string | null }>(initialData.workspaceId, `activities?limit=100${more ? `&cursor=${encodeURIComponent(cursor ?? "")}` : ""}`);
      setItems((old) => more ? [...old, ...payload.data.filter((item) => !old.some((existing) => existing.id === item.id))] : payload.data);
      setCursor(payload.nextCursor ?? null);
    } catch (error) { setFailure((error as Error).message); }
    finally { fetching.current = false; setBusy(false); }
  };
  const saved = (record: RecordData) => {
    setItems((old) => old.some((item) => item.id === record.id) ? old.map((item) => item.id === record.id ? { ...item, ...record } : item) : [record, ...old]);
    setNotice(record.status === "completed" ? "Follow-up completed." : "Follow-up saved. Its reminder is available in Today and Calendar.");
  };
  const followUps = useMemo(() => items.filter((item) => item.type !== "note"), [items]);
  const counts = { todo: followUps.filter((item) => item.status === "pending").length, completed: followUps.filter((item) => item.status === "completed").length, all: followUps.length };
  const visible = useMemo(() => followUps.filter((item) => view === "all" || item.status === (view === "todo" ? "pending" : "completed"))
    .filter((item) => !search.trim() || [item.title, item.description, item.partyName, item.leadTitle, item.ownerName].some((value) => String(value ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    .sort((a, b) => {
      const priority = (item: RecordData) => ({ Overdue: 0, Today: 1, Upcoming: 2, "No date yet": 3, Completed: 4, Cancelled: 5 })[followUpGroup(item, now, timeZone)];
      const statusOrder = priority(a) - priority(b);
      if (statusOrder) return statusOrder;
      if (a.status === "completed" && b.status === "completed") return Date.parse(String(b.completedAt ?? b.updatedAt ?? "")) - Date.parse(String(a.completedAt ?? a.updatedAt ?? ""));
      return (Date.parse(String(a.dueAt ?? "")) || Number.MAX_SAFE_INTEGER) - (Date.parse(String(b.dueAt ?? "")) || Number.MAX_SAFE_INTEGER);
    }), [followUps, now, search, timeZone, view]);
  const columns = useMemo(() => columnsFor(now, timeZone), [now, timeZone]);
  const views = [
    { id: "todo", label: `To do (${counts.todo}${cursor ? "+" : ""})` },
    { id: "completed", label: `Completed (${counts.completed}${cursor ? "+" : ""})` },
    { id: "all", label: `All (${counts.all}${cursor ? "+" : ""})` },
  ];

  return <CrmProductShell title="Follow-ups" description="" canView={initialData.canView} useWorkspaceColors actions={<div className={styles.actions}>
    <Link href="/workspace/crm/calendar" className={styles.calendarLink}><CalendarDays aria-hidden="true" size={15} />Open calendar</Link>
    <IconButton aria-label="Refresh follow-ups" isDisabled={busy} onPress={() => void reload()}><RefreshCw size={16} /></IconButton>
    <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus size={15} />Add follow-up</Button>
  </div>}>
    {failure ? <Callout title="Could not load follow-ups" tone="warning">{failure}<Button size="compact" onPress={() => void reload()}>Retry</Button></Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    <DataGrid
      ariaLabel="Follow-ups"
      columns={columns}
      data={visible}
      emptyTitle={search ? "No matching follow-ups" : view === "todo" ? "You're all caught up" : "No follow-ups here yet"}
      emptyDescription={search ? "Try a customer name or a word from your notes." : "Add a follow-up when there’s a next step with a customer."}
      exportFileName="wodana-follow-ups.csv"
      footerActions={cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>Load more follow-ups</Button> : undefined}
      getRowId={(item) => String(item.id)}
      hasMoreRows={Boolean(cursor)}
      onRowAction={(item) => setSelected(String(item.id))}
      pageSize={25}
      persistKey="crm-follow-ups"
      rowNumbers={false}
      savedViews={views}
      searchLabel="Search follow-ups"
      searchValue={search}
      onSearchChange={setSearch}
      selectable={false}
      selectedView={view}
      onViewChange={(id) => setView(id as FollowUpView)}
    />
    <p className={styles.timeZone}>Times in {timeZone}{cursor ? " · More follow-ups are available" : ""}</p>
    {creating ? <NewFollowUpDialog workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onCreated={(record) => { saved(record); setView("todo"); setSearch(""); setCreating(false); }} /> : null}
    {selected ? <FollowUpSheet key={selected} recordId={selected} summary={items.find((item) => item.id === selected)} workspaceId={initialData.workspaceId} onClose={() => setSelected(undefined)} onSaved={saved} /> : null}
  </CrmProductShell>;
}
