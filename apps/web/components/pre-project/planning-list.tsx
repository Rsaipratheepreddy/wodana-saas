"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Badge, Button, Callout, ControlledModalDialog, DataGrid, EmptyState, ListTabs, NoResultsState, OwnerCell, PageShell, personDisplayName, RecordName, SearchInput, SelectField,
  type DataGridColumn, type ToolbarFilter,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import type { CaseProjectFacts, PreProjectList, PreProjectListItem } from "@/lib/pre-project/types";
import type { ProjectWorkflowPhase } from "@/lib/projects/workflow-templates";
import { projectDisplayName } from "@/lib/projects/format";
import type { PortfolioRow } from "@/components/projects/project-portfolio";
import { useProjectFormat } from "@/components/project-core/format";
import { StartQualifiedLead } from "./start-qualified-lead";
import { caseListStep } from "@/lib/pre-project/case-record";
import styles from "./planning-list.module.css";

export type PlanningGroup = "ready" | "before_deal" | "in_design";
/** Each workflow template's stages and the phase each belongs to (Settings → Projects → workflow), by template code. */
export type WorkflowPhases = Record<string, Record<string, ProjectWorkflowPhase>>;

export type PlanningRow = {
  id: string; title: string; reference?: string; description?: string; customer: string; group: PlanningGroup;
  stage: string; next: string; owner: string | null; amount: string | null; currency: string | null; onHold: boolean;
  /** The values the next step names (the quotation it waits on), when it names one. */
  nextValues?: Record<string, string | number>;
  href?: string; caseId?: string; projectId?: string; source?: PreProjectListItem;
};

/**
 * What Planning lists: the cases being briefed, designed and priced (not yet a project), and projects whose current
 * workflow stage is still a planning stage (a deal-first route opens the project at the paid deal). Whether a
 * project's stage is planning comes from its workflow template, never from a list of stage keys.
 *
 * Where a case belongs is read from the case's own record (its project), so everyone who sees the case sees the same
 * row: a project on staged delivery or finished has left Planning. The viewer's project list (only the projects
 * they're on) fills in only a project the case's record doesn't carry.
 */
export function planningRows(projects: PortfolioRow[], planning: PreProjectListItem[], workflow: WorkflowPhases = {}, servicePathEnabled = false): PlanningRow[] {
  const cases = new Map(planning.map((item) => [item.id, item]));
  const portfolio = new Set(projects.map((project) => project.caseId).filter(Boolean));
  const caseRows: PlanningRow[] = planning.filter((item) => !item.projectId && !item.project && !portfolio.has(item.id) && item.status !== "cancelled").map((item) => {
    // A case's planning phase as the person reads it on its path's own line (PLM-121/126), moved on by its quotations
    // and agreement as its overview reads them, and what it needs next (a sent quotation waits for the client).
    const step = caseListStep({ phase: item.phase ?? "discover", plan: item.plan, designApprovedOn: item.designApprovedOn, designComplete: item.designComplete }, item.commercial);
    const ready = Boolean(item.qualifiedLead) || item.status === "qualified";
    return {
      id: `case-${item.id}`, title: item.title, description: item.description?.trim() || undefined, customer: item.customerName, group: ready ? "ready" : "before_deal",
      stage: ready ? tKey("Ready to start") : servicePathEnabled ? tKey("Before deal") : step.stage, next: ready ? tKey("Start planning") : step.next.key,
      ...(!ready && step.next.values ? { nextValues: step.next.values } : {}),
      owner: personDisplayName(item.leadManagerName) || null, amount: item.amount, currency: item.currencyCode,
      onHold: item.status === "on_hold" || ["lost", "abandoned"].includes(item.opportunityStatus ?? ""), caseId: item.id, source: item,
      ...(!item.qualifiedLead ? { href: `/workspace/pre-projects/cases/${item.id}/requirements` } : {}),
    };
  });
  const facts: CaseProjectFacts[] = [
    ...planning.flatMap((item) => item.project ? [item.project] : []),
    ...projects.filter((item) => !cases.get(item.caseId)?.project).map((item): CaseProjectFacts => ({ id: item.id, caseId: item.caseId, name: item.name, reference: item.reference,
      status: "active", onHold: item.onHold, managerName: item.manager, nextAction: item.nextAction, staged: false, stageName: null, phase: item.phase, workflow: item.workflow ?? null })),
  ];
  const portfolioRows = new Map(projects.map((item) => [item.id, item]));
  const projectRows: PlanningRow[] = facts.flatMap((item) => {
    // Staged delivery and finished projects are in Projects, not Planning.
    if (item.staged || ["completed", "cancelled", "archived"].includes(item.status)) return [];
    const phase = item.workflow ? workflow[item.workflow.templateCode]?.[item.workflow.currentStageKey] : undefined;
    if ((phase ?? item.phase) !== "planning") return [];
    const origin = cases.get(item.caseId);
    const listed = portfolioRows.get(item.id);
    return [{
      id: `project-${item.id}`, title: item.name, reference: item.reference, description: origin?.description?.trim() || listed?.description?.trim() || undefined,
      customer: origin?.customerName ?? listed?.customer ?? "",
      group: "in_design" as const, stage: phase ? item.workflow!.currentStageName : tKey("Execution planning"), next: item.nextAction || item.workflow?.currentStageName || tKey("Execution planning"),
      owner: personDisplayName(item.managerName) || null, amount: origin?.amount ?? null, currency: origin?.currencyCode ?? null, onHold: item.onHold,
      // Planning opens the planning case; a project without one opens its plan.
      caseId: item.caseId, projectId: item.id, href: item.caseId
        ? `/workspace/pre-projects/cases/${item.caseId}/overview` : `/workspace/projects/${item.id}/plan?${new URLSearchParams({ projectName: projectDisplayName(item.name, origin?.customerName ?? listed?.customer) })}`,
    }];
  });
  return [...caseRows, ...projectRows];
}

