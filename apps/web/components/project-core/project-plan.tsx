"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import {
  Avatar, Button, ControlledModalDialog, DateField, EmptyState, ErrorState, GroupedTable, IconMenuButton, InlineNotice, Kanban, MenuButton, SearchInput, SegmentedControl,
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
  const [creating, setCreating] = useState(false);
  const requested = params.get("view");
  const view: View = VIEWS.includes(requested as View) ? requested as View : "list";
  const [sprintFilter, setSprintFilter] = useState<string>("all");
  const format = useProjectFormat();
  const [baselining, setBaselining] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [critical, setCritical] = useState(false);
  const open = params.get("item");

  const load = useCallback(async () => {
    try { setBoard(await api.work(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The plan didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const navigate = useCallback((next: { view?: View; item?: string | null }) => {
    const query = new URLSearchParams(params.toString());
    if (next.view) { if (next.view === "list") query.delete("view"); else query.set("view", next.view); }
    if (next.item !== undefined) { if (next.item) query.set("item", next.item); else query.delete("item"); }
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const filtered = useMemo(() => {
    if (!board) return [];
    const needle = search.trim().toLocaleLowerCase().replace(/^#/, "");
    // Subtasks go with their task's sprint.
    const sprintOf = (item: WorkItem) => (item.parentId ? board.items.find((parent) => parent.id === item.parentId)?.sprintId ?? null : item.sprintId);
    return board.items.filter((item) => item.status !== "cancelled"
      && (who === "everyone" || (who === "me" ? item.assigneeId === board.me : who === "none" ? !item.assigneeId : item.assigneeId === who))
      && (sprintFilter === "all" || (sprintFilter === "backlog" ? !sprintOf(item) : sprintOf(item) === sprintFilter))
      && (!needle || item.title.toLocaleLowerCase().includes(needle) || String(item.number) === needle));
  }, [board, search, who, sprintFilter]);

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

  return <div className={styles.plan}>
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
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {overrun ? <p className={styles.risk}>{t("The plan ends {date}, {count} days after the handover date.", { date: format.day(planEnd!), count: overrun })}</p> : null}

    {view === "sprints" && !empty ? <PlanSprints board={board} api={api} projectId={projectId} run={runWork} onOpen={(id) => navigate({ item: id })} />
      : empty ? <EmptyState illustration={null} title={t("No work planned yet")} description={t("Break the project into tasks, give each one to someone and set when it's due.")}
        action={!board.canEdit ? undefined : unplanned.length ? <Button variant="primary" onPress={() => setPlanning(true)}>{t("Plan a package")}</Button>
          : <Button variant="primary" onPress={() => setCreating(true)}>{t("New task")}</Button>} />
      : !filtered.length ? <EmptyState illustration={null} title={t("Nothing matches")} action={<Button onPress={() => { setSearch(""); setWho("everyone"); setSprintFilter("all"); }}>{t("Clear filters")}</Button>} />
      : view === "list" ? <PlanList board={board} items={filtered} onOpen={(item) => navigate({ item: item.id })} />
      : view === "timeline" ? <PlanTimeline board={board} items={filtered} critical={critical} onOpen={(id) => navigate({ item: id })} />
      : <Kanban<WorkItem> columns={BOARD_STATUSES.map((status) => ({ id: status, label: labels.status[status], items: filtered.filter((item) => item.status === status) }))}
          getId={(item) => item.id} getLabel={(item) => `#${item.number} ${item.title}`} onItemAction={(item) => navigate({ item: item.id })}
          onMove={board.canEdit ? (id, status) => { const item = board.items.find((entry) => entry.id === id); if (item) void move(item, status as WorkStatus); } : undefined}
          renderItem={(item) => <WorkCard item={item} parent={item.parentId ? board.items.find((entry) => entry.id === item.parentId) : undefined} />} />}

    {open && board.items.some((item) => item.id === open) ? <WorkSheet api={api} projectId={projectId} itemId={open} board={board} onBoard={setBoard}
      onOpenItem={(id) => navigate({ item: id })} onClose={() => navigate({ item: null })} /> : null}
    {baselining ? <ControlledModalDialog isOpen size="md" title={board.baseline ? t("Reset the baseline") : t("Set the baseline")} onOpenChange={(open) => { if (!open) setBaselining(false); }}
      footer={<div className="wd-dialog-actions"><Button onPress={() => setBaselining(false)}>{t("Cancel")}</Button>
        <Button variant="primary" onPress={async () => {
          try { setBoard(await api.workCommand(projectId, "set_baseline")); setBaselining(false); }
          catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); setBaselining(false); }
        }}>{t("Save")}</Button></div>}>
      <p className={styles.dialogText}>{board.baseline
        ? t("Today's dates replace the baseline set on {date} by {name}.", { date: format.when(board.baseline.at), name: board.baseline.byName ?? "" })
        : t("Today's dates become the plan you measure slips against.")}</p>
    </ControlledModalDialog> : null}
    {planning ? <PlanPackageDialog board={board} load={(packageId, startDate) => api.packagePlan(projectId, packageId, startDate)} onClose={() => setPlanning(false)}
      onSave={async (packageId, startDate) => {
        try { setBoard(await api.workCommand(projectId, "plan_package", { packageId, startDate })); return true; }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
      }} /> : null}
    {creating ? <NewWorkDialog board={board} onClose={() => setCreating(false)} onCreate={async (input) => {
      try { setBoard(await api.workCommand(projectId, "create", input)); return true; }
      catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
    }} /> : null}
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
function PlanList({ board, items, onOpen }: { board: WorkBoard; items: WorkItem[]; onOpen: (item: WorkItem) => void }) {
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
  return <GroupedTable<Row> ariaLabel={t("Plan")} columns={columns} sections={sections} selectable={false} getRowId={(row) => row.id}
    getRowLabel={(row) => `#${row.number} ${row.title}`} onRowAction={onOpen} />;
}

/** A new task, client request or snag: its title, who does it, when it's due and its package. */
function NewWorkDialog({ board, onClose, onCreate }: { board: WorkBoard; onClose: () => void; onCreate: (input: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const labels = useWorkLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkType>("task");
  const [assigneeId, setAssigneeId] = useState<string | null>(board.me);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("New task")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!title.trim()} onPress={async () => {
        setBusy(true);
        if (await onCreate({ id, title: title.trim(), type, assigneeId, dueDate, packageId })) onClose();
        setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Title")} isRequired autoFocus value={title} onChange={setTitle} />
      <SegmentedControl label={t("Type")} value={type} onChange={(value) => setType(value as WorkType)}
        options={(["task", "client_request", "snag"] as const).map((option) => ({ id: option, label: labels.type[option] }))} />
      <div className={styles.pair}>
        <SelectField label={t("Assignee")} placeholder={t("No one")} selectedKey={assigneeId} onSelectionChange={(key) => setAssigneeId(key === null ? null : String(key))}
          items={board.people.map((person) => ({ id: person.membershipId, label: person.membershipId === board.me ? t("{name} (me)", { name: person.name }) : person.name }))} />
        <DateField label={t("Due")} value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)} />
      </div>
      {board.packages.length ? <SelectField label={t("Package")} placeholder={t("None")} selectedKey={packageId} onSelectionChange={(key) => setPackageId(key === null ? null : String(key))}
        items={board.packages.map((item) => ({ id: item.id, label: item.name }))} /> : null}
    </div>
  </ControlledModalDialog>;
}

/**
 * Plans a package from the standard work for how it's delivered: the tasks in order on working days,
 * who does each (from the project team's roles) and its stage. Shown before anything is created.
 */
function PlanPackageDialog({ board, load, onClose, onSave }: {
  board: WorkBoard; load: (packageId: string, startDate: string | null) => Promise<PackagePlan>; onClose: () => void; onSave: (packageId: string, startDate: string) => Promise<boolean>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const supplies = useSupplyLabels();
  const options = board.packages.filter((item) => !item.planned);
  const [packageId, setPackageId] = useState<string | null>(options[0]?.id ?? null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [plan, setPlan] = useState<PackagePlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!packageId) return;
    let alive = true;
    load(packageId, startDate).then((next) => { if (alive) { setPlan(next); setError(""); } }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [load, packageId, startDate]);
  const shown = plan && plan.package.id === packageId ? plan : null;
  return <ControlledModalDialog isOpen size="lg" title={t("Plan a package")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!shown || !shown.tasks.length} onPress={async () => {
        if (!shown) return;
        setBusy(true);
        if (await onSave(shown.package.id, shown.startDate)) onClose();
        setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <SelectField label={t("Package")} selectedKey={packageId} onSelectionChange={(key) => setPackageId(key === null ? null : String(key))}
          items={options.map((item) => ({ id: item.id, label: `${item.name} · ${supplies[item.supply]}` }))} />
        <DateField label={t("Start")} value={shown ? parseDate(shown.startDate) : startDate ? parseDate(startDate) : null} onChange={(value) => setStartDate(value ? value.toString() : null)} />
      </div>
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
    </div>
  </ControlledModalDialog>;
}
