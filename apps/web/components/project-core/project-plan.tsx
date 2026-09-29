"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import {
  Avatar, Button, DateField, FormDialog, FormRow, EmptyState, ErrorState, GroupedTable, IconMenuButton, InlineNotice, Kanban, MenuButton, PillTabs, SearchInput, SegmentedControl,
  SelectField, Skeleton, Switch, TextInput, type GroupedTableSection,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { PackagePlan, WorkBoard, WorkItem, WorkStatus, WorkType } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { PlanSprints } from "./plan-sprints";
import { PlanTimeline } from "./plan-timeline";
import { useSupplyLabels } from "./project-scope";
import { AwayChip, BOARD_STATUSES, TypeIcon, isOpen, useWorkLabels } from "./work-labels";
import { useWorkColumns, type WorkRow } from "./work-columns";
import { WorkSheet } from "./work-sheet";
import styles from "./work.module.css";

type View = "list" | "board" | "timeline" | "sprints";
const VIEWS: View[] = ["list", "board", "timeline", "sprints"];
type Row = WorkRow;
/** Quick filters: what can start today, what's held up, what's late, snags, the client's requests, mine. */
type Filter = "all" | "ready" | "blocked" | "materials" | "late" | "snags" | "requests" | "mine";
const FILTERS: Filter[] = ["all", "ready", "blocked", "materials", "late", "snags", "requests", "mine"];

/**
 * The project's plan: every task and issue, as a list grouped by package or as a board by status.
 * A row opens the item's panel; "New task" adds one. Done work sits at the end of the list.
 */
