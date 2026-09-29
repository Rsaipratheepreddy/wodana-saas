"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FolderKanban, ContactRound, UsersRound, CalendarClock, Flag, CheckCircle2 } from "lucide-react";
import { Avatar, Badge, Button, DesignSystemProvider, DataGrid, FormDialog, SearchInput, SegmentedControl, SelectField, useDesignSystem, type DataGridColumn } from "@/design-system";
import { tKey, type Translate } from "@/lib/i18n/keys";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath, label } from "@/lib/projects/execution";
import styles from "./project-portfolio.module.css";
import enquiryStyles from "../crm/leads-page.module.css";

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
  const viewItems = views.map((view) => ({ ...view, label: t(view.label as never) }));
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
    { accessorKey: "name", header: t("Project"), size: 260, meta: { headerIcon: <FolderKanban size={14} aria-hidden="true" />, primary: true, renderCell: (row) => <span className={styles.projectName}>{row.name}</span> } },
    { accessorKey: "customer", header: t("Client"), size: 220, meta: { headerIcon: <ContactRound size={14} aria-hidden="true" />, renderCell: (row) => <span className={styles.client}><Avatar name={row.customer} size="sm" />{row.customer}</span> } },
    { accessorKey: "manager", header: t("Project manager"), size: 220, meta: { headerIcon: <UsersRound size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => row.manager || "–" } },
    { accessorKey: "nextAction", header: t("Next action"), size: 280, meta: { headerIcon: <CalendarClock size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => <span className={styles.action} title={row.nextAction || undefined}><span className={styles.actionText}>{row.nextAction || "–"}</span>{row.nextActionDate ? <small>{row.nextActionDate}</small> : null}</span> } },
    { accessorKey: "risk", header: t("Risk"), size: 150, meta: { headerIcon: <Flag size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => <Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? t("On hold") : projectStatusText(t, row.risk)}</Badge> } },
    { accessorKey: "phase", header: t("Status"), size: 150, meta: { headerIcon: <CheckCircle2 size={14} aria-hidden="true" />, renderCell: (row) => <Badge tone={statusTone(row.phase)}>{projectStatusText(t, row.phase)}</Badge> } },
  ];

  async function start() {
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

  return <DesignSystemProvider className={enquiryStyles.provider}><section aria-label={t("Projects")} className={`${enquiryStyles.page} ${styles.compactPage}`}>
    {layout === "cards" ? <>
      <div className={styles.cardToolbar}>
        <SearchInput label={t("Search projects")} placeholder={t("Search projects…")} value={search} onChange={setSearch} />
        <SelectField label={t("Project status")} items={viewItems} selectedKey={status} onSelectionChange={key => setStatus(String(key ?? "all"))} />
        <div className={styles.viewSwitch}><SegmentedControl label={t("Project view")} options={layouts} value={layout} onChange={setLayout} /></div>
        <Button onPress={() => void start()} size="compact" variant="primary"><Plus size={14} aria-hidden="true" />{t("Start project")}</Button>
      </div>
      <div className={styles.cards}>
        {visible.map(row => {
          const progress = typeof row.progress === "number" && Number.isFinite(row.progress) ? Math.max(0, Math.min(100, row.progress)) : null;
          const date = row.targetCompletion || row.handoverDate;
          return <Link className={styles.card} key={row.id} href={`/workspace/projects/${row.id}/overview`}>
            <div className={styles.cardTop}><span className={styles.reference}>{row.reference || t("Project")}</span><Badge tone={statusTone(row.phase)}>{projectStatusText(t, row.phase)}</Badge></div>
            <h2>{row.name}</h2><p className={styles.customer}>{row.customer}</p>
            <div className={styles.cardMeta}><span className={styles.client}>{row.manager && <Avatar name={row.manager} size="sm" />}{row.manager || t("Manager unassigned")}</span><Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? t("On hold") : projectStatusText(t, row.risk)}</Badge></div>
            <div className={styles.progressLabel}><span>{t("Verified progress")}</span><span>{progress === null || row.taskSummary?.total === 0 ? t("Not started") : `${progress}%`}</span></div>
            <progress aria-label={t("{name} verified progress", { name: row.name })} max={100} value={progress ?? 0} />
            <div className={styles.deadline} data-overdue={Boolean(date && date < today && row.phase !== "completed") || undefined}><span>{row.targetCompletion ? t("Target completion") : t("Target handover")}</span><span>{date ? new Intl.DateTimeFormat(locale, {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date.slice(0,10)}T00:00:00Z`)) : t("Not scheduled")}</span></div>
            {row.nextAction && <div className={styles.next}><span>{t("Next action")}</span><p>{row.nextAction}</p>{row.nextActionDate && <time dateTime={row.nextActionDate}>{row.nextActionDate}</time>}</div>}
          </Link>;
        })}
      </div>
      {!visible.length && <div className={styles.emptyCards}><FolderKanban size={26} aria-hidden="true" /><strong>{rows.length ? t("No matching projects") : t("No projects yet")}</strong><p>{rows.length ? t("Try another status or search.") : t("Start a project from an active Planning case.")}</p></div>}
    </> : <>
      <div className={styles.viewSwitch}><SegmentedControl label={t("Project view")} options={layouts} value={layout} onChange={setLayout} /></div>
      <DataGrid gridLines
      ariaLabel={t("Projects")}
      pageSize={50}
      toolbarActions={<Button onPress={() => void start()} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />{t("Start project")}</Button>}
      columns={columns}
      data={visible}
      emptyTitle={rows.length ? t("No matching projects") : t("No projects yet")}
      emptyDescription={rows.length ? t("Try another view or search.") : t("Start a project from an active Planning case.")}
      exportFileName="projects.csv"
      getRowId={(row) => row.id}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}/overview`)}
      onSearchChange={setSearch}
      onViewChange={setStatus}
      persistKey="projects-portfolio"
      rowNumbers={false}
      savedViews={viewItems}
      searchLabel={t("Search projects")}
      searchValue={search}
      selectedView={status}
    /></>}
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
  </section></DesignSystemProvider>;
}
