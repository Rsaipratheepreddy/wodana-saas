"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { statementChange, type StatementRow } from "@wodana/contracts/financial-statements";
import {
  EmptyState, ErrorState, SegmentedControl, SelectField, Skeleton, StatementTable, TrendLines, type StatementColumnHead, type StatementLine,
} from "@/design-system";
import { ledgerPaths, type LedgerScope } from "@/lib/books/reports-client";
import {
  BASIS_LABELS, COMPARISON_LABELS, SOURCE_LABELS, type CashFlowStatement, type ProfitAndLossStatement, type StatementResponse, type StatementScope,
  type StatementsApi,
} from "@/lib/books/statements-client";
import { tKey } from "@/lib/i18n/keys";
import { LedgerRegion, useLedgerFormat, useLedgerT, type LedgerFormat, type LedgerT } from "./ledger-format";
import { ReportActions, ReportPicker } from "./report-picker";
import { useLoad } from "./use-load";
import styles from "./ledger.module.css";

/**
 * Company statements: the P&L (period, comparison, basis) and the cash flow by month with its 90-day forecast,
 * read from wherever the company's books live (one muted line names it). Every Ledger line opens its account's
 * ledger (and from there each journal and its record); categories open to their accounts.
 */

type Ctx = { t: LedgerT; format: LedgerFormat; scope: LedgerScope; drillDown: boolean };

/** Labels the server names in English (sections, categories) are translated; account names stay as they are. */
const labelOf = (t: LedgerT, row: Pick<StatementRow, "key" | "label">) => (row.key.startsWith("account:") || row.key.startsWith("group:") ? row.label : t(row.label));

function rowLine(ctx: Ctx, row: StatementRow, depth: number, values: (amounts: string[]) => { values: string[]; negative: boolean[] }): StatementLine {
  const label = labelOf(ctx.t, row);
  const shown = values(row.amounts);
  return {
    key: row.key, kind: "line", depth, code: row.code ?? null, values: shown.values, negative: shown.negative,
    label: ctx.drillDown && row.accountId ? <Link href={ledgerPaths.account(row.accountId, ctx.scope)}>{label}</Link>
      : row.href ? <Link href={row.href}>{label}</Link> : label,
    children: row.rows?.length ? row.rows.map((child) => rowLine(ctx, child, depth + 1, values)) : undefined,
  };
}

/** The P&L as statement lines: sections with their categories and accounts, totals, gross and net profit with margins. */
export function profitAndLossLines(ctx: Ctx, statement: ProfitAndLossStatement): StatementLine[] {
  const { t, format } = ctx;
  const compared = statement.columns.length === 2;
  const values = (amounts: string[]) => {
    if (!compared) return { values: [format.figure(amounts[0])], negative: [format.negative(amounts[0])] };
    const { change, percent } = statementChange(amounts[0], amounts[1]);
    return { values: [format.figure(amounts[0]), format.figure(amounts[1]), format.figure(change), format.percent(percent)],
      negative: [format.negative(amounts[0]), format.negative(amounts[1]), false, false] };
  };
  const margins = (key: string, label: string, percents: Array<string | null>): StatementLine => ({
    key, kind: "ratio", label, values: compared ? [format.percent(percents[0]), format.percent(percents[1]), null, null] : [format.percent(percents[0])],
  });
  const result = (key: string, label: string, amounts: string[]): StatementLine => ({ key, kind: "result", label, ...values(amounts) });
  const lines: StatementLine[] = [];
  const section = (key: string, always = true) => {
    const item = statement.sections.find((entry) => entry.key === key);
    if (!item) return;
    if (!always && !item.rows.length && item.total.every((value) => /^-?0+(\.0+)?$/.test(value))) return;
    const label = t(item.label);
    lines.push({ key: `${key}:head`, kind: "heading", label, values: compared ? [null, null, null, null] : [null] });
    lines.push(...item.rows.map((row) => rowLine(ctx, row, 1, values)));
    lines.push({ key: `${key}:total`, kind: "subtotal", label: t("Total {section}", { section: label.toLocaleLowerCase() }), ...values(item.total) });
  };
  section("revenue");
  section("cost_of_sales");
  lines.push(result("gross", t("Gross profit"), statement.totals.grossProfit), margins("gross-margin", t("Gross margin"), statement.totals.grossMarginPercent));
  section("operating_expenses");
  lines.push(result("operating", t("Operating profit"), statement.totals.operatingProfit));
  section("other_income", false);
  section("other_expenses", false);
  lines.push(result("net", t("Net profit"), statement.totals.netProfit), margins("net-margin", t("Net margin"), statement.totals.netMarginPercent));
  return lines;
}

