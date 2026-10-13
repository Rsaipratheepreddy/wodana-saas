"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import {
  Button, CardGrid, ColumnChart, DataGrid, DateRangeField, DonutChart, EmptyState, ErrorState, FunnelSteps, InspectorSheet, KpiFigure, ListTabs, MenuButton, PageShell,
  RankedBars, RecordTable, ReportPanel, SelectField, Skeleton, TrendLines, useDesignSystem, type ComparisonState, type DataGridColumn, type TargetState,
} from "@/design-system";
import { useWoddy } from "@/components/crm/woddy-chat";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { meetsRule, type AccessContext } from "@/lib/workspace/access";
import { loadAiSettings } from "@/lib/workspace/ai-settings";
import { useHydrated } from "@/lib/use-hydrated";
import {
  DASHBOARD_FILTERS, DASHBOARD_LABELS, DASHBOARDS, downloadCsv, filtersFrom, filtersQuery, reportsApi, toCsv,
  type Chart, type Dashboard, type DashboardId, type FilterOptions, type Filters, type Kpi, type ReportRecord, type TargetResult, type Unit,
} from "@/lib/reports/management";
import styles from "./management-reports.module.css";

/** Each figure's name on its tile (the definitions are in the master plan §6.27a). */
const KPI_LABELS: Record<string, MessageKey> = {
  sales_won: tKey("Sales won"), revenue_collected: tKey("Revenue collected"), deals_closed: tKey("Deals closed"), profit_margin: tKey("Profit margin"),
  new_leads: tKey("New enquiries"), conversion_funnel: tKey("Enquiry to won"), response_rate: tKey("Answered within target"), lost: tKey("Lost"),
  package_mix: tKey("Design projects started"), designs_approved: tKey("Designs approved"), design_to_proposal2_days: tKey("Days to Proposal 2"),
  design_to_proposal2_rate: tKey("Moved on to furniture or joinery"),
  work_orders_made: tKey("Work orders made"), on_time_rate: tKey("Made on time"), work_orders_delivered: tKey("Delivered to site"), installations_done: tKey("Installations done"),
  cash_in: tKey("Cash in"), cash_out: tKey("Cash out"), revenue_mix: tKey("Revenue"), refunds: tKey("Refunds"),
  stock_value: tKey("Stock value"), purchases: tKey("Purchases"), stock_used: tKey("Stock used"),
};

/** Each chart's title (a chart may break down a tile's figure; its title says how). */
const CHART_LABELS: Record<string, MessageKey> = {
  sales_won: tKey("Sales won by month"), active_projects: tKey("Projects by stage"), new_leads: tKey("Enquiries by source"), won_by_source: tKey("Won value by source"),
  design_stage: tKey("Projects by design stage"), designer_workload: tKey("Designer workload"), work_orders_status: tKey("Open work orders"),
  factory_load: tKey("Factory load by week"), cash_in_out: tKey("Cash in and out by month"), receivables_ageing: tKey("Receivables by age"),
  reserved_available: tKey("Reserved and available stock"), slow_moving: tKey("Slow-moving stock"),
};

