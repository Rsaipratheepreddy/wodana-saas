"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, ColumnChart, DataGrid, EmptyState, ErrorState, Heading, InlineNotice, Skeleton, TrendLines, useDesignSystem, type DataGridColumn, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import { addExact } from "@/lib/purchasing/amounts";
import type { CashMonth, CostCategory, PnlCategory, PnlFlag, ProjectCashFlow, ProjectPnl, UpcomingBucket } from "@/lib/project-core/types";
import { usePercent } from "../books/projects-profit";
import { useProjectFormat } from "./format";
import styles from "./project-money-summary.module.css";

/** The cost categories' labels (the P&L's rows). */
export function useCategoryLabels(): Record<CostCategory, string> {
  const t = useT();
  return useMemo(() => ({ materials: t("Materials"), factory: t("Factory"), subcontract_labour: t("Subcontract & labour"), site_expenses: t("Site expenses"), other: t("Other") }), [t]);
}

const negative = (value: string | null) => value !== null && value.trim().startsWith("-") && !isZero(value);
/** "0", "0.0000" or "-0.00": nothing. */
const isZero = (value: string) => /^-?0*(\.0*)?$/.test(value.trim());
/** Money for a chart's bar height only; the figures people read are always the exact text. */
const height = (value: string) => Math.max(0, Number(value));

/** One flag as a short state with its tone: an overrun or a loss is red, a thin or unknown margin amber. */
export function useFlagText() {
  const t = useT();
  const labels = useCategoryLabels();
  const { percent } = usePercent();
  return useCallback((flag: PnlFlag, money: (value: string) => string): { text: string; tone: StatusTone } => {
    switch (flag.code) {
      case "over_budget": return { text: t("{category} over by {amount}", { category: labels[flag.category], amount: money(flag.amount) }), tone: "danger" };
      case "forecast_loss": return { text: t("Expected loss of {amount}", { amount: money(flag.amount) }), tone: "danger" };
      case "below_target": return { text: t("Margin {percent} below the {target} target", { percent: percent(flag.forecastPercent), target: percent(flag.target) }), tone: "warning" };
      case "estimate_incomplete": return { text: flag.count === 1 ? t("1 quoted line has no cost") : t("{count} quoted lines have no cost", { count: flag.count }), tone: "warning" };
      default: return { text: t("The quotation has no cost estimate"), tone: "warning" };
    }
  }, [t, labels, percent]);
}

/**
 * Money › Summary: the project's key figures, its P&L by category against the quotation's estimate, and its cash —
 * in and out by month, the cash it holds and what falls due in the next 90 days. Every figure comes from the records
 * that caused it; margins only for people who see margins.
 */
