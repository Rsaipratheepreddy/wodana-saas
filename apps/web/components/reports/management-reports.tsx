"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import {
  CardGrid, ColumnChart, DataGrid, DateRangeField, DonutChart, EmptyState, ErrorState, FunnelSteps, Gauge, InspectorSheet, KpiFigure, ListTabs,
  MenuButton, PageShell, RankedBars, SelectField, Skeleton, TrendLines, useDesignSystem, type DataGridColumn, type TargetState,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { administrativeAreaLabel } from "@/lib/workspace/region-labels";
import {
  DASHBOARD_LABELS, DASHBOARDS, downloadCsv, filtersFrom, filtersQuery, reportsApi, toCsv,
  type Chart, type Dashboard, type DashboardId, type FilterOptions, type Filters, type Kpi, type ReportRecord, type TargetResult, type Unit,
} from "@/lib/reports/management";
import styles from "./management-reports.module.css";

/** Each KPI's title (PLM-104/105/129/130); the definitions are in the master plan §6.27a. */
const KPI_LABELS: Record<string, MessageKey> = {
  sales_won: tKey("Sales Won"), revenue_collected: tKey("Revenue collected"), outstanding: tKey("Outstanding balances"),
  deals_awaiting_approval: tKey("Deals waiting for approval"), active_projects: tKey("Active projects by stage"), delayed_items: tKey("Delayed items"),
  deals_closed: tKey("Deals Closed / Completed"), profit_margin: tKey("Profit margin"),
  net_revenue: tKey("Net revenue"), cancellations_refunds: tKey("Cancellations and refunds"), not_interested: tKey("Not interested enquiries"),
  new_leads: tKey("New leads"), conversion_funnel: tKey("Conversion funnel"), pipeline_value: tKey("Pipeline value"), won_by_account_manager: tKey("Won by Account Manager"),
  lost: tKey("Lost"), duplicates: tKey("Duplicates"), returning_customers: tKey("Returning customers"), follow_ups: tKey("Follow-ups due / overdue"), quotes_expiring: tKey("Quotes expiring"),
  response_rate: tKey("Response rate"), first_response_hours: tKey("Average first response"), reassignments: tKey("Reassignments"), unassigned_leads: tKey("Unassigned leads"),
  design_stage: tKey("Projects by design stage"), package_mix: tKey("Package mix"), design_overdue: tKey("Overdue"), chargeable_revisions: tKey("Chargeable revisions"),
  designer_workload: tKey("Designer workload"), visualiser_workload: tKey("Visualiser workload"),
  design_to_proposal2_days: tKey("Design approval → Proposal 2"), design_to_proposal2_rate: tKey("Moved on to furniture / joinery"),
};

/** Fixed chart keys the server sends (stages, ages, series), named here. */
const KEY_LABELS: Record<string, MessageKey> = {
  design: tKey("Design"), main: tKey("Proposal 2"), collected: tKey("Collected"), invoiced: tKey("Invoiced"), margin: tKey("Margin"), rate: tKey("Response rate"),
  net: tKey("Net revenue"), cancelled: tKey("Cancelled"), refund: tKey("Refunded"),
  not_due: tKey("Not due yet"), overdue_1_30: tKey("1–30 days overdue"), overdue_31_60: tKey("31–60 days overdue"), overdue_60_plus: tKey("Over 60 days overdue"), no_due_date: tKey("No due date"),
  estimate: tKey("Estimate"), production: tKey("Production"), delivery: tKey("Delivery"), snagging: tKey("Snagging"),
  inspiration: tKey("Inspiration"), site_visit: tKey("Site visit"), development: tKey("Development"), materials: tKey("Materials"), renders: tKey("Renders"),
  approval: tKey("Approval"), not_started: tKey("Not started"), concepts: tKey("Concepts"), space_planning: tKey("Space planning"), material_selection: tKey("Material selection"),
  lead: tKey("Leads"), opportunity: tKey("Opportunity"), qualified: tKey("Qualified"), proposal: tKey("Proposal"), won: tKey("Won"),
  promise_date: tKey("Past the promised date"), tasks: tKey("Late tasks"), other: tKey("Other"), none: tKey("Not assigned"),
  met: tKey("Within target"), missed: tKey("Missed"), open: tKey("Open"), submitted: tKey("Submitted"), verified: tKey("Verified by Finance"),
  overdue: tKey("Overdue"), due: tKey("Due"), duplicate: tKey("Duplicate"), returning: tKey("Returning customer"), designer: tKey("Designer"), visualiser: tKey("Visualiser"),
};