function profitAndLossColumns(t: LedgerT, format: LedgerFormat, response: StatementResponse<ProfitAndLossStatement>): StatementColumnHead[] {
  const [current, comparison] = response.statement.columns;
  const head: StatementColumnHead[] = [{ key: "current", label: format.period(current.from, current.to) }];
  if (comparison) {
    head.push({ key: "comparison", label: format.period(comparison.from, comparison.to), detail: t(COMPARISON_LABELS[response.compare]), tone: "comparison" },
      { key: "change", label: t("Change"), tone: "change" }, { key: "change-percent", label: t("Change %"), tone: "change" });
  }
  return head;
}

/** One muted line: where the figures come from, the basis and the currency, and what the reader should know. */
export function SourceLine({ response }: { response: StatementResponse<ProfitAndLossStatement | CashFlowStatement> }) {
  const t = useLedgerT();
  const { statement, source } = response;
  const parts = [source.label ? `${t(SOURCE_LABELS[source.source])} · ${source.label}` : t(SOURCE_LABELS[source.source]),
    statement.statement === "profit_and_loss" ? t(BASIS_LABELS[statement.basis]) : null, statement.currency, ...statement.notes.map((note) => t(note))].filter(Boolean);
  return <p className={styles.sourceLine} data-testid="statement-source">{parts.join(" · ")}</p>;
}

function useStatementScope(scope: StatementScope, response: StatementResponse<unknown> | null): LedgerScope {
  return { entity: scope.entity || response?.company.id || "", from: scope.from || response?.period.from || "", to: scope.to || response?.period.to || "" };
}

