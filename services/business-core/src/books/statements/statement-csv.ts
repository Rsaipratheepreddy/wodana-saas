import { toCsv } from "../reports/report-math";
import { statementChangeOf } from "./statement-change";
import type { CashFlowStatement, ProfitAndLossStatement, StatementColumn, StatementRow } from "./statement-contract";
import { SOURCE_NAMES, type StatementResponse } from "./statements";

/** The statements as CSV: the same exact figures as the screen, indented rows, one column per period. */

const columnLabel = (column: StatementColumn) => (column.from === column.to ? column.from : `${column.from} – ${column.to}`);

function rowsOf(rows: readonly StatementRow[], depth: number, extra: (amounts: string[]) => string[]): string[][] {
  return rows.flatMap((row) => [
    [`${"  ".repeat(depth)}${row.label}`, row.code ?? "", ...row.amounts, ...extra(row.amounts)],
    ...rowsOf(row.rows ?? [], depth + 1, extra),
  ]);
}

export function profitAndLossCsv(response: StatementResponse<ProfitAndLossStatement>) {
  const { statement, company } = response;
  const compared = statement.columns.length === 2;
  const change = (amounts: string[]) => {
    if (!compared) return [];
    const { change: value, percent } = statementChangeOf(amounts[0], amounts[1]);
    return [value, percent ?? ""];
  };
  const totals = statement.totals;
  const result = (label: string, amounts: string[]) => [label, "", ...amounts, ...change(amounts)];
  const margin = (label: string, values: Array<string | null>) => [label, "", ...values.map((value) => value ?? ""), ...(compared ? ["", ""] : [])];
  const section = (key: string) => statement.sections.find((item) => item.key === key);
  const block = (key: string) => {
    const item = section(key);
    if (!item) return [];
    return [[item.label], ...rowsOf(item.rows, 1, change), [`Total ${item.label.toLocaleLowerCase()}`, "", ...item.total, ...change(item.total)]];
  };
  return toCsv([
    [company.name, statement.currency, response.period.from, response.period.to, SOURCE_NAMES[statement.source], statement.basis],
    ["Line", "Code", ...statement.columns.map(columnLabel), ...(compared ? ["Change", "Change %"] : [])],
    ...block("revenue"), ...block("cost_of_sales"),
    result("Gross profit", totals.grossProfit), margin("Gross margin %", totals.grossMarginPercent),
    ...block("operating_expenses"),
    result("Operating profit", totals.operatingProfit),
    ...block("other_income"), ...block("other_expenses"),
    result("Net profit", totals.netProfit), margin("Net margin %", totals.netMarginPercent),
  ]);
}

export function cashFlowCsv(response: StatementResponse<CashFlowStatement>) {
  const { statement, company } = response;
  const head = ["Line", ...statement.columns.map((column) => column.from.slice(0, 7))];
  const section = (key: string) => {
    const item = statement.sections.find((entry) => entry.key === key);
    return item ? [[item.label], ...item.rows.map((row) => [`  ${row.label}`, ...row.amounts]), [`Total ${item.label.toLocaleLowerCase()}`, ...item.total]] : [];
  };
  const forecast = statement.forecast ? [[], ["Forecast", ...statement.forecast.columns.map(columnLabel)],
    ["  Due from clients", ...statement.forecast.receipts], ["  Due to suppliers", ...statement.forecast.payments],
    ["Net", ...statement.forecast.net], ["Projected cash", ...statement.forecast.closing]] : [];
  return toCsv([
    [company.name, statement.currency, response.period.from, response.period.to, SOURCE_NAMES[statement.source]],
    head,
    ["Opening cash", ...statement.opening],
    ...section("cash_in"), ...section("cash_out"),
    ["Net cash flow", ...statement.netCashFlow],
    ["Closing cash", ...statement.closing],
    ...(statement.accounts.length ? [[], ["Account", ...statement.columns.map((column) => column.from.slice(0, 7))],
      ...statement.accounts.map((account) => [`${account.label} (closing)`, ...account.closing])] : []),
    ...forecast,
  ]);
}
