"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, SegmentedControl, SelectField, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest } from "@/lib/crm/client";
import { enquiryFields, isShown } from "@/lib/crm/enquiry-fields";
import { leadOptionLabel } from "@/lib/crm/lead-options";
import type { LeadsPageData } from "@/lib/crm/leads";
import styles from "./sales-reports.module.css";

type ReportId = "lead-flow" | "funnel" | "pipeline" | "sla" | "assignment" | "forecast";
type Row = Record<string, unknown>;
type Result = { rows?: Row[]; summary?: Row; walkIns?: Row[] };
type GridRow = { id: string; title: string; detail: string; value: string };

const REPORTS: { id: ReportId; label: string }[] = [
  { id: "lead-flow", label: "Enquiries" }, { id: "funnel", label: "Funnel" }, { id: "pipeline", label: "Pipeline" },
  { id: "sla", label: "Response" }, { id: "assignment", label: "Assignment" }, { id: "forecast", label: "Forecast" },
];
const PERIODS = [{ id: "7", label: "Last 7 days" }, { id: "30", label: "Last 30 days" }, { id: "90", label: "Last 90 days" }, { id: "365", label: "Last 12 months" }];
const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const humanize = (value: unknown, fallback = "Not set") => { const text = String(value ?? "").trim(); return text ? text.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()) : fallback; };
const sum = (rows: Row[], key: string, filter: (row: Row) => boolean = () => true) => rows.filter(filter).reduce((total, row) => total + num(row[key]), 0);

/**
 * Sales reports: one place, one period. Enquiries break down by any shown enquiry field (the
 * workspace's own dropdown fields too); the others follow the pipeline, response and forecast.
 */