function StatementState({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  const t = useLedgerT();
  if (error) return <ErrorState title={t("This statement didn't load")} description={t(error)} onRetry={onRetry} />;
  if (loading) return <Skeleton shape="rows" lines={12} />;
  return <>{children}</>;
}

/** The company P&L: picker (report, company, period, comparison, basis), source line, the statement, CSV and print. */
export function ProfitAndLossReport({ api, scope, onScope, picker }: {
  api: StatementsApi; scope: StatementScope; onScope: (next: Partial<StatementScope>) => void;
  /** The report switcher from the Reports tab. */
  picker: Pick<Parameters<typeof ReportPicker>[0], "report" | "onReport" | "reports">;
}) {
  const t = useLedgerT();
  const key = `pnl|${scope.entity}|${scope.from}|${scope.to}|${scope.basis}|${scope.compare}`;
  const load = useLoad(key, (signal) => api.profitAndLoss(scope, signal));
  const response = load.data ?? load.stale;
  const shown = useStatementScope(scope, response);
  const capabilities = response?.source.capabilities;
  return <LedgerRegion entity={response?.company}>
    <ReportPicker {...picker} entities={response?.companies ?? []} entity={response?.company ?? null} scope={shown}
      onScope={(next) => onScope({ ...next })}
      actions={<ReportActions csvHref={response ? api.csvHref("profit-and-loss", { ...scope, entity: shown.entity, from: shown.from, to: shown.to }) : null} />}>
      <SelectField accent="neutral" label={t("Compare with")} selectedKey={scope.compare || "none"}
        items={(["none", "previous_period", "previous_year"] as const).map((id) => ({ id, label: t(COMPARISON_LABELS[id]) }))}
        onSelectionChange={(value) => onScope({ compare: value && value !== "none" ? String(value) : "" })} />
      {capabilities?.cash && capabilities.accrual ? <SegmentedControl label={t("Basis")} value={scope.basis || "accrual"}
        options={(["accrual", "cash"] as const).map((id) => ({ id, label: t(BASIS_LABELS[id]) }))} onChange={(value) => onScope({ basis: value === "cash" ? "cash" : "" })} /> : null}
    </ReportPicker>
    <StatementState loading={!response} error={load.error} onRetry={load.reload}>
      {response ? <ProfitAndLossBody response={response} scope={shown} /> : null}
    </StatementState>
  </LedgerRegion>;
}

export function ProfitAndLossBody({ response, scope }: { response: StatementResponse<ProfitAndLossStatement>; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const ctx: Ctx = { t, format, scope, drillDown: response.source.capabilities.drillDown };
  const lines = useMemo(() => profitAndLossLines(ctx, response.statement), [response, t, format, scope.entity, scope.from, scope.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = profitAndLossColumns(t, format, response);
  const empty = response.statement.sections.every((section) => !section.rows.length);
  return <div className={styles.stack}>
    <SourceLine response={response} />
    <p className={styles.printTitle}>{[t("Profit and loss"), response.company.name, format.period(response.period.from, response.period.to)].join(" · ")}</p>
    {empty ? <EmptyState title={t("Nothing in this period")} description={t("Choose another period")} />
      : <StatementTable label={t("Profit and loss")} columns={columns} lines={lines} defaultOpen={["design_fees", "production", "variations", "other_revenue"]} />}
  </div>;
}

// ---------------------------------------------------------------------------------------------------------------
// Cash flow.

export function cashFlowLines(ctx: Ctx, statement: CashFlowStatement): StatementLine[] {
  const { t, format } = ctx;
  const values = (amounts: string[]) => ({ values: amounts.map((value) => format.figure(value)), negative: amounts.map((value) => format.negative(value)) });
  const blank = statement.columns.map(() => null);
  const lines: StatementLine[] = [{ key: "opening", kind: "line", label: t("Opening cash"), ...values(statement.opening) }];
  for (const section of statement.sections) {
    const label = t(section.label);
    lines.push({ key: `${section.key}:head`, kind: "heading", label, values: blank });
    if (!section.rows.length) lines.push({ key: `${section.key}:none`, kind: "line", depth: 1, label: t("None"), values: statement.columns.map(() => format.figure("0")) });
    lines.push(...section.rows.map((row) => rowLine(ctx, row, 1, values)));
    lines.push({ key: `${section.key}:total`, kind: "subtotal", label: t("Total {section}", { section: label.toLocaleLowerCase() }), ...values(section.total) });
  }
  lines.push({ key: "net", kind: "result", label: t("Net cash flow"), ...values(statement.netCashFlow) });
  lines.push({ key: "closing", kind: "subtotal", label: t("Closing cash"), ...values(statement.closing),
    children: statement.accounts.length ? statement.accounts.map((account) => ({
      key: account.key, kind: "line" as const, depth: 1, ...values(account.closing),
      label: ctx.drillDown && account.accountId ? <Link href={ledgerPaths.account(account.accountId, ctx.scope)}>{account.label}</Link> : account.label,
    })) : undefined });
  return lines;
}

export function CashFlowReport({ api, scope, onScope, picker }: {
  api: StatementsApi; scope: StatementScope; onScope: (next: Partial<StatementScope>) => void;
  picker: Pick<Parameters<typeof ReportPicker>[0], "report" | "onReport" | "reports">;
}) {
  const key = `cash|${scope.entity}|${scope.from}|${scope.to}`;
  const load = useLoad(key, (signal) => api.cashFlow(scope, signal));
  const response = load.data ?? load.stale;
  const shown = useStatementScope(scope, response);
  return <LedgerRegion entity={response?.company}>
    <ReportPicker {...picker} entities={response?.companies ?? []} entity={response?.company ?? null} scope={shown} onScope={onScope}
      actions={<ReportActions csvHref={response ? api.csvHref("cash-flow", shown) : null} />} />
    <StatementState loading={!response} error={load.error} onRetry={load.reload}>
      {response ? <CashFlowBody response={response} scope={shown} /> : null}
    </StatementState>
  </LedgerRegion>;
}

export function CashFlowBody({ response, scope }: { response: StatementResponse<CashFlowStatement>; scope: LedgerScope }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const { statement } = response;
  const ctx: Ctx = { t, format, scope, drillDown: response.source.capabilities.drillDown };
  const lines = cashFlowLines(ctx, statement);
  const columns: StatementColumnHead[] = statement.columns.map((column) => ({ key: column.key, label: format.month(column.from) }));
  const forecast = statement.forecast;
  // The chart: cash in, cash out and closing cash per month, then the forecast's three buckets.
  const categories = [...statement.columns.map((column) => ({ key: column.key, label: format.month(column.from) })),
    ...(forecast?.columns.map((column, index) => ({ key: column.key, label: t(FORECAST_LABELS[index]) })) ?? [])];
  const number = (value: string) => Number(value);
  const cashIn = statement.sections.find((section) => section.key === "cash_in")?.total ?? [];
  const cashOut = statement.sections.find((section) => section.key === "cash_out")?.total ?? [];
  const chartValues = [
    [...cashIn.map(number), ...(forecast?.receipts.map(number) ?? [])],
    [...cashOut.map(number), ...(forecast?.payments.map(number) ?? [])],
    [...statement.closing.map(number), ...(forecast?.closing.map(number) ?? [])],
  ];
  const moved = statement.sections.some((section) => section.rows.length) || statement.closing.some((value) => !/^-?0+(\.0+)?$/.test(value));
  return <div className={styles.stack}>
    <SourceLine response={response} />
    <p className={styles.printTitle}>{[t("Cash flow"), response.company.name, format.period(response.period.from, response.period.to)].join(" · ")}</p>
    {!moved && !forecast ? <EmptyState title={t("No money moved in this period")} description={t("Choose another period")} /> : <>
      <div className={styles.chart}>
        <TrendLines ariaLabel={t("Cash in and out by month")} categories={categories}
          series={[{ id: "in", label: t("Cash in") }, { id: "out", label: t("Cash out") }, { id: "closing", label: t("Closing cash") }]}
          values={chartValues} format={(value) => format.figure(String(value))} />
      </div>
      <StatementTable label={t("Cash flow")} columns={columns} lines={lines} />
      {forecast ? <section className={styles.stack} aria-label={t("Next 90 days")}>
        <h2 className={styles.subhead}>{t("Next 90 days")}</h2>
        <StatementTable label={t("Next 90 days")} columns={forecast.columns.map((column, index) => ({ key: column.key, label: t(FORECAST_LABELS[index]),
          detail: format.period(column.from, column.to), tone: "forecast" as const }))} lines={[
          { key: "due-in", kind: "line", label: t("Due from clients"), values: forecast.receipts.map((value) => format.figure(value)) },
          { key: "due-out", kind: "line", label: t("Due to suppliers"), values: forecast.payments.map((value) => format.figure(value)) },
          { key: "due-net", kind: "result", label: t("Net"), values: forecast.net.map((value) => format.figure(value)), negative: forecast.net.map((value) => format.negative(value)) },
          { key: "due-cash", kind: "subtotal", label: t("Projected cash"), values: forecast.closing.map((value) => format.figure(value)),
            negative: forecast.closing.map((value) => format.negative(value)) },
        ]} />
      </section> : null}
    </>}
  </div>;
}

const FORECAST_LABELS = [tKey("Next 30 days"), tKey("31–60 days"), tKey("61–90 days")] as const;
