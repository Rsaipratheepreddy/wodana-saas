"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardGrid, DataGrid, EmptyState, FormDialog, ListTabs, NoResultsState, OwnerCell, PageShell, Progress, RecordName, SearchInput, SegmentedControl, SelectField, useDesignSystem, type DataGridColumn } from "@/design-system";
import { tKey, type Translate } from "@/lib/i18n/keys";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath, label } from "@/lib/projects/execution";
import styles from "./project-portfolio.module.css";

export type PortfolioRow = {
  id: string; caseId: string; name: string; description?: string | null; customer: string; phase: string;
  workflow?: { templateCode: string; currentStageKey: string; currentStageName: string };
  manager: string | null; team?: string[]; reference: string; priority: string; risk: string;
  progress?: number; taskSummary?: { total: number }; targetCompletion?: string;
  onHold: boolean; handoverDate: string; nextAction: string; nextActionDate: string;
};

const views = [
  { id: "all", label: tKey("All projects") },
  { id: "planning", label: tKey("Planning") },
  { id: "active", label: tKey("In progress") },
  { id: "handover", label: tKey("Handover") },
  { id: "completed", label: tKey("Completed") },
];

/** Project phases and risk levels as the person reads them; anything unknown is humanized. */
const statusLabels: Record<string, string> = {
  planning: tKey("Planning"), active: tKey("In progress"), handover: tKey("Handover"), completed: tKey("Completed"),
  on_track: tKey("On track"), get_ready: tKey("Get ready"), urgent_action: tKey("Urgent action"), high_risk: tKey("High risk"), complete: tKey("Complete"),
};
export function projectStatusText(t: Translate, value: string) {
  return statusLabels[value] ? t(statusLabels[value] as never) : label(value);
}

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "active") return "info";
  if (["completed", "on_track"].includes(value)) return "success";
  if (["high_risk", "urgent_action", "blocked"].includes(value)) return "danger";
  if (["get_ready", "planning", "handover"].includes(value)) return "warning";
  return "neutral";
}

