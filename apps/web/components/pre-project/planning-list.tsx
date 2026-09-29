"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Badge, Button, Callout, ControlledModalDialog, DataGrid, EmptyState, NoResultsState, PageHeader, personDisplayName, SearchInput, SegmentedControl, SelectField,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import type { PreProjectList, PreProjectListItem } from "@/lib/pre-project/types";
import type { ProjectWorkflowPhase } from "@/lib/projects/workflow-templates";
import { projectDisplayName } from "@/lib/projects/format";
import type { PortfolioRow } from "@/components/projects/project-portfolio";
import { useProjectFormat } from "@/components/project-core/format";
import { StartQualifiedLead } from "./start-qualified-lead";
import styles from "./planning-list.module.css";

export type PlanningGroup = "ready" | "before_deal" | "in_design";
/** Each workflow template's stages and the phase each belongs to (Settings → Projects → workflow), by template code. */
export type WorkflowPhases = Record<string, Record<string, ProjectWorkflowPhase>>;

export type PlanningRow = {
  id: string; title: string; reference?: string; description?: string; customer: string; group: PlanningGroup;
  stage: string; next: string; owner: string | null; amount: string | null; currency: string | null; onHold: boolean;
  href?: string; caseId?: string; projectId?: string; source?: PreProjectListItem;
};

/** A case's planning phase as the person reads it, and what it needs next. */
const CASE_PHASES = {
  discover: { stage: tKey("Requirements"), next: tKey("Capture the requirements") },
  define: { stage: tKey("Scope confirmation"), next: tKey("Confirm the scope") },
  design: { stage: tKey("Design"), next: tKey("Present the design") },
  price: { stage: tKey("Quotation"), next: tKey("Send the quotation") },
  agree: { stage: tKey("Agreement"), next: tKey("Sign the agreement") },
  release: { stage: tKey("Ready for production"), next: tKey("Release to production") },
} as const;

/**
 * What Planning lists: the cases being briefed, designed and priced (not yet a project), and projects whose current
 * workflow stage is still a planning stage (a deal-first route opens the project at the paid deal). Whether a
 * project's stage is planning comes from its workflow template, never from a list of stage keys.
 */
export function planningRows(projects: PortfolioRow[], planning: PreProjectListItem[], workflow: WorkflowPhases = {}, servicePathEnabled = false): PlanningRow[] {
  const linked = new Set(projects.map((project) => project.caseId));
  const cases = new Map(planning.map((item) => [item.id, item]));
  const caseRows: PlanningRow[] = planning.filter((item) => !linked.has(item.id) && item.status !== "cancelled").map((item) => {
    const phase = CASE_PHASES[item.phase ?? "discover"] ?? CASE_PHASES.discover;
    const ready = Boolean(item.qualifiedLead) || item.status === "qualified";
    return {
      id: `case-${item.id}`, title: item.title, description: item.description?.trim() || undefined, customer: item.customerName, group: ready ? "ready" : "before_deal",
      stage: ready ? tKey("Ready to start") : servicePathEnabled ? tKey("Before deal") : phase.stage, next: ready ? tKey("Start planning") : phase.next,
      owner: personDisplayName(item.leadManagerName) || null, amount: item.amount, currency: item.currencyCode,
      onHold: item.status === "on_hold" || ["lost", "abandoned"].includes(item.opportunityStatus ?? ""), caseId: item.id, source: item,
      ...(!item.qualifiedLead ? { href: `/workspace/pre-projects/cases/${item.id}/requirements` } : {}),
    };
  });
  const projectRows: PlanningRow[] = projects.flatMap((item) => {
    const phase = item.workflow ? workflow[item.workflow.templateCode]?.[item.workflow.currentStageKey] : undefined;
    if ((phase ?? item.phase) !== "planning") return [];
    const origin = cases.get(item.caseId);
    return [{
      id: `project-${item.id}`, title: item.name, reference: item.reference, description: item.description?.trim() || origin?.description?.trim() || undefined, customer: item.customer,
      group: "in_design" as const, stage: phase ? item.workflow!.currentStageName : tKey("Execution planning"), next: item.nextAction || item.workflow?.currentStageName || tKey("Execution planning"),
      owner: personDisplayName(item.manager) || null, amount: origin?.amount ?? null, currency: origin?.currencyCode ?? null, onHold: item.onHold,
      // A deal-first project is designed inside the project; otherwise its planning case is where the work is.
      caseId: item.caseId, projectId: item.id, href: servicePathEnabled || !item.caseId
        ? `/workspace/projects/${item.id}/overview?${new URLSearchParams({ projectName: projectDisplayName(item.name) })}` : `/workspace/pre-projects/cases/${item.caseId}/overview`,
    }];
  });
  return [...caseRows, ...projectRows];
}

type Status = "all" | "active" | "hold";