/** The case name inside its link: it reads "Opening…" while the case loads, so a single click visibly lands. */
function CaseLinkLabel({ title }: { title: string }) {
  const t = useT();
  const { pending } = useLinkStatus();
  return <span aria-busy={pending || undefined}>{pending ? t("Opening…") : title}</span>;
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
    { id: "case", header: t("Case"), accessorFn: (row) => `${row.title} ${row.reference ?? ""} ${row.customer}`, size: 320, meta: { primary: true, interactive: true, renderCell: (row) => <span title={row.description}>
      <RecordName detail={[row.customer, row.reference].filter(Boolean).join(" · ")} title={row.href ? <Link className={styles.open} data-tour="case-open" href={row.href}><CaseLinkLabel title={projectDisplayName(row.title, row.customer)} /></Link>
        : <button type="button" className={styles.open} disabled={Boolean(busy) || !(row.source?.opportunityId ? planning.canCreate : planning.canStartLead)}
            onClick={(event) => { event.stopPropagation(); void open(row); }}>{busy === row.id ? t("Opening…") : projectDisplayName(row.title, row.customer)}</button>} />
    </span> } },
    { id: "stage", header: t("Stage"), accessorFn: (row) => (row.onHold ? t("On hold") : translateKnown(t, row.stage)), size: 150, meta: { renderCell: (row) => row.onHold
      ? <Badge tone="warning">{t("On hold")}</Badge> : <Badge tone={row.group === "in_design" ? "info" : "neutral"}>{translateKnown(t, row.stage)}</Badge> } },
    { id: "next", header: t("Next step"), accessorFn: (row) => (row.nextValues ? t(row.next as MessageKey, row.nextValues) : translateKnown(t, row.next)), size: 200, meta: { priority: "medium" } },
    { id: "owner", header: t("Owner"), accessorFn: (row) => row.owner ?? "", size: 150, meta: { priority: "low", renderCell: (row) => <OwnerCell fallback={t("Unassigned")} person={row.owner} /> } },
    { id: "value", header: t("Value"), accessorFn: (row) => Number(row.amount ?? 0), size: 120, meta: { align: "end", renderCell: (row) => row.amount && row.currency
      ? format.money(row.amount, row.currency) : <span className={styles.muted}>—</span> } },
  // `open` reads the latest state through `busy`; the columns only need rebuilding when that changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, format, busy, planning.canCreate, planning.canStartLead]);

  const canStart = planning.canCreate;
  // Only "Ready to start" asks for action, so only it shows a count.
  const groups: Array<{ id: "all" | PlanningGroup; label: string; count?: number }> = [{ id: "all", label: t("All") },
    { id: "ready", label: t("Ready to start"), count: rows.filter((row) => row.group === "ready" && !row.onHold).length },
    { id: "before_deal", label: servicePathEnabled ? t("Before deal") : t("In planning") }, { id: "in_design", label: servicePathEnabled ? t("In design") : t("Project open") }];
  const filters: ToolbarFilter[] = [{ id: "status", label: t("Status"), options: [{ id: "active", label: t("Active") }, { id: "hold", label: t("On hold") }],
    value: status === "all" ? undefined : status, onChange: (value) => setStatus((value as Status | undefined) ?? "all") }];
  const problem = error || projectError || planning.error;

  return <div data-tour="planning-list"><PageShell title={t("Planning")} action={<Button variant="primary" onPress={() => setStarting(true)}><Plus aria-hidden="true" size={15} />{t("Start planning")}</Button>}
    tabs={<ListTabs label={t("Planning stage")} items={groups} value={group} onChange={setGroup} />}>
    {problem ? <Callout tone="warning" title={t("Some projects could not be loaded")}>{translateKnown(t, problem)}</Callout> : null}
    <DataGrid<PlanningRow>
      gridKey="planning.list"
      ariaLabel={t("Planning")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      onRowAction={(row) => void open(row)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search planning")}
      filters={filters}
      emptyContent={search.trim() || group !== "all" || status !== "all"
        ? <NoResultsState onClear={() => { setSearch(""); setGroup("all"); setStatus("all"); }} />
        : <EmptyState title={t("Nothing in planning yet")}
            description={servicePathEnabled ? t("A project appears here after the first paid Deal File is approved.") : t("Qualified opportunities appear here, ready to plan.")}
            action={<Button variant="primary" onPress={() => setStarting(true)}>{t("Start planning")}</Button>} />}
      rowNumbers={false}
      selectable={false}
    />
    {lead ? <StartQualifiedLead workspaceId={planning.workspaceId} lead={lead} onClose={() => setLead(null)} onStarted={(id) => router.push(`/workspace/pre-projects/cases/${id}/requirements`)} /> : null}
    {starting ? <StartPlanningDialog planning={planning} canStart={canStart} onClose={() => setStarting(false)} /> : null}
  </PageShell></div>;
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