export function ProjectPortfolio({ workspaceId, rows, today }: { workspaceId: string; rows: PortfolioRow[]; today: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const router = useRouter();
  const [layout, setLayout] = useState("cards");
  const viewItems = views.map((view) => ({ id: view.id, label: t(view.label as never) }));
  const layouts = [{ id: "cards", label: t("Cards") }, { id: "table", label: t("Table") }];
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<{ id: string; title: string; customer: string }[]>([]);
  const [caseId, setCaseId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = rows.filter((row) =>
    (status === "all" || row.phase === status) &&
    `${row.name} ${row.customer} ${row.reference}`.toLowerCase().includes(search.toLowerCase()),
  );
  const columns: DataGridColumn<PortfolioRow>[] = [
    { id: "name", accessorFn: (row) => `${row.name} ${row.customer} ${row.reference}`, header: t("Project"), size: 280, meta: { primary: true,
      renderCell: (row) => <RecordName title={row.name} detail={[row.customer, row.reference].filter(Boolean).join(" · ")} /> } },
    { accessorKey: "manager", header: t("Project manager"), size: 180, meta: { priority: "low", renderCell: (row) => <OwnerCell fallback={t("Unassigned")} person={row.manager} /> } },
    { accessorKey: "nextAction", header: t("Next action"), size: 260, meta: { priority: "medium", renderCell: (row) => <RecordName title={row.nextAction || "–"} detail={row.nextActionDate || undefined} /> } },
    { accessorKey: "risk", header: t("Risk"), size: 140, meta: { priority: "medium", renderCell: (row) => <Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? t("On hold") : projectStatusText(t, row.risk)}</Badge> } },
    { accessorKey: "phase", header: t("Status"), size: 140, meta: { renderCell: (row) => <Badge tone={statusTone(row.phase)}>{projectStatusText(t, row.phase)}</Badge> } },
  ];

  async function start() {
    // Each start opens clean: no planning case chosen from the last time.
    setCaseId("");
    setOpen(true);
    setBusy(true);
    setError("");
    try { setCases(await jsonRequest(projectPath(workspaceId, "candidates"))); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function createProject() {
    if (!caseId) return;
    setError("");
    const project = await jsonRequest<{ id: string }>(projectPath(workspaceId, "planning"), "POST", { caseId });
    router.push(`/workspace/projects/${project.id}/plan-teams`);
  }

  const filtered = Boolean(search.trim()) || status !== "all";
  const clear = () => { setSearch(""); setStatus("all"); };
  const empty = filtered ? <NoResultsState onClear={clear} />
    : <EmptyState title={t("No projects yet")} description={t("Start a project from an active Planning case.")}
        action={<Button onPress={() => void start()} variant="primary">{t("Start project")}</Button>} />;
  const viewSwitch = <SegmentedControl label={t("Project view")} options={layouts} value={layout} onChange={setLayout} />;

  return <PageShell title={t("Projects")} action={<Button onPress={() => void start()} variant="primary"><Plus size={15} aria-hidden="true" />{t("Start project")}</Button>}
    tabs={<ListTabs label={t("Project status")} items={viewItems} value={status} onChange={setStatus} />}
    toolbar={layout === "cards" ? <div className={styles.cardToolbar}>
      <SearchInput label={t("Search projects")} placeholder={t("Search projects…")} value={search} onChange={setSearch} />{viewSwitch}</div> : undefined}>
    {layout === "cards" ? visible.length ? <CardGrid>
        {visible.map(row => {
          const progress = typeof row.progress === "number" && Number.isFinite(row.progress) ? Math.max(0, Math.min(100, row.progress)) : null;
          const date = row.targetCompletion || row.handoverDate;
          return <Card as="article" key={row.id} title={<Link className={styles.open} href={`/workspace/projects/${row.id}/overview`}>{row.name}</Link>}
            chip={<Badge tone={statusTone(row.phase)}>{projectStatusText(t, row.phase)}</Badge>}
            footer={row.nextAction ? <p className={styles.next}><span>{row.nextAction}</span>{row.nextActionDate ? <time dateTime={row.nextActionDate}>{row.nextActionDate}</time> : null}</p> : undefined}>
            <span className={styles.muted}>{[row.customer, row.reference].filter(Boolean).join(" · ")}</span>
            <div className={styles.row}><OwnerCell fallback={t("Manager unassigned")} person={row.manager} />
              <Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? t("On hold") : projectStatusText(t, row.risk)}</Badge></div>
            <div className={styles.row}><span className={styles.muted}>{t("Verified progress")}</span><span>{progress === null || row.taskSummary?.total === 0 ? t("Not started") : `${progress}%`}</span></div>
            <Progress label={t("{name} verified progress", { name: row.name })} value={progress ?? 0} />
            <div className={styles.row} data-overdue={Boolean(date && date < today && row.phase !== "completed") || undefined}><span className={styles.muted}>{row.targetCompletion ? t("Target completion") : t("Target handover")}</span>
              <span className={styles.date}>{date ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`)) : t("Not scheduled")}</span></div>
          </Card>;
        })}
      </CardGrid> : empty
    : <DataGrid
      ariaLabel={t("Projects")}
      pageSize={50}
      columns={columns}
      data={visible}
      emptyContent={empty}
      exportFileName="projects.csv"
      getRowId={(row) => row.id}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}/overview`)}
      onSearchChange={setSearch}
      persistKey="projects-portfolio"
      rowNumbers={false}
      selectable={false}
      searchLabel={t("Search projects")}
      searchValue={search}
      toolbarLeading={viewSwitch}
    />}
    <FormDialog isOpen={open} onClose={() => setOpen(false)} title={t("Start project")} error={error || undefined} isSubmitDisabled={!caseId || busy}
      submitLabel={t("Create planning workspace")} onSubmit={createProject}>
      <SelectField
        isDisabled={busy || !cases.length}
        isRequired
        items={cases.map((item) => ({ id: item.id, label: `${item.title} · ${item.customer}` }))}
        label={t("Planning case")}
        onSelectionChange={(key) => setCaseId(String(key ?? ""))}
        placeholder={t("Choose a case")}
        selectedKey={caseId || null}
      />
      {!busy && !cases.length && !error ? <p className={styles.empty}>{t("No eligible cases are available.")}</p> : null}
    </FormDialog>
  </PageShell>;
}