/** What a record's measure means, per KPI (the drill-down's column header). */
const MEASURE_LABELS: Record<string, MessageKey> = {
  outstanding: tKey("Days overdue"), deals_awaiting_approval: tKey("Days waiting"), delayed_items: tKey("Days late"), profit_margin: tKey("Margin %"),
  quotes_expiring: tKey("Days left"), response_rate: tKey("Hours to respond"), first_response_hours: tKey("Hours to respond"), unassigned_leads: tKey("Hours waiting"),
  design_overdue: tKey("Days late"), chargeable_revisions: tKey("Revisions"), design_to_proposal2_days: tKey("Days"),
};

/** The period presets; "Custom dates" opens a date range. */
const PRESETS = ["month", "last-month", "quarter", "year", "last-12", "custom"] as const;
type Preset = (typeof PRESETS)[number];
const PRESET_LABELS: Record<Preset, MessageKey> = {
  month: tKey("This month"), "last-month": tKey("Last month"), quarter: tKey("This quarter"), year: tKey("Year to date"), "last-12": tKey("Last 12 months"), custom: tKey("Custom dates"),
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
/** The period a preset means, from today (local date text). */
export function presetRange(preset: Preset, today: string): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const first = (y: number, m: number) => iso(new Date(Date.UTC(y, m - 1, 1)));
  const last = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
  if (preset === "last-month") return { from: first(year, month - 1), to: last(year, month - 1) };
  if (preset === "quarter") return { from: first(year, Math.floor((month - 1) / 3) * 3 + 1), to: today };
  if (preset === "year") return { from: first(year, 1), to: today };
  if (preset === "last-12") return { from: first(year, month - 11), to: today };
  return { from: first(year, month), to: today };
}

function localToday(timeZone: string | undefined) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch { return iso(new Date()); }
}

type Drill = { kpi: string; bucket: string; title: string };

