"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import {
  Avatar, Button, ControlledModalDialog, DateField, EmptyState, ErrorState, GroupedTable, InlineNotice, Kanban, MenuButton, SearchInput, SegmentedControl, SelectField,
  Skeleton, TextInput, type GroupedTableColumn, type GroupedTableSection,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { WorkBoard, WorkItem, WorkStatus, WorkType } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { BOARD_STATUSES, StatusLabel, TypeIcon, isOpen, useWorkLabels } from "./work-labels";
import { WorkSheet } from "./work-sheet";
import styles from "./work.module.css";

type View = "list" | "board";
type Row = WorkItem & { depth: 0 | 1 };

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
  const view: View = params.get("view") === "board" ? "board" : "list";
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
    return board.items.filter((item) => item.status !== "cancelled"
      && (who === "everyone" || (who === "me" ? item.assigneeId === board.me : who === "none" ? !item.assigneeId : item.assigneeId === who))
      && (!needle || item.title.toLocaleLowerCase().includes(needle) || String(item.number) === needle));
  }, [board, search, who]);

  if (error && !board) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!board) return <Skeleton lines={6} />;

  const move = async (item: WorkItem, status: WorkStatus) => {
    if (item.status === status) return;
    setNotice("");
    try { setBoard(await api.workCommand(projectId, "update", { itemId: item.id, version: item.version, status })); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
  };
  const people = board.people.length ? board.people : [...new Map(board.items.filter((item) => item.assigneeId).map((item) => [item.assigneeId!, { membershipId: item.assigneeId!, name: item.assigneeName ?? "" }])).values()];
  const whoLabel = who === "everyone" ? t("Everyone") : who === "me" ? t("Assigned to me") : who === "none" ? t("No one") : people.find((person) => person.membershipId === who)?.name ?? t("Everyone");
  const empty = !board.items.some((item) => item.status !== "cancelled");

  return <div className={styles.plan}>
    <div className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <SearchInput label={t("Search the plan")} placeholder={t("Search")} value={search} onChange={setSearch} />
        <MenuButton size="compact" label={whoLabel} onAction={setWho}
          items={[{ id: "everyone", label: t("Everyone") }, ...(board.me ? [{ id: "me", label: t("Assigned to me") }] : []), { id: "none", label: t("No one") },
            ...people.filter((person) => person.membershipId !== board.me).map((person) => ({ id: person.membershipId, label: person.name }))]} />
      </div>
      <div className={styles.toolbarGroup}>
        <SegmentedControl label={t("View")} value={view} onChange={(value) => navigate({ view: value as View })} options={[{ id: "list", label: t("List") }, { id: "board", label: t("Board") }]} />
        {board.canEdit ? <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{t("New task")}</Button> : null}
      </div>
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}

    {empty ? <EmptyState illustration={null} title={t("No work planned yet")} description={t("Break the project into tasks, give each one to someone and set when it's due.")}
        action={board.canEdit ? <Button variant="primary" onPress={() => setCreating(true)}>{t("New task")}</Button> : undefined} />
      : !filtered.length ? <EmptyState illustration={null} title={t("Nothing matches")} action={<Button onPress={() => { setSearch(""); setWho("everyone"); }}>{t("Clear filters")}</Button>} />
      : view === "list" ? <PlanList board={board} items={filtered} onOpen={(item) => navigate({ item: item.id })} />
      : <Kanban<WorkItem> columns={BOARD_STATUSES.map((status) => ({ id: status, label: labels.status[status], items: filtered.filter((item) => item.status === status) }))}
          getId={(item) => item.id} getLabel={(item) => `#${item.number} ${item.title}`} onItemAction={(item) => navigate({ item: item.id })}
          onMove={board.canEdit ? (id, status) => { const item = board.items.find((entry) => entry.id === id); if (item) void move(item, status as WorkStatus); } : undefined}
          renderItem={(item) => <WorkCard item={item} parent={item.parentId ? board.items.find((entry) => entry.id === item.parentId) : undefined} />} />}

    {open && board.items.some((item) => item.id === open) ? <WorkSheet api={api} projectId={projectId} itemId={open} board={board} onBoard={setBoard}
      onOpenItem={(id) => navigate({ item: id })} onClose={() => navigate({ item: null })} /> : null}
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
      <span className={styles.spacer} />
      {item.assigneeName ? <Avatar name={item.assigneeName} size="sm" /> : null}
    </span> : null}
  </div>;
}

/** Open work grouped by package, each task followed by its subtasks; finished work last. */
function PlanList({ board, items, onOpen }: { board: WorkBoard; items: WorkItem[]; onOpen: (item: WorkItem) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useWorkLabels();
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
    .map((section) => ({ ...section, label: `${section.label} · ${section.rows.filter((row) => row.depth === 0).length}` }));
  const columns: GroupedTableColumn<Row>[] = [
    { id: "title", label: t("Title"), width: "52%", render: (row) => <span className={styles.titleCell} data-depth={row.depth || undefined}>
      <span><TypeIcon type={row.type} label={labels.type[row.type]} /><span className={styles.number}>#{row.number}</span><span data-done={row.status === "done" || undefined}>{row.title}</span></span>
      <Meta row={row} parent={row.depth === 0 && row.parentId ? board.items.find((item) => item.id === row.parentId) : undefined} />
    </span> },
    { id: "assignee", label: t("Assignee"), width: "20%", mobileHidden: true, render: (row) => row.assigneeName
      ? <span className={styles.person}><Avatar name={row.assigneeName} size="sm" />{row.assigneeName}</span> : <span className={styles.muted}>—</span> },
    { id: "due", label: t("Due"), width: "12%", mobileHidden: true, render: (row) => {
      if (!row.dueDate) return <span className={styles.muted}>—</span>;
      const due = isOpen(row.status) ? format.until(row.dueDate) : null;
      return <span className={styles.muted} data-late={due?.late || undefined}>{format.day(row.dueDate)}</span>;
    } },
    { id: "status", label: t("Status"), width: "16%", render: (row) => <StatusLabel status={row.status} /> },
  ];
  return <GroupedTable<Row> ariaLabel={t("Plan")} columns={columns} sections={sections} selectable={false} getRowId={(row) => row.id}
    getRowLabel={(row) => `#${row.number} ${row.title}`} onRowAction={onOpen} />;
}

/** Under a row's title: what holds it up, its subtasks and a high priority. */
function Meta({ row, parent }: { row: Row; parent?: WorkItem }) {
  const t = useT();
  const labels = useWorkLabels();
  const parts = [
    parent ? t("Subtask of #{number}", { number: parent.number }) : "",
    row.subtasks ? t("{done} of {count} subtasks", { done: row.subtasksDone, count: row.subtasks }) : "",
    row.priority === "urgent" || row.priority === "high" ? labels.priority[row.priority] : "",
  ].filter(Boolean);
  const blocked = row.blockedBy.length > 0 && isOpen(row.status);
  if (!parts.length && !blocked) return null;
  return <small>{blocked ? <span className={styles.blocked}>{t("Blocked by {items}", { items: row.blockedBy.map((item) => `#${item.number}`).join(", ") })}</span> : null}{parts.join(" · ")}</small>;
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
