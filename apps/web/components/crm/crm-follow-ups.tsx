"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import { Avatar, Badge, Button, Callout, DataGrid, EmptyState, IconButton, ListTabs, NoResultsState, OwnerCell, RecordName, SearchInput, SelectField, ToolbarSearch, useDesignSystem, useDetailsMenu, useWorkspaceZoneLabel, type DataGridColumn, type ToolbarFilter, TypeChip } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import {FollowUpKanban} from './follow-up-kanban';
import boardStyles from '../projects/global-work-board.module.css';
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell } from "./crm-product-shell";
import { FollowUpSheet, NewFollowUpDialog } from "./follow-up-editor";
import { zonedDateTime, zonedToday } from "@/lib/crm/zoned-time";
import { FollowUpTimeline } from "./follow-up-timeline";
import styles from "./crm-follow-ups.module.css";

type FollowUpView = "todo" | "completed" | "all";
const groups = ["Overdue", "Today", "Upcoming", "In progress", "Completed", "Cancelled"] as const;
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

function columnsFor(now: number, timeZone: string, locale: string, t: Translate): DataGridColumn<RecordData>[] {
  return [
    { id: "title", accessorFn: (row) => `${String(row.title ?? "")} ${String(row.partyName ?? row.leadTitle ?? "")}`, header: t("Follow-up"), size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={String(row.title ?? t("Untitled follow-up"))}
      detail={String(row.partyName ?? row.leadTitle ?? t("Not linked"))} /> } },
    { accessorKey: "type", header: t("Type"), size: 115, meta: { priority: "low" }, cell: ({ row }) => <TypeChip>{t(row.original.type === "call" ? "Call" : row.original.type === "meeting" ? "Meeting" : "Task")}</TypeChip> },
    { id: "when", accessorFn: (row) => String(row.dueAt ?? ""), header: t("Due"), size: 170, cell: ({ row }) => { const item = row.original; const due = Date.parse(String(item.dueAt ?? "")); return Number.isFinite(due) ? <time dateTime={String(item.dueAt)}>{new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(due)}</time> : <span className={styles.muted}>{t("No date yet")}</span>; } },
    { id: "priority", accessorFn: (row) => followUpGroup(row, now, timeZone), header: t("Status"), size: 125, cell: ({ row }) => { const group = followUpGroup(row.original, now, timeZone); return <Badge tone={group === "Overdue" ? "danger" : group === "Completed" ? "success" : group === "Today" ? "info" : "neutral"}>{t(group)}</Badge>; } },
    { accessorKey: "ownerName", header: t("Owner"), size: 160, meta: { priority: "medium", renderCell: (row) => <OwnerCell fallback={t("Unassigned")} person={row.ownerName ? String(row.ownerName) : null} /> } },
  ];
}

