import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { columnIndexes, mapQuickBooksCashFlow, mapQuickBooksProfitAndLoss, type QuickBooksReport } from "./quickbooks-statements";
import { monthColumns } from "./statement-math";
import type { StatementColumn, StatementRow } from "./statement-types";
import { cashGroupOf, mapZohoCashFlow, mapZohoProfitAndLoss, pnlSectionOf } from "./zoho-books-statements";

/** Report payloads shaped as each provider returns them (amounts as the integration service passes them: exact text). */
const fixture = <T>(name: string): T => JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8")) as T;
const header = { sourceLabel: "QuickBooks · Palm Interiors LLC", basis: "accrual" as const, currency: "USD", legalEntityId: "entity-1", projectId: null,
  generatedAt: "2026-11-02T10:00:00.000Z" };
const OCTOBER: StatementColumn[] = [{ key: "current", from: "2026-10-01", to: "2026-10-31", role: "current" }];
const AUTUMN = monthColumns("2026-09-01", "2026-10-31");
const labels = (rows: StatementRow[]): unknown => rows.map((row) => (row.rows ? { [row.label]: labels(row.rows) } : row.label));

describe("QuickBooks profit and loss", () => {
  const statement = mapQuickBooksProfitAndLoss(fixture<QuickBooksReport>("quickbooks-profit-and-loss.json"), header, OCTOBER);

  it("puts each group in its section with accounts nested as QuickBooks has them", () => {
    expect(statement.source).toBe("quickbooks");
    expect(statement.statement).toBe("profit_and_loss");
    expect(statement.sections.map((section) => [section.key, section.label, section.total])).toEqual([
      ["revenue", "Revenue", ["7179.4700"]],
      ["cost_of_sales", "Cost of sales", ["405.0000"]],
      ["operating_expenses", "Operating expenses", ["1587.5500"]],
      ["other_income", "Other income", ["0.0000"]],
      ["other_expenses", "Other expenses", ["2916.0000"]],
    ]);
    expect(labels(statement.sections[0].rows)).toEqual(["Design income",
      { "Landscaping Services": [{ "Job Materials": ["Fountains and Garden Lighting", "Plants and Soil"] }, { Labor: ["Installation"] }] }, "Services"]);
    const landscaping = statement.sections[0].rows[1];
    expect(landscaping).toMatchObject({ key: "account:45", amounts: ["4425.9200"] });
    expect(landscaping.rows![0].rows![1]).toEqual({ key: "account:49", label: "Plants and Soil", amounts: ["2523.4200"] });
    // "1,050.00" is read exactly.
    expect(statement.sections[2].rows[2]).toEqual({ key: "account:12", label: "Legal & Professional Fees", amounts: ["1050.0000"] });
  });

  it("derives gross, operating and net profit that agree with QuickBooks' own net income", () => {
    expect(statement.totals).toMatchObject({
      revenue: ["7179.4700"], costOfSales: ["405.0000"], grossProfit: ["6774.4700"], grossMarginPercent: ["94.4"],
      operatingProfit: ["5186.9200"], netProfit: ["2270.9200"], netMarginPercent: ["31.6"],
    });
    expect(statement.notes).toEqual([]);
    expect(statement.columns).toEqual(OCTOBER);
    expect(statement.currency).toBe("USD");
  });

  it("notes when QuickBooks' net income differs from its sections", () => {
    const report = fixture<QuickBooksReport>("quickbooks-profit-and-loss.json");
    const net = report.Rows!.Row!.find((row) => row.group === "NetIncome")!;
    net.Summary!.ColData![1].value = "2270.93";
    expect(mapQuickBooksProfitAndLoss(report, header, OCTOBER).notes).toEqual(["The accounting system's net profit differs from the sum of its sections."]);
  });

  it("refuses an amount that isn't a number", () => {
    const report = fixture<QuickBooksReport>("quickbooks-profit-and-loss.json");
    report.Rows!.Row![0].Rows!.Row![0].ColData![1].value = "twelve";
    expect(() => mapQuickBooksProfitAndLoss(report, header, OCTOBER)).toThrow(TypeError);
  });
});