/** Planning (D-31): one list of the cases in planning with their stage, owner, value and next step. */
export function PlanningList({ projects, planning, workflow = {}, projectError, servicePathEnabled = false, initialGroup }: {
  projects: PortfolioRow[]; planning: PreProjectList; workflow?: WorkflowPhases; projectError?: string; servicePathEnabled?: boolean; initialGroup?: PlanningGroup;
}) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [group, setGroup] = useState<"all" | PlanningGroup>(initialGroup ?? "all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lead, setLead] = useState<PreProjectListItem | null>(null);
  const [starting, setStarting] = useState(false);
  const lock = useRef(false);

  const rows = useMemo(() => planningRows(projects, planning.items, workflow, servicePathEnabled), [projects, planning.items, workflow, servicePathEnabled]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => (group === "all" || row.group === group) && (status === "all" || (status === "hold" ? row.onHold : !row.onHold))
      && (!query || [row.title, row.reference ?? "", row.customer, row.owner ?? ""].some((value) => value.toLocaleLowerCase().includes(query))));
  }, [rows, group, status, search]);

  /** A qualified enquiry opens its case the first time it's opened (the case is made then). */
  async function open(row: PlanningRow) {
    if (row.href) { router.push(row.href); return; }
    if (lock.current || !row.source) return;
    if (!row.source.opportunityId) { setLead(row.source); return; }
    lock.current = true; setBusy(row.id); setError("");
    try {
      const response = await fetch(`/api/workspace/pre-projects?workspaceId=${planning.workspaceId}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: row.source.opportunityId }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw Error(result.message ?? t("Could not open planning."));
      router.push(`/workspace/pre-projects/cases/${result.id}/requirements`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not open planning.")); }
    finally { lock.current = false; setBusy(null); }
  }

  const columns = useMemo<DataGridColumn<PlanningRow>[]>(() => [
    { id: "case", header: t("Case"), accessorFn: (row) => `${row.title} ${row.reference ?? ""}`, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      {row.href ? <Link data-tour="case-open" href={row.href}>{projectDisplayName(row.title)}</Link>
        : <button type="button" className={styles.openButton} disabled={Boolean(busy) || !(row.source?.opportunityId ? planning.canCreate : planning.canStartLead)}
            onClick={(event) => { event.stopPropagation(); void open(row); }}>{busy === row.id ? t("Opening…") : projectDisplayName(row.title)}</button>}
      {row.reference || row.description ? <small>{[row.reference, row.description].filter(Boolean).join(" · ")}</small> : null}</span> } },
    { id: "client", header: t("Client"), accessorFn: (row) => row.customer, size: 170 },
    { id: "stage", header: t("Stage"), accessorFn: (row) => translateKnown(t, row.stage), size: 170 },
    { id: "owner", header: t("Owner"), accessorFn: (row) => row.owner ?? "", size: 160, meta: { mobileHidden: true, renderCell: (row) => row.owner ?? <span className={styles.muted}>{t("Unassigned")}</span> } },
    { id: "value", header: t("Value"), accessorFn: (row) => Number(row.amount ?? 0), size: 140, meta: { align: "end", renderCell: (row) => row.amount && row.currency
      ? format.money(row.amount, row.currency) : <span className={styles.muted}>—</span> } },
    { id: "next", header: t("Next step"), accessorFn: (row) => (row.onHold ? t("On hold") : translateKnown(t, row.next)), size: 220, meta: { renderCell: (row) => row.onHold
      ? <Badge tone="warning">{t("On hold")}</Badge> : <span>{translateKnown(t, row.next)}</span> } },
  // `open` reads the latest state through `busy`; the columns only need rebuilding when that changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, format, busy, planning.canCreate, planning.canStartLead]);

  const canStart = planning.canCreate;
  const groups = [{ id: "all", label: t("All") }, { id: "ready", label: t("Ready to start") }, { id: "before_deal", label: servicePathEnabled ? t("Before deal") : t("In planning") },
    { id: "in_design", label: servicePathEnabled ? t("In design") : t("Project open") }];
  const problem = error || projectError || planning.error;

  return <div className={styles.page} data-tour="planning-list">
    <PageHeader title={t("Planning")} actions={<Button variant="primary" onPress={() => setStarting(true)}><Plus aria-hidden="true" size={15} />{t("Start planning")}</Button>} />
    {problem ? <Callout tone="warning" title={t("Some projects could not be loaded")}>{translateKnown(t, problem)}</Callout> : null}
    <DataGrid<PlanningRow>
      ariaLabel={t("Planning")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      onRowAction={(row) => void open(row)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search planning")}
      toolbarLeading={<>
        <SegmentedControl label={t("Planning stage")} value={group} onChange={(value) => setGroup(value as "all" | PlanningGroup)} options={groups} />
        <SelectField label={null} aria-label={t("Project status")} selectedKey={status} onSelectionChange={(key) => setStatus(String(key) as Status)}
          items={[{ id: "all", label: t("All projects") }, { id: "active", label: t("Active") }, { id: "hold", label: t("On hold") }]} />
      </>}
      emptyContent={search.trim() || group !== "all" || status !== "all"
        ? <NoResultsState onClear={() => { setSearch(""); setGroup("all"); setStatus("all"); }} />
        : <EmptyState title={t("Nothing in planning yet")}
            description={servicePathEnabled ? t("A project appears here after the first paid Deal File is approved.") : t("Qualified opportunities appear here, ready to plan.")}
            action={<Button variant="primary" onPress={() => setStarting(true)}>{t("Start planning")}</Button>} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
    {lead ? <StartQualifiedLead workspaceId={planning.workspaceId} lead={lead} onClose={() => setLead(null)} onStarted={(id) => router.push(`/workspace/pre-projects/cases/${id}/requirements`)} /> : null}
    {starting ? <StartPlanningDialog planning={planning} canStart={canStart} onClose={() => setStarting(false)} /> : null}
  </div>;
}

type Candidate = { id: string; title: string; customerName: string; status: string; caseId?: string | null };

/** Start planning from an open or won opportunity; Requirements come first. */
function StartPlanningDialog({ planning, canStart, onClose }: { planning: PreProjectList; canStart: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [search, setSearch] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState("");

  async function load(query: string) {
    if (!canStart) return;
    setLoading(true); setFailure(""); setOpportunityId("");
    try {
      const params = new URLSearchParams({ workspaceId: planning.workspaceId });
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(`/api/workspace/pre-projects/candidates?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message ?? t("Eligible opportunities could not be loaded."));
      if (!Array.isArray(payload.items)) throw Error(t("The opportunity list could not be read. Refresh and try again."));
      setCandidates(payload.items.filter((item: Candidate) => !item.caseId));
      setMore(payload.hasMore === true);
    } catch (cause) { setCandidates([]); setMore(false); setFailure(cause instanceof Error ? cause.message : t("Eligible opportunities could not be loaded.")); }
    finally { setLoading(false); }
  }
  // The first page of opportunities, once, when the dialog opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(() => void load("")); }, []);

  async function create() {
    if (!opportunityId || creating || !canStart) return;
    setCreating(true); setFailure("");
    try {
      const response = await fetch(`/api/workspace/pre-projects?workspaceId=${encodeURIComponent(planning.workspaceId)}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw Error(payload.message ?? t("Planning could not be started."));
      if (!payload.id) throw Error(t("The new planning record could not be confirmed. Refresh Projects before retrying."));
      router.push(`/workspace/pre-projects/cases/${encodeURIComponent(payload.id)}/overview`);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : t("Planning could not be started.")); setCreating(false); }
  }

  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open && !creating) onClose(); }} title={t("Start planning")}
    footer={<div className="wd-dialog-actions"><Button isDisabled={creating} onPress={onClose}>{t("Cancel")}</Button>{canStart
      ? <Button variant="primary" isDisabled={!opportunityId || loading || creating} isLoading={creating} onPress={() => void create()}>{t("Start with requirements")}</Button> : null}</div>}>
    <p>{t("Choose an open or won opportunity. Requirements come first; production is released only after the required approvals.")}</p>
    {failure ? <Callout tone="warning" title={t("Could not start planning")}>{failure}</Callout> : null}
    {planning.error ? <Callout tone="warning" title={t("Planning access could not be checked")}>{translateKnown(t, planning.error)}</Callout>
      : !canStart ? <Callout tone="warning" title={t("Project creation needs access")}>{t("Your account needs Planning create and Opportunities view permissions. Ask your workspace administrator to update your role.")}</Callout>
      : <><div className={styles.candidateSearch}><SearchInput label={t("Search opportunities")} placeholder={t("Find by project or client")} value={search} onChange={setSearch} />
          <Button size="compact" isDisabled={loading} onPress={() => void load(search)}>{t("Find")}</Button></div>
        {loading ? <p role="status">{t("Loading opportunities…")}</p> : candidates.length ? <>
          <SelectField label={t("Opportunity")} isRequired items={candidates.map((item) => ({ id: item.id, label: `${item.title} · ${item.customerName}` }))} selectedKey={opportunityId || null}
            onSelectionChange={(key) => setOpportunityId(String(key ?? ""))} placeholder={t("Choose an opportunity")} />
          {more ? <p className={styles.hint}>{t("More opportunities exist. Search by project or client to find one beyond this list.")}</p> : null}</>
          : !failure ? <p>{t("No eligible opportunities found. Try another search, or start with an enquiry in Sales and qualify it.")}</p> : null}</>}
    <div className={styles.startLinks}><Link href="/workspace/crm/leads?create=true">{t("New enquiry")}</Link><Link href="/workspace/crm/opportunities">{t("View opportunities")}</Link></div>
  </ControlledModalDialog>;
}