/** `initialCreate` opens Add follow-up (or Add task) at once, e.g. from ⌘K. */
export function CrmFollowUps({ initialData, initialRecordId, initialLayout = "timeline", tasksOnly = false, initialCreate = false }: { tasksOnly?: boolean; initialLayout?: "timeline" | "list" | "kanban"; initialData: CrmScreenPageData; initialRecordId?: string; initialCreate?: boolean }) {
  const t = useT();
  // Due times, "today" and the schedule are the workspace's (its region's zone), wherever the viewer is.
  const { locale, timeZone } = useDesignSystem();
  const zoneLabel = useWorkspaceZoneLabel();
  const [items, setItems] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [view, setView] = useState<FollowUpView>(tasksOnly ? "all" : "todo");
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<"timeline" | "list" | "kanban">(initialLayout);
  const [sort, setSort] = useState("due");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  // The assignee picker closes on a click outside or Esc like every menu; picking a person closes it too.
  const peopleMenu = useDetailsMenu({ closeOnChoose: true });
  const [day, setDay] = useState(() => zonedToday(timeZone, new Date(initialData.referenceTime)));
  const [createTime, setCreateTime] = useState("10:00");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(initialCreate && initialData.canView);
  const [selected, setSelected] = useState(initialRecordId);
  const [busy, setBusy] = useState(false);
  const fetching = useRef(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const now = useSyncExternalStore(subscribeToClock, currentMinute, () => Date.parse(initialData.referenceTime));

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
    if (record.dueAt) setDay(zonedDateTime(record.dueAt, timeZone).slice(0, 10));
    setItems((old) => old.some((item) => item.id === record.id) ? old.map((item) => item.id === record.id ? { ...item, ...record } : item) : [record, ...old]);
    setNotice(record.status === "completed" ? t("Follow-up completed.") : t("Follow-up saved. Its reminder is available in Today and Calendar."));
  };
  const followUps = useMemo(() => items.filter((item) => item.type !== "note" && (!tasksOnly || item.type === "task")), [items, tasksOnly]);
  const counts = { todo: followUps.filter((item) => item.status === "pending").length };
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
  const boardOwners = useMemo(() => [...new Map(followUps.map(item => [ownerKey(item), String(item.ownerName ?? t('Assigned person')).trim()] as const).filter(([id]) => Boolean(id))).entries()].map(([id,name]) => ({id,name})).sort((a,b) => a.name.localeCompare(b.name)), [followUps, t]);
  const matchingOwners = boardOwners.filter(owner => owner.name.toLocaleLowerCase().includes(peopleSearch.trim().toLocaleLowerCase()));
  const selectedOwner = boardOwners.find(owner => owner.id === ownerFilter);
  const selectOwner = (id: string) => { setOwnerFilter(id); setView('all'); setPeopleSearch(''); if (peopleMenu.ref.current) peopleMenu.ref.current.open = false; };
  const columns = useMemo(() => columnsFor(now, timeZone, locale, t), [now, timeZone, locale, t]);
  // To do asks for action, so only it shows a count.
  const tabs = layout === "timeline" ? undefined : <ListTabs label={t("Follow-up lists")} value={view} onChange={setView} items={[
    { id: "todo", label: t("To do"), count: counts.todo }, { id: "completed", label: t("Completed") }, { id: "all", label: t("All") }]} />;
  const filters: ToolbarFilter[] = [{ id: "owner", label: t("Owner"), options: [{ id: "unassigned", label: t("Unassigned") }, ...boardOwners.map(owner => ({ id: owner.id, label: owner.name }))],
    value: ownerFilter || undefined, onChange: (value) => setOwnerFilter(value ?? "") }];

  const actions = <div className={styles.actions}>
    {!tasksOnly?<Link href="/workspace/crm/follow-ups?view=schedule" className={styles.calendarLink}><CalendarDays aria-hidden="true" size={15} />{t("Open calendar")}</Link>:null}
    <IconButton size="compact" aria-label={t("Refresh follow-ups")} isDisabled={busy} onPress={() => { void reload(); setRevision(value => value + 1); }}><RefreshCw size={15} /></IconButton>
  </div>;
  // One primary action, top-end in the page header (S-20).
  const primary = <Button variant="primary" onPress={() => setCreating(true)}><Plus size={15} aria-hidden="true" />{tasksOnly ? t("Add task") : t("Add follow-up")}</Button>;
  // One name for the page in every layout: the list, the timeline and the Sales board are all Follow-ups (NV-1).
  return <CrmProductShell title={t("Follow-ups")} canView={initialData.canView} actions={primary} tabs={tabs} useWorkspaceColors>
    {failure ? <Callout title={t("Could not load follow-ups")} tone="warning">{failure}<Button size="compact" onPress={() => void reload()}>{t("Retry")}</Button></Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {!creating && !selected ? <>{tasksOnly?<div className={boardStyles.boardHeader}><nav aria-label={t("Task boards")} className={boardStyles.boardSwitcher}><Link aria-current="page" href="/workspace/crm/follow-ups?view=activity">{t("Sales")}</Link><Link href="/workspace/tasks">{t("Projects")}</Link></nav></div>:null}
    {layout === "timeline" ? <FollowUpTimeline workspaceId={initialData.workspaceId} onList={() => setLayout("list")} day={day} onDayChange={setDay} now={now} revision={revision} onCreate={(time) => { setCreateTime(time ?? "10:00"); setCreating(true); }} onOpen={record => { setItems(old => old.some(item => item.id === record.id) ? old.map(item => item.id === record.id ? record : item) : [...old, record]); setSelected(String(record.id)); }} /> : layout === "kanban" ? <><div className={boardStyles.toolbar}><ToolbarSearch label={t("Search sales tasks")} value={search} onChange={setSearch}/><SelectField label={t("Sort by")} selectedKey={sort} items={[{id:'due',label:t('Due date')},{id:'customer',label:t('Customer')},{id:'title',label:t('Title')}]} onSelectionChange={key=>setSort(String(key))}/><div className={boardStyles.boardPeople}><div className={boardStyles.peopleAvatars} role="group" aria-label={t("Filter sales tasks by assignee")}>{boardOwners.slice(0,5).map((owner,index)=><button key={owner.id} type="button" className={boardStyles.personButton} aria-label={t("Show tasks assigned to {name}", { name: owner.name })} aria-pressed={ownerFilter===owner.id} title={owner.name} onClick={()=>selectOwner(ownerFilter===owner.id?'':owner.id)}><Avatar name={owner.name} size="sm" colorVariant={index}/></button>)}</div><details ref={peopleMenu.ref} onClick={peopleMenu.onClick} className={boardStyles.peoplePicker} data-selected={Boolean(ownerFilter&&!boardOwners.slice(0,5).some(owner=>owner.id===ownerFilter))}><summary aria-label={t("Choose sales assignee")} title={selectedOwner?t("Filtering by {name}", { name: selectedOwner.name }):ownerFilter==='unassigned'?t('Filtering by Unassigned'):t('Choose assignee')}>{boardOwners.length>5?`+${boardOwners.length-5}`:'+'}</summary><div className={boardStyles.peopleMenu}><SearchInput label={t("Search sales assignees")} placeholder={t("Search people…")} value={peopleSearch} onChange={setPeopleSearch}/><button type="button" className={boardStyles.peopleOption} aria-pressed={!ownerFilter&&view==='all'} onClick={()=>selectOwner('')}>{t("All assignees")}</button><button type="button" className={boardStyles.peopleOption} aria-pressed={ownerFilter==='unassigned'} onClick={()=>selectOwner('unassigned')}>{t("Unassigned")}</button>{matchingOwners.map(owner=><button key={owner.id} type="button" className={boardStyles.peopleOption} aria-label={owner.name} aria-pressed={ownerFilter===owner.id} onClick={()=>selectOwner(owner.id)}><Avatar name={owner.name} size="sm"/>{owner.name}</button>)}{!matchingOwners.length&&<p className={boardStyles.peopleEmpty}>{t("No people found")}</p>}</div></details></div>{actions}</div><FollowUpKanban groups={(["Overdue","Today","Upcoming","In progress","Completed"] as const).map(title=>({title,items:visible.filter(item=>{const group=followUpGroup(item,now,timeZone);return group===title||(title==="Completed"&&group==="Cancelled");})}))} timeZone={timeZone} onOpen={setSelected}/>{cursor&&<Button size="compact" isLoading={busy} onPress={()=>void reload(true)}>{t("Load more follow-ups")}</Button>}</> : <DataGrid
      gridKey="crm.follow_ups"
      ariaLabel={t("Follow-ups")}
      columns={columns}
      data={visible}
      emptyContent={search.trim() || ownerFilter ? <NoResultsState onClear={() => { setSearch(""); setOwnerFilter(""); }} />
        : <EmptyState title={view === "todo" ? t("You're all caught up") : t("No follow-ups here yet")} action={<Button variant="primary" onPress={() => setCreating(true)}>{tasksOnly ? t("Add task") : t("Add follow-up")}</Button>} />}
      exportFileName="wodana-follow-ups.csv"
      filters={filters}
      footerActions={<>{cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more follow-ups")}</Button> : null}{actions}</>}
      getRowId={(item) => String(item.id)}
      hasMoreRows={Boolean(cursor)}
      onRowAction={(item) => setSelected(String(item.id))}
      pageSize={25}
      persistKey="crm-follow-ups"
      rowNumbers={false}
      searchLabel={t("Search follow-ups")}
      searchValue={search}
      onSearchChange={setSearch}
      selectable={false}
    />}
    {zoneLabel || cursor ? <p className={styles.timeZone}>{[zoneLabel ? t("Times in {zone}", { zone: zoneLabel }) : null, cursor ? t("More follow-ups are available") : null].filter(Boolean).join(" · ")}</p> : null}</> : null}
    {creating ? <NewFollowUpDialog initialType={tasksOnly ? "task" : "call"} inline={layout === "timeline"} initialSchedule={{ date: day, time: createTime }} workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onCreated={(record) => { saved(record); setView("todo"); setSearch(""); setCreating(false); }} /> : null}
    {selected ? <FollowUpSheet inline={layout === "timeline"} key={selected} recordId={selected} summary={items.find((item) => item.id === selected)} workspaceId={initialData.workspaceId} onClose={() => setSelected(undefined)} onSaved={saved} /> : null}
  </CrmProductShell>;
}