describe("QuickBooks cash flow", () => {
  const statement = mapQuickBooksCashFlow(fixture<QuickBooksReport>("quickbooks-cash-flow.json"), header, AUTUMN);

  it("reads one column per month by the columns' start dates, leaving out the total column", () => {
    expect(statement.columns.map((column) => column.key)).toEqual(["2026-09", "2026-10"]);
    expect(statement.sections.map((section) => [section.key, section.total])).toEqual([
      ["operating_activities", ["750.0000", "1370.9200"]],
      ["investing_activities", ["0.0000", "-1000.0000"]],
      ["financing_activities", ["200.0000", "0.0000"]],
    ]);
    expect(statement.netCashFlow).toEqual(["950.0000", "370.9200"]);
    expect(statement.opening).toEqual(["4000.0000", "4950.0000"]);
    expect(statement.closing).toEqual(["4950.0000", "5320.9200"]);
    expect(statement.sections[0].rows[1].rows!.map((row) => [row.key, row.amounts])).toEqual([
      ["account:84", ["-500.0000", "-1200.0000"]], ["account:33", ["250.0000", "300.0000"]]]);
    expect(statement.accounts).toEqual([]);
    expect(statement.forecast).toBeNull();
  });

  it("finds month columns in order when QuickBooks leaves out their dates, and zero for a month it doesn't have", () => {
    const report = fixture<QuickBooksReport>("quickbooks-cash-flow.json");
    for (const column of report.Columns!.Column!) column.MetaData = column.MetaData?.filter((item) => item.Name === "ColKey");
    expect(columnIndexes(report, AUTUMN)).toEqual([1, 2]);
    const dated = fixture<QuickBooksReport>("quickbooks-cash-flow.json");
    expect(columnIndexes(dated, monthColumns("2026-08-01", "2026-10-31"))).toEqual([-1, 1, 2]);
    const longer = mapQuickBooksCashFlow(dated, header, monthColumns("2026-08-01", "2026-10-31"));
    expect(longer.netCashFlow).toEqual(["0.0000", "950.0000", "370.9200"]);
  });

  it("works closing cash out from opening and the net change when QuickBooks gives no closing row", () => {
    const report = fixture<QuickBooksReport>("quickbooks-cash-flow.json");
    report.Rows!.Row = report.Rows!.Row!.filter((row) => row.group !== "EndingCash");
    expect(mapQuickBooksCashFlow(report, header, AUTUMN).closing).toEqual(["4950.0000", "5320.9200"]);
  });
});

describe("Zoho Books profit and loss", () => {
  const statement = mapZohoProfitAndLoss([fixture("zoho-books-profit-and-loss.json")], { ...header, sourceLabel: "Zoho Books · Palm Interiors LLC", currency: "AED" }, OCTOBER);

  it("finds each section inside Zoho's profit groups, with account codes", () => {
    expect(statement.source).toBe("zoho_books");
    expect(statement.sections.map((section) => [section.key, section.total])).toEqual([
      ["revenue", ["10500.0000"]], ["cost_of_sales", ["6380.0000"]], ["operating_expenses", ["1220.0000"]], ["other_income", ["0.0000"]], ["other_expenses", ["50.0000"]],
    ]);
    expect(statement.sections[0].rows[0]).toEqual({ key: "account:460000000038003", label: "Project revenue", code: "4100", amounts: ["10000.0000"] });
    expect(statement.totals).toMatchObject({ grossProfit: ["4120.0000"], operatingProfit: ["2900.0000"], netProfit: ["2850.0000"], netMarginPercent: ["27.1"] });
    expect(statement.notes).toEqual([]);
  });

  it("classifies Zoho's group names, keeping non-operating apart from operating", () => {
    expect(pnlSectionOf("Non Operating Income")).toBe("other_income");
    expect(pnlSectionOf("Non-Operating Expense")).toBe("other_expenses");
    expect(pnlSectionOf("Operating Income")).toBe("revenue");
    expect(pnlSectionOf("Operating Expense")).toBe("operating_expenses");
    expect(pnlSectionOf("Cost of Goods Sold")).toBe("cost_of_sales");
    expect(pnlSectionOf("Gross Profit")).toBeNull();
  });
});

describe("Zoho Books cash flow", () => {
  const months = [fixture("zoho-books-cash-flow-september.json"), fixture("zoho-books-cash-flow-october.json")];
  const statement = mapZohoCashFlow(months as Array<Record<string, unknown>>, { ...header, currency: "AED" }, AUTUMN);

  it("merges one report per month into one column per month", () => {
    expect(statement.sections.map((section) => [section.key, section.total])).toEqual([
      ["operating_activities", ["750.0000", "1370.9200"]],
      ["investing_activities", ["0.0000", "-1000.0000"]],
      ["financing_activities", ["200.0000", "0.0000"]],
    ]);
    expect(statement.sections[1].rows).toEqual([{ key: "account:460000000000410", label: "Furniture and Equipment", amounts: ["0.0000", "-1000.0000"] }]);
    expect(statement.sections[0].rows.map((row) => row.key)).toEqual(["group:net_income", "account:460000000000361", "account:460000000000367"]);
    expect(statement.netCashFlow).toEqual(["950.0000", "370.9200"]);
    expect(statement.opening).toEqual(["4000.0000", "4950.0000"]);
    expect(statement.closing).toEqual(["4950.0000", "5320.9200"]);
  });

  it("refuses a different number of reports than months", () => {
    expect(() => mapZohoCashFlow([months[0]] as Array<Record<string, unknown>>, header, AUTUMN)).toThrow(TypeError);
  });

  it("names the cash groups", () => {
    expect(cashGroupOf("Beginning Cash Balance")).toBe("opening");
    expect(cashGroupOf("Ending Cash Balance")).toBe("closing");
    expect(cashGroupOf("Net Change in cash")).toBe("net");
    expect(cashGroupOf("Cash Flow from Financing Activities")).toBe("financing_activities");
  });
});
