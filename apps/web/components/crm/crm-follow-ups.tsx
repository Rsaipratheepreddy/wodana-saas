"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, Filter, Plus, RefreshCw, Phone, CheckSquare, UserRound } from "lucide-react";
import { Avatar, Badge, Button, Callout, DataGrid, IconButton, SearchInput, SelectField, type DataGridColumn } from "@/design-system";
import {FollowUpKanban} from './follow-up-kanban';
import boardStyles from '../projects/global-work-board.module.css';
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell } from "./crm-product-shell";
import { FollowUpSheet, NewFollowUpDialog } from "./follow-up-editor";
import { calendarDayKey } from "@/lib/crm/calendar";
import { FollowUpTimeline } from "./follow-up-timeline";
import styles from "./crm-follow-ups.module.css";

type FollowUpView = "todo" | "completed" | "all";
const groups = ["Overdue", "Today", "Upcoming", "In progress", "Completed", "Cancelled"] as const;
const subscribe = () => () => {};
const subscribeToClock = (update: () => void) => { const timer = window.setInterval(update, 1_000); return () => window.clearInterval(timer); };
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const ownerKey = (item: RecordData) => String(item.ownerMembershipId ?? '').trim() || (item.ownerName ? `name:${String(item.ownerName).trim().toLocaleLowerCase()}` : '');

export function followUpGroup(item: RecordData, now: number, timeZone: string): typeof groups[number] {
  if (item.status === "completed") return "Completed";
  if (item.status === "cancelled") return "Cancelled";
  const due = Date.parse(String(item.dueAt ?? ""));
  if (!Number.isFinite(due)) return "In progress";
  if (due < now) return "Overdue";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return day.format(due) === day.format(now) ? "Today" : "Upcoming";
}

function columnsFor(now: number, timeZone: string): DataGridColumn<RecordData>[] {
  return [
    { accessorKey: "title", header: "Follow-up", size: 285, meta: { primary: true }, cell: ({ row }) => <span className={styles.followUpCell}><span className={styles.typeIcon} aria-hidden="true">{row.original.type === "call" ? <Phone size={15} /> : row.original.type === "meeting" ? <CalendarDays size={15} /> : <CheckSquare size={15} />}</span><span className={styles.identity}><strong>{String(row.original.title ?? "Untitled follow-up")}</strong>{row.original.description ? <small>{String(row.original.description)}</small> : null}</span></span> },
    { accessorKey: "partyName", header: "Customer", size: 200, cell: ({ row }) => row.original.partyName ? <span className={styles.personCell}><Avatar name={String(row.original.partyName)} size="sm" /><span>{String(row.original.partyName)}</span></span> : <span className={styles.muted}>{String(row.original.leadTitle ?? "Not linked")}</span> },
    { accessorKey: "type", header: "Type", size: 115, cell: ({ row }) => String(row.original.type === "call" ? "Call" : row.original.type === "meeting" ? "Meeting" : "Task") },
    { id: "when", accessorFn: (row) => String(row.dueAt ?? ""), header: "Due", size: 170, cell: ({ row }) => { const item = row.original; const due = Date.parse(String(item.dueAt ?? "")); return Number.isFinite(due) ? <time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(due)}</time> : <span className={styles.muted}>No date yet</span>; } },
    { id: "priority", accessorFn: (row) => followUpGroup(row, now, timeZone), header: "Status", size: 125, cell: ({ row }) => { const group = followUpGroup(row.original, now, timeZone); return <Badge tone={group === "Overdue" ? "danger" : group === "Completed" ? "success" : group === "Today" ? "info" : "neutral"}>{group}</Badge>; } },
    { accessorKey: "ownerName", header: "Owner", size: 160, cell: ({ row }) => <span className={styles.personCell}>{row.original.ownerName ? <Avatar name={String(row.original.ownerName)} size="sm" /> : <UserRound size={16} aria-hidden="true" />}<span className={!row.original.ownerName ? styles.muted : undefined}>{String(row.original.ownerName ?? "Unassigned")}</span></span> },
  ];
}

