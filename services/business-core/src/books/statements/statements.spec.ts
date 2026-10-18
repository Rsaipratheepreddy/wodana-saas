import { describe, expect, it } from "vitest";
import * as shared from "../../../../../packages/contracts/src/financial-statements";
import { placeOfAccount, revenueCategoryOfQuote } from "./classify";
import { roundTo, taxInside } from "./documents";
import { cashRowOf, ledgerPnlFacts } from "./ledger-source";
import { buildCashFlow, buildForecast, buildProfitAndLoss, mergeProfitAndLoss, percent, type PnlFact } from "./statement-builder";
import { statementChangeOf } from "./statement-change";
import type { StatementColumn } from "./statement-contract";
import { comparisonPeriod, fiscalYearOf, forecastBuckets, monthsOf, shiftMonths, wholeMonths } from "./statement-period";
import { parseStatementQuery, type StatementCompany } from "./statements";

const header = { source: "ledger" as const, sourceLabel: null, basis: "accrual" as const, currency: "AED", legalEntityId: "e1", projectId: null, generatedAt: "now", notes: [] };
const one: StatementColumn[] = [{ key: "current", from: "2026-10-01", to: "2026-10-31", role: "current" }];
const fact = (section: PnlFact["section"], category: string | null, key: string, amount: string, column = 0, extra: Partial<PnlFact> = {}): PnlFact =>
  ({ column, section, category, key, label: extra.label ?? key, code: extra.code ?? null, accountId: extra.accountId ?? null, amount, ...extra });

