"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FolderKanban, ContactRound, UsersRound, CalendarClock, Flag, CheckCircle2 } from "lucide-react";
import { Avatar, Badge, Button, DesignSystemProvider, ControlledModalDialog, DataGrid, Form, SearchInput, SegmentedControl, SelectField, type DataGridColumn } from "@/design-system";
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
  { id: "all", label: "All projects" },
  { id: "planning", label: "Planning" },
  { id: "active", label: "In progress" },
  { id: "handover", label: "Handover" },
  { id: "completed", label: "Completed" },
];

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "active") return "info";
  if (["completed", "on_track"].includes(value)) return "success";
  if (["high_risk", "urgent_action", "blocked"].includes(value)) return "danger";
  if (["get_ready", "planning", "handover"].includes(value)) return "warning";
  return "neutral";
}

export function ProjectPortfolio({ workspaceId, rows, today }: { workspaceId: string; rows: PortfolioRow[]; today: string }) {
  const router = useRouter();
  const [layout, setLayout] = useState("cards");
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
    { accessorKey: "name", header: "Project", size: 260, meta: { headerIcon: <FolderKanban size={14} aria-hidden="true" />, primary: true, renderCell: (row) => <span className={styles.projectName}>{row.name}</span> } },
    { accessorKey: "customer", header: "Client", size: 220, meta: { headerIcon: <ContactRound size={14} aria-hidden="true" />, renderCell: (row) => <span className={styles.client}><Avatar name={row.customer} size="sm" />{row.customer}</span> } },
    { accessorKey: "manager", header: "Project manager", size: 220, meta: { headerIcon: <UsersRound size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => row.manager || "–" } },
    { accessorKey: "nextAction", header: "Next action", size: 280, meta: { headerIcon: <CalendarClock size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => <span className={styles.action} title={row.nextAction || undefined}><span className={styles.actionText}>{row.nextAction || "–"}</span>{row.nextActionDate ? <small>{row.nextActionDate}</small> : null}</span> } },
    { accessorKey: "risk", header: "Risk", size: 150, meta: { headerIcon: <Flag size={14} aria-hidden="true" />, mobileHidden: true, renderCell: (row) => <Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? "On hold" : label(row.risk)}</Badge> } },
    { accessorKey: "phase", header: "Status", size: 150, meta: { headerIcon: <CheckCircle2 size={14} aria-hidden="true" />, renderCell: (row) => <Badge tone={statusTone(row.phase)}>{row.phase === "active" ? "In progress" : label(row.phase)}</Badge> } },
  ];

  async function start() {
    setOpen(true);
    setBusy(true);
    setError("");
    try { setCases(await jsonRequest(projectPath(workspaceId, "candidates"))); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseId || busy) return;
    setBusy(true);
    setError("");
    try {
      const project = await jsonRequest<{ id: string }>(projectPath(workspaceId, "planning"), "POST", { caseId });
      router.push(`/workspace/projects/${project.id}/plan-teams`);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return <DesignSystemProvider className={enquiryStyles.provider}><section aria-label="Projects" className={`${enquiryStyles.page} ${styles.compactPage}`}>
    {layout === "cards" ? <>
      <div className={styles.cardToolbar}>
        <SearchInput label="Search projects" placeholder="Search projects…" value={search} onChange={setSearch} />
        <SelectField label="Project status" items={views} selectedKey={status} onSelectionChange={key => setStatus(String(key ?? "all"))} />
        <div className={styles.viewSwitch}><SegmentedControl label="Project view" options={[{id:"cards",label:"Cards"},{id:"table",label:"Table"}]} value={layout} onChange={setLayout} /></div>
        <Button onPress={() => void start()} size="compact" variant="primary"><Plus size={14} aria-hidden="true" />Start project</Button>
      </div>
      <div className={styles.cards}>
        {visible.map(row => {
          const progress = typeof row.progress === "number" && Number.isFinite(row.progress) ? Math.max(0, Math.min(100, row.progress)) : null;
          const date = row.targetCompletion || row.handoverDate;
          return <Link className={styles.card} key={row.id} href={`/workspace/projects/${row.id}/overview`}>
            <div className={styles.cardTop}><span className={styles.reference}>{row.reference || "Project"}</span><Badge tone={statusTone(row.phase)}>{row.phase === "active" ? "In progress" : label(row.phase)}</Badge></div>
            <h2>{row.name}</h2><p className={styles.customer}>{row.customer}</p>
            <div className={styles.cardMeta}><span className={styles.client}>{row.manager && <Avatar name={row.manager} size="sm" />}{row.manager || "Manager unassigned"}</span><Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? "On hold" : label(row.risk)}</Badge></div>
            <div className={styles.progressLabel}><span>Verified progress</span><span>{progress === null || row.taskSummary?.total === 0 ? "Not started" : `${progress}%`}</span></div>
            <progress aria-label={`${row.name} verified progress`} max={100} value={progress ?? 0} />
            <div className={styles.deadline} data-overdue={Boolean(date && date < today && row.phase !== "completed") || undefined}><span>{row.targetCompletion ? "Target completion" : "Target handover"}</span><span>{date ? new Intl.DateTimeFormat("en-GB", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date.slice(0,10)}T00:00:00Z`)) : "Not scheduled"}</span></div>
            {row.nextAction && <div className={styles.next}><span>Next action</span><p>{row.nextAction}</p>{row.nextActionDate && <time dateTime={row.nextActionDate}>{row.nextActionDate}</time>}</div>}
          </Link>;
        })}
      </div>
      {!visible.length && <div className={styles.emptyCards}><FolderKanban size={26} aria-hidden="true" /><strong>{rows.length ? "No matching projects" : "No projects yet"}</strong><p>{rows.length ? "Try another status or search." : "Start a project from an active Planning case."}</p></div>}
    </> : <>
      <div className={styles.viewSwitch}><SegmentedControl label="Project view" options={[{id:"cards",label:"Cards"},{id:"table",label:"Table"}]} value={layout} onChange={setLayout} /></div>
      <DataGrid gridLines
      ariaLabel="Projects"
      pageSize={50}
      toolbarActions={<Button onPress={() => void start()} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />Start project</Button>}
      columns={columns}
      data={visible}
      emptyTitle={rows.length ? "No matching projects" : "No projects yet"}
      emptyDescription={rows.length ? "Try another view or search." : "Start a project from an active Planning case."}
      exportFileName="projects.csv"
      getRowId={(row) => row.id}
      onRowAction={(row) => router.push(`/workspace/projects/${row.id}/overview`)}
      onSearchChange={setSearch}
      onViewChange={setStatus}
      persistKey="projects-portfolio"
      rowNumbers={false}
      savedViews={views}
      searchLabel="Search projects"
      searchValue={search}
      selectedView={status}
    /></>}
    <ControlledModalDialog isOpen={open} onOpenChange={setOpen} title="Start project">
      <Form className={styles.form} onSubmit={createProject}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <SelectField
          isDisabled={busy || !cases.length}
          isRequired
          items={cases.map((item) => ({ id: item.id, label: `${item.title} · ${item.customer}` }))}
          label="Planning case"
          onSelectionChange={(key) => setCaseId(String(key ?? ""))}
          placeholder="Choose a case"
          selectedKey={caseId || null}
        />
        {!busy && !cases.length && !error ? <p className={styles.empty}>No eligible cases are available.</p> : null}
        <div className={styles.formActions}><Button onPress={() => setOpen(false)}>Cancel</Button><Button isDisabled={!caseId} isLoading={busy} type="submit" variant="primary">Create planning workspace</Button></div>
      </Form>
    </ControlledModalDialog>
  </section></DesignSystemProvider>;
}
