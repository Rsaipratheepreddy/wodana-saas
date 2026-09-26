"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, EmptyState, ErrorState, GroupedTable, SearchInput, SegmentedControl, Skeleton, useDesignSystem, type GroupedTableColumn, type GroupedTableSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { OpenWork as OpenWorkState, OpenWorkItem, WorkBoard } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { StatusLabel, TypeIcon, useWorkLabels } from "./work-labels";
import { WorkSheet } from "./work-sheet";
import styles from "./work.module.css";

type View = "mine" | "all";
type Bucket = "late" | "today" | "week" | "later" | "none";

/**
 * Open work across every project the person is on, by when it's due: their own, or everyone's.
 * A row opens the item's panel in place.
 */
export function OpenWork({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useWorkLabels();
  const { timeZone } = useDesignSystem();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [view, setView] = useState<View>("mine");
  const [data, setData] = useState<OpenWorkState | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<{ projectId: string; itemId: string; board: WorkBoard | null; error?: string } | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.openWork(view)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Your work didn't load.")); }
  }, [api, view, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const open = async (item: OpenWorkItem) => {
    setOpened({ projectId: item.projectId, itemId: item.id, board: null });
    try { const board = await api.work(item.projectId); setOpened((current) => (current?.itemId === item.id ? { ...current, board } : current)); }
    catch (cause) { setOpened((current) => (current?.itemId === item.id ? { ...current, error: cause instanceof Error ? cause.message : t("This item didn't load.") } : current)); }
  };

  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), [timeZone]);
  const weekEnd = useMemo(() => { const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 7); return date.toISOString().slice(0, 10); }, [today]);
  const bucket = (due: string | null): Bucket => (!due ? "none" : due < today ? "late" : due === today ? "today" : due <= weekEnd ? "week" : "later");
  const bucketLabels: Record<Bucket, string> = { late: t("Late"), today: t("Today"), week: t("Next 7 days"), later: t("Later"), none: t("No due date") };

  if (error && !data) return <div className={styles.openWork}><ErrorState description={error} onRetry={() => void load()} /></div>;
  const needle = search.trim().toLocaleLowerCase();
  const items = (data?.items ?? []).filter((item) => !needle || `${item.title} ${item.projectName} ${item.projectReference}`.toLocaleLowerCase().includes(needle));
  const sections: GroupedTableSection<OpenWorkItem>[] = (Object.keys(bucketLabels) as Bucket[])
    .map((id) => ({ id, label: bucketLabels[id], rows: items.filter((item) => bucket(item.dueDate) === id), emptyMessage: "" }))
    .filter((section) => section.rows.length)
    .map((section) => ({ ...section, label: `${section.label} · ${section.rows.length}` }));
  const columns: GroupedTableColumn<OpenWorkItem>[] = [
    { id: "title", label: t("Title"), width: view === "mine" ? "44%" : "36%", render: (item) => <span className={styles.titleCell}>
      <span><TypeIcon type={item.type} label={labels.type[item.type]} /><span className={styles.number}>#{item.number}</span>{item.title}</span>
      {item.blockedBy.length ? <small><span className={styles.blocked}>{t("Blocked by {items}", { items: item.blockedBy.map((ref) => `#${ref.number}`).join(", ") })}</span></small> : null}
    </span> },
    { id: "project", label: t("Project"), width: "24%", mobileHidden: true, render: (item) => <span className={styles.projectCell}><span>{item.projectName}</span><small>{item.projectReference}</small></span> },
    ...(view === "all" ? [{ id: "assignee", label: t("Assignee"), width: "16%", mobileHidden: true, render: (item: OpenWorkItem) => item.assigneeName
      ? <span className={styles.person}><Avatar name={item.assigneeName} size="sm" />{item.assigneeName}</span> : <span className={styles.muted}>—</span> }] : []),
    { id: "due", label: t("Due"), width: "12%", render: (item) => <span className={styles.muted} data-late={bucket(item.dueDate) === "late" || undefined}>{item.dueDate ? format.day(item.dueDate) : "—"}</span> },
    { id: "status", label: t("Status"), width: "14%", mobileHidden: true, render: (item) => <StatusLabel status={item.status} /> },
  ];

  return <div className={styles.openWork}>
    <div className={styles.toolbar}>
      <SearchInput label={t("Search work")} placeholder={t("Search")} value={search} onChange={setSearch} />
      <SegmentedControl label={t("Whose work")} value={view} onChange={(value) => { setView(value as View); setData(null); }}
        options={[{ id: "mine", label: t("Mine") }, { id: "all", label: t("Everyone") }]} />
    </div>
    {!data ? <Skeleton lines={6} />
      : !data.items.length ? <EmptyState illustration={null} title={view === "mine" ? t("Nothing on your plate") : t("No open work")}
          description={view === "mine" ? t("Work given to you on any project shows here.") : undefined} />
      : !items.length ? <EmptyState illustration={null} title={t("Nothing matches")} />
      : <GroupedTable<OpenWorkItem> ariaLabel={t("Open work")} columns={columns} sections={sections} selectable={false} getRowId={(item) => item.id}
          getRowLabel={(item) => `#${item.number} ${item.title}`} onRowAction={(item) => void open(item)} />}
    {opened?.error ? <ErrorState description={opened.error} onRetry={() => setOpened(null)} /> : null}
    {opened?.board ? <WorkSheet api={api} projectId={opened.projectId} itemId={opened.itemId} board={opened.board}
      onBoard={(board) => setOpened((current) => (current ? { ...current, board } : current))}
      onOpenItem={(itemId) => setOpened((current) => (current ? { ...current, itemId } : current))}
      onClose={() => { setOpened(null); void load(); }} /> : null}
  </div>;
}
