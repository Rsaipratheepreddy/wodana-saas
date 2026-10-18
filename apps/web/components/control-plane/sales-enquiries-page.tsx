"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, ErrorState, ListTabs, NoResultsState, PageHeader, RecordTable, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import {
  SALES_ENQUIRY_STATUSES, salesApi, salesEnquiriesExportUrl,
  type SalesEnquiryDetail, type SalesEnquiryList, type SalesEnquiryStatus, type SalesEnquirySummary,
} from "@/lib/internal/sales";
import { useConsoleFormat } from "./labels";
import { SalesEnquiryInspector } from "./sales-enquiry-inspector";
import { announceNewEnquiries, summaryOf, useCountryName, useSalesLabels } from "./sales-labels";
import shell from "./control-plane.module.css";
import styles from "./sales.module.css";

type Filter = "all" | SalesEnquiryStatus;
const PATH = "/internal/sales-enquiries";

/** A command's response replaces its row; the status counts move with it. */
function merge(list: SalesEnquiryList, detail: SalesEnquiryDetail): SalesEnquiryList {
  const previous = list.enquiries.find((row) => row.id === detail.id);
  if (!previous) return list;
  const counts = { ...list.counts };
  if (previous.status !== detail.status) {
    counts[previous.status] = Math.max(0, (counts[previous.status] ?? 0) - 1);
    counts[detail.status] = (counts[detail.status] ?? 0) + 1;
  }
  const row = summaryOf(detail);
  return { ...list, counts, enquiries: list.enquiries.map((item) => (item.id === detail.id ? row : item)) };
}

/** Enquiries from Wodana's "Contact sales" form: who asked, where each one stands, and who follows up. */
export function SalesEnquiriesPage({ canManage }: { canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const labels = useSalesLabels();
  const format = useConsoleFormat();
  const countryName = useCountryName();
  const [data, setData] = useState<SalesEnquiryList | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try { setData(await salesApi.enquiries()); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Enquiries didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // The portal's notice of new enquiries follows what this page knows.
  useEffect(() => { if (data) announceNewEnquiries(data.counts.new ?? 0); }, [data]);

  const selectedId = params.get("enquiry");
  const open = (id: string | null) => {
    const query = new URLSearchParams(params.toString());
    if (id) query.set("enquiry", id); else query.delete("enquiry");
    router.replace(`${PATH}${query.size ? `?${query}` : ""}`, { scroll: false });
  };
  const applyDetail = useCallback((detail: SalesEnquiryDetail) => setData((current) => (current ? merge(current, detail) : current)), []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.enquiries ?? []).filter((row) => (filter === "all" || row.status === filter) && (!query
      || [row.reference, row.name, row.email, row.company ?? ""].some((value) => value.toLowerCase().includes(query))));
  }, [data, filter, search]);

  const columns = useMemo<DataGridColumn<SalesEnquirySummary>[]>(() => [
    { id: "enquiry", header: t("Enquiry"), size: 260, accessorFn: (row) => `${row.reference} ${row.name}`, meta: { primary: true, renderCell: (row) =>
      <span className={styles.cell}>
        <span><span className={styles.reference}>{row.reference}</span><span className={styles.name}>{row.name}</span></span>
        {row.company ? <small>{row.company}</small> : null}
      </span> } },
    { id: "contact", header: t("Contact"), size: 220, accessorFn: (row) => row.email, meta: { renderCell: (row) =>
      <span className={styles.cell}><span className={styles.ltr}>{row.email}</span>{row.phone ? <small className={styles.ltr}>{row.phone}</small> : null}</span> } },
    { id: "country", header: t("Country"), size: 160, accessorFn: (row) => countryName(row.countryCode) },
    { id: "teamSize", header: t("Team size"), size: 110, accessorFn: (row) => row.teamSize ?? "" },
    { id: "status", header: t("Status"), size: 120, accessorFn: (row) => labels.status[row.status].label, meta: { renderCell: (row) =>
      <Badge tone={labels.status[row.status].tone}>{labels.status[row.status].label}</Badge> } },
    { id: "assignee", header: t("Assignee"), size: 150, accessorFn: (row) => row.assignee?.name ?? "", meta: { renderCell: (row) =>
      row.assignee ? row.assignee.name ?? t("Operator") : <span className={shell.muted}>{t("Unassigned")}</span> } },
    { id: "received", header: t("Received"), size: 140, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) =>
      <span title={format.dateTime(row.createdAt)}>{format.relative(row.createdAt)}</span> } },
  ], [countryName, format, labels, t]);

  const counts = data?.counts ?? {};
  const tabs = [
    { id: "all" as Filter, label: t("All"), count: data?.total },
    ...SALES_ENQUIRY_STATUSES.map((status) => ({ id: status as Filter, label: labels.status[status].label, count: data ? counts[status] ?? 0 : undefined })),
  ];
  const selected = data?.enquiries.find((row) => row.id === selectedId);
  const formLink = <Button onPress={() => router.push("/internal/contact-form")}>{t("Contact form")}</Button>;

  if (error && !data) return <div className={shell.page}><PageHeader title={t("Sales enquiries")} /><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={shell.page}>
    <PageHeader title={t("Sales enquiries")} />
    <RecordTable<SalesEnquirySummary>
      ariaLabel={t("Sales enquiries")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      isLoading={!data}
      onRowAction={(row) => open(row.id)}
      onExport={() => window.location.assign(salesEnquiriesExportUrl({ status: filter, search }))}
      searchLabel={t("Search enquiries")}
      searchValue={search}
      onSearchChange={setSearch}
      toolbarLeading={<ListTabs label={t("Status")} items={tabs} value={filter} onChange={setFilter} />}
      emptyContent={search.trim() || filter !== "all"
        ? <NoResultsState onClear={() => { setSearch(""); setFilter("all"); }} />
        : <EmptyState title={t("No enquiries yet")} description={t("They arrive from the website's contact form.")} action={formLink} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
    {selectedId ? <SalesEnquiryInspector key={selectedId} id={selectedId} fallback={selected} canManage={canManage}
      onClose={() => open(null)} onChanged={applyDetail} /> : null}
  </div>;
}