describe("statement periods", () => {
  it("compares whole months with the months before, other periods with the same number of days", () => {
    expect(comparisonPeriod({ from: "2026-02-01", to: "2026-02-28" }, "previous_period")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(comparisonPeriod({ from: "2026-07-01", to: "2026-09-30" }, "previous_period")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-11" }, "previous_period")).toEqual({ from: "2026-09-20", to: "2026-09-30" });
    expect(comparisonPeriod({ from: "2026-10-01", to: "2026-10-31" }, "none")).toBeNull();
  });

  it("compares with the same days a year earlier, keeping month ends", () => {
    expect(comparisonPeriod({ from: "2028-02-01", to: "2028-02-29" }, "previous_year")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(comparisonPeriod({ from: "2027-02-01", to: "2027-02-28" }, "previous_year")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonPeriod({ from: "2026-01-01", to: "2026-10-11" }, "previous_year")).toEqual({ from: "2025-01-01", to: "2025-10-11" });
  });

  it("splits a period into calendar months and knows whole months", () => {
    expect(monthsOf({ from: "2026-09-15", to: "2026-11-03" })).toEqual([
      { from: "2026-09-15", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-03" }]);
    expect(wholeMonths({ from: "2026-01-01", to: "2026-03-31" })).toBe(3);
    expect(wholeMonths({ from: "2026-01-02", to: "2026-03-31" })).toBeNull();
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("works out the financial year from the month it starts (region pack or Ledger settings)", () => {
    expect(fiscalYearOf("2026-10-11", 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(fiscalYearOf("2026-10-11", 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(fiscalYearOf("2026-02-11", 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(fiscalYearOf("2026-08-01", 7)).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });

  it("defaults a statement to the financial year to date and refuses bad queries", () => {
    const company = { today: "2026-10-11", fiscalYearStartMonth: 4 } as StatementCompany;
    expect(parseStatementQuery(company, {})).toEqual({ period: { from: "2026-04-01", to: "2026-10-11" }, basis: "accrual", compare: "none" });
    expect(parseStatementQuery(company, { from: "2026-10-01", to: "2026-10-31", basis: "cash", compare: "previous_year" }).compare).toBe("previous_year");
    expect(() => parseStatementQuery(company, { from: "2026-11-01", to: "2026-10-01" })).toThrow();
    expect(() => parseStatementQuery(company, { basis: "magic" })).toThrow();
    expect(() => parseStatementQuery(company, { from: "2026-02-30" })).toThrow();
  });

  it("lays three 30-day forecast buckets after today", () => {
    expect(forecastBuckets("2026-10-11")).toEqual([
      { from: "2026-10-12", to: "2026-11-10" }, { from: "2026-11-11", to: "2026-12-10" }, { from: "2026-12-11", to: "2027-01-09" }]);
  });
});

describe("profit and loss", () => {
  it("adds sections, gross and net profit and margins exactly", () => {
    const statement = buildProfitAndLoss(header, one, [
      fact("revenue", "production", "account:r", "100000.0000", 0, { code: "4100", accountId: "r", label: "Project revenue" }),
      fact("revenue", "design_fees", "account:r", "20000.0000", 0, { code: "4100", accountId: "r", label: "Project revenue" }),
      fact("revenue", "variations", "account:r", "0.0100", 0, { code: "4100", accountId: "r" }),
      fact("cost_of_sales", "materials", "account:m", "45000.0000", 0, { code: "5100", accountId: "m" }),
      fact("cost_of_sales", "factory", "account:l", "5000.0000", 0, { code: "5300", accountId: "l" }),
      fact("operating_expenses", null, "account:rent", "12000.0000", 0, { code: "6120", accountId: "rent", label: "Rent" }),
      fact("operating_expenses", null, "account:adj", "-500.0000", 0, { code: "6200", accountId: "adj", label: "Stock adjustments" }),
      fact("other_expenses", null, "account:fx", "100.0000", 0, { code: "6900", accountId: "fx" }),
    ]);
    const revenue = statement.sections.find((section) => section.key === "revenue")!;
    expect(revenue.rows.map((row) => row.key)).toEqual(["design_fees", "production", "variations"]);
    expect(revenue.rows[0].rows?.[0]).toMatchObject({ key: "account:r", code: "4100", accountId: "r", amounts: ["20000.0000"] });
    expect(statement.totals).toEqual({
      revenue: ["120000.0100"], costOfSales: ["50000.0000"], grossProfit: ["70000.0100"], grossMarginPercent: ["58.3"],
      operatingExpenses: ["11500.0000"], operatingProfit: ["58500.0100"], otherIncome: ["0.0000"], otherExpenses: ["100.0000"],
      netProfit: ["58400.0100"], netMarginPercent: ["48.7"],
    });
    expect(statement.sections.find((section) => section.key === "cost_of_sales")!.rows.map((row) => row.key)).toEqual(["materials", "factory"]);
    expect(statement.sections.find((section) => section.key === "operating_expenses")!.rows.map((row) => row.code)).toEqual(["6120", "6200"]);
  });

  it("shows no margin without revenue and leaves empty lines out", () => {
    const statement = buildProfitAndLoss(header, one, [fact("operating_expenses", null, "account:a", "10.0000"), fact("operating_expenses", null, "account:b", "0.0000")]);
    expect(statement.totals.grossMarginPercent).toEqual([null]);
    expect(statement.totals.netProfit).toEqual(["-10.0000"]);
    expect(statement.sections.find((section) => section.key === "operating_expenses")!.rows).toHaveLength(1);
  });

  it("keeps a source's own category amounts without leaves", () => {
    const statement = buildProfitAndLoss(header, one, [fact("revenue", "variations", "variations", "500.0000")]);
    expect(statement.sections[0].rows).toEqual([{ key: "variations", label: "Variations", amounts: ["500.0000"], rows: [] }]);
  });

  it("merges the comparison side by side, with rows only one period has", () => {
    const current = buildProfitAndLoss(header, one, [fact("revenue", "production", "account:r", "100.0000"), fact("operating_expenses", null, "account:x", "30.0000")]);
    const previous = buildProfitAndLoss(header, [{ ...one[0], from: "2026-09-01", to: "2026-09-30" }], [
      fact("revenue", "design_fees", "account:r", "40.0000"), fact("revenue", "production", "account:r", "60.0000"), fact("operating_expenses", null, "account:y", "10.0000")]);
    const merged = mergeProfitAndLoss(current, previous);
    expect(merged.columns.map((column) => column.role)).toEqual(["current", "comparison"]);
    const revenue = merged.sections[0];
    expect(revenue.rows.map((row) => [row.key, row.amounts])).toEqual([["design_fees", ["0.0000", "40.0000"]], ["production", ["100.0000", "60.0000"]]]);
    expect(merged.sections.find((section) => section.key === "operating_expenses")!.rows.map((row) => [row.key, row.amounts]))
      .toEqual([["account:x", ["30.0000", "0.0000"]], ["account:y", ["0.0000", "10.0000"]]]);
    expect(merged.totals.netProfit).toEqual(["70.0000", "90.0000"]);
    expect(merged.totals.netMarginPercent).toEqual(["70.0", "90.0"]);
  });

  it("works out change and percentage like the shared contract", () => {
    for (const [now, before] of [["120000.0000", "100000.0000"], ["1.0000", "3.0000"], ["-50.0000", "-100.0000"], ["5.0000", "0.0000"]]) {
      expect(statementChangeOf(now, before)).toEqual(shared.statementChange(now, before));
    }
    expect(percent("1.0000", "3.0000")).toBe("33.3");
    expect(percent("-2.0000", "3.0000")).toBe("-66.7");
    expect(percent("1.0000", "0.0000")).toBeNull();
  });
});

describe("placing ledger accounts", () => {
  const account = (type: string, subtype: string, roles: string[] = [], templateKey: string | null = null) => ({ type, subtype, roles, templateKey });

  it("splits project revenue by the quotation an invoice came from", () => {
    expect(revenueCategoryOfQuote({ kind: "variation", round: "main" })).toBe("variations");
    expect(revenueCategoryOfQuote({ kind: "quotation", round: "design" })).toBe("design_fees");
    expect(revenueCategoryOfQuote({ kind: "quotation", round: "main" })).toBe("production");
    expect(revenueCategoryOfQuote(null)).toBe("production");
    expect(placeOfAccount(account("income", "revenue", ["revenue_project"]), "design_fees")).toEqual({ section: "revenue", category: "design_fees" });
    expect(placeOfAccount(account("income", "revenue", ["revenue_project"]), null)).toEqual({ section: "revenue", category: "production" });
    expect(placeOfAccount(account("income", "revenue", [], "design_fees"), null)).toEqual({ section: "revenue", category: "design_fees" });
    expect(placeOfAccount(account("income", "revenue", [], "product_sales"), null)).toEqual({ section: "revenue", category: "other_revenue" });
    expect(placeOfAccount(account("income", "other_income", ["revenue_other"]), null)).toEqual({ section: "other_income", category: null });
  });

  it("places costs by role: materials, subcontract and labour, factory, other", () => {
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_materials"]), null)?.category).toBe("materials");
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_price_variance"]), null)?.category).toBe("materials");
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_subcontract"]), null)?.category).toBe("subcontract_labour");
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_labour"]), "factory")?.category).toBe("factory");
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_labour"]), null)?.category).toBe("subcontract_labour");
    expect(placeOfAccount(account("expense", "cost_of_sales", ["cost_site_expenses"]), null)?.category).toBe("other_costs");
    expect(placeOfAccount(account("expense", "operating_expense", ["general_expense"]), null)).toEqual({ section: "operating_expenses", category: null });
    expect(placeOfAccount(account("expense", "other_expense", ["fx_gain_loss"]), null)).toEqual({ section: "other_expenses", category: null });
    expect(placeOfAccount(account("asset", "bank"), null)).toBeNull();
  });

  it("turns journal movements into facts, grouping operating expenses by parent account", () => {
    const facts = ledgerPnlFacts([
      { accountId: "r", code: "4100", name: "Project revenue", type: "income", subtype: "revenue", templateKey: "project_revenue", roles: ["revenue_project"],
        parentId: null, parentCode: null, parentName: null, hint: "variations", debit: "100.0000", credit: "1100.0000" },
      { accountId: "o", code: "6120", name: "Rent", type: "expense", subtype: "operating_expense", templateKey: "rent", roles: [],
        parentId: "p", parentCode: "6000", parentName: "Premises", hint: null, debit: "500.0000", credit: "0.0000" },
      { accountId: "z", code: "6130", name: "Utilities", type: "expense", subtype: "operating_expense", templateKey: null, roles: [],
        parentId: null, parentCode: null, parentName: null, hint: null, debit: "10.0000", credit: "10.0000" },
    ], 0);
    expect(facts).toEqual([
      expect.objectContaining({ section: "revenue", category: "variations", accountId: "r", amount: "1000.0000" }),
      expect.objectContaining({ section: "operating_expenses", category: "group:p", categoryLabel: "Premises", accountId: "o", amount: "500.0000" }),
    ]);
  });
});

describe("cash flow", () => {
  const months: StatementColumn[] = [{ key: "m0", from: "2026-09-01", to: "2026-09-30", role: "month" }, { key: "m1", from: "2026-10-01", to: "2026-10-31", role: "month" }];

  it("classifies what moved cash", () => {
    expect(cashRowOf({ sourceType: "receipt", cash: "100", contraType: "liability", contraSubtype: "current_liability", contraTemplate: null, contraRoles: ["client_advances"] })).toBe("client_advances");
    expect(cashRowOf({ sourceType: "receipt", cash: "100", contraType: "asset", contraSubtype: "receivable", contraTemplate: null, contraRoles: ["ar_control"] })).toBe("client_payments");
    expect(cashRowOf({ sourceType: "supplier_payment", cash: "-100", contraType: "liability", contraSubtype: "payable", contraTemplate: null, contraRoles: ["ap_control"] })).toBe("supplier_payments");
    expect(cashRowOf({ sourceType: "manual_journal", cash: "-100", contraType: "liability", contraSubtype: "tax", contraTemplate: null, contraRoles: [] })).toBe("tax");
    expect(cashRowOf({ sourceType: "manual_journal", cash: "-100", contraType: "expense", contraSubtype: "operating_expense", contraTemplate: "salaries", contraRoles: [] })).toBe("labour");
    expect(cashRowOf({ sourceType: "manual_journal", cash: "-100", contraType: "expense", contraSubtype: "operating_expense", contraTemplate: "rent", contraRoles: [] })).toBe("expenses");
    expect(cashRowOf({ sourceType: "manual_journal", cash: "500", contraType: "equity", contraSubtype: "equity", contraTemplate: null, contraRoles: [] })).toBe("other_receipts");
    expect(cashRowOf({ sourceType: "manual_journal", cash: "-500", contraType: "liability", contraSubtype: "non_current_liability", contraTemplate: null, contraRoles: [] })).toBe("other_payments");
  });

  it("adds cash in and out per month and carries balances per account and in total", () => {
    const statement = buildCashFlow({ ...header, basis: "cash" }, months, {
      facts: [
        { column: 0, section: "cash_in", row: "client_advances", amount: "1000.0000" },
        { column: 1, section: "cash_in", row: "client_payments", amount: "500.0000" },
        { column: 1, section: "cash_in", row: "client_payments", amount: "-100.0000" },
        { column: 1, section: "cash_out", row: "supplier_payments", amount: "300.0000" },
        { column: 1, section: "cash_out", row: "tax", amount: "50.0000" },
      ],
      accounts: [
        { key: "account:b", label: "Bank", accountId: "b", opening: "200.0000", movements: ["1000.0000", "60.0000"] },
        { key: "account:c", label: "Petty cash", accountId: "c", opening: "0.0000", movements: ["0.0000", "-10.0000"] },
      ],
    });
    expect(statement.sections[0].rows.map((row) => [row.key, row.amounts])).toEqual([["client_payments", ["0.0000", "400.0000"]], ["client_advances", ["1000.0000", "0.0000"]]]);
    expect(statement.sections[1].rows.map((row) => row.key)).toEqual(["supplier_payments", "tax"]);
    expect(statement.netCashFlow).toEqual(["1000.0000", "50.0000"]);
    expect(statement.opening).toEqual(["200.0000", "1200.0000"]);
    expect(statement.closing).toEqual(["1200.0000", "1250.0000"]);
    expect(statement.accounts[0]).toMatchObject({ opening: ["200.0000", "1200.0000"], closing: ["1200.0000", "1260.0000"] });
    expect(statement.accounts[1].closing).toEqual(["0.0000", "-10.0000"]);
  });

  it("opens with what was recorded before when there are no accounts, and projects the forecast from closing cash", () => {
    const statement = buildCashFlow({ ...header, basis: "cash" }, months.slice(0, 1), { facts: [], accounts: [], opening: "75.0000" });
    expect(statement.opening).toEqual(["75.0000"]);
    const forecast = buildForecast(forecastBuckets("2026-10-11").map((bucket, index) => ({ key: `f${index}`, ...bucket, role: "forecast" as const })),
      ["100.0000", "0.0000", "50.0000"], ["40.0000", "200.0000", "0.0000"], "1000.0000");
    expect(forecast.net).toEqual(["60.0000", "-200.0000", "50.0000"]);
    expect(forecast.closing).toEqual(["1060.0000", "860.0000", "910.0000"]);
  });
});

describe("cash basis amounts", () => {
  it("takes the tax out of a gross payment at the quotation's rate, to the currency's minor units", () => {
    expect(taxInside("105000.0000", "5", "AED")).toBe("5000.0000");
    expect(taxInside("100.0000", "5", "AED")).toBe("4.7600");
    expect(taxInside("100.0000", "0", "AED")).toBe("0.0000");
    expect(taxInside("100.0000", null, "AED")).toBe("0.0000");
    expect(taxInside("1000.0000", "18", "JPY")).toBe("153.0000");
    expect(taxInside("100.0000", "5", "KWD")).toBe("4.7620");
  });

  it("rounds half away from zero to a step", () => {
    expect(roundTo(12345n, 100n)).toBe(12300n);
    expect(roundTo(12350n, 100n)).toBe(12400n);
    expect(roundTo(-12350n, 100n)).toBe(-12400n);
    expect(roundTo(7n, 1n)).toBe(7n);
  });
});