export function ProjectPlan({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const t = useT();
  const labels = useWorkLabels();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [board, setBoard] = useState<WorkBoard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [who, setWho] = useState<string>("everyone");
  // Home's "New task" opens the new-task dialog on arrival (`?new=task`).
  const [creating, setCreating] = useState(() => params.get("new") === "task");
  const requested = params.get("view");
  const view: View = VIEWS.includes(requested as View) ? requested as View : "list";
  const [sprintFilter, setSprintFilter] = useState<string>("all");
  const requestedFilter = params.get("filter") ?? (params.get("type") === "snag" ? "snags" : params.get("type") === "client_request" ? "requests" : null);
  const filter: Filter = FILTERS.includes(requestedFilter as Filter) ? requestedFilter as Filter : "all";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDue, setBulkDue] = useState(false);
  const format = useProjectFormat();
  const [baselining, setBaselining] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [critical, setCritical] = useState(false);
  const open = params.get("item");
  const root = useRef<HTMLDivElement>(null);
  const canCreate = Boolean(board?.canEdit);
  // Keys on the list: j/k move between rows, Enter opens one, n adds a task, / searches (never while typing or in a dialog).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !root.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']")) return;
      if (event.key === "/") {
        const search = root.current.querySelector<HTMLInputElement>("input");
        if (search) { event.preventDefault(); search.focus(); }
      } else if (event.key === "n" && canCreate) {
        event.preventDefault(); setCreating(true);
      } else if (event.key === "j" || event.key === "k") {
        const rows = [...root.current.querySelectorAll<HTMLElement>("tr[data-actionable]")];
        if (!rows.length) return;
        const at = rows.indexOf(document.activeElement as HTMLElement);
        const next = rows[at < 0 ? 0 : event.key === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)];
        event.preventDefault(); next.focus(); next.scrollIntoView?.({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCreate]);

  const load = useCallback(async () => {
    try { setBoard(await api.work(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The plan didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const navigate = useCallback((next: { view?: View; item?: string | null; filter?: Filter }) => {
    const query = new URLSearchParams(params.toString());
    if (next.view) { if (next.view === "list") query.delete("view"); else query.set("view", next.view); }
    if (next.filter) { if (next.filter === "all") query.delete("filter"); else query.set("filter", next.filter); }
    if (next.item !== undefined) { if (next.item) query.set("item", next.item); else query.delete("item"); }
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const filtered = useMemo(() => {
    if (!board) return [];
    const needle = search.trim().toLocaleLowerCase().replace(/^#/, "");
    // Subtasks go with their task's sprint.
    const sprintOf = (item: WorkItem) => (item.parentId ? board.items.find((parent) => parent.id === item.parentId)?.sprintId ?? null : item.sprintId);
    const today = format.today();
    const quick = (item: WorkItem) => {
      const open = isOpen(item.status);
      switch (filter) {
        case "ready": return item.status === "todo" && !item.blockedBy.length && !(board.materials[item.id]?.length) && (!item.startDate || item.startDate <= today);
        case "blocked": return open && item.blockedBy.length > 0;
        case "materials": return open && Boolean(board.materials[item.id]?.length);
        case "late": return open && Boolean(item.dueDate && item.dueDate < today);
        case "snags": return open && item.type === "snag";
        case "requests": return open && item.type === "client_request";
        case "mine": return item.assigneeId === board.me;
        default: return true;
      }
    };
    return board.items.filter((item) => item.status !== "cancelled" && quick(item)
      && (who === "everyone" || (who === "me" ? item.assigneeId === board.me : who === "none" ? !item.assigneeId : item.assigneeId === who))
      && (sprintFilter === "all" || (sprintFilter === "backlog" ? !sprintOf(item) : sprintOf(item) === sprintFilter))
      && (!needle || item.title.toLocaleLowerCase().includes(needle) || String(item.number) === needle));
  }, [board, search, who, sprintFilter, filter, format]);

  if (error && !board) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!board) return <Skeleton lines={6} shape="rows" />;

  const runWork = async (action: string, input: Record<string, unknown> = {}) => {
    setNotice("");
    try { setBoard(await api.workCommand(projectId, action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  };
  const openSprints = board.sprints.filter((sprint) => sprint.status !== "closed");
  const sprintLabel = sprintFilter === "all" ? t("All sprints") : sprintFilter === "backlog" ? t("Backlog") : board.sprints.find((sprint) => sprint.id === sprintFilter)?.name ?? t("All sprints");
  /** One change to every selected item, each checked against its own version. */
  const bulk = async (changes: Record<string, unknown>) => {
    const items = [...selected].map((id) => board.items.find((item) => item.id === id)).filter((item): item is WorkItem => Boolean(item)).map((item) => ({ id: item.id, version: item.version }));
    if (!items.length) return false;
    const ok = await runWork("bulk_update", { items, changes });
    if (ok) setSelected(new Set());
    return ok;
  };
  const today = format.today();
  const live = board.items.filter((item) => isOpen(item.status));
  const counts: Record<Filter, number> = {
    all: 0,
    ready: live.filter((item) => item.status === "todo" && !item.blockedBy.length && !(board.materials[item.id]?.length) && (!item.startDate || item.startDate <= today)).length,
    blocked: live.filter((item) => item.blockedBy.length > 0).length,
    materials: live.filter((item) => board.materials[item.id]?.length).length,
    late: live.filter((item) => item.dueDate && item.dueDate < today).length,
    snags: live.filter((item) => item.type === "snag").length,
    requests: live.filter((item) => item.type === "client_request").length,
    mine: live.filter((item) => item.assigneeId === board.me).length,
  };
  const filterLabels: Record<Filter, string> = { all: t("All"), ready: t("Ready to start"), blocked: t("Blocked"), materials: t("Materials not in"), late: t("Late"),
    snags: t("Snags"), requests: t("Client requests"), mine: t("Mine") };
  const move = async (item: WorkItem, status: WorkStatus) => {
    if (item.status === status) return;
    setNotice("");
    try { setBoard(await api.workCommand(projectId, "update", { itemId: item.id, version: item.version, status })); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const people = board.people.length ? board.people : [...new Map(board.items.filter((item) => item.assigneeId).map((item) => [item.assigneeId!, { membershipId: item.assigneeId!, name: item.assigneeName ?? "" }])).values()];
  const whoLabel = who === "everyone" ? t("Everyone") : who === "me" ? t("Assigned to me") : who === "none" ? t("No one") : people.find((person) => person.membershipId === who)?.name ?? t("Everyone");
  const empty = !board.items.some((item) => item.status !== "cancelled");
  const unplanned = board.packages.filter((item) => !item.planned);
  const menu = [
    ...(board.canEdit && unplanned.length ? [{ id: "package", label: t("Plan a package") }] : []),
    ...(board.canManage && !empty ? [{ id: "baseline", label: board.baseline ? t("Reset the baseline") : t("Set the baseline") }] : []),
  ];
  // When the open work runs past the handover date, say by how much.
  const planEnd = board.items.filter((item) => isOpen(item.status)).map((item) => item.dueDate ?? item.startDate).filter((value): value is string => Boolean(value)).sort().at(-1);
  const overrun = planEnd && board.promiseDate && planEnd > board.promiseDate
    ? Math.round((Date.parse(`${planEnd}T00:00:00Z`) - Date.parse(`${board.promiseDate}T00:00:00Z`)) / 86_400_000) : 0;

  return <div className={styles.plan} ref={root}>
    <div className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        {view !== "sprints" ? <>
          <SearchInput label={t("Search the plan")} placeholder={t("Search")} value={search} onChange={setSearch} />
          <MenuButton size="compact" label={whoLabel} onAction={setWho}
            items={[{ id: "everyone", label: t("Everyone") }, ...(board.me ? [{ id: "me", label: t("Assigned to me") }] : []), { id: "none", label: t("No one") },
              ...people.filter((person) => person.membershipId !== board.me).map((person) => ({ id: person.membershipId, label: person.name }))]} />
          {openSprints.length ? <MenuButton size="compact" label={sprintLabel} onAction={setSprintFilter}
            items={[{ id: "all", label: t("All sprints") }, ...openSprints.map((sprint) => ({ id: sprint.id, label: sprint.status === "active" ? t("{name} (running)", { name: sprint.name }) : sprint.name })), { id: "backlog", label: t("Backlog") }]} /> : null}
        </> : null}
      </div>
      <div className={styles.toolbarGroup}>
        {view === "timeline" && !empty ? <Switch isSelected={critical} onChange={setCritical}>{t("Critical path")}</Switch> : null}
        <SegmentedControl label={t("View")} value={view} onChange={(value) => navigate({ view: value as View })}
          options={[{ id: "list", label: t("List") }, { id: "board", label: t("Board") }, { id: "timeline", label: t("Timeline") }, { id: "sprints", label: t("Sprints") }]} />
        {board.canEdit ? <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{t("New task")}</Button> : null}
        {menu.length ? <IconMenuButton ariaLabel={t("Plan actions")} onAction={(id) => (id === "baseline" ? setBaselining(true) : setPlanning(true))} items={menu} /> : null}
      </div>
    </div>
    {view !== "sprints" && !empty ? <PillTabs ariaLabel={t("Show")} layout="scroll" selectedKey={filter} onSelectionChange={(value) => { setSelected(new Set()); navigate({ filter: value as Filter }); }}
      items={FILTERS.map((id) => ({ id, label: filterLabels[id], count: id === "all" ? undefined : counts[id] || undefined }))} /> : null}
    {board.onHold ? <p className={styles.dialogText}>{t("On hold: only cancelling work and comments until it resumes.")}</p> : null}
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {overrun ? <p className={styles.risk}>{t("The plan ends {date}, {count} days after the handover date.", { date: format.day(planEnd!), count: overrun })}</p> : null}

    {view === "sprints" && !empty ? <PlanSprints board={board} api={api} projectId={projectId} run={runWork} onOpen={(id) => navigate({ item: id })} />
      : empty ? <EmptyState illustration={null} title={t("No work planned yet")} description={t("Break the project into tasks, give each one to someone and set when it's due.")}
        action={!board.canEdit ? undefined : unplanned.length ? <Button variant="primary" onPress={() => setPlanning(true)}>{t("Plan a package")}</Button>
          : <Button variant="primary" onPress={() => setCreating(true)}>{t("New task")}</Button>} />
      : !filtered.length ? <EmptyState illustration={null} title={t("Nothing matches")} action={<Button onPress={() => { setSearch(""); setWho("everyone"); setSprintFilter("all"); navigate({ filter: "all" }); }}>{t("Clear filters")}</Button>} />
      : view === "list" ? <PlanList board={board} items={filtered} onOpen={(item) => navigate({ item: item.id })} selected={board.canEdit ? selected : undefined} onSelect={setSelected} />
      : view === "timeline" ? <PlanTimeline board={board} items={filtered} critical={critical} onOpen={(id) => navigate({ item: id })} />
      : <Kanban<WorkItem> columns={BOARD_STATUSES.map((status) => ({ id: status, label: labels.status[status], items: filtered.filter((item) => item.status === status) }))}
          getId={(item) => item.id} getLabel={(item) => `#${item.number} ${item.title}`} onItemAction={(item) => navigate({ item: item.id })}
          onMove={board.canEdit ? (id, status) => { const item = board.items.find((entry) => entry.id === id); if (item) void move(item, status as WorkStatus); } : undefined}
          renderItem={(item) => <WorkCard item={item} parent={item.parentId ? board.items.find((entry) => entry.id === item.parentId) : undefined} />} />}

    {selected.size && board.canEdit ? <div className={styles.selectionBar} role="region" aria-label={t("Selected work")}>
      <span className={styles.muted}>{t("{count} selected", { count: selected.size })}</span>
      <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
      <span className={styles.selectionActions}>
        <MenuButton size="compact" label={t("Assign")} onAction={(id) => void bulk({ assigneeId: id === "__nobody" ? null : id })}
          items={[{ id: "__nobody", label: t("No one") }, ...board.people.map((person) => ({ id: person.membershipId, label: person.name }))]} />
        <Button size="compact" onPress={() => setBulkDue(true)}>{t("Due date")}</Button>
        {board.stages.length ? <MenuButton size="compact" label={t("Stage")} onAction={(id) => void bulk({ stageId: id })} items={board.stages.map((stage) => ({ id: stage.id, label: t(stage.name as never) }))} /> : null}
        {board.packages.length ? <MenuButton size="compact" label={t("Package")} onAction={(id) => void bulk({ packageId: id === "__none" ? null : id })}
          items={[{ id: "__none", label: t("No package") }, ...board.packages.map((item) => ({ id: item.id, label: item.name }))]} /> : null}
        {openSprints.length ? <MenuButton size="compact" label={t("Sprint")} onAction={(id) => void runWork("set_sprint", { itemIds: [...selected].filter((itemId) => !board.items.find((item) => item.id === itemId)?.parentId),
          sprintId: id === "backlog" ? null : id }).then((ok) => { if (ok) setSelected(new Set()); })}
          items={[...openSprints.map((sprint) => ({ id: sprint.id, label: sprint.name })), { id: "backlog", label: t("Backlog") }]} /> : null}
        <MenuButton size="compact" label={t("Status")} onAction={(id) => void bulk({ status: id })}
          items={(["todo", "in_progress", "in_review", "done"] as const).map((id) => ({ id, label: labels.status[id] }))} />
      </span>
    </div> : null}
    {bulkDue ? <BulkDueDialog count={selected.size} onClose={() => setBulkDue(false)} onSave={async (dueDate) => {
      const items = [...selected].map((id) => board.items.find((item) => item.id === id)).filter((item): item is WorkItem => Boolean(item)).map((item) => ({ id: item.id, version: item.version }));
      try { setBoard(await api.workCommand(projectId, "bulk_update", { items, changes: { dueDate } })); }
      catch (cause) { if (cause instanceof Error && "status" in cause && cause.status === 409) await load(); throw cause; }
      setSelected(new Set()); setBulkDue(false);
    }} /> : null}
    {open && board.items.some((item) => item.id === open) ? <WorkSheet api={api} projectId={projectId} itemId={open} board={board} onBoard={setBoard}
      onOpenItem={(id) => navigate({ item: id })} onClose={() => navigate({ item: null })} /> : null}
    {baselining ? <FormDialog size="md" title={board.baseline ? t("Reset the baseline") : t("Set the baseline")} onClose={() => setBaselining(false)} submitLabel={t("Save")}
      onSubmit={async () => { setBoard(await api.workCommand(projectId, "set_baseline")); setBaselining(false); }}>
      <p className={styles.dialogText}>{board.baseline
        ? t("Today's dates replace the baseline set on {date} by {name}.", { date: format.when(board.baseline.at), name: board.baseline.byName ?? "" })
        : t("Today's dates become the plan you measure slips against.")}</p>
    </FormDialog> : null}
    {planning ? <PlanPackageDialog board={board} load={(packageId, startDate) => api.packagePlan(projectId, packageId, startDate)} onClose={() => setPlanning(false)}
      onSave={async (packageId, startDate) => { setBoard(await api.workCommand(projectId, "plan_package", { packageId, startDate })); }} /> : null}
    {creating && board.canEdit ? <NewWorkDialog board={board} onClose={() => setCreating(false)} onCreate={async (input) => { setBoard(await api.workCommand(projectId, "create", input)); }} /> : null}
  </div>;
}

/** A card on the board: the item, whether it's blocked, when it's due and who has it. */
function WorkCard({ item, parent }: { item: WorkItem; parent?: WorkItem }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useWorkLabels();
  const due = item.dueDate && isOpen(item.status) ? format.until(item.dueDate) : null;
  const blocked = item.blockedBy.length > 0 && isOpen(item.status);
  return <div className={styles.card}>
    <span className={styles.cardTitle}><TypeIcon type={item.type} label={labels.type[item.type]} /><span className={styles.number}>#{item.number}</span>{item.title}</span>
    {parent ? <small className={styles.muted}>{t("Subtask of #{number}", { number: parent.number })}</small> : null}
    {blocked || item.dueDate || item.subtasks || item.assigneeName ? <span className={styles.cardMeta}>
      {blocked ? <span className={styles.blocked}>{t("Blocked")}</span> : null}
      {item.dueDate ? <span className={styles.muted} data-late={due?.late || undefined}>{format.day(item.dueDate)}</span> : null}
      {item.subtasks ? <span className={styles.muted}>{t("{done} of {count}", { done: item.subtasksDone, count: item.subtasks })}</span> : null}
      <AwayChip item={item} />
      <span className={styles.spacer} />
      {item.assigneeName ? <Avatar name={item.assigneeName} size="sm" /> : null}
    </span> : null}
  </div>;
}

/** Open work grouped by package, each task followed by its subtasks; finished work last. */
function PlanList({ board, items, onOpen, selected, onSelect }: { board: WorkBoard; items: WorkItem[]; onOpen: (item: WorkItem) => void; selected?: Set<string>; onSelect?: (ids: Set<string>) => void }) {
  const t = useT();
  const shown = new Set(items.map((item) => item.id));
  const withChildren = (list: WorkItem[]): Row[] => list.flatMap((item) => [
    { ...item, depth: 0 as const },
    ...items.filter((child) => child.parentId === item.id).map((child) => ({ ...child, depth: 1 as const })),
  ]);
  // A subtask shows under its task; on its own only when its task is filtered out.
  const top = items.filter((item) => !item.parentId || !shown.has(item.parentId));
  const open = top.filter((item) => isOpen(item.status));
  const done = top.filter((item) => item.status === "done").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const sections: GroupedTableSection<Row>[] = [
    ...board.packages.map((item) => ({ id: item.id, label: item.name, rows: withChildren(open.filter((row) => row.packageId === item.id)), emptyMessage: "" })),
    { id: "none", label: board.packages.length ? t("No package") : t("Open"), rows: withChildren(open.filter((row) => !row.packageId || !board.packages.some((item) => item.id === row.packageId))), emptyMessage: "" },
    { id: "done", label: t("Done"), rows: done.map((item) => ({ ...item, depth: 0 as const })), emptyMessage: "" },
  ].filter((section) => section.rows.length)
    .map((section) => {
      const label = `${section.label} · ${section.rows.filter((row) => row.depth === 0).length}`;
      const percent = board.progress.packages[section.id];
      return { ...section, label: percent === undefined ? label : t("{label} · {percent}% done", { label, percent }) };
    });
  const columns = useWorkColumns<Row>(board);
  // Open work can be selected to change in bulk; finished work can't.
  return <GroupedTable<Row> ariaLabel={t("Plan")} columns={columns} sections={sections} selectable={Boolean(selected && onSelect)} getRowId={(row) => row.id}
    selectedIds={selected} onSelectionChange={(ids) => onSelect?.(new Set([...ids].filter((id) => { const item = board.items.find((row) => row.id === id); return item && isOpen(item.status); })))}
    getRowLabel={(row) => `#${row.number} ${row.title}`} onRowAction={onOpen} />;
}

/** A new task, client request or snag: its title, who does it, when it's due and its package. */
function NewWorkDialog({ board, onClose, onCreate }: { board: WorkBoard; onClose: () => void; onCreate: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const labels = useWorkLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkType>("task");
  const [assigneeId, setAssigneeId] = useState<string | null>(board.me);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  return <FormDialog size="md" title={t("New task")} onClose={onClose} isDirty={Boolean(title.trim())} submitLabel={t("Save")} closeOnSuccess
    onSubmit={() => onCreate({ id, title: title.trim(), type, assigneeId, dueDate, packageId })}>
    <TextInput label={t("Title")} isRequired maxLength={240} value={title} onChange={setTitle} />
    <SegmentedControl label={t("Type")} value={type} onChange={(value) => setType(value as WorkType)}
      options={(["task", "client_request", "snag"] as const).map((option) => ({ id: option, label: labels.type[option] }))} />
    <FormRow>
      <SelectField label={t("Assignee")} placeholder={t("No one")} selectedKey={assigneeId} onSelectionChange={(key) => setAssigneeId(key === null ? null : String(key))}
        items={board.people.map((person) => ({ id: person.membershipId, label: person.membershipId === board.me ? t("{name} (me)", { name: person.name }) : person.name }))} />
      <DateField label={t("Due")} value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)} />
    </FormRow>
    {board.packages.length ? <SelectField label={t("Package")} placeholder={t("None")} selectedKey={packageId} onSelectionChange={(key) => setPackageId(key === null ? null : String(key))}
      items={board.packages.map((item) => ({ id: item.id, label: item.name }))} /> : null}
  </FormDialog>;
}

/**
 * Plans a package from the standard work for how it's delivered: the tasks in order on working days,
 * who does each (from the project team's roles) and its stage. Shown before anything is created.
 */
function PlanPackageDialog({ board, load, onClose, onSave }: {
  board: WorkBoard; load: (packageId: string, startDate: string | null) => Promise<PackagePlan>; onClose: () => void; onSave: (packageId: string, startDate: string) => Promise<void>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const supplies = useSupplyLabels();
  const options = board.packages.filter((item) => !item.planned);
  const [packageId, setPackageId] = useState<string | null>(options[0]?.id ?? null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [plan, setPlan] = useState<PackagePlan | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!packageId) return;
    let alive = true;
    load(packageId, startDate).then((next) => { if (alive) { setPlan(next); setError(""); } }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [load, packageId, startDate]);
  const shown = plan && plan.package.id === packageId ? plan : null;
  return <FormDialog size="lg" title={t("Plan a package")} onClose={onClose} isSubmitDisabled={!shown || !shown.tasks.length} submitLabel={t("Save")} closeOnSuccess
    onSubmit={async () => { if (shown) await onSave(shown.package.id, shown.startDate); }}>
      <FormRow>
        <SelectField label={t("Package")} isRequired selectedKey={packageId} onSelectionChange={(key) => setPackageId(key === null ? null : String(key))}
          items={options.map((item) => ({ id: item.id, label: `${item.name} · ${supplies[item.supply]}` }))} />
        <DateField label={t("Start")} value={shown ? parseDate(shown.startDate) : startDate ? parseDate(startDate) : null} onChange={(value) => setStartDate(value ? value.toString() : null)} />
      </FormRow>
      {error ? <InlineNotice tone="error" message={error} />
        : !shown ? <Skeleton lines={4} shape="rows" />
        : !shown.tasks.length ? <EmptyState illustration={null} title={t("No standard tasks for this kind of package")} description={t("Add them in Settings → Projects → Standard tasks.")} />
        : <ol className={styles.planList} aria-label={t("Tasks")}>
            {shown.tasks.map((task, index) => <li key={index}>
              <span>{task.title}</span>
              <span className={styles.muted}>{format.short(task.startDate)}{task.dueDate !== task.startDate ? ` – ${format.short(task.dueDate)}` : ""}</span>
              <span className={task.assigneeName ? undefined : styles.muted}>{task.assigneeName ?? (task.roleLabel ? t("No {role} named", { role: task.roleLabel.toLocaleLowerCase() }) : "—")}</span>
            </li>)}
          </ol>}
  </FormDialog>;
}

/** A new due date for the selected work. */
function BulkDueDialog({ count, onClose, onSave }: { count: number; onClose: () => void; onSave: (dueDate: string | null) => Promise<void> }) {
  const t = useT();
  const [dueDate, setDueDate] = useState<string | null>(null);
  return <FormDialog size="md" title={t("Due date for {count} items", { count })} onClose={onClose} isSubmitDisabled={!dueDate} submitLabel={t("Save")} onSubmit={() => onSave(dueDate)}>
    <DateField label={t("Due")} isRequired value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)} />
  </FormDialog>;
}
