"use client";

import { useState } from "react";
import { BarChart3, CheckCircle2, Gauge, GitBranch, RefreshCw, Route, TimerReset } from "lucide-react";
import { Button, Callout, DataGrid, SelectField, Tabs, type DataGridColumn } from "@/design-system";
import { crmRequest, label, rows } from "@/lib/crm/client";
import type { CrmRecord, CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-reports.module.css";

type ReportId = "sources" | "lead-flow" | "funnel" | "pipeline" | "sla" | "assignment" | "forecast";
type ReportResult = Record<string, unknown>;
type HealthGrouping = "mainSource" | "channel" | "owner" | "team" | "enquiryType" | "freshness";
type ReportGridRow = { id: string; title: string; detail: string; value: string };

const REPORTS: Array<{ id: ReportId; label: string; icon: typeof BarChart3 }> = [
  { id: "sources", label: "Sources", icon: BarChart3 },
  { id: "lead-flow", label: "Enquiry health", icon: Gauge },
  { id: "funnel", label: "Funnel", icon: Route },
  { id: "pipeline", label: "Pipeline", icon: GitBranch },
  { id: "sla", label: "Response SLA", icon: TimerReset },
  { id: "assignment", label: "Assignment", icon: CheckCircle2 },
  { id: "forecast", label: "Forecast", icon: BarChart3 },
];

const HEALTH_GROUPINGS: Array<{ id: HealthGrouping; label: string }> = [
  { id: "mainSource", label: "Source" },
  { id: "channel", label: "Channel" },
  { id: "owner", label: "Sales owner" },
  { id: "team", label: "Sales team" },
  { id: "enquiryType", label: "Enquiry type" },
  { id: "freshness", label: "Freshness" },
];

const REPORT_COLUMNS: DataGridColumn<ReportGridRow>[] = [
  { accessorKey: "title", header: "Breakdown", size: 320, meta: { primary: true }, cell: ({ row }) => <span className={styles.identity}><strong>{row.original.title}</strong><small>{row.original.detail}</small></span> },
  { accessorKey: "value", header: "Result", size: 140, meta: { align: "end" } },
];

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayNumber(value: unknown) {
  return number(value).toLocaleString("en-GB");
}

function count(value: unknown, singular: string, plural = `${singular}s`) {
  return `${displayNumber(value)} ${number(value) === 1 ? singular : plural}`;
}

function money(value: unknown, currency: unknown) {
  const amount = Number(value);
  const code = String(currency ?? "");
  if (!Number.isFinite(amount)) return "—";
  if (/^[A-Z]{3}$/.test(code)) return new Intl.NumberFormat("en-AE", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  return amount.toLocaleString("en-GB");
}

function resultRows(result: ReportResult | undefined) {
  return rows(result) as CrmRecord[];
}

function initialResults(data: CrmScreenPageData) {
  const results = data.supporting.results;
  if (results && typeof results === "object" && !Array.isArray(results)) return results as Record<ReportId, ReportResult | null>;
  return REPORTS.reduce<Record<ReportId, ReportResult | null>>((all, report) => {
    all[report.id] = { report: report.id, rows: data.items.filter((item) => item.report === report.id) };
    return all;
  }, {} as Record<ReportId, ReportResult | null>);
}

function rangeQuery(days: number) {
  if (days === 90) return "";
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

function reportQuery(report: ReportId, days: number, grouping: HealthGrouping) {
  const range = rangeQuery(days);
  const params = new URLSearchParams(range.startsWith("?") ? range.slice(1) : "");
  if (report === "lead-flow") params.set("groupBy", grouping);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function metricsFor(report: ReportId, result: ReportResult | undefined) {
  const reportRows = resultRows(result);
  const summary = result?.summary && typeof result.summary === "object" ? result.summary as Record<string, unknown> : {};
  if (report === "sources") return [
    ["Enquiries", reportRows.reduce((total, item) => total + number(item.enquiries), 0)],
    ["Opportunities", reportRows.reduce((total, item) => total + number(item.opportunities), 0)],
    ["Won", reportRows.reduce((total, item) => total + number(item.won), 0)],
  ] as const;
  if (report === "lead-flow") return [
    ["Enquiries", summary.leads ?? reportRows.reduce((total, item) => total + number(item.leads), 0)],
    ["Qualified", summary.qualified ?? reportRows.reduce((total, item) => total + number(item.qualified), 0)],
    ["Unassigned", summary.unassigned ?? reportRows.reduce((total, item) => total + number(item.unassigned), 0)],
    ["Stale", summary.stale ?? reportRows.reduce((total, item) => total + number(item.stale), 0)],
  ] as const;
  if (report === "funnel") return [["Stage movements", reportRows.reduce((total, item) => total + number(item.count), 0)], ["Stages", reportRows.length]] as const;
  if (report === "pipeline") return [
    ["Open", reportRows.filter((item) => item.status === "open").reduce((total, item) => total + number(item.count), 0)],
    ["Won", reportRows.filter((item) => item.status === "won").reduce((total, item) => total + number(item.count), 0)],
    ["Open value", reportRows.filter((item) => item.status === "open").reduce((total, item) => total + number(item.value), 0)],
  ] as const;
  if (report === "sla") return [
    ["Response rate", summary.responseComplianceRate == null ? "—" : `${Number(summary.responseComplianceRate).toFixed(1)}%`],
    ["Within target", number(summary.withinTarget)],
    ["Breached", number(summary.breached)],
    ["Avg. response", summary.averageResponseMinutes == null ? "—" : `${Math.round(number(summary.averageResponseMinutes))} min`],
  ] as const;
  if (report === "assignment") return [
    ["Assignments", reportRows.reduce((total, item) => total + number(item.count), 0)],
    ["Sales owners", new Set(reportRows.map((item) => String(item.owner ?? "Unassigned"))).size],
  ] as const;
  return [
    ["Forecast", reportRows.reduce((total, item) => total + number(item.amount), 0)],
    ["Weighted", reportRows.reduce((total, item) => total + number(item.weightedAmount), 0)],
    ["Opportunities", reportRows.reduce((total, item) => total + number(item.count), 0)],
  ] as const;
}

function rowTitle(report: ReportId, row: CrmRecord) {
  if (report === "sources") return label(row.source, "Direct") ;
  if (report === "lead-flow") return String(row.label ?? "Not set");
  if (report === "funnel") return String(row.stage ?? label(row.status));
  if (report === "pipeline") return `${String(row.pipeline ?? "Pipeline")} · ${String(row.stage ?? "Not set")}`;
  if (report === "sla") return label(row.status);
  if (report === "assignment") return String(row.owner ?? "Unassigned");
  return `${String(row.currency ?? "Amount")} · ${label(row.status)}`;
}

function rowDetail(report: ReportId, row: CrmRecord) {
  if (report === "sources") return `${label(row.channel, "Unknown channel")} · ${count(row.enquiries, "enquiry", "enquiries")} · ${count(row.opportunities, "opportunity", "opportunities")} · ${displayNumber(row.won)} won`;
  if (report === "lead-flow") return `${displayNumber(row.qualified)} qualified · ${displayNumber(row.unassigned)} unassigned · ${displayNumber(row.stale)} stale`;
  if (report === "funnel") return `${count(row.count, "movement")} in this period`;
  if (report === "pipeline") return `${label(row.status)} · ${count(row.count, "opportunity", "opportunities")}`;
  if (report === "sla") return `${displayNumber(row.responded)} responded · ${displayNumber(row.withinTarget)} within target · ${displayNumber(row.breached)} breached`;
  if (report === "assignment") return `${label(row.method)} · ${count(row.count, "assignment")}`;
  return `${count(row.count, "opportunity", "opportunities")} · weighted ${money(row.weightedAmount, row.currency)}`;
}

function rowValue(report: ReportId, row: CrmRecord) {
  if (report === "pipeline") return money(row.value, row.currency);
  if (report === "forecast") return money(row.amount, row.currency);
  if (report === "lead-flow") return `${Number(row.qualificationRate ?? 0).toFixed(1)}%`;
  if (report === "sla") return row.averageMinutes == null ? "—" : `${Math.round(number(row.averageMinutes))} min`;
  return displayNumber(report === "sources" ? row.enquiries : row.count ?? row.leads);
}

function gridRows(report: ReportId, rows: CrmRecord[]): ReportGridRow[] {
  return rows.map((row, index) => ({
    id: String(row.id ?? `${report}-${index}`),
    title: rowTitle(report, row),
    detail: rowDetail(report, row),
    value: rowValue(report, row),
  }));
}

function ReportPanel({ report, result }: { report: ReportId; result?: ReportResult }) {
  const reportRows = resultRows(result);
  const metrics = metricsFor(report, result);
  const reconciliation = result?.reconciliation && typeof result.reconciliation === "object"
    ? result.reconciliation as { matches?: boolean }
    : null;
  const title = REPORTS.find((item) => item.id === report)?.label ?? "Report";
  return <div className={styles.panel}>
    {reconciliation?.matches === false ? <Callout title="Report totals need review" tone="warning">This breakdown does not match its underlying record total. Refresh before using it for a decision.</Callout> : null}
    <section aria-label={`${title} summary`} className={styles.metrics}>{metrics.map(([name, value]) => <div key={name}><small>{name}</small><strong>{typeof value === "number" && (name === "Open value" || name === "Forecast" || name === "Weighted") ? money(value, reportRows.find((item) => typeof item.currency === "string")?.currency) : typeof value === "number" ? displayNumber(value) : String(value ?? "—")}</strong></div>)}</section>
    <DataGrid
      ariaLabel={`${title} breakdown`}
      columns={REPORT_COLUMNS}
      data={gridRows(report, reportRows)}
      emptyDescription="New CRM activity will appear here automatically."
      emptyTitle="No data in this period"
      exportFileName={`wodana-${report}-report.csv`}
      getRowId={(row) => row.id}
      pageSize={25}
      persistKey={`crm-report-${report}`}
      rowNumbers={false}
      searchLabel={`Search ${title.toLocaleLowerCase()}`}
      selectable={false}
    />
  </div>;
}

export function CrmReports({ initialData }: { initialData: CrmScreenPageData }) {
  const [results, setResults] = useState(() => initialResults(initialData));
  const [active, setActive] = useState<ReportId>("sources");
  const [grouping, setGrouping] = useState<HealthGrouping>("mainSource");
  const [range, setRange] = useState(90);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const refresh = async (report = active, nextGrouping = grouping) => {
    setBusy(true); setFailure("");
    try {
      const next = await crmRequest<ReportResult>(initialData.workspaceId, `reports/${report}${reportQuery(report, range, nextGrouping)}`);
      setResults((current) => ({ ...current, [report]: next }));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Reports could not be refreshed.");
    } finally { setBusy(false); }
  };

  return <CrmProductShell title="Reports" description="" canView={initialData.canView} useWorkspaceColors actions={<div className={styles.actions}>
    {active === "lead-flow" ? <SelectField aria-label="Enquiry health breakdown" items={HEALTH_GROUPINGS} label="Break down by" selectedKey={grouping} onSelectionChange={(key) => { const next = String(key) as HealthGrouping; setGrouping(next); void refresh("lead-flow", next); }} /> : null}
    <SelectField aria-label="Report period" items={[{ id: "30", label: "Last 30 days" }, { id: "90", label: "Last 90 days" }, { id: "180", label: "Last 180 days" }]} label="Period" selectedKey={String(range)} onSelectionChange={(key) => setRange(Number(key))} />
    <Button size="compact" isLoading={busy} onPress={() => void refresh()}><RefreshCw aria-hidden="true" size={14} />Refresh</Button>
  </div>}>
    {failure ? <Callout title="Could not refresh this report" tone="warning">{failure}</Callout> : null}
    <Tabs selectedKey={active} onSelectionChange={(key) => setActive(key as ReportId)} items={REPORTS.map((report) => {
      const Icon = report.icon;
      return { id: report.id, label: <><Icon aria-hidden="true" size={14} />{report.label}</>, panel: <ReportPanel report={report.id} result={results[report.id] ?? undefined} /> };
    })} />
  </CrmProductShell>;
}