export function SalesReports({ initialData, regionLabel }: { initialData: LeadsPageData; regionLabel: string }) {
  const t = useT();
  const locale = initialData.defaultLocale;
  const [report, setReport] = useState<ReportId>("lead-flow");
  const [period, setPeriod] = useState("30");
  const [groupBy, setGroupBy] = useState("source");
  const [result, setResult] = useState<Result>();
  const [failure, setFailure] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const options = initialData.leadOptions;
  const fields = useMemo(() => enquiryFields(initialData.enquiryFields, regionLabel), [initialData.enquiryFields, regionLabel]);

  const groupings = useMemo(() => [
    { id: "source", label: t("Source & channel") }, { id: "mainSource", label: t("Source") }, { id: "channel", label: t("Channel") },
    { id: "enquiryType", label: t("Enquiry type") },
    ...(isShown(fields, "customerType") ? [{ id: "customerType", label: t("Customer type") }] : []),
    ...(isShown(fields, "budgetRange") ? [{ id: "budget", label: t("Budget") }] : []),
    { id: "emirate", label: regionLabel },
    ...(isShown(fields, "area") ? [{ id: "area", label: t("Area / city") }] : []),
    ...fields.filter((field) => field.custom && field.visible && ["select", "multi_select"].includes(field.type)).map((field) => ({ id: field.key, label: field.label })),
    { id: "owner", label: t("Sales owner") }, { id: "team", label: t("Sales team") }, { id: "intake", label: t("Captured via") },
    { id: "freshness", label: t("Freshness") }, { id: "week", label: t("Week") }, { id: "month", label: t("Month") },
  ], [fields, regionLabel, t]);
  const activeGroup = groupings.some((group) => group.id === groupBy) ? groupBy : "source";

  useEffect(() => {
    const controller = new AbortController();
    const to = new Date(), from = new Date(to.getTime() - Number(period) * 86_400_000);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), ...(report === "lead-flow" ? { groupBy: activeGroup } : {}) });
    setLoading(true);
    crmRequest<Result>(initialData.workspaceId, `reports/${report}?${query}`, "GET", undefined, controller.signal)
      .then((value) => { setResult(value); setFailure(null); })
      .catch((cause: Error & { status?: number }) => { if (!controller.signal.aborted) { setResult(undefined); setFailure({ status: cause.status, message: cause.message }); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialData.workspaceId, report, period, activeGroup, reload]);

  const rows = result?.rows ?? [];
  const money = (value: unknown, currency: unknown) => {
    const code = String(currency ?? "");
    if (!Number.isFinite(Number(value))) return "—";
    try { return /^[A-Z]{3}$/.test(code) ? new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(Number(value)) : Number(value).toLocaleString(locale); }
    catch { return String(value); }
  };
  const groupLabel = (value: unknown) => {
    const text = String(value ?? "");
    if (!text || text === "Not set") return t("Not set");
    if (activeGroup === "mainSource") return leadOptionLabel(options?.sources, text);
    if (activeGroup === "channel") return leadOptionLabel(Object.values(options?.channels ?? {}).flat(), text);
    if (activeGroup === "enquiryType") return leadOptionLabel(options?.enquiryTypes, text);
    if (activeGroup === "budget") return leadOptionLabel(options?.budgetRanges, text);
    if (activeGroup === "customerType") return leadOptionLabel(options?.customerTypes, text);
    if (activeGroup === "emirate") return leadOptionLabel(options?.emirates, text);
    if (activeGroup === "intake") return text === "form" ? t("Form or QR") : text === "manual" ? t("Staff entry") : humanize(text);
    if (activeGroup === "source") { const [source, channel] = text.split(" / "); return `${leadOptionLabel(options?.sources, source)} · ${leadOptionLabel(options?.channels[source], channel)}`; }
    if (["freshness"].includes(activeGroup)) return humanize(text);
    return text;
  };

  const summary = result?.summary ?? {};
  const metrics: [string, string][] = report === "lead-flow" ? [
    [t("Enquiries"), String(num(summary.leads))], [t("Qualified"), String(num(summary.qualified))], [t("Unassigned"), String(num(summary.unassigned))], [t("No update in 7 days"), String(num(summary.stale))],
  ] : report === "funnel" ? [[t("Stage moves"), String(sum(rows, "count"))], [t("Stages"), String(rows.length)]]
    : report === "pipeline" ? [[t("Open"), String(sum(rows, "count", (row) => row.status === "open"))], [t("Won"), String(sum(rows, "count", (row) => row.status === "won"))], [t("Open value"), money(sum(rows, "value", (row) => row.status === "open"), rows[0]?.currency)]]
    : report === "sla" ? [[t("On time"), summary.responseComplianceRate == null ? "—" : `${num(summary.responseComplianceRate).toFixed(1)}%`], [t("Within target"), String(num(summary.withinTarget))], [t("Breached"), String(num(summary.breached))], [t("Average first response"), summary.averageResponseMinutes == null ? "—" : t("{count} min", { count: Math.round(num(summary.averageResponseMinutes)) })]]
    : report === "assignment" ? [[t("Assignments"), String(sum(rows, "count"))], [t("Sales owners"), String(new Set(rows.map((row) => String(row.owner ?? ""))).size)]]
    : [[t("Forecast"), money(sum(rows, "amount"), rows[0]?.currency)], [t("Weighted"), money(sum(rows, "weightedAmount"), rows[0]?.currency)], [t("Opportunities"), String(sum(rows, "count"))]];

  const enquiryColumns: DataGridColumn<Row>[] = [
    { id: "label", header: groupings.find((group) => group.id === activeGroup)?.label ?? t("Group"), size: 240, accessorFn: (row) => groupLabel(row.label), meta: { primary: true } },
    { id: "leads", header: t("Enquiries"), size: 110, accessorFn: (row) => num(row.leads), meta: { align: "end" } },
    { id: "unassigned", header: t("Unassigned"), size: 115, accessorFn: (row) => num(row.unassigned), meta: { align: "end" } },
    { id: "qualified", header: t("Qualified"), size: 110, accessorFn: (row) => num(row.qualified), meta: { align: "end" } },
    { id: "rate", header: t("Qualified %"), size: 115, accessorFn: (row) => `${num(row.qualificationRate).toFixed(1)}%`, meta: { align: "end" } },
    { id: "disqualified", header: t("Not interested"), size: 130, accessorFn: (row) => num(row.disqualified), meta: { align: "end" } },
    { id: "won", header: t("Won"), size: 90, accessorFn: (row) => num(row.won), meta: { align: "end" } },
    { id: "lost", header: t("Lost"), size: 90, accessorFn: (row) => num(row.lost), meta: { align: "end" } },
    { id: "stale", header: t("No update in 7 days"), size: 170, accessorFn: (row) => num(row.stale), meta: { align: "end" } },
  ];
  const gridRows: GridRow[] = rows.map((row, index) => {
    const id = String(row.id ?? `${report}-${index}`);
    if (report === "funnel") return { id, title: String(row.stage ?? humanize(row.status)), detail: humanize(row.status), value: String(num(row.count)) };
    if (report === "pipeline") return { id, title: `${String(row.pipeline ?? "")} · ${String(row.stage ?? t("Not set"))}`, detail: `${humanize(row.status)} · ${num(row.count)}`, value: money(row.value, row.currency) };
    if (report === "sla") return { id, title: humanize(row.status), detail: `${num(row.responded)} ${t("responded")} · ${num(row.breached)} ${t("breached")}`, value: row.averageMinutes == null ? "—" : t("{count} min", { count: Math.round(num(row.averageMinutes)) }) };
    if (report === "assignment") return { id, title: String(row.owner ?? t("Unassigned")), detail: humanize(row.method), value: String(num(row.count)) };
    return { id, title: `${String(row.currency ?? "")} · ${humanize(row.status)}`, detail: `${num(row.count)} · ${t("Weighted")} ${money(row.weightedAmount, row.currency)}`, value: money(row.amount, row.currency) };
  });
  const otherColumns: DataGridColumn<GridRow>[] = [
    { accessorKey: "title", header: t("Breakdown"), size: 320, meta: { primary: true } },
    { accessorKey: "detail", header: t("Detail"), size: 280 },
    { accessorKey: "value", header: t("Result"), size: 160, meta: { align: "end" } },
  ];
  const title = REPORTS.find((item) => item.id === report)!.label;

  return <section className={styles.page} aria-label={t("Sales reports")}>
    <div className={styles.toolbar}>
      <SegmentedControl label={t("Report")} value={report} onChange={(key) => setReport(key as ReportId)} options={REPORTS.map((item) => ({ id: item.id, label: t(item.label as never) }))} />
      <span className={styles.spacer} />
      {report === "lead-flow" ? <SelectField aria-label={t("Break down by")} accent="neutral" label={null} items={groupings} selectedKey={activeGroup} onSelectionChange={(key) => setGroupBy(String(key ?? "source"))} /> : null}
      <SelectField aria-label={t("Period")} accent="neutral" label={null} items={PERIODS.map((item) => ({ ...item, label: t(item.label as never) }))} selectedKey={period} onSelectionChange={(key) => setPeriod(String(key ?? "30"))} />
    </div>
    {failure ? failure.status === 403
      ? <EmptyState illustration="locked" title={t("You can't see this report")} description={t("Ask an owner for access to deal values.")} />
      : <EmptyState illustration="error" title={t("This report didn't load")} description={failure.message} action={<Button size="compact" onPress={() => setReload((value) => value + 1)}>{t("Retry")}</Button>} />
      : <>
        <dl className={styles.metrics} aria-label={t("{name} summary", { name: t(title as never) })}>{metrics.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{loading ? "…" : value}</dd></div>)}</dl>
        {report === "lead-flow"
          ? <DataGrid key={`${report}:${activeGroup}`} ariaLabel={t("Enquiry breakdown")} appearance="flush" columns={enquiryColumns} data={loading ? [] : rows} isLoading={loading} getRowId={(row) => String(row.id ?? row.label)} selectable={false} rowNumbers={false} showToolbar={false} pageSize={50}
            exportFileName="enquiries-report.csv" emptyTitle={t("No enquiries in this period")} emptyDescription={t("Choose a longer period.")} />
          : <DataGrid key={report} ariaLabel={t("{name} breakdown", { name: t(title as never) })} appearance="flush" columns={otherColumns} data={loading ? [] : gridRows} isLoading={loading} getRowId={(row) => row.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={50}
            exportFileName={`${report}-report.csv`} emptyTitle={t("Nothing in this period")} emptyDescription={t("Choose a longer period.")} />}
      </>}
  </section>;
}
