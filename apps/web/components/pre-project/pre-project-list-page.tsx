"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Archive, ArrowUpRight, BriefcaseBusiness, CalendarDays, CircleCheck, Clock3, ContactRound, RefreshCw, UsersRound } from "lucide-react";
import { Avatar, Button, Callout, DataGrid, DesignSystemProvider, IconButton, type DataGridColumn } from "@/design-system";
import { caseHref, requirementViews, PRE_PROJECT_ROOT, listSearch, type PreProjectList, type PreProjectListItem } from "@/lib/pre-project/types";
import { StartQualifiedLead } from "./start-qualified-lead";
import styles from "./pre-project.module.css";

const statusLabel = (status: PreProjectListItem["status"]) => status === "active" ? "In progress" : status[0].toUpperCase() + status.slice(1);

export function PreProjectListPage({ initialData, search }: { initialData: PreProjectList; search: string }) {
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
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const [pending, startTransition] = useTransition();
  const update = useCallback((values: Record<string, string>) => {
    const next = listSearch(new URLSearchParams(search));
    if ("search" in values) next.delete("page");
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setRequestedSearch(next.get("search") ?? "");
    startTransition(() => router.replace(`${PRE_PROJECT_ROOT}${next.size ? `?${next}` : ""}`));
  }, [router, search]);
  useEffect(() => {
    if (term.trim() === appliedSearch) return;
    const timer = setTimeout(() => update({ search: term.trim() }), 300);
    return () => clearTimeout(timer);
  }, [term, appliedSearch, update]);
  const destination = (id: string) => caseHref(id, params, [...requirementViews.map(item => item.section), "designs", "quotations", "client-portal"].includes(params.get("section") ?? "") ? params.get("section")! : "requirements");
  const canStart = (record: PreProjectListItem) => !pending && !openingId && Boolean(record.opportunityId ? initialData.canCreate : initialData.canStartLead);
  const startQualified = async (record: PreProjectListItem) => {
    if (!canStart(record)) return;
    setStartError("");
    if (!record.opportunityId) { setQualifiedLead(record); return; }
    setOpeningId(record.id);
    try {
      const response = await fetch(`/api/workspace/pre-projects?workspaceId=${initialData.workspaceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: record.opportunityId }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Pre-execution could not be started.");
      router.push(destination(data.id));
    } catch (error) { setStartError(error instanceof Error ? error.message : "Pre-execution could not be started."); setOpeningId(null); }
  };
  const columns: DataGridColumn<PreProjectListItem>[] = [
    { accessorKey: "customerName", header: "Client", size: 210, meta: { headerIcon: <ContactRound size={14}/> }, cell: ({ row: { original: record } }) => <div className={styles.qualifiedIdentity}><Avatar name={record.customerName} size="sm"/><span title={record.customerName}>{record.customerName}</span></div> },
    { accessorKey: "title", header: "Pre-execution", size: 290, meta: { headerIcon: <BriefcaseBusiness size={14}/> }, cell: ({ row: { original: record } }) => record.qualifiedLead ? <button type="button" className={styles.qualifiedName} disabled={!canStart(record)} onClick={() => void startQualified(record)} title={record.title}>{record.title}</button> : <Link className={styles.qualifiedName} title={record.title} href={destination(record.id)}>{record.title}</Link> },
    { id: "leadManagerName", header: "Lead manager", size: 205, accessorFn: record => record.leadManagerName ?? "Unassigned", meta: { headerIcon: <UsersRound size={14}/> }, cell: ({ row: { original: record } }) => record.leadManagerName ? <div className={styles.qualifiedIdentity}><Avatar name={record.leadManagerName} size="sm"/><span title={record.leadManagerName}>{record.leadManagerName}</span></div> : <span className={styles.qualifiedMuted}>Unassigned</span> },
    { id: "status", header: "Status", size: 140, accessorFn: record => statusLabel(record.status), filterFn: "equalsString", meta: { headerIcon: <CircleCheck size={14}/>, filterOptions: ["qualified", "active", "released", "archived"].map(status => ({ id: statusLabel(status as PreProjectListItem["status"]), label: statusLabel(status as PreProjectListItem["status"]) })) }, cell: ({ row: { original: record } }) => {
      const Icon = record.status === "active" ? Clock3 : ["released", "qualified"].includes(record.status) ? CircleCheck : Archive;
      return <span className={styles.qualifiedStatus} data-status={record.status}><Icon size={13} aria-hidden="true"/>{statusLabel(record.status)}</span>;
    } },
    { accessorKey: "createdAt", header: "Created", size: 135, meta: { headerIcon: <CalendarDays size={14}/> }, cell: ({ row: { original: record } }) => <time dateTime={record.createdAt} title={record.qualifiedLead ? "Qualified" : "Opened"}>{new Date(record.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time> },
    { id: "action", header: "Action", size: 100, enableSorting: false, enableColumnFilter: false, enableHiding: false, cell: ({ row: { original: record } }) => record.qualifiedLead ? <Button size="compact" variant="primary" isDisabled={!canStart(record)} isLoading={openingId === record.id} onPress={() => void startQualified(record)} aria-label={`Start ${record.title}`}>Start</Button> : <Link className={styles.qualifiedOpen} aria-label={`Open ${record.title}`} href={destination(record.id)}>Open <ArrowUpRight size={14} aria-hidden="true"/></Link> },
  ];
  return <DesignSystemProvider className={styles.qualifiedProvider} portalContainer={portal} ref={setPortal}>
    <section className={`${styles.page} ${styles.preProjectPage} ${styles.qualifiedPage}`} aria-label="Qualified leads workspace" aria-busy={pending}>
      <h1 className="wd-visually-hidden">Qualified leads</h1>
      {startError ? <p role="alert" className={styles.hint}>{startError}</p> : null}
      {params.has("section") ? <p className={styles.hint}>Select a pre-execution to open this section.</p> : null}
      {initialData.error ? <Callout tone="danger" title="Qualified leads could not be loaded" actions={<Button size="compact" onPress={() => router.refresh()}>Try again</Button>}>{initialData.error}</Callout> : <DataGrid ariaLabel="Qualified leads" columns={columns} data={initialData.items} getRowId={record => record.id}
        searchLabel="Search qualified leads" searchValue={term} onSearchChange={value => setTerm(value.slice(0, 200))}
        exportFileName="qualified-leads.csv" manualPagination page={page} pageSize={24} pageCount={Math.ceil(initialData.total / 24)}
        onPageChange={next => update({ page: next > 1 ? String(next) : "" })} totalRowCount={initialData.error ? undefined : initialData.total} hasMoreRows={initialData.total > initialData.items.length}
        error={initialData.error} isLoading={pending}
        onRowAction={record => record.qualifiedLead ? void startQualified(record) : router.push(destination(record.id))}
        emptyTitle={appliedSearch || page > 1 ? "No matching qualified leads" : "No qualified leads yet"}
        emptyDescription={appliedSearch || page > 1 ? "Try another search or clear the filters." : "Qualified leads appear here, ready to start a pre-execution."}
        footerActions={<>{initialData.error ? <Button size="compact" onPress={() => router.refresh()}>Try again</Button> : appliedSearch || page > 1 ? <Button size="compact" variant="quiet" onPress={() => { setTerm(""); update({ search: "", page: "" }); }}>Clear search</Button> : !initialData.items.length ? <Link className={styles.qualifiedOpen} href="/workspace/crm/leads">Open Leads <ArrowUpRight size={14}/></Link> : null}<IconButton size="compact" aria-label="Refresh qualified leads" onPress={() => router.refresh()}><RefreshCw size={14}/></IconButton></>}
      />}
    </section>
    {qualifiedLead ? <StartQualifiedLead workspaceId={initialData.workspaceId} lead={qualifiedLead} onClose={() => setQualifiedLead(null)} onStarted={(id) => router.push(destination(id))} /> : null}
  </DesignSystemProvider>;
}