export function ManagementReports({ workspaceId, initialDashboard }: { workspaceId: string; initialDashboard: DashboardId }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => reportsApi(workspaceId), [workspaceId]);
  const today = useMemo(() => localToday(timeZone), [timeZone]);
  const [dashboard, setDashboard] = useState<DashboardId>(initialDashboard);
  const filters = useMemo(() => filtersFrom(params), [params]);
  const preset = (PRESETS as readonly string[]).includes(params.get("period") ?? "") ? params.get("period") as Preset : filters.from || filters.to ? "custom" : "month";
  const effective: Filters = useMemo(() => {
    if (preset === "custom" && filters.from && filters.to) return filters;
    return { ...filters, ...presetRange(preset === "custom" ? "month" : preset, today) };
  }, [filters, preset, today]);
  const [data, setData] = useState<Dashboard | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.options(controller.signal).then(setOptions).catch(() => undefined);
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => setLoading(true));
    api.dashboard(dashboard, effective, controller.signal)
      .then((value) => { setData(value); setFailure(null); })
      .catch((cause: Error) => { if (!controller.signal.aborted) { setData(null); setFailure(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, dashboard, effective, reload]);

  /** Every filter lives in the address, so a view can be shared and survives a reload. */
  const update = useCallback((next: Partial<Filters> & { period?: Preset }, tab: DashboardId = dashboard) => {
    const query = filtersQuery({ ...filters, ...next });
    const period = next.period ?? preset;
    if (period !== "custom") { query.delete("from"); query.delete("to"); if (period !== "month") query.set("period", period); }
    else query.set("period", "custom");
    if (next.source !== undefined && next.source !== filters.source) query.delete("channel");
    const base = tab === "owner-overview" ? "/workspace/reports" : `/workspace/reports/${tab}`;
    router.replace(`${base}${query.size ? `?${query}` : ""}`, { scroll: false });
  }, [dashboard, filters, preset, router]);

  const changeTab = (tab: DashboardId) => { setDashboard(tab); setData(null); update({}, tab); };

  const label = useCallback((key: string) => (KEY_LABELS[key] ? t(KEY_LABELS[key]) : key), [t]);
  const format = useFormatters(data?.currency ?? "USD", locale, t);

  const exportDashboard = () => {
    if (!data) return;
    const rows = data.kpis.map((kpi) => [t(KPI_LABELS[kpi.code] ?? (kpi.code as MessageKey)), kpi.value === null ? t("Not enough data yet") : format.value(kpi.unit, kpi.value), String(kpi.count),
      kpi.amount ? format.money(kpi.amount) : "", kpi.target ? format.value(kpi.unit, kpi.target.target) : "", kpi.target?.percent ? `${kpi.target.percent}%` : "", kpi.target ? format.value(kpi.unit, kpi.target.gap) : ""]);
    downloadCsv(`${dashboard}-${effective.from}-${effective.to}.csv`, toCsv([t("KPI"), t("Actual"), t("Records"), t("Value"), t("Target"), t("Achieved"), t("Gap")], rows));
  };

  return <div className={styles.report} data-report="">
    <PageShell kind="dashboard" title={t("Reports")}
      tabs={<ListTabs label={t("Dashboards")} value={dashboard} onChange={changeTab} items={DASHBOARDS.map((id) => ({ id, label: t(DASHBOARD_LABELS[id]) }))} />}
      toolbar={<span className={styles.noPrint}><MenuButton label={t("Export")} size="compact" items={[{ id: "excel", label: t("Excel (CSV)"), isDisabled: !data }, { id: "pdf", label: t("Print or save as PDF"), isDisabled: !data }]}
        onAction={(id) => (id === "pdf" ? window.print() : exportDashboard())} /></span>}>
      <FilterBar filters={effective} preset={preset} options={options} onChange={update} />
      <p className={styles.printPeriod}>{t(DASHBOARD_LABELS[dashboard])} · {format.date(effective.from)} – {format.date(effective.to)}</p>
      {failure ? <ErrorState title={t("This report didn't load")} description={translateKnown(t, failure)} onRetry={() => setReload((value) => value + 1)} />
        : loading && !data ? <div className={styles.loading}><Skeleton shape="facts" lines={6} /></div>
        : data ? <CardGrid min="24rem">{data.kpis.map((kpi) => <KpiCard key={kpi.code} kpi={kpi} format={format} label={label} options={options}
            open={(bucket, title) => setDrill({ kpi: kpi.code, bucket, title: title ? `${t(KPI_LABELS[kpi.code])} · ${title}` : t(KPI_LABELS[kpi.code]) })} />)}</CardGrid>
        : null}
    </PageShell>
    {drill ? <Records api={api} dashboard={dashboard} filters={effective} drill={drill} format={format} label={label} onClose={() => setDrill(null)} /> : null}
  </div>;
}

type Formatters = ReturnType<typeof useFormatters>;

function useFormatters(currency: string, locale: string, t: Translate) {
  return useMemo(() => {
    const number = (value: string, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value as unknown as number);
    const money = (value: string, compact = false) => {
      try { return new Intl.NumberFormat(locale, { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(value as unknown as number); }
      catch { return number(value, 0); }
    };
    const value = (unit: Unit, text: string, compact = false) => unit === "money" ? money(text, compact) : unit === "percent" ? `${number(text)}%`
      : unit === "hours" ? t("{hours} h", { hours: number(text, 2) }) : unit === "days" ? t("{days} days", { days: number(text) }) : number(text, 0);
    const date = (text: string | null) => {
      if (!text) return "—";
      const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`) : new Date(text);
      return Number.isNaN(at.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(text) ? "UTC" : undefined }).format(at);
    };
    const month = (key: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
    const day = (key: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
    return { number, money, value, date, month, day };
  }, [currency, locale, t]);
}

function targetState(unit: Unit, target: TargetResult | null | undefined, format: Formatters): TargetState {
  if (!target) return null;
  return { target: format.value(unit, target.target), percent: target.percent === null ? null : `${format.number(target.percent)}%`, gap: format.value(unit, target.gap), tone: target.tone };
}

/** One KPI: its figure with Actual / Target / % / gap, the graph Palm's sheet names, and a way into its records. */
function KpiCard({ kpi, format, label, options, open }: {
  kpi: Kpi; format: Formatters; label: (key: string) => string; options: FilterOptions | null; open: (bucket: string, title?: string) => void;
}) {
  const t = useT();
  const title = t(KPI_LABELS[kpi.code] ?? (kpi.code as MessageKey));
  const chart = kpi.chart;
  const nameOf = (dimension: string, key: string, fallback: string) => {
    if (dimension === "type") return options?.enquiryTypes.find((item) => item.id === key)?.label ?? (key === "none" ? t("Not set") : key);
    if (dimension === "sourceGroup") return key === "other" ? t("Other") : options?.sources.find((item) => item.id === key)?.label ?? key;
    if ((dimension === "am" || dimension === "person") && key === "none") return t("Not assigned");
    if (dimension === "reason" && key === "none") return t("No reason recorded");
    if (dimension === "series" && key === "design") return t("Design Fee");
    if (dimension === "month") return format.month(key);
    if (dimension === "week") return format.day(key);
    return KEY_LABELS[key] && ["stage", "age", "step", "series", "type"].includes(dimension) ? label(key) : fallback || label(key);
  };
  const notes = [
    kpi.notes?.amountsIncludeTax ? t("Includes tax") : null,
    kpi.notes?.taxIncluded ? t("{count} without a quotation, value as entered", { count: kpi.notes.taxIncluded }) : null,
    kpi.notes?.otherCurrency ? t("{count} in another currency not included", { count: kpi.notes.otherCurrency }) : null,
    kpi.notes?.target ? (kpi.extra?.mode === "business" ? t("Target {minutes} working minutes", { minutes: kpi.notes.target }) : t("Target {minutes} minutes", { minutes: kpi.notes.target })) : null,
    kpi.targetHidden ? t("Target not compared while filtered") : null,
  ].filter(Boolean);
  const detail = kpiDetail(kpi, format, t);
  const value = kpi.value === null ? null : format.value(kpi.unit, kpi.value);
  return <KpiFigure label={title} value={value} noData={kpi.value === null} targetable={kpi.targetable && !kpi.targetHidden} target={targetState(kpi.unit, kpi.target, format)}
    tone={["delayed_items", "design_overdue"].includes(kpi.code) && kpi.count > 0 ? "danger" : undefined}
    detail={[detail, ...notes].filter(Boolean).join(" · ") || undefined} onOpen={() => open(chart?.type === "list" ? chart.bucket : "period=1")}>
    {kpi.code === "response_rate" && kpi.value !== null ? <Gauge ariaLabel={title} percent={Number(kpi.value)} display={value} tone={kpi.target?.tone}
      target={kpi.target ? Number(kpi.target.target) : null} /> : null}
    {chart ? <ChartView chart={chart} title={title} format={format} nameOf={nameOf} open={open} danger={["delayed_items", "design_overdue"].includes(kpi.code)} /> : null}
  </KpiFigure>;
}

function kpiDetail(kpi: Kpi, format: Formatters, t: Translate): string | null {
  const extra = kpi.extra ?? {};
  switch (kpi.code) {
    case "sales_won": return t("{count} won · Design Fee {design} · Proposal 2 {main}", { count: kpi.count, design: format.money(String(extra.designValue ?? "0")), main: format.money(String(extra.mainValue ?? "0")) })
      + (extra.countTarget ? ` · ${t("Count target {target} ({percent})", { target: format.number(String(extra.countTarget), 0), percent: extra.countPercent ? `${format.number(String(extra.countPercent))}%` : "—" })}` : "");
    case "revenue_collected": return t("Invoiced {amount}", { amount: format.money(String(extra.invoiced ?? "0")) });
    case "net_revenue": return t("Collected {collected} · Refunded {refunded}", { collected: format.money(String(extra.collected ?? "0")), refunded: format.money(String(extra.refunded ?? "0")) });
    case "cancellations_refunds": return t("{amount} cancelled · {count} refunds paid, {refunds}", { amount: format.money(kpi.amount ?? "0"), count: Number(extra.refundCount ?? 0),
      refunds: format.money(String(extra.refundValue ?? "0")) });
    case "deals_awaiting_approval": case "deals_closed": case "lost": case "quotes_expiring": case "package_mix": return kpi.amount ? format.money(kpi.amount) : null;
    case "won_by_account_manager": return extra.average ? t("Average deal {amount}", { amount: format.money(String(extra.average)) }) : null;
    case "follow_ups": return t("{overdue} overdue · {due} due", { overdue: Number(extra.overdue ?? 0), due: Number(extra.due ?? 0) });
    case "response_rate": return t("{met} within target · {missed} missed", { met: Number(extra.met ?? 0), missed: Number(extra.missed ?? 0) });
    case "first_response_hours": return t("{count} responses", { count: kpi.count });
    case "profit_margin": return extra.withoutCost ? t("{count} projects without a QS cost left out", { count: Number(extra.withoutCost) }) : null;
    case "design_to_proposal2_days": return t("{count} of {total} approved designs have a Proposal 2", { count: kpi.count, total: Number(extra.approved ?? 0) });
    case "design_to_proposal2_rate": return t("{won} of {total} approved designs", { won: Number(extra.won ?? 0), total: Number(extra.approved ?? 0) });
    default: return null;
  }
}

function ChartView({ chart, title, format, nameOf, open, danger }: {
  chart: Chart; title: string; format: Formatters; nameOf: (dimension: string, key: string, fallback: string) => string; open: (bucket: string, title?: string) => void; danger: boolean;
}) {
  if (chart.type === "list") return null;
  if (chart.type === "columns") {
    const categories = chart.categories.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label) }));
    const series = chart.series.map((item) => ({ id: item.id, label: chart.seriesDimension ? nameOf(chart.seriesDimension, item.id, item.label) : item.label }));
    return <ColumnChart ariaLabel={title} categories={categories} series={series} values={chart.values.map((row) => row.map(Number))} format={(value) => format.value(chart.unit, String(value), true)}
      onSelect={(key, seriesId) => open(`${chart.dimension}=${key}${seriesId && chart.seriesDimension ? `;${chart.seriesDimension}=${seriesId}` : ""}`,
        [categories.find((item) => item.key === key)?.label, series.find((item) => item.id === seriesId)?.label].filter(Boolean).join(" · "))} />;
  }
  if (chart.type === "lines") {
    const categories = chart.categories.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label) }));
    return <TrendLines ariaLabel={title} categories={categories} series={chart.series.map((item) => ({ id: item.id, label: nameOf("series", item.id, item.label) }))}
      values={chart.values.map((row) => row.map((value) => (value === null ? null : Number(value))))} maxValue={chart.unit === "percent" ? 100 : undefined}
      format={(value) => format.value(chart.unit, String(value), true)} onSelect={(key) => open(`${chart.dimension}=${key}`, categories.find((item) => item.key === key)?.label)} />;
  }
  if (chart.type === "bars") {
    return <RankedBars ariaLabel={title} tone={danger ? "danger" : undefined}
      items={chart.items.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label), value: Number(item.value), display: format.value(chart.unit, item.value, true),
        detail: [chart.unit !== "count" && item.count ? String(item.count) : null, item.amount && chart.unit === "count" ? format.money(item.amount, true) : null,
          item.target?.percent ? `${format.number(item.target.percent)}%` : null].filter(Boolean).join(" · ") || undefined }))}
      onSelect={(key) => open(`period=1;${chart.dimension}=${key}`, nameOf(chart.dimension, key, chart.items.find((item) => item.key === key)?.label ?? key))} />;
  }
  if (chart.type === "donut") {
    return <DonutChart ariaLabel={title} centre={format.number(String(chart.items.reduce((sum, item) => sum + item.count, 0)), 0)}
      segments={chart.items.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label), value: item.count, display: format.number(String(item.count), 0),
        secondary: item.amount ? format.money(item.amount) : undefined }))}
      onSelect={(key) => open(`period=1;${chart.dimension}=${key}`, nameOf(chart.dimension, key, chart.items.find((item) => item.key === key)?.label ?? key))} />;
  }
  if (chart.type === "funnel") {
    return <FunnelSteps ariaLabel={title} steps={chart.items.map((item) => ({ key: item.key, label: nameOf("step", item.key, item.label), value: Number(item.value),
      display: format.number(item.value, 0), rate: item.rate === null ? undefined : `${format.number(item.rate)}%` }))}
      onSelect={(key) => open(`period=1;${key}=1`, nameOf("step", key, key))} />;
  }
  return null;
}

/** The filter bar every dashboard shares (PLM-134): period, Account Manager, enquiry type, package, client type, source, channel, region, entity. */
function FilterBar({ filters, preset, options, onChange }: { filters: Filters; preset: Preset; options: FilterOptions | null; onChange: (next: Partial<Filters> & { period?: Preset }) => void }) {
  const t = useT();
  const any = { id: "", label: t("All") };
  const select = (key: keyof Filters, fieldLabel: string, items: Array<{ id: string; label: string }> | undefined) =>
    items && items.length ? <SelectField key={key} accent="neutral" label={fieldLabel} items={[any, ...items]} selectedKey={filters[key] || ""}
      onSelectionChange={(value) => onChange({ [key]: String(value ?? "") } as Partial<Filters>)} /> : null;
  let range = null;
  try { range = { start: parseDate(filters.from), end: parseDate(filters.to) }; } catch { range = null; }
  return <div className={`${styles.filters} ${styles.noPrint}`} role="group" aria-label={t("Filters")}>
    <SelectField accent="neutral" label={t("Period")} items={PRESETS.map((id) => ({ id, label: t(PRESET_LABELS[id]) }))} selectedKey={preset}
      onSelectionChange={(value) => { const next = String(value ?? "month") as Preset; onChange(next === "custom" ? { period: next, from: filters.from, to: filters.to } : { period: next }); }} />
    {preset === "custom" ? <DateRangeField label={t("Dates")} value={range} onChange={(value) => value && onChange({ period: "custom", from: value.start.toString(), to: value.end.toString() })} /> : null}
    {select("accountManager", t("Account Manager"), options?.accountManagers)}
    {select("enquiryType", t("Enquiry type"), options?.enquiryTypes)}
    {select("package", t("Package"), options?.packages)}
    {select("clientType", t("Client type"), options?.clientTypes)}
    {select("source", t("Source"), options?.sources)}
    {filters.source ? select("channel", t("Channel"), options?.channels[filters.source]) : null}
    {select("region", t(administrativeAreaLabel(options?.countryCode) as MessageKey), options?.regions)}
    {select("entity", t("Entity"), options?.entities)}
    <small className={styles.taxNote}>{t("Amounts exclude tax unless marked")}</small>
  </div>;
}

/** The records behind a figure or a bar, with links to each record and an Excel (CSV) export. */
function Records({ api, dashboard, filters, drill, format, label, onClose }: {
  api: ReturnType<typeof reportsApi>; dashboard: DashboardId; filters: Filters; drill: Drill; format: Formatters; label: (key: string) => string; onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<ReportRecord[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.records(dashboard, filters, drill.kpi, drill.bucket, controller.signal)
      .then((result) => { setRows(result.records); setTruncated(result.truncated); setFailure(null); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [api, dashboard, filters, drill, reload]);
  const columns: DataGridColumn<ReportRecord & { key: string }>[] = [
    { id: "reference", header: t("Reference"), size: 140, accessorFn: (row) => row.reference ?? "",
      meta: { primary: true, interactive: true, renderCell: (row) => <Link className={styles.recordLink} href={row.href}>{row.reference || t("Open")}</Link> } },
    { id: "title", header: t("Name"), size: 240, accessorFn: (row) => row.title },
    { id: "client", header: t("Client"), size: 180, accessorFn: (row) => row.client ?? "" },
    { id: "owner", header: t("Owner"), size: 160, accessorFn: (row) => row.owner ?? "" },
    { id: "at", header: t("Date"), size: 130, accessorFn: (row) => format.date(row.at) },
    { id: "amount", header: t("Value"), size: 140, accessorFn: (row) => (row.amount === null ? "" : format.money(row.amount)), meta: { align: "end" } },
    ...(MEASURE_LABELS[drill.kpi] ? [{ id: "measure", header: t(MEASURE_LABELS[drill.kpi]), size: 120, accessorFn: (row: ReportRecord) => (row.measure === null ? "" : format.number(row.measure, 2)),
      meta: { align: "end" as const } }] : []),
    { id: "detail", header: t("Detail"), size: 200, accessorFn: (row) => (!row.detail ? "" : row.detail === "design" && ["sales_won", "won_by_account_manager"].includes(drill.kpi) ? t("Design Fee") : label(row.detail)) },
  ];
  return <InspectorSheet isOpen size="xl" title={drill.title} onOpenChange={(open) => { if (!open) onClose(); }}>
    {failure ? <ErrorState title={t("These records didn't load")} description={translateKnown(t, failure)} onRetry={() => setReload((value) => value + 1)} />
      : <DataGrid ariaLabel={drill.title} columns={columns} data={(rows ?? []).map((row, index) => ({ ...row, key: `${row.id}:${index}` }))} isLoading={rows === null}
        getRowId={(row) => row.key} selectable={false} rowNumbers={false} pageSize={50} showToolbar wrapText
        exportFileName={`${dashboard}-${drill.kpi}-${filters.from}-${filters.to}.csv`}
        emptyContent={<EmptyState title={t("No records behind this figure")} description={t("Choose a longer period or clear a filter.")} />}
        footerActions={truncated ? <small>{t("Showing the first 2,000 records")}</small> : undefined} />}
  </InspectorSheet>;
}