/** Fixed chart keys and reasons the server sends (stages, ages, series, steps), named here. */
const KEY_LABELS: Record<string, MessageKey> = {
  design: tKey("Design fee"), main: tKey("Proposal 2"), collected: tKey("Collected"), invoiced: tKey("Invoiced"), net: tKey("Net"), in: tKey("Cash in"), out: tKey("Cash out"),
  not_due: tKey("Not due yet"), overdue_1_30: tKey("1–30 days overdue"), overdue_31_60: tKey("31–60 days overdue"), overdue_60_plus: tKey("Over 60 days overdue"), no_due_date: tKey("No due date"),
  estimate: tKey("Estimate"), production: tKey("Production"), delivery: tKey("Delivery"), snagging: tKey("Snagging"),
  inspiration: tKey("Inspiration"), site_visit: tKey("Site visit"), development: tKey("Development"), materials: tKey("Materials"), renders: tKey("Renders"),
  approval: tKey("Approval"), not_started: tKey("Not started"), concepts: tKey("Concepts"), space_planning: tKey("Space planning"), material_selection: tKey("Material selection"),
  promise_date: tKey("Past the promised date"), tasks: tKey("Late tasks"), other: tKey("Other"), none: tKey("Not assigned"),
  overdue: tKey("Overdue"), due: tKey("Due"), designer: tKey("Designer"), visualiser: tKey("Visualiser"),
  scheduled: tKey("Scheduled"), in_production: tKey("In production"), quality_check: tKey("Quality check"), ready: tKey("Ready"),
  reserved: tKey("Reserved"), available: tKey("Available"), days_90_180: tKey("90–180 days"), days_181_365: tKey("181–365 days"), over_365: tKey("Over a year"),
  short: tKey("Short"), low: tKey("Low"), late_work_order: tKey("Work order late"), late_installation: tKey("Installation late"), permit_expired: tKey("Permit expired"),
  permit_expiring: tKey("Permit expiring"), late_handover: tKey("Handover late"), client_overdue: tKey("Client payment overdue"), bill_overdue: tKey("Bill overdue"),
  request_waiting: tKey("Waiting over a week"), design_stage: tKey("Design stage late"), design_fees: tKey("Design fees"), variations: tKey("Variations"),
  on_time: tKey("On time"), late: tKey("Late"), issued: tKey("Issued"), stuck_deal: tKey("No stage change"), follow_up_overdue: tKey("Follow-up overdue"),
};

/** What a record's measure means, per figure (the list's column header). */
const MEASURE_LABELS: Record<string, MessageKey> = {
  delayed_items: tKey("Days late"), profit_margin: tKey("Margin %"), design_overdue: tKey("Days late"), design_to_proposal2_days: tKey("Days"),
  production_attention: tKey("Days late"), on_time_rate: tKey("Days late"), factory_load: tKey("Hours"), finance_attention: tKey("Days overdue"),
  receivables_ageing: tKey("Days overdue"), low_stock: tKey("Free"), slow_moving: tKey("Days idle"), stock_value: tKey("Quantity"), stock_used: tKey("Quantity"),
  response_rate: tKey("Hours to respond"), installations_done: tKey("Days late"), sales_attention: tKey("Days"), stuck_deals: tKey("Days"),
};

/** Where to start when a chart has nothing to show yet. */
const NEXT_ACTIONS: Record<DashboardId, { href: string; label: MessageKey }> = {
  "owner-overview": { href: "/workspace/crm/opportunities", label: tKey("Open opportunities") },
  "sales-pipeline": { href: "/workspace/crm/leads", label: tKey("Open enquiries") },
  "design-projects": { href: "/workspace/pre-projects", label: tKey("Open planning") },
  "production-delivery": { href: "/workspace/factory", label: tKey("Open the factory") },
  finance: { href: "/workspace/finance", label: tKey("Open finance") },
  stock: { href: "/workspace/inventory", label: tKey("Open stock") },
};

