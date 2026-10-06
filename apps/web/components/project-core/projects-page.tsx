"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Badge, Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, ListTabs, NoResultsState, PageShell, RecordName, type DataGridColumn, type StatusTone, type ToolbarFilter } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectRow, ReadyCase } from "@/lib/project-core/types";
import { useProjectFormat, useStatusLabel } from "./format";
import { StartProjectDialog } from "./start-project-dialog";
import styles from "./project-core.module.css";

type Filter = "open" | "on_hold" | "closed";
/** Home's Projects health links here: late = off track or past its promised date, at risk = flagged at risk. */
export type HealthFilter = "on-track" | "at-risk" | "late";
const STATUS_TONE: Record<string, StatusTone> = { ok: "success", risk: "warning", off: "danger", hold: "neutral", done: "info" };

/** Every project the person can see, one row each: where it is, what's next and when it's due. */
export function ProjectsPage({ workspaceId, initialHealth, initialStart }: { workspaceId: string; initialHealth?: HealthFilter;
  /** A case whose project is ready to start (from the "Ready to start" notice): its start opens at once. */
  initialStart?: string }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const status = useStatusLabel();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [canStart, setCanStart] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [health, setHealth] = useState<HealthFilter | null>(initialHealth ?? null);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState<string | null>(initialStart ?? null);

  const load = useCallback(async () => {
    try { const next = await api.list(); setRows(next.projects); setCanStart(next.canStart); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Projects didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const visible = useMemo(() => (rows ?? []).filter((row) => {
    if (filter === "open" && row.status !== "active") return false;
    if (filter === "on_hold" && row.status !== "on_hold") return false;
    if (filter === "closed" && !["completed", "cancelled", "archived"].includes(row.status)) return false;
    if (health) {
      const late = row.health === "off_track" || Boolean(row.promiseDate && format.until(row.promiseDate)?.late);
      if (row.status !== "active" || (late ? "late" : row.health === "at_risk" ? "at-risk" : "on-track") !== health) return false;
    }
    const query = search.trim().toLocaleLowerCase();
    return !query || [row.name, row.reference, row.clientName, row.lead ?? ""].some((value) => value.toLocaleLowerCase().includes(query));
  }), [rows, filter, search, health, format]);

  const columns = useMemo<DataGridColumn<ProjectRow>[]>(() => [
    { id: "name", header: t("Project"), accessorFn: (row) => `${row.name} ${row.reference} ${row.clientName}`, size: 260, meta: { primary: true, interactive: true, renderCell: (row) =>
      <RecordName detail={[row.clientName, row.reference].filter(Boolean).join(" · ")} title={<Link className={styles.open} data-tour="project-open" href={`/workspace/projects/${row.id}`}>{row.name}</Link>} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => status(row.status, row.health).label, size: 120, meta: { renderCell: (row) => {
      const value = status(row.status, row.health);
      return <Badge tone={STATUS_TONE[value.tone] ?? "success"}>{value.label}</Badge>;
    } } },
    { id: "stage", header: t("Stage"), accessorFn: (row) => row.stage?.name ?? "", size: 170, meta: { renderCell: (row) => row.stage
      ? <RecordName title={row.stage.name} detail={t("{position} of {count}", { position: row.stage.position, count: row.stage.count })} /> : null } },
    { id: "next", header: t("Next step"), accessorFn: (row) => row.next?.text ?? "", size: 230, meta: { priority: "medium", renderCell: (row) => row.status === "active" && row.next
      ? <RecordName title={row.next.text} detail={row.next.owner} /> : null } },
    { id: "attention", header: t("Needs a look"), accessorFn: (row) => (row.attention?.late ?? 0) * 1000 + (row.attention?.blocked ?? 0), size: 130, meta: { priority: "low", renderCell: (row) => {
      const parts = [row.attention?.late ? t("{count} late", { count: row.attention.late }) : "", row.attention?.blocked ? t("{count} blocked", { count: row.attention.blocked }) : ""].filter(Boolean);
      return row.status === "active" && parts.length ? <Link className={styles.attention} data-late={row.attention?.late ? true : undefined}
        href={`/workspace/projects/${row.id}/plan?filter=${row.attention?.late ? "late" : "blocked"}`}>{parts.join(" · ")}</Link> : <span className={styles.muted}>—</span>;
    } } },
    { id: "handover", header: t("Handover"), accessorFn: (row) => row.promiseDate ?? "", size: 130, meta: { priority: "medium", renderCell: (row) => {
      const until = row.status === "active" ? format.until(row.promiseDate) : null;
      return row.promiseDate ? <span className={styles.dateCell}>{format.day(row.promiseDate)}{until ? <small data-late={until.late || undefined}>{until.text}</small> : null}</span> : null;
    } } },
  ], [t, format, status]);

  const action = canStart ? <Button variant="primary" onPress={() => setPicking(true)}><Play aria-hidden="true" size={15} />{t("Start project")}</Button> : null;
  const tabs = <ListTabs label={t("Show")} value={filter} onChange={(value) => { setFilter(value); if (value !== "open") setHealth(null); }}
    items={[{ id: "open", label: t("Running") }, { id: "on_hold", label: t("On hold") }, { id: "closed", label: t("Closed") }]} />;
  // Home's Projects health links here; health applies to running projects only.
  const filters: ToolbarFilter[] = filter === "open" ? [{ id: "health", label: t("Health"), value: health ?? undefined,
    options: [{ id: "on-track", label: t("On track") }, { id: "at-risk", label: t("At risk") }, { id: "late", label: t("Late") }],
    onChange: (value) => { setHealth((value as HealthFilter | undefined) ?? null); if (!value) router.replace("/workspace/projects"); } }] : [];

  if (error && !rows) return <PageShell title={t("Projects")} action={action} tabs={tabs}><ErrorState description={error} onRetry={() => void load()} /></PageShell>;

  return <div data-tour="project-list"><PageShell title={t("Projects")} action={action} tabs={tabs}>
    <DataGrid<ProjectRow>
      gridKey="projects.list"
      ariaLabel={t("Projects")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      isLoading={!rows}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}`)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search projects")}
      filters={filters}
      emptyContent={search.trim() || health ? <NoResultsState onClear={() => { setSearch(""); setHealth(null); }} />
        : <EmptyState title={filter === "open" ? t("No running projects") : filter === "on_hold" ? t("Nothing on hold") : t("No closed projects")}
            description={filter === "open" ? t("A project starts from an accepted quotation.") : undefined}
            action={filter === "open" && canStart ? <Button variant="primary" onPress={() => setPicking(true)}>{t("Start project")}</Button> : null} />}
      rowNumbers={false}
      selectable={false}
    />
    {picking ? <ReadyPicker workspaceId={workspaceId} onClose={() => setPicking(false)} onPick={(caseId) => { setPicking(false); setStarting(caseId); }} /> : null}
    {starting ? <StartProjectDialog workspaceId={workspaceId} caseId={starting} onClose={() => setStarting(null)} /> : null}
  </PageShell></div>;
}

/** Accepted quotations whose project hasn't started: pick one to start. */
function ReadyPicker({ workspaceId, onClose, onPick }: { workspaceId: string; onClose: () => void; onPick: (caseId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [cases, setCases] = useState<ReadyCase[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    projectApi(workspaceId).ready().then((next) => { if (alive) setCases(next.cases); }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId]);
  return <ControlledModalDialog isOpen size="md" title={t("Start project")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button></div>}>
    {error ? <ErrorState description={error} /> : !cases ? null : !cases.length
      ? <EmptyState illustration={null} title={t("Nothing to start")} description={t("When a client accepts a quotation, it appears here.")} />
      : <ul className={styles.pickList} aria-label={t("Accepted quotations")}>
          {cases.map((item) => <li key={item.caseId}><button type="button" onClick={() => onPick(item.caseId)}>
            <span><strong>{item.name}</strong><small>{item.clientName} · {t("Q-{number}", { number: item.quoteNumber })}</small></span>
            <span>{format.money(item.total, item.currency)}</span>
          </button></li>)}
        </ul>}
  </ControlledModalDialog>;
}