export function ProjectMoneySummary({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; switcher?: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const { locale } = useDesignSystem();
  const { percent } = usePercent();
  const labels = useCategoryLabels();
  const flagText = useFlagText();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [pnl, setPnl] = useState<ProjectPnl | null>(null);
  const [cash, setCash] = useState<ProjectCashFlow | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextPnl, nextCash] = await Promise.all([api.pnl(projectId), api.cashFlow(projectId)]);
      setPnl(nextPnl); setCash(nextCash); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Money didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const money = useCallback((value: string | null, currency?: string) => (value === null ? "—" : format.money(value, currency ?? pnl?.currency ?? "")), [format, pnl?.currency]);
  const month = useCallback((key: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`)), [locale]);
  const amount = useCallback((value: string | null, currency?: string) =>
    <span className={[styles.number, negative(value) ? styles.danger : ""].filter(Boolean).join(" ")}>{money(value, currency)}</span>, [money]);
  // Table cells show plain amounts: the currency is named once in the section's title, so every column fits.
  const plain = useCallback((value: string | null) => {
    if (value === null) return "—";
    // The currency's own decimals (2 for AED, 0 for JPY, 3 for KWD), without its code.
    let digits = 2;
    try { digits = new Intl.NumberFormat(locale, { style: "currency", currency: pnl?.currency ?? "" }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* no currency yet */ }
    return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));
  }, [locale, pnl?.currency]);
  const cell = useCallback((value: string | null) =>
    <span className={[styles.number, negative(value) ? styles.danger : ""].filter(Boolean).join(" ")}>{plain(value)}</span>, [plain]);

  const categoryColumns = useMemo<DataGridColumn<PnlCategory>[]>(() => [
    { id: "category", header: t("Category"), accessorFn: (row) => labels[row.category], size: 160, enableSorting: false, meta: { primary: true } },
    { id: "budget", header: t("Budget"), accessorFn: (row) => row.budget ?? "", size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.budget) } },
    { id: "actual", header: t("Spent"), accessorFn: (row) => row.actual, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.actual) } },
    { id: "committed", header: t("Committed"), accessorFn: (row) => row.committed, size: 120, enableSorting: false, meta: { align: "end", mobileHidden: true, renderCell: (row) => cell(row.committed) } },
    { id: "forecast", header: t("Expected"), accessorFn: (row) => row.forecast, size: 120, enableSorting: false, meta: { align: "end", priority: "medium", renderCell: (row) => cell(row.forecast) } },
    { id: "variance", header: t("Left"), accessorFn: (row) => row.variance ?? "", size: 140, enableSorting: false, meta: { align: "end", renderCell: (row) => row.variance === null
      ? <span className={styles.muted}>—</span>
      : row.over ? <span className={`${styles.number} ${styles.danger}`}>{t("{amount} over", { amount: plain(row.variance.replace(/^-/, "")) })}</span> : cell(row.variance) } },
  ], [t, labels, cell, plain]);
  const monthColumns = useMemo<DataGridColumn<CashMonth>[]>(() => [
    { id: "month", header: t("Month"), accessorFn: (row) => row.month, size: 140, enableSorting: false, meta: { primary: true, renderCell: (row) => <span>{month(row.month)}</span> } },
    { id: "in", header: t("In"), accessorFn: (row) => row.in, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.in) } },
    { id: "out", header: t("Out"), accessorFn: (row) => row.out, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.out) } },
    { id: "net", header: t("Net"), accessorFn: (row) => row.net, size: 120, enableSorting: false, meta: { align: "end", mobileHidden: true, renderCell: (row) => cell(row.net) } },
    { id: "balance", header: t("Balance"), accessorFn: (row) => row.balance, size: 140, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.balance) } },
  ], [t, month, cell]);
  const bucketLabels: Record<UpcomingBucket, string> = { overdue: t("Overdue"), days_0_30: t("Next 30 days"), days_31_60: t("31–60 days"), days_61_90: t("61–90 days") };
  type Bucket = ProjectCashFlow["upcoming"]["buckets"][number];
  const bucketColumns: DataGridColumn<Bucket>[] = [
    { id: "when", header: t("When"), accessorFn: (row) => row.key, size: 160, enableSorting: false, meta: { primary: true, renderCell: (row) => <span>{bucketLabels[row.key]}</span> } },
    { id: "in", header: t("Due in"), accessorFn: (row) => row.in, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.in) } },
    { id: "out", header: t("Due out"), accessorFn: (row) => row.out, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.out) } },
    { id: "net", header: t("Net"), accessorFn: (row) => row.net, size: 120, enableSorting: false, meta: { align: "end", renderCell: (row) => cell(row.net) } },
  ];

  if (error && (!pnl || !cash)) return <div className={styles.summary}>{switcher ? <div className={styles.toolbar}>{switcher}</div> : null}<ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!pnl || !cash) return <Skeleton lines={8} shape="rows" />;
  const contractCurrency = pnl.contractCurrency;
  const ledger = pnl.basis.ledger;
  // The Ledger against these figures: costs first (events still posting), then revenue.
  const ledgerDifference = [ledger?.costDifference, ledger?.revenueDifference].find((value): value is string => typeof value === "string" && !isZero(value)) ?? null;
  const chartCategories = pnl.categories.map((row) => ({ key: row.category, label: labels[row.category] }));
  const recent = cash.months.slice(-12);
  const showBuckets = cash.upcoming.buckets.some((row) => !isZero(row.in) || !isZero(row.out));

  return <div className={styles.summary}>
    {switcher ? <div className={styles.toolbar}>{switcher}</div> : null}
    <dl className={styles.facts}>
      <div><dt>{t("Contract value")}</dt><dd>{money(pnl.contract.net, contractCurrency)}
        <small>{!isZero(pnl.contract.variationsNet) ? t("{amount} from variations", { amount: money(pnl.contract.variationsNet, contractCurrency) }) : t("Before tax")}</small></dd></div>
      <div><dt>{t("Received")}</dt><dd>{money(pnl.revenue.received, contractCurrency)}<small>{t("{amount} invoiced", { amount: money(pnl.revenue.invoicedTotal, contractCurrency) })}</small></dd></div>
      <div><dt>{t("Spent")}</dt><dd>{money(pnl.totals.actual)}{pnl.totals.budget !== null ? <small>{t("of {amount} planned", { amount: money(pnl.totals.budget) })}</small> : null}</dd></div>
      <div><dt>{t("Committed")}</dt><dd>{money(pnl.totals.committed)}<small>{t("On open orders")}</small></dd></div>
      {pnl.marginHidden ? null : <>
        <div><dt>{t("Margin to date")}</dt><dd className={negative(pnl.margin.toDate) ? styles.danger : undefined}>{money(pnl.margin.toDate)}
          <small>{pnl.margin.toDatePercent === null ? t("Nothing invoiced yet") : t("{percent} of invoiced", { percent: percent(pnl.margin.toDatePercent) })}</small></dd></div>
        <div><dt>{t("Forecast margin")}</dt><dd className={negative(pnl.margin.forecast) || pnl.flags.some((flag) => flag.code === "below_target") ? styles.danger : undefined}>{money(pnl.margin.forecast)}
          <small>{pnl.margin.forecastPercent === null ? "—" : pnl.margin.target === null ? t("{percent} at completion", { percent: percent(pnl.margin.forecastPercent) })
            : t("{percent} at completion, target {target}", { percent: percent(pnl.margin.forecastPercent), target: percent(pnl.margin.target) })}</small></dd></div>
      </>}
    </dl>
    {pnl.flags.length ? <ul className={styles.flags} aria-label={t("Flags")}>{pnl.flags.map((flag, index) => {
      const { text, tone } = flagText(flag, (value) => money(value));
      return <li key={`${flag.code}-${index}`}><Badge tone={tone}>{text}</Badge></li>;
    })}</ul> : null}
    <p className={styles.basis}>
      <span>{t("From Wodana's records")}</span>
      {ledger ? <>
        <span aria-hidden="true">·</span>
        <span>{ledger.matches ? t("Matches the Ledger") : ledgerDifference !== null ? t("The Ledger differs by {amount}", { amount: money(ledgerDifference, ledger.currency) }) : t("Compared with the Ledger")}</span>
        <span aria-hidden="true">·</span>
        <Link className={styles.link} href={ledger.journals}>{t("Ledger journals")}</Link>
      </> : null}
    </p>
    {!pnl.comparable && !pnl.marginHidden ? <InlineNotice tone="info" message={t("The project is in {project} and costs are in {costs}, so there's no margin here.", { project: contractCurrency, costs: pnl.currency })} /> : null}
    {pnl.uncosted ? <InlineNotice tone="info" message={pnl.uncosted === 1 ? t("1 cost has no price or exchange rate yet and isn't counted.") : t("{count} costs have no price or exchange rate yet and aren't counted.", { count: pnl.uncosted })} /> : null}

    <section className={styles.section} aria-labelledby="money-pnl">
      <Heading as="h2" size="sm" id="money-pnl">{t("Profit & loss")} <span className={styles.muted}>{pnl.currency}</span></Heading>
      {pnl.categories.length ? <>
        <DataGrid<PnlCategory> ariaLabel={t("Costs by category")} columns={categoryColumns} data={pnl.categories} getRowId={(row) => row.category} rowNumbers={false}
          selectable={false} showToolbar={false} showFooter={false} wrapText />
        <dl className={styles.totals}>
          <div><dt>{t("Expected cost")}</dt><dd>{money(pnl.totals.forecast)}</dd></div>
          {pnl.totals.budget !== null ? <div><dt>{t("Estimate")}</dt><dd>{money(pnl.totals.budget)}</dd></div> : null}
          <div><dt>{t("Still to spend")}</dt><dd>{money(pnl.totals.remaining)}</dd></div>
        </dl>
        <ColumnChart ariaLabel={t("Spend against the estimate")} categories={chartCategories}
          series={[{ id: "actual", label: t("Spent") }, { id: "committed", label: t("Committed") }, { id: "remaining", label: t("Still to spend") }]}
          values={[pnl.categories.map((row) => height(row.actual)), pnl.categories.map((row) => height(row.committed)), pnl.categories.map((row) => height(row.remaining))]}
          format={(value) => money(String(value))} highlightLast={false} />
      </> : <EmptyState title={t("No costs yet")} />}
    </section>

    <section className={styles.section} aria-labelledby="money-cash">
      <Heading as="h2" size="sm" id="money-cash">{t("Cash flow")} <span className={styles.muted}>{cash.currency}</span></Heading>
      <dl className={styles.facts}>
        <div><dt>{t("Project cash")}</dt><dd className={negative(cash.wallet.balance) ? styles.danger : undefined}>{money(cash.wallet.balance, cash.currency)}
          <small>{t("{received} in, {paid} out", { received: money(cash.wallet.received, cash.currency), paid: money(cash.wallet.paid, cash.currency) })}</small></dd></div>
        <div><dt>{t("Due in")}</dt><dd>{money(addExact(...cash.upcoming.buckets.map((row) => row.in)), cash.currency)}<small>{t("Next 90 days")}</small></dd></div>
        <div><dt>{t("Due out")}</dt><dd>{money(addExact(...cash.upcoming.buckets.map((row) => row.out)), cash.currency)}<small>{t("Next 90 days")}</small></dd></div>
      </dl>
      {cash.spendingLock.state === "locked" ? <InlineNotice tone="error" message={t("New orders are stopped: {amount} in hand.", { amount: money(cash.spendingLock.available, cash.currency) })} /> : null}
      {cash.spendingLock.state === "warn" ? <InlineNotice tone="info" message={t("New orders go ahead with a warning: {amount} in hand.", { amount: money(cash.spendingLock.available, cash.currency) })} /> : null}
      {cash.unconverted ? <InlineNotice tone="info" message={cash.unconverted === 1 ? t("1 payment has no exchange rate yet and isn't counted.") : t("{count} payments have no exchange rate yet and aren't counted.", { count: cash.unconverted })} /> : null}
      {recent.length ? <>
        <TrendLines ariaLabel={t("Money in and out")} categories={recent.map((row) => ({ key: row.month, label: month(row.month) }))}
          series={[{ id: "in", label: t("Received") }, { id: "out", label: t("Paid") }]}
          values={[recent.map((row) => height(row.cumulativeIn)), recent.map((row) => height(row.cumulativeOut))]} format={(value) => money(String(value), cash.currency)} />
        <DataGrid<CashMonth> ariaLabel={t("Cash by month")} columns={monthColumns} data={[...cash.months].reverse()} getRowId={(row) => row.month} rowNumbers={false}
          selectable={false} showToolbar={false} showFooter={false} />
      </> : <EmptyState title={t("No money in or out yet")} />}
      {showBuckets ? <DataGrid<Bucket> ariaLabel={t("Due in the next 90 days")} columns={bucketColumns} data={cash.upcoming.buckets} getRowId={(row) => row.key} rowNumbers={false}
        selectable={false} showToolbar={false} showFooter={false} /> : null}
      {!isZero(cash.upcoming.undated.in) || !isZero(cash.upcoming.undated.out)
        ? <p className={styles.basis}>{t("{in} in and {out} out have no date yet", { in: money(cash.upcoming.undated.in, cash.currency), out: money(cash.upcoming.undated.out, cash.currency) })}</p> : null}
    </section>
  </div>;
}