const FILTER_LABELS: Record<"accountManager" | "enquiryType" | "package" | "entity", { label: MessageKey; all: MessageKey }> = {
  accountManager: { label: tKey("Account manager"), all: tKey("All account managers") },
  enquiryType: { label: tKey("Enquiry type"), all: tKey("All enquiry types") },
  package: { label: tKey("Package"), all: tKey("All packages") },
  entity: { label: tKey("Company"), all: tKey("All companies") },
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

/** Whether a chart has anything to draw. */
export function chartHasData(chart: Chart | undefined) {
  if (!chart) return false;
  if (chart.type === "columns") return chart.values.some((row) => row.some((value) => Number(value) !== 0));
  if (chart.type === "lines") return chart.values.some((row) => row.some((value) => value !== null && Number(value) !== 0));
  if (chart.type === "bars" || chart.type === "donut") return chart.items.some((item) => item.count > 0 || Number(item.value) !== 0);
  if (chart.type === "funnel") return chart.items.some((item) => Number(item.value) > 0);
  return false;
}

type Drill = { kpi: string; bucket: string; title: string };

/** What the Overview suggests asking Woddy (the existing chat answers from the records; nothing new is stored). */
const WODDY_QUESTIONS: MessageKey[] = [
  tKey("Which deals are stuck, and why?"), tKey("How do this month's sales compare with last month?"), tKey("Which projects are running late?"),
];

/**
 * One compact way into Woddy on the Overview: shown only when the workspace has AI assistance on and the person may
 * use it; a question opens the chat and asks it.
 */
function AskWoddy({ workspaceId, access }: { workspaceId: string; access: AccessContext }) {
  const t = useT();
  const woddy = useWoddy();
  const canAsk = Boolean(woddy?.ask) && meetsRule([["ai.suggestions.use"]], access);
  const [aiOn, setAiOn] = useState(false);
  useEffect(() => {
    if (!canAsk) return;
    let alive = true;
    void loadAiSettings(workspaceId).then((settings) => { if (alive) setAiOn(Boolean(settings?.enabled && settings.available !== false)); });
    return () => { alive = false; };
  }, [workspaceId, canAsk]);
  if (!canAsk || !aiOn) return null;
  return <div className={`${styles.ask} ${styles.noPrint}`} role="group" aria-label={t("Ask Woddy")}>
    <span className={styles.askLabel}>{t("Ask Woddy")}</span>
    {WODDY_QUESTIONS.map((question) => <Button key={question} size="compact" variant="quiet" onPress={() => woddy?.ask(t(question))}>{t(question)}</Button>)}
  </div>;
}

export function ManagementReports({ workspaceId, initialDashboard, dashboards = DASHBOARDS, access = {} }: {
  workspaceId: string; initialDashboard: DashboardId; dashboards?: readonly DashboardId[];
  /** The member's permissions and roles (who may ask Woddy). */
  access?: AccessContext;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const hydrated = useHydrated();
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

  /** Every filter lives in the address, so a view can be shared and survives a reload; a tab keeps only the filters it offers. */
  const update = useCallback((next: Partial<Filters> & { period?: Preset }, tab: DashboardId = dashboard) => {
    const kept = new Set<string>(DASHBOARD_FILTERS[tab]);
    const merged = { ...filters, ...next };
    for (const key of ["accountManager", "enquiryType", "package", "clientType", "source", "channel", "region", "entity"] as const) if (!kept.has(key)) merged[key] = "";
    const query = filtersQuery(merged);
    const period = next.period ?? preset;
    if (period !== "custom") { query.delete("from"); query.delete("to"); if (period !== "month") query.set("period", period); }
    else query.set("period", "custom");
    const base = tab === "owner-overview" ? "/workspace/reports" : `/workspace/reports/${tab}`;
    router.replace(`${base}${query.size ? `?${query}` : ""}`, { scroll: false });
  }, [dashboard, filters, preset, router]);

  const changeTab = (tab: DashboardId) => { setDashboard(tab); setData(null); update({}, tab); };

  const label = useCallback((key: string) => (KEY_LABELS[key] ? t(KEY_LABELS[key]) : key), [t]);
  const format = useFormatters(data?.currency ?? "USD", locale, t);
  const kpiOf = (code: string) => data?.kpis.find((kpi) => kpi.code === code);
  const layout = data?.layout ?? { tiles: [], charts: [], attention: null };
  const open = (kpi: string, bucket: string, title: string) => setDrill({ kpi, bucket, title });

  const exportDashboard = () => {
    if (!data) return;
    const rows = layout.tiles.flatMap((code) => {
      const kpi = kpiOf(code);
      if (!kpi) return [];
      return [[t(KPI_LABELS[code] ?? (code as MessageKey)), kpi.value === null ? t("Not enough data yet") : format.value(kpi.unit, kpi.value),
        kpi.previous?.value ? format.value(kpi.unit, kpi.previous.value) : "", kpi.previous?.change ? `${kpi.previous.change}%` : "",
        kpi.target ? format.value(kpi.unit, kpi.target.target) : "", kpi.target?.percent ? `${kpi.target.percent}%` : ""]];
    });
    downloadCsv(`${dashboard}-${effective.from}-${effective.to}.csv`, toCsv([t("Figure"), t("This period"), t("Period before"), t("Change"), t("Target"), t("Achieved")], rows));
  };

  const toolbar = <div className={`${styles.toolbar} ${styles.noPrint}`} role="group" aria-label={t("Filters")}>
    <Toolbar dashboard={dashboard} filters={effective} preset={preset} options={options} onChange={update} />
    <MenuButton label={t("Export")} size="compact" items={[{ id: "excel", label: t("Excel (CSV)"), isDisabled: !data }, { id: "pdf", label: t("Print or save as PDF"), isDisabled: !data }]}
      onAction={(id) => (id === "pdf" ? window.print() : exportDashboard())} />
  </div>;

  return <div className={styles.report} data-report="">
    <PageShell kind="dashboard" title={t("Reports")} toolbar={toolbar}
      tabs={<ListTabs label={t("Dashboards")} value={dashboard} onChange={changeTab} items={dashboards.map((id) => ({ id, label: t(DASHBOARD_LABELS[id]) }))} />}>
      {/* The period for print: worked out from today and the runtime's date formatting, so only once hydrated (QA-009). */}
      <p className={styles.printPeriod}>{hydrated ? `${t(DASHBOARD_LABELS[dashboard])} · ${format.range(effective.from, effective.to)}` : null}</p>
      {failure ? <ErrorState title={t("This report didn't load")} description={translateKnown(t, failure)} onRetry={() => setReload((value) => value + 1)} />
        : loading && !data ? <div className={styles.loading}><Skeleton shape="facts" lines={6} /></div>
        : data ? <div className={styles.page}>
          {layout.tiles.length ? <CardGrid min="14rem">{layout.tiles.map((code) => {
            const kpi = kpiOf(code);
            return kpi ? <Tile key={code} kpi={kpi} format={format} open={() => open(code, "period=1", t(KPI_LABELS[code] ?? (code as MessageKey)))} /> : null;
          })}</CardGrid> : null}
          {layout.charts.length ? <CardGrid min="24rem">{layout.charts.map((code) => {
            const kpi = kpiOf(code);
            const title = t(CHART_LABELS[code] ?? (code as MessageKey));
            return kpi?.chart ? <ReportPanel key={code} title={title}>
              {chartHasData(kpi.chart)
                ? <ChartView chart={kpi.chart} title={title} format={format} nameOf={nameOf(t, options, format, label)} open={(bucket, part) => open(code, bucket, part ? `${title} · ${part}` : title)} />
                : <EmptyState illustration={null} title={t("Nothing to show for this period")}
                    action={<Link className={styles.recordLink} href={NEXT_ACTIONS[dashboard].href}>{t(NEXT_ACTIONS[dashboard].label)}</Link>} />}
            </ReportPanel> : null;
          })}</CardGrid> : null}
          {layout.attention && data.attention ? <Attention attention={data.attention} format={format} label={label}
            onShowAll={() => open(data.attention!.kpi, "period=1", t("Needs attention"))} /> : null}
          {dashboard === "owner-overview" ? <AskWoddy workspaceId={workspaceId} access={access} /> : null}
        </div> : null}
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
      : unit === "hours" ? t("{hours} h", { hours: number(text, compact ? 1 : 2) }) : unit === "days" ? t("{days} days", { days: number(text) }) : number(text, 0);
    const date = (text: string | null) => {
      if (!text) return "—";
      const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`) : new Date(text);
      return Number.isNaN(at.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(text) ? "UTC" : undefined }).format(at);
    };
    /** A period as dates people say ("1–12 Sep"). */
    const range = (from: string, to: string) => {
      try { return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).formatRange(new Date(`${from}T12:00:00Z`), new Date(`${to}T12:00:00Z`)); }
      catch { return `${from} – ${to}`; }
    };
    const month = (key: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
    const day = (key: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
    return { number, money, value, date, range, month, day };
  }, [currency, locale, t]);
}

function targetState(unit: Unit, target: TargetResult | null | undefined, format: Formatters): TargetState {
  if (!target) return null;
  return { target: format.value(unit, target.target, true), percent: target.percent === null ? null : `${format.number(target.percent)}%`, gap: format.value(unit, target.gap, true), tone: target.tone };
}

/** The figure against the period before: which way, by how much, and whether that is good news. */
export function comparisonState(kpi: Kpi, format: Formatters): ComparisonState {
  const previous = kpi.previous;
  if (!previous || kpi.value === null || previous.value === null) return null;
  const change = previous.change === null ? null : Number(previous.change);
  const direction = change === null ? (Number(kpi.value) === Number(previous.value) ? "flat" : Number(kpi.value) > Number(previous.value) ? "up" : "down")
    : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const good = previous.better === "neutral" || direction === "flat" ? undefined
    : (direction === "up") === (previous.better === "higher") ? "success" as const : "danger" as const;
  return { direction, change: change === null ? null : `${format.number(String(Math.abs(change)))}%`, tone: good, against: format.range(previous.from, previous.to),
    previous: format.value(kpi.unit, previous.value, true) };
}

/** One figure for the period: compact, against the period before, opening its records. */
function Tile({ kpi, format, open }: { kpi: Kpi; format: Formatters; open: () => void }) {
  const t = useT();
  const title = t(KPI_LABELS[kpi.code] ?? (kpi.code as MessageKey));
  const notes = [
    kpi.notes?.otherCurrency ? t("{count} in another currency not included", { count: kpi.notes.otherCurrency }) : null,
    kpi.notes?.basis === "records" ? t("From Wodana's records") : kpi.notes?.basis === "ledger" ? t("From the Ledger") : kpi.notes?.basis === "mixed" ? t("From the Ledger and Wodana's records") : null,
    kpi.targetHidden ? t("Target not compared while filtered") : null,
  ].filter(Boolean);
  return <KpiFigure label={title} value={kpi.value === null ? null : format.value(kpi.unit, kpi.value, true)} noData={kpi.value === null}
    targetable={kpi.targetable && !kpi.targetHidden && Boolean(kpi.target)} target={targetState(kpi.unit, kpi.target, format)}
    comparison={comparisonState(kpi, format)} detail={tileDetail(kpi, format, t) ?? undefined} note={notes.length ? notes.join(" · ") : undefined} onOpen={open} />;
}

/** At most one short line under a figure, never a number another tile or chart already shows. */
function tileDetail(kpi: Kpi, format: Formatters, t: Translate): string | null {
  const extra = kpi.extra ?? {};
  switch (kpi.code) {
    case "sales_won": return t("{count} won", { count: kpi.count });
    case "deals_closed": case "lost": case "refunds": case "package_mix": return kpi.amount && Number(kpi.amount) ? format.money(kpi.amount, true) : null;
    case "revenue_mix": return t("Design fees {design} · production {production}", { design: format.money(String(extra.design_fees ?? "0"), true), production: format.money(String(extra.production ?? "0"), true) });
    case "on_time_rate": case "installations_done": return Number(extra.late ?? 0) ? t("{count} late", { count: Number(extra.late) }) : null;
    case "profit_margin": return extra.withoutCost ? t("{count} projects without a QS cost left out", { count: Number(extra.withoutCost) }) : null;
    default: return null;
  }
}

/** How a chart names its keys: the workspace's own options, months and weeks, else the fixed keys above. */
function nameOf(t: Translate, options: FilterOptions | null, format: Formatters, label: (key: string) => string) {
  return (dimension: string, key: string, fallback: string) => {
    if (key === "other") return t("Other");
    if (dimension === "type" || dimension === "typeGroup") return options?.enquiryTypes.find((item) => item.id === key)?.label ?? (key === "none" ? t("Not set") : key);
    if (dimension === "sourceGroup" || dimension === "source") return key === "none" ? t("No enquiry") : options?.sources.find((item) => item.id === key)?.label ?? (fallback || key);
    if ((dimension === "am" || dimension === "person") && key === "none") return t("Not assigned");
    if (dimension === "series" && key === "design") return t("Design fee");
    if (dimension === "month") return format.month(key);
    if (dimension === "week") return format.day(key);
    if (dimension === "category" && key === "none") return t("No category");
    return fallback || label(key);
  };
}

function ChartView({ chart, title, format, nameOf, open }: {
  chart: Chart; title: string; format: Formatters; nameOf: (dimension: string, key: string, fallback: string) => string; open: (bucket: string, part?: string) => void;
}) {
  const t = useT();
  if (chart.type === "list" || chart.type === "gauge") return null;
  if (chart.type === "columns") {
    const categories = chart.categories.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label === item.key ? "" : item.label) }));
    const series = chart.series.map((item) => ({ id: item.id, label: chart.seriesDimension ? nameOf(chart.seriesDimension, item.id, item.label === item.id ? "" : item.label) : item.label }));
    return <ColumnChart ariaLabel={title} categories={categories} series={series} values={chart.values.map((row) => row.map(Number))} format={(value) => format.value(chart.unit, String(value), true)}
      onSelect={(key, seriesId) => open(`${chart.dimension}=${key}${seriesId && chart.seriesDimension ? `;${chart.seriesDimension}=${seriesId}` : ""}`,
        [categories.find((item) => item.key === key)?.label, series.find((item) => item.id === seriesId)?.label].filter(Boolean).join(" · "))} />;
  }
  if (chart.type === "lines") {
    const categories = chart.categories.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, "") }));
    return <TrendLines ariaLabel={title} categories={categories} series={chart.series.map((item) => ({ id: item.id, label: nameOf("series", item.id, item.label) }))}
      values={chart.values.map((row) => row.map((value) => (value === null ? null : Number(value))))} maxValue={chart.unit === "percent" ? 100 : undefined}
      format={(value) => format.value(chart.unit, String(value), true)} onSelect={(key) => open(`${chart.dimension}=${key}`, categories.find((item) => item.key === key)?.label)} />;
  }
  if (chart.type === "bars") {
    return <RankedBars ariaLabel={title}
      items={chart.items.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label === item.key ? "" : item.label), value: Number(item.value),
        display: format.value(chart.unit, item.value, true),
        detail: [item.extra && "leads" in item.extra ? t("{count} enquiries", { count: Number(item.extra.leads) }) : null,
          chart.unit !== "count" && !item.extra && item.count ? String(item.count) : null].filter(Boolean).join(" · ") || undefined }))}
      onSelect={(key) => open(`period=1;${chart.dimension}=${key}`, nameOf(chart.dimension, key, chart.items.find((item) => item.key === key)?.label ?? key))} />;
  }
  if (chart.type === "donut") {
    return <DonutChart ariaLabel={title} segments={chart.items.map((item) => ({ key: item.key, label: nameOf(chart.dimension, item.key, item.label), value: item.count,
      display: format.number(String(item.count), 0), secondary: item.amount ? format.money(item.amount, true) : undefined }))}
      onSelect={(key) => open(`period=1;${chart.dimension}=${key}`, nameOf(chart.dimension, key, key))} />;
  }
  return <FunnelSteps ariaLabel={title} steps={chart.items.map((item) => ({ key: item.key, label: nameOf("step", item.key, item.label), value: Number(item.value),
    display: format.number(item.value, 0), rate: item.rate === null ? undefined : `${format.number(item.rate)}%` }))} onSelect={(key) => open(`period=1;${key}=1`, nameOf("step", key, key))} />;
}

/** The period and the dashboard's two filters, in one row (the dashboard's own words for its options). */
function Toolbar({ dashboard, filters, preset, options, onChange }: {
  dashboard: DashboardId; filters: Filters; preset: Preset; options: FilterOptions | null; onChange: (next: Partial<Filters> & { period?: Preset }) => void;
}) {
  const t = useT();
  const items = (key: "accountManager" | "enquiryType" | "package" | "entity") => key === "accountManager" ? options?.accountManagers : key === "enquiryType" ? options?.enquiryTypes
    : key === "package" ? options?.packages : options?.entities;
  let range = null;
  try { range = { start: parseDate(filters.from), end: parseDate(filters.to) }; } catch { range = null; }
  return <>
    <SelectField accent="neutral" label={null} aria-label={t("Period")} items={PRESETS.map((id) => ({ id, label: t(PRESET_LABELS[id]) }))} selectedKey={preset}
      onSelectionChange={(value) => { const next = String(value ?? "month") as Preset; onChange(next === "custom" ? { period: next, from: filters.from, to: filters.to } : { period: next }); }} />
    {preset === "custom" ? <DateRangeField label={null} aria-label={t("Dates")} value={range} onChange={(value) => value && onChange({ period: "custom", from: value.start.toString(), to: value.end.toString() })} /> : null}
    {DASHBOARD_FILTERS[dashboard].map((key) => {
      const list = items(key);
      // A company filter only where there is more than one company; an empty list offers nothing to choose.
      if (!list?.length || (key === "entity" && list.length < 2)) return null;
      return <SelectField key={key} accent="neutral" label={null} aria-label={t(FILTER_LABELS[key].label)} items={[{ id: "", label: t(FILTER_LABELS[key].all) }, ...list]}
        selectedKey={filters[key] || ""} onSelectionChange={(value) => onChange({ [key]: String(value ?? "") } as Partial<Filters>)} />;
    })}
  </>;
}

/** The record columns a list shows: only those its rows fill. */
function recordColumns(rows: ReportRecord[], kpi: string, format: Formatters, label: (key: string) => string, t: Translate): DataGridColumn<ReportRecord & { key: string }>[] {
  const filled = (pick: (row: ReportRecord) => unknown) => rows.some((row) => pick(row) !== null && pick(row) !== undefined && pick(row) !== "");
  return [
    { id: "reference", header: t("Reference"), size: 130, accessorFn: (row) => row.reference ?? "",
      meta: { primary: true, interactive: true, renderCell: (row) => <Link className={styles.recordLink} href={row.href}>{row.reference || t("Open")}</Link> } },
    { id: "title", header: t("Name"), size: 220, accessorFn: (row) => row.title },
    ...(filled((row) => row.client) ? [{ id: "client", header: t("Client"), size: 160, accessorFn: (row: ReportRecord) => row.client ?? "" }] : []),
    ...(filled((row) => row.at) ? [{ id: "at", header: t("Date"), size: 120, accessorFn: (row: ReportRecord) => format.date(row.at) }] : []),
    ...(filled((row) => row.amount) ? [{ id: "amount", header: t("Value"), size: 130, accessorFn: (row: ReportRecord) => (row.amount === null ? "" : format.money(row.amount)),
      meta: { align: "end" as const } }] : []),
    ...(MEASURE_LABELS[kpi] && filled((row) => row.measure) ? [{ id: "measure", header: t(MEASURE_LABELS[kpi]), size: 110,
      accessorFn: (row: ReportRecord) => (row.measure === null ? "" : format.number(row.measure, 2)), meta: { align: "end" as const } }] : []),
    ...(filled((row) => row.detail) ? [{ id: "detail", header: t("Detail"), size: 180, accessorFn: (row: ReportRecord) => (row.detail ? label(row.detail) : "") }] : []),
  ];
}

/** The dashboard's one "needs attention" list: its first five, most urgent first, each opening its record; the rest in the records sheet. */
function Attention({ attention, format, label, onShowAll }: {
  attention: NonNullable<Dashboard["attention"]>; format: Formatters; label: (key: string) => string; onShowAll: () => void;
}) {
  const t = useT();
  const rows = attention.records.map((row, index) => ({ ...row, key: `${row.id}:${index}` }));
  return <ReportPanel title={attention.total ? t("Needs attention · {count}", { count: attention.total }) : t("Needs attention")}
    action={attention.total > rows.length ? <Button size="compact" variant="quiet" onPress={onShowAll}>{t("Show all")}</Button> : undefined}>
    {rows.length ? <RecordTable ariaLabel={t("Needs attention")} columns={recordColumns(attention.records, attention.kpi, format, label, t)} data={rows} getRowId={(row) => row.key}
        selectable={false} rowNumbers={false} pageSize={rows.length} showToolbar={false} showFooter={false} wrapText />
      : <EmptyState illustration={null} title={t("Nothing needs attention")} />}
  </ReportPanel>;
}

/** The records behind a figure or a bar, with links to each record and an Excel (CSV) export; amounts in full. */
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
  return <InspectorSheet isOpen size="xl" title={drill.title} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
    {failure ? <ErrorState title={t("These records didn't load")} description={translateKnown(t, failure)} onRetry={() => setReload((value) => value + 1)} />
      : <DataGrid ariaLabel={drill.title} columns={recordColumns(rows ?? [], drill.kpi, format, label, t)} data={(rows ?? []).map((row, index) => ({ ...row, key: `${row.id}:${index}` }))}
        isLoading={rows === null} getRowId={(row) => row.key} selectable={false} rowNumbers={false} pageSize={50} showToolbar wrapText
        exportFileName={`${dashboard}-${drill.kpi}-${filters.from}-${filters.to}.csv`}
        emptyContent={<EmptyState title={t("No records behind this figure")} description={t("Choose a longer period or clear a filter.")} />}
        footerActions={truncated ? <small>{t("Showing the first 2,000 records")}</small> : undefined} />}
  </InspectorSheet>;
}
