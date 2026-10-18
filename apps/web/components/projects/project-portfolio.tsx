"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Avatar, Badge, Button, Container, ControlledModalDialog, DataGrid, Form, PageHeader, SelectField, type DataGridColumn } from "@/design-system";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath, label } from "@/lib/projects/execution";
import styles from "./project-portfolio.module.css";

export type PortfolioRow = {
  id: string; caseId: string; name: string; customer: string; phase: string;
  manager: string | null; reference: string; priority: string; risk: string;
  onHold: boolean; handoverDate: string; nextAction: string; nextActionDate: string;
};

const views = [
  { id: "all", label: "All projects" },
  { id: "planning", label: "Planning" },
  { id: "active", label: "In progress" },
  { id: "handover", label: "Handover" },
  { id: "completed", label: "Completed" },
];

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" {
  if (["completed", "on_track"].includes(value)) return "success";
  if (["high_risk", "urgent_action", "blocked"].includes(value)) return "danger";
  if (["get_ready", "planning", "handover"].includes(value)) return "warning";
  return "neutral";
}

export function ProjectPortfolio({ workspaceId, rows, today }: { workspaceId: string; rows: PortfolioRow[]; today: string }) {
  const router = useRouter();
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
  const handoverLimit = new Date(`${today}T12:00:00Z`);
  handoverLimit.setUTCDate(handoverLimit.getUTCDate() + 30);
  const handoverLimitDay = handoverLimit.toISOString().slice(0, 10);
  const metrics = [
    { label: "High risk", value: rows.filter((row) => ["high_risk", "urgent_action"].includes(row.risk)).length, tone: "danger" },
    { label: "On hold", value: rows.filter((row) => row.onHold).length, tone: "attention" },
    { label: "Overdue actions", value: rows.filter((row) => row.nextActionDate && row.nextActionDate < today).length, tone: "danger" },
    { label: "Handover next 30 days", value: rows.filter((row) => row.handoverDate && row.handoverDate >= today && row.handoverDate <= handoverLimitDay).length, tone: "neutral" },
  ];
  const columns: DataGridColumn<PortfolioRow>[] = [
    { accessorKey: "name", header: "Project", meta: { primary: true, renderCell: (row) => <span className={styles.projectName}>{row.name}</span> } },
    { accessorKey: "customer", header: "Client", meta: { renderCell: (row) => <span className={styles.client}><Avatar name={row.customer} size="sm" />{row.customer}</span> } },
    { accessorKey: "manager", header: "Project manager", meta: { mobileHidden: true, renderCell: (row) => row.manager || "–" } },
    { accessorKey: "nextAction", header: "Next action", meta: { mobileHidden: true, renderCell: (row) => <span className={styles.action} title={row.nextAction || undefined}><span className={styles.actionText}>{row.nextAction || "–"}</span>{row.nextActionDate ? <small>{row.nextActionDate}</small> : null}</span> } },
    { accessorKey: "risk", header: "Risk", meta: { mobileHidden: true, renderCell: (row) => <Badge tone={statusTone(row.onHold ? "blocked" : row.risk)}>{row.onHold ? "On hold" : label(row.risk)}</Badge> } },
    { accessorKey: "phase", header: "Status", meta: { renderCell: (row) => <Badge tone={statusTone(row.phase)}>{row.phase === "active" ? "In progress" : label(row.phase)}</Badge> } },
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

  return <Container as="section" aria-label="Projects" className={styles.page} size="full">
    <PageHeader
      actions={<Button onPress={() => void start()} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />Start project</Button>}
      description={<>{rows.length} project{rows.length === 1 ? "" : "s"} · released from <Link href="/workspace/pre-projects">Pre-execution</Link></>}
      eyebrow="Delivery"
      title="Projects"
    />
    {metrics.some((metric) => metric.value > 0) ? <dl aria-label="Project attention" className={styles.metrics}>
      {metrics.filter((metric) => metric.value > 0).map((metric) => <div data-tone={metric.tone} key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
    </dl> : null}
    <DataGrid
      ariaLabel="Projects"
      columns={columns}
      data={visible}
      emptyTitle={rows.length ? "No matching projects" : "No projects yet"}
      emptyDescription={rows.length ? "Try another view or search." : "Start a project from an active Pre-execution case."}
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
      selectable={false}
      selectedView={status}
    />
    <ControlledModalDialog isOpen={open} onOpenChange={setOpen} title="Start project">
      <Form className={styles.form} onSubmit={createProject}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <SelectField
          isDisabled={busy || !cases.length}
          isRequired
          items={cases.map((item) => ({ id: item.id, label: `${item.title} · ${item.customer}` }))}
          label="Pre-execution case"
          onSelectionChange={(key) => setCaseId(String(key ?? ""))}
          placeholder="Choose a case"
          selectedKey={caseId || null}
        />
        {!busy && !cases.length && !error ? <p className={styles.empty}>No eligible cases are available.</p> : null}
        <div className={styles.formActions}><Button onPress={() => setOpen(false)}>Cancel</Button><Button isDisabled={!caseId} isLoading={busy} type="submit" variant="primary">Create planning workspace</Button></div>
      </Form>
    </ControlledModalDialog>
  </Container>;
}
