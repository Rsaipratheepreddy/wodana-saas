"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, Coins, ListChecks, RefreshCw, UsersRound } from "lucide-react";
import { Badge, Button, DataGrid, DesignSystemProvider, EmptyState, ErrorState, formatDate, IconButton, InlineNotice, ListTabs, OwnerCell, PageShell, RecordName, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { money } from "@/lib/commercial/client";
import { casePhaseLabel, casePhases, casePriorityLabel, caseRiskLabel, caseStatusLabel, caseStatusTone, riskTone } from "./case-spine";
import { caseHref, requirementViews, PRE_PROJECT_ROOT, listSearch, type PreProjectList, type PreProjectListItem } from "@/lib/pre-project/types";
import { StartQualifiedLead } from "./start-qualified-lead";
import styles from "./pre-project.module.css";

const statusLabel = caseStatusLabel;
function dateCell(value: string | null | undefined, region: { locale: string; timeZone: string }, fallback = "—") {
  if (!value) return fallback;
  // A calendar date (no time) is the same day everywhere; a timestamp shows in the workspace time zone.
  const dateOnly = value.length === 10;
  return formatDate(dateOnly ? `${value}T00:00:00Z` : value, { locale: region.locale, timeZone: dateOnly ? "UTC" : region.timeZone }, { day: "numeric", month: "short", year: "numeric" });
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
  const { locale, currency, timeZone } = useDesignSystem();
  const region = { locale, timeZone };
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
      if (!response.ok) throw new Error(data.message ?? t("Planning could not be started."));
      router.push(destination(data.id));
    } catch (error) { setStartError(error instanceof Error ? error.message : t("Planning could not be started.")); setOpeningId(null); }
  };
  const columns: DataGridColumn<PreProjectListItem>[] = [
    { id: "title", header: t("Case"), size: 280, accessorFn: record => `${record.title} ${record.customerName}`, meta: { primary: true, interactive: true, headerIcon: <BriefcaseBusiness size={14}/> }, cell: ({ row: { original: record } }) => <RecordName detail={record.customerName}
      title={record.qualifiedLead ? <span title={record.title}>{record.title}</span> : <Link className={styles.qualifiedName} title={record.title} href={destination(record.id)}>{record.title}</Link>} /> },
    { id: "phase", header: t("Phase"), size: 150, accessorFn: record => record.qualifiedLead ? t("Ready to start") : record.phase ? t(casePhaseLabel[record.phase]) : "—", filterFn: "equalsString", meta: { headerIcon: <ListChecks size={14}/>, filterOptions: casePhases.map(phase => ({ id: t(casePhaseLabel[phase]), label: t(casePhaseLabel[phase]) })) }, cell: ({ row: { original: record } }) => record.qualifiedLead ? <span className={styles.qualifiedMuted}>{t("Ready to start")}</span> : record.phase ? <span className={styles.phaseCell}><i data-step={casePhases.indexOf(record.phase) + 1} aria-hidden="true" /><span>{t(casePhaseLabel[record.phase])}</span><small>{casePhases.indexOf(record.phase) + 1}/{casePhases.length}</small></span> : "—" },
    { id: "status", header: t("Status"), size: 120, accessorFn: record => t(statusLabel(record.status)), filterFn: "equalsString", meta: { headerIcon: <CheckCircle2 size={14}/>, filterOptions: ["qualified", "draft", "active", "on_hold", "released", "cancelled"].map(status => ({ id: t(statusLabel(status as PreProjectListItem["status"])), label: t(statusLabel(status as PreProjectListItem["status"])) })) }, cell: ({ row: { original: record } }) => <Badge tone={caseStatusTone(record.status)}>{t(statusLabel(record.status))}</Badge> },
    { id: "leadManagerName", header: t("Owner"), size: 170, meta: { priority: "medium", headerIcon: <UsersRound size={14}/> }, accessorFn: record => record.leadManagerName ?? t("Unassigned"), cell: ({ row: { original: record } }) => <OwnerCell fallback={t("Unassigned")} person={record.leadManagerName} /> },
    { id: "amount", header: t("Value"), size: 140, accessorFn: record => Number(record.amount ?? 0), meta: { align: "end", headerIcon: <Coins size={14}/> }, cell: ({ row: { original: record } }) => record.amount ? <span className={styles.money}>{money(Number(record.amount), record.currencyCode ?? currency, locale)}</span> : <span className={styles.qualifiedMuted}>—</span> },
    { id: "targetDate", header: t("Target"), size: 120, meta: { priority: "low" }, accessorFn: record => record.targetDate ?? "", cell: ({ row: { original: record } }) => dateCell(record.targetDate, region, t("No target")) },
    { id: "priority", header: t("Priority"), size: 100, meta: { priority: "low" }, accessorFn: record => record.priority ?? "normal", cell: ({ row: { original: record } }) => <span className={styles.capitalize} data-priority={record.priority}>{t(casePriorityLabel[record.priority ?? "normal"])}</span> },
    { id: "risk", header: t("Risk"), size: 100, meta: { priority: "low" }, accessorFn: record => record.riskLevel ?? "none", cell: ({ row: { original: record } }) => <Badge tone={riskTone(record.riskLevel ?? "none")}>{t(caseRiskLabel[record.riskLevel ?? "none"])}</Badge> },
    { accessorKey: "updatedAt", header: t("Updated"), size: 120, meta: { priority: "low" }, cell: ({ row: { original: record } }) => <time dateTime={record.updatedAt}>{dateCell(record.updatedAt, region)}</time> },
    { accessorKey: "createdAt", header: t("Created"), size: 120, meta: { priority: "low" }, cell: ({ row: { original: record } }) => <time dateTime={record.createdAt} title={t(record.qualifiedLead ? "Qualified" : "Opened")}>{dateCell(record.createdAt, region)}</time> },
    { id: "action", header: t("Action"), size: 110, enableSorting: false, enableColumnFilter: false, enableHiding: false, cell: ({ row: { original: record } }) => record.qualifiedLead ? <Button size="compact" variant="primary" isDisabled={!canStart(record)} isLoading={openingId === record.id} onPress={() => void startQualified(record)} aria-label={t("Start {title}", { title: record.title })}>{t("Start")}</Button> : <Link className={styles.qualifiedOpen} aria-label={t("Open {title}", { title: record.title })} href={destination(record.id)}>{t("Open")} <ArrowUpRight size={13} aria-hidden="true"/></Link> },
  ];
  const visibleItems = initialData.items.filter((record) => view === "all"
    || (view === "qualified" && record.qualifiedLead)
    || (view === "on_hold" && record.status === "on_hold")
    || (view === "released" && record.status === "released")
    || (view === "active" && !record.qualifiedLead && Boolean(record.phase) && !["on_hold", "released", "cancelled"].includes(record.status))
    || (!record.qualifiedLead && record.phase === view && !["on_hold", "released", "cancelled"].includes(record.status)));
  const inTab = (id: string) => initialData.items.filter((record) => id === "all" || (id === "qualified" && record.qualifiedLead) || (id === "on_hold" && record.status === "on_hold") || (id === "released" && record.status === "released") || (id === "active" && !record.qualifiedLead && Boolean(record.phase) && !["on_hold", "released", "cancelled"].includes(record.status))).length;
  const filtered = Boolean(appliedSearch) || page > 1 || view !== "all";
  const clear = () => { setTerm(""); setView("all"); update({ search: "", page: "" }); };
  return <DesignSystemProvider className={styles.qualifiedProvider} portalContainer={portal} ref={setPortal}>
    <PageShell aria-label={t(salesPreparation ? "Sales preparation workspace" : "Planning cases workspace")} title={t(salesPreparation ? "Sales preparation" : "Planning")}
      tabs={initialData.error ? undefined : <ListTabs label={t("Case lists")} value={view} onChange={setView} items={[{ id: "all", label: t("All") }, { id: "qualified", label: t("Ready to start"), count: inTab("qualified") }, { id: "active", label: t("In progress") }, { id: "on_hold", label: t("On hold") }, { id: "released", label: t("Released") }]} />}>
      {startError ? <InlineNotice tone="error" message={startError} /> : null}
      {params.has("section") ? <p className={styles.hint}>{t("Select a planning to open this section.")}</p> : null}
      {initialData.error ? <ErrorState title={t("Preparation cases could not be loaded")} description={initialData.error} onRetry={() => router.refresh()} /> : <div aria-busy={pending}><DataGrid ariaLabel={t(salesPreparation ? "Sales preparation cases" : "Planning cases")} columns={columns} data={visibleItems} getRowId={record => record.id} rowNumbers={false} selectable={false} persistKey={salesPreparation ? "sales-preparation-cases" : "pre-project-cases"}
        searchLabel={t("Search cases")} searchValue={term} onSearchChange={value => setTerm(value.slice(0, 200))}
        exportFileName="planning-cases.csv" manualPagination page={page} pageSize={24} pageCount={Math.ceil(initialData.total / 24)}
        onPageChange={next => update({ page: next > 1 ? String(next) : "" })} totalRowCount={initialData.total} hasMoreRows={initialData.total > initialData.items.length}
        isLoading={pending}
        onRowAction={record => record.qualifiedLead ? void startQualified(record) : router.push(destination(record.id))}
        emptyContent={filtered ? <EmptyState illustration="search" title={t("No matching cases")} description={t("Try another view or clear the search.")} action={<Button variant="quiet" onPress={clear}>{t("Clear search")}</Button>} />
          : <EmptyState title={t(salesPreparation ? "No deals in preparation" : "No planning cases yet")} description={t(salesPreparation ? "Qualify an enquiry, then prepare its quotation and first approval here. The project opens after the paid Deal File is approved." : "Qualify an enquiry in CRM and it appears here, ready to start.")}
            action={<Link className="wd-button" data-size="compact" data-variant="primary" href="/workspace/crm/leads">{t("Open Leads")}</Link>} />}
        footerActions={<>{appliedSearch || page > 1 ? <Button size="compact" variant="quiet" onPress={clear}>{t("Clear search")}</Button> : null}<IconButton size="compact" aria-label={t("Refresh cases")} onPress={() => router.refresh()}><RefreshCw size={14}/></IconButton></>}
      /></div>}
    </PageShell>
    {qualifiedLead ? <StartQualifiedLead workspaceId={initialData.workspaceId} lead={qualifiedLead} onClose={() => setQualifiedLead(null)} onStarted={(id) => router.push(destination(id))} /> : null}
  </DesignSystemProvider>;
}
