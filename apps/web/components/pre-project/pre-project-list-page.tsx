"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, Coins, ContactRound, ListChecks, RefreshCw, UsersRound } from "lucide-react";
import { Avatar, Badge, Button, Callout, DataGrid, DesignSystemProvider, IconButton, ListTabs, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { money } from "@/lib/commercial/client";
import { casePhaseLabel, casePhases, caseStatusLabel, caseStatusTone, riskTone } from "./case-spine";
import { caseHref, requirementViews, PRE_PROJECT_ROOT, listSearch, type PreProjectList, type PreProjectListItem } from "@/lib/pre-project/types";
import { StartQualifiedLead } from "./start-qualified-lead";
import styles from "./pre-project.module.css";

const statusLabel = caseStatusLabel;
function dateCell(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function PreProjectListPage({ initialData, search, basePath = PRE_PROJECT_ROOT, salesPreparation = false }: { initialData: PreProjectList; search: string; basePath?: string; salesPreparation?: boolean }) {
  const router = useRouter();
  const params = listSearch(new URLSearchParams(search));
  const page = Number(params.get("page") ?? 1);
  const appliedSearch = params.get("search") ?? "";
  const [term, setTerm] = useState(appliedSearch);
  const [searchSnapshot, setSearchSnapshot] = useState(search);
  const [requestedSearch, setRequestedSearch] = useState(appliedSearch);
  // Keep a draft while its server result arrives; browser navigation restores URL search.
  if (searchSnapshot !== search) {
    setSearchSnapshot(search);
    if (appliedSearch !== requestedSearch) setTerm(appliedSearch);
  }
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [qualifiedLead, setQualifiedLead] = useState<PreProjectListItem | null>(null);
  const t = useT();
  const [view, setView] = useState("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const [pending, startTransition] = useTransition();
  const update = useCallback((values: Record<string, string>) => {
    const next = listSearch(new URLSearchParams(search));
    if ("search" in values) next.delete("page");
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setRequestedSearch(next.get("search") ?? "");
    startTransition(() => router.replace(`${basePath}${next.size ? `?${next}` : ""}`));
  }, [basePath, router, search]);
  useEffect(() => {
    if (term.trim() === appliedSearch) return;
    const timer = setTimeout(() => update({ search: term.trim() }), 300);
    return () => clearTimeout(timer);
  }, [term, appliedSearch, update]);
  const destination = (id: string) => caseHref(id, params, ["overview", ...requirementViews.map(item => item.section), "definition", "designs", "quotations", "client-portal"].includes(params.get("section") ?? "") ? params.get("section")! : "requirements");
  const canStart = (record: PreProjectListItem) => !pending && !openingId && Boolean(record.opportunityId ? initialData.canCreate : initialData.canStartLead);
  const startQualified = async (record: PreProjectListItem) => {
    if (!canStart(record)) return;
    setStartError("");
    if (!record.opportunityId) { setQualifiedLead(record); return; }
    setOpeningId(record.id);
    try {
      const response = await fetch(`/api/workspace/pre-projects?workspaceId=${initialData.workspaceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: record.opportunityId }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Planning could not be started.");
      router.push(destination(data.id));
    } catch (error) { setStartError(error instanceof Error ? error.message : "Planning could not be started."); setOpeningId(null); }
  };
  const columns: DataGridColumn<PreProjectListItem>[] = [
    { accessorKey: "customerName", header: "Client", size: 200, meta: { primary: true, headerIcon: <ContactRound size={14}/> }, cell: ({ row: { original: record } }) => <div className={styles.qualifiedIdentity}><Avatar name={record.customerName} size="sm"/><span title={record.customerName}>{record.customerName}</span></div> },
    { accessorKey: "title", header: "Case", size: 220, meta: { headerIcon: <BriefcaseBusiness size={14}/> }, cell: ({ row: { original: record } }) => record.qualifiedLead ? <span className={styles.qualifiedName} title={record.title}>{record.title}</span> : <Link className={styles.qualifiedName} title={record.title} href={destination(record.id)}>{record.title}</Link> },
    { id: "phase", header: "Phase", size: 150, accessorFn: record => record.qualifiedLead ? "Ready to start" : record.phase ? casePhaseLabel[record.phase] : "—", filterFn: "equalsString", meta: { headerIcon: <ListChecks size={14}/>, filterOptions: casePhases.map(phase => ({ id: casePhaseLabel[phase], label: casePhaseLabel[phase] })) }, cell: ({ row: { original: record } }) => record.qualifiedLead ? <span className={styles.qualifiedMuted}>Ready to start</span> : record.phase ? <span className={styles.phaseCell}><i data-step={casePhases.indexOf(record.phase) + 1} aria-hidden="true" /><span>{casePhaseLabel[record.phase]}</span><small>{casePhases.indexOf(record.phase) + 1}/{casePhases.length}</small></span> : "—" },
    { id: "status", header: "Status", size: 120, accessorFn: record => statusLabel(record.status), filterFn: "equalsString", meta: { headerIcon: <CheckCircle2 size={14}/>, filterOptions: ["qualified", "draft", "active", "on_hold", "released", "cancelled"].map(status => ({ id: statusLabel(status as PreProjectListItem["status"]), label: statusLabel(status as PreProjectListItem["status"]) })) }, cell: ({ row: { original: record } }) => <Badge tone={caseStatusTone(record.status)}>{statusLabel(record.status)}</Badge> },
    { id: "leadManagerName", header: "Owner", size: 170, meta: { headerIcon: <UsersRound size={14}/> }, accessorFn: record => record.leadManagerName ?? "Unassigned", cell: ({ row: { original: record } }) => record.leadManagerName ? <div className={styles.qualifiedIdentity}><Avatar name={record.leadManagerName} size="sm"/><span title={record.leadManagerName}>{record.leadManagerName}</span></div> : <span className={styles.qualifiedMuted}>Unassigned</span> },
    { id: "amount", header: "Value", size: 140, accessorFn: record => Number(record.amount ?? 0), meta: { align: "end", headerIcon: <Coins size={14}/> }, cell: ({ row: { original: record } }) => record.amount ? <span className={styles.money}>{money(Number(record.amount), record.currencyCode ?? "AED")}</span> : <span className={styles.qualifiedMuted}>—</span> },
    { id: "targetDate", header: "Target", size: 120, accessorFn: record => record.targetDate ?? "", cell: ({ row: { original: record } }) => dateCell(record.targetDate, "No target") },
    { id: "priority", header: "Priority", size: 100, accessorFn: record => record.priority ?? "normal", cell: ({ row: { original: record } }) => <span className={styles.capitalize} data-priority={record.priority}>{record.priority ?? "normal"}</span> },
    { id: "risk", header: "Risk", size: 100, accessorFn: record => record.riskLevel ?? "none", cell: ({ row: { original: record } }) => <Badge tone={riskTone(record.riskLevel ?? "none")}>{record.riskLevel && record.riskLevel !== "none" ? record.riskLevel : "None"}</Badge> },
    { accessorKey: "updatedAt", header: "Updated", size: 120, meta: { mobileHidden: true }, cell: ({ row: { original: record } }) => <time dateTime={record.updatedAt}>{dateCell(record.updatedAt)}</time> },
    { accessorKey: "createdAt", header: "Created", size: 120, meta: { mobileHidden: true }, cell: ({ row: { original: record } }) => <time dateTime={record.createdAt} title={record.qualifiedLead ? "Qualified" : "Opened"}>{dateCell(record.createdAt)}</time> },
    { id: "action", header: "Action", size: 110, enableSorting: false, enableColumnFilter: false, enableHiding: false, cell: ({ row: { original: record } }) => record.qualifiedLead ? <Button size="compact" variant="primary" isDisabled={!canStart(record)} isLoading={openingId === record.id} onPress={() => void startQualified(record)} aria-label={`Start ${record.title}`}>Start</Button> : <Link className={styles.qualifiedOpen} aria-label={`Open ${record.title}`} href={destination(record.id)}>Open <ArrowUpRight size={13} aria-hidden="true"/></Link> },
  ];
  const visibleItems = initialData.items.filter((record) => view === "all"
    || (view === "qualified" && record.qualifiedLead)
    || (view === "on_hold" && record.status === "on_hold")
    || (view === "released" && record.status === "released")
    || (view === "active" && !record.qualifiedLead && Boolean(record.phase) && !["on_hold", "released", "cancelled"].includes(record.status))
    || (!record.qualifiedLead && record.phase === view && !["on_hold", "released", "cancelled"].includes(record.status)));
  const inTab = (id: string) => initialData.items.filter((record) => id === "all" || (id === "qualified" && record.qualifiedLead) || (id === "on_hold" && record.status === "on_hold") || (id === "released" && record.status === "released") || (id === "active" && !record.qualifiedLead && Boolean(record.phase) && !["on_hold", "released", "cancelled"].includes(record.status))).length;
  return <DesignSystemProvider className={styles.qualifiedProvider} portalContainer={portal} ref={setPortal}>
    <section className={`${styles.page} ${styles.preProjectPage} ${styles.qualifiedPage}`} aria-label={salesPreparation ? "Sales preparation workspace" : "Planning cases workspace"} aria-busy={pending}>
      {startError ? <p role="alert" className={styles.hint}>{startError}</p> : null}
      {params.has("section") ? <p className={styles.hint}>Select a planning to open this section.</p> : null}
      <div data-sales-grid>{initialData.error ? <Callout tone="danger" title="Preparation cases could not be loaded" actions={<Button size="compact" onPress={() => router.refresh()}>Try again</Button>}>{initialData.error}</Callout> : <DataGrid ariaLabel={salesPreparation ? "Sales preparation cases" : "Planning cases"} columns={columns} data={visibleItems} getRowId={record => record.id} rowNumbers={false} selectable={false} toolbarLeading={<ListTabs label={t("Case lists")} value={view} onChange={setView} items={[{ id: "all", label: t("All") }, { id: "qualified", label: t("Ready to start"), count: inTab("qualified") }, { id: "active", label: t("In progress"), count: inTab("active") }, { id: "on_hold", label: t("On hold"), count: inTab("on_hold") }, { id: "released", label: t("Released"), count: inTab("released") }]} />} persistKey={salesPreparation ? "sales-preparation-cases" : "pre-project-cases"}
        searchLabel="Search cases" searchValue={term} onSearchChange={value => setTerm(value.slice(0, 200))}
        exportFileName="planning-cases.csv" manualPagination page={page} pageSize={24} pageCount={Math.ceil(initialData.total / 24)}
        onPageChange={next => update({ page: next > 1 ? String(next) : "" })} totalRowCount={initialData.error ? undefined : initialData.total} hasMoreRows={initialData.total > initialData.items.length}
        error={initialData.error} isLoading={pending}
        onRowAction={record => record.qualifiedLead ? void startQualified(record) : router.push(destination(record.id))}
        emptyTitle={appliedSearch || page > 1 || view !== "all" ? "No matching cases" : salesPreparation ? "No deals in preparation" : "No planning cases yet"}
        emptyDescription={appliedSearch || page > 1 || view !== "all" ? "Try another view or clear the search." : salesPreparation ? "Qualify an enquiry, then prepare its quotation and first approval here. The project opens after the paid Deal File is approved." : "Qualify an enquiry in CRM and it appears here, ready to start."}
        footerActions={<>{initialData.error ? <Button size="compact" onPress={() => router.refresh()}>Try again</Button> : appliedSearch || page > 1 ? <Button size="compact" variant="quiet" onPress={() => { setTerm(""); update({ search: "", page: "" }); }}>Clear search</Button> : !initialData.items.length ? <Link className={styles.qualifiedOpen} href="/workspace/crm/leads">Open Leads <ArrowUpRight size={14}/></Link> : null}<IconButton size="compact" aria-label="Refresh cases" onPress={() => router.refresh()}><RefreshCw size={14}/></IconButton></>}
      />}</div>
    </section>
    {qualifiedLead ? <StartQualifiedLead workspaceId={initialData.workspaceId} lead={qualifiedLead} onClose={() => setQualifiedLead(null)} onStarted={(id) => router.push(destination(id))} /> : null}
  </DesignSystemProvider>;
}
