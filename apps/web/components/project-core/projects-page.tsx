"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, NoResultsState, PageHeader, SegmentedControl, Tag, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectRow, ReadyCase } from "@/lib/project-core/types";
import { useProjectFormat, useStatusLabel } from "./format";
import { StartProjectDialog } from "./start-project-dialog";
import styles from "./project-core.module.css";

type Filter = "open" | "on_hold" | "closed";
/** Home's Projects health links here: late = off track or past its promised date, at risk = flagged at risk. */
export type HealthFilter = "on-track" | "at-risk" | "late";

/** Every project the person can see, one row each: where it is, what's next and when it's due. */
export function ProjectsPage({ workspaceId, initialHealth }: { workspaceId: string; initialHealth?: HealthFilter }) {
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
  const [starting, setStarting] = useState<string | null>(null);

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
    { id: "name", header: t("Project"), accessorFn: (row) => `${row.name} ${row.reference}`, size: 240, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <Link href={`/workspace/projects/${row.id}`}>{row.name}</Link><small>{row.reference}</small></span> } },
    { id: "client", header: t("Client"), accessorFn: (row) => row.clientName, size: 160 },
    { id: "stage", header: t("Stage"), accessorFn: (row) => row.stage?.name ?? "", size: 170, meta: { renderCell: (row) => row.stage
      ? <span className={styles.stageCell}>{row.stage.name}<small>{t("{position} of {count}", { position: row.stage.position, count: row.stage.count })}</small></span> : null } },
    { id: "next", header: t("Next step"), accessorFn: (row) => row.next?.text ?? "", size: 250, meta: { mobileHidden: true, renderCell: (row) => row.status === "active" && row.next
      ? <span className={styles.nextCell}>{row.next.text}{row.next.owner ? <small>{row.next.owner}</small> : null}</span> : null } },
    { id: "handover", header: t("Handover"), accessorFn: (row) => row.promiseDate ?? "", size: 140, meta: { renderCell: (row) => {
      const until = row.status === "active" ? format.until(row.promiseDate) : null;
      return row.promiseDate ? <span className={styles.dateCell}>{format.day(row.promiseDate)}{until ? <small data-late={until.late || undefined}>{until.text}</small> : null}</span> : null;
    } } },
    { id: "status", header: t("Status"), accessorFn: (row) => status(row.status, row.health).label, size: 120, meta: { renderCell: (row) => {
      const value = status(row.status, row.health);
      return <span className={styles.status} data-tone={value.tone}>{value.label}</span>;
    } } },
  ], [t, format, status]);

  if (error && !rows) return <div className={styles.page}><PageHeader title={t("Projects")} /><ErrorState description={error} onRetry={() => void load()} /></div>;

  return <div className={styles.page}>
    <PageHeader title={t("Projects")} actions={canStart ? <Button variant="primary" onPress={() => setPicking(true)}><Play aria-hidden="true" size={15} />{t("Start project")}</Button> : null} />
    <DataGrid<ProjectRow>
      appearance="flush"
      ariaLabel={t("Projects")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      isLoading={!rows}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}`)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search projects")}
      toolbarLeading={<><SegmentedControl label={t("Show")} value={filter} onChange={(value) => { setFilter(value as Filter); if (value !== "open") setHealth(null); }}
        options={[{ id: "open", label: t("Running") }, { id: "on_hold", label: t("On hold") }, { id: "closed", label: t("Closed") }]} />
        {health ? <Tag onRemove={() => { setHealth(null); router.replace("/workspace/projects"); }}>{health === "late" ? t("Late") : health === "at-risk" ? t("At risk") : t("On track")}</Tag> : null}</>}
      emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} />
        : <EmptyState title={filter === "open" ? t("No running projects") : filter === "on_hold" ? t("Nothing on hold") : t("No closed projects")}
            description={filter === "open" ? t("A project starts from an accepted quotation.") : undefined}
            action={filter === "open" && canStart ? <Button variant="primary" onPress={() => setPicking(true)}>{t("Start project")}</Button> : null} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
    {picking ? <ReadyPicker workspaceId={workspaceId} onClose={() => setPicking(false)} onPick={(caseId) => { setPicking(false); setStarting(caseId); }} /> : null}
    {starting ? <StartProjectDialog workspaceId={workspaceId} caseId={starting} onClose={() => setStarting(null)} /> : null}
  </div>;
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