export function CrmFollowUps({ initialData, initialRecordId, initialLayout = "timeline", tasksOnly = false }: { tasksOnly?: boolean; initialLayout?: "timeline" | "list" | "kanban"; initialData: CrmScreenPageData; initialRecordId?: string }) {
  const [items, setItems] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [view, setView] = useState<FollowUpView>(tasksOnly ? "all" : "todo");
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<"timeline" | "list" | "kanban">(initialLayout);
  const [sort, setSort] = useState("due");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const peopleMenu = useRef<HTMLDetailsElement | null>(null);
  const [day, setDay] = useState(() => calendarDayKey(new Date(initialData.referenceTime)));
  const [createTime, setCreateTime] = useState("10:00");
  const [revision, setRevision] = useState(0);
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
    setRevision(value => value + 1);
    if (record.dueAt) setDay(calendarDayKey(new Date(String(record.dueAt))));
    setItems((old) => old.some((item) => item.id === record.id) ? old.map((item) => item.id === record.id ? { ...item, ...record } : item) : [record, ...old]);
    setNotice(record.status === "completed" ? "Follow-up completed." : "Follow-up saved. Its reminder is available in Today and Calendar.");
  };
  const followUps = useMemo(() => items.filter((item) => item.type !== "note" && (!tasksOnly || item.type === "task")), [items, tasksOnly]);
  const counts = { todo: followUps.filter((item) => item.status === "pending").length, completed: followUps.filter((item) => item.status === "completed").length, all: followUps.length };
  const visible = useMemo(() => followUps.filter((item) => view === "all" || item.status === (view === "todo" ? "pending" : "completed"))
    .filter((item) => !ownerFilter || (ownerFilter === 'unassigned' ? !ownerKey(item) : ownerKey(item) === ownerFilter))
    .filter((item) => !search.trim() || [item.title, item.description, item.partyName, item.leadTitle, item.ownerName].some((value) => String(value ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    .sort((a, b) => {
      if (sort === "customer") return String(a.partyName ?? a.leadTitle ?? "").localeCompare(String(b.partyName ?? b.leadTitle ?? ""));
      if (sort === "title") return String(a.title ?? "").localeCompare(String(b.title ?? ""));
      const priority = (item: RecordData) => ({ Overdue: 0, Today: 1, Upcoming: 2, "In progress": 3, Completed: 4, Cancelled: 5 })[followUpGroup(item, now, timeZone)];
      const statusOrder = priority(a) - priority(b);
      if (statusOrder) return statusOrder;
      if (a.status === "completed" && b.status === "completed") return Date.parse(String(b.completedAt ?? b.updatedAt ?? "")) - Date.parse(String(a.completedAt ?? a.updatedAt ?? ""));
      return (Date.parse(String(a.dueAt ?? "")) || Number.MAX_SAFE_INTEGER) - (Date.parse(String(b.dueAt ?? "")) || Number.MAX_SAFE_INTEGER);
    }), [followUps, now, ownerFilter, search, sort, timeZone, view]);
  const boardOwners = useMemo(() => [...new Map(followUps.map(item => [ownerKey(item), String(item.ownerName ?? 'Assigned person').trim()] as const).filter(([id]) => Boolean(id))).entries()].map(([id,name]) => ({id,name})).sort((a,b) => a.name.localeCompare(b.name)), [followUps]);
  const matchingOwners = boardOwners.filter(owner => owner.name.toLocaleLowerCase().includes(peopleSearch.trim().toLocaleLowerCase()));
  const selectedOwner = boardOwners.find(owner => owner.id === ownerFilter);
  const selectOwner = (id: string) => { setOwnerFilter(id); setView('all'); setPeopleSearch(''); if (peopleMenu.current) peopleMenu.current.open = false; };
  const columns = useMemo(() => columnsFor(now, timeZone), [now, timeZone]);
  const views = [
    { id: "todo", label: `To do (${counts.todo}${cursor ? "+" : ""})` },
    { id: "completed", label: `Completed (${counts.completed}${cursor ? "+" : ""})` },
    { id: "all", label: `All (${counts.all}${cursor ? "+" : ""})` },
  ];

  const actions = <div className={styles.actions}>
    {!tasksOnly?<Link href="/workspace/crm/follow-ups?view=schedule" className={styles.calendarLink}><CalendarDays aria-hidden="true" size={15} />Open schedule</Link>:null}
    <IconButton size="compact" aria-label="Refresh follow-ups" isDisabled={busy} onPress={() => { void reload(); setRevision(value => value + 1); }}><RefreshCw size={15} /></IconButton>
    <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus size={15} />{tasksOnly?'Add task':'Add follow-up'}</Button>
  </div>;
  return <CrmProductShell title="Calendar" description="" canView={initialData.canView} useWorkspaceColors pageClassName={tasksOnly?boardStyles.page:styles.page}>
    {failure ? <Callout title="Could not load follow-ups" tone="warning">{failure}<Button size="compact" onPress={() => void reload()}>Retry</Button></Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {!creating && !selected ? <>{tasksOnly?<div className={boardStyles.boardHeader}><nav aria-label="Task boards" className={boardStyles.boardSwitcher}><Link aria-current="page" href="/workspace/crm/follow-ups?view=activity">Sales</Link><Link href="/workspace/tasks">Projects</Link></nav></div>:null}
    {layout === "timeline" ? <FollowUpTimeline workspaceId={initialData.workspaceId} onList={() => setLayout("list")} day={day} onDayChange={setDay} now={now} revision={revision} onCreate={(time) => { setCreateTime(time ?? "10:00"); setCreating(true); }} onOpen={record => { setItems(old => old.some(item => item.id === record.id) ? old.map(item => item.id === record.id ? record : item) : [...old, record]); setSelected(String(record.id)); }} /> : layout === "kanban" ? <><div className={boardStyles.toolbar}><SearchInput label="Search sales tasks" placeholder="Search tasks…" value={search} onChange={setSearch}/><SelectField label="Sort by" selectedKey={sort} items={[{id:'due',label:'Due date'},{id:'customer',label:'Customer'},{id:'title',label:'Title'}]} onSelectionChange={key=>setSort(String(key))}/><details className={boardStyles.filterMenu}><summary><Filter size={15} aria-hidden="true"/>Filter</summary><div className={boardStyles.filterPanel}><div className={boardStyles.group} role="group" aria-label="Sales task filter">{views.map(item=><Button key={item.id} size="compact" variant={view===item.id?"primary":"secondary"} aria-pressed={view===item.id} onPress={()=>setView(item.id as FollowUpView)}>{item.label}</Button>)}</div></div></details><div className={boardStyles.boardPeople}><div className={boardStyles.peopleAvatars} role="group" aria-label="Filter sales tasks by assignee">{boardOwners.slice(0,5).map((owner,index)=><button key={owner.id} type="button" className={boardStyles.personButton} aria-label={`Show tasks assigned to ${owner.name}`} aria-pressed={ownerFilter===owner.id} title={owner.name} onClick={()=>selectOwner(ownerFilter===owner.id?'':owner.id)}><Avatar name={owner.name} size="sm" colorVariant={index}/></button>)}</div><details ref={peopleMenu} className={boardStyles.peoplePicker} data-selected={Boolean(ownerFilter&&!boardOwners.slice(0,5).some(owner=>owner.id===ownerFilter))}><summary aria-label="Choose sales assignee" title={selectedOwner?`Filtering by ${selectedOwner.name}`:ownerFilter==='unassigned'?'Filtering by Unassigned':'Choose assignee'}>{boardOwners.length>5?`+${boardOwners.length-5}`:'+'}</summary><div className={boardStyles.peopleMenu}><SearchInput label="Search sales assignees" placeholder="Search people…" value={peopleSearch} onChange={setPeopleSearch}/><button type="button" className={boardStyles.peopleOption} aria-pressed={!ownerFilter&&view==='all'} onClick={()=>selectOwner('')}>All assignees</button><button type="button" className={boardStyles.peopleOption} aria-pressed={ownerFilter==='unassigned'} onClick={()=>selectOwner('unassigned')}>Unassigned</button>{matchingOwners.map(owner=><button key={owner.id} type="button" className={boardStyles.peopleOption} aria-label={owner.name} aria-pressed={ownerFilter===owner.id} onClick={()=>selectOwner(owner.id)}><Avatar name={owner.name} size="sm"/>{owner.name}</button>)}{!matchingOwners.length&&<p className={boardStyles.peopleEmpty}>No people found</p>}</div></details></div>{actions}</div><FollowUpKanban groups={(["Overdue","Today","Upcoming","In progress","Completed"] as const).map(title=>({title,items:visible.filter(item=>{const group=followUpGroup(item,now,timeZone);return group===title||(title==="Completed"&&group==="Cancelled");})}))} timeZone={timeZone} onOpen={setSelected}/>{cursor&&<Button size="compact" isLoading={busy} onPress={()=>void reload(true)}>Load more follow-ups</Button>}</> : <DataGrid
      ariaLabel="Follow-ups"
      toolbarActions={actions}
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
    />}
    <p className={styles.timeZone}>Times in {timeZone}{cursor ? " · More follow-ups are available" : ""}</p></> : null}
    {creating ? <NewFollowUpDialog initialType={tasksOnly ? "task" : "call"} inline={layout === "timeline"} initialSchedule={{ date: day, time: createTime }} workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onCreated={(record) => { saved(record); setView("todo"); setSearch(""); setCreating(false); }} /> : null}
    {selected ? <FollowUpSheet inline={layout === "timeline"} key={selected} recordId={selected} summary={items.find((item) => item.id === selected)} workspaceId={initialData.workspaceId} onClose={() => setSelected(undefined)} onSaved={saved} /> : null}
  </CrmProductShell>;
}
