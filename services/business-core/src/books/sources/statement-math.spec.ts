import { describe, expect, it } from "vitest";
import * as shared from "../../../../../packages/contracts/src/financial-statements";
import { amountOf, labelKey, mergeColumns, monthColumns, percentOf, profitAndLossTotals } from "./statement-math";
import * as local from "./statement-types";

describe("statement contract", () => {
  it("is the same in business-core as in packages/contracts", () => {
    expect(local.FINANCIAL_STATEMENT_SOURCES).toEqual(shared.FINANCIAL_STATEMENT_SOURCES);
    expect(local.STATEMENT_BASES).toEqual(shared.STATEMENT_BASES);
    expect(local.PNL_SECTIONS).toEqual(shared.PNL_SECTIONS);
  });
});

describe("statement arithmetic", () => {
  it("reads provider amounts exactly: thousands separators, blanks and signs; refuses anything else", () => {
    expect(amountOf("1,050.00")).toBe("1050.0000");
    expect(amountOf("")).toBe("0.0000");
    expect(amountOf(undefined)).toBe("0.0000");
    expect(amountOf("-0.10")).toBe("-0.1000");
    expect(amountOf("12345678901234.5678")).toBe("12345678901234.5678");
    expect(() => amountOf("12abc")).toThrow(TypeError);
    expect(() => amountOf("NaN")).toThrow(TypeError);
  });

  it("gives a percentage to one place, half away from zero, and none without a base", () => {
    expect(percentOf("1", "3")).toBe("33.3");
    expect(percentOf("2", "3")).toBe("66.7");
    expect(percentOf("-1", "8")).toBe("-12.5");
    expect(percentOf("5", "0")).toBeNull();
  });

  it("lists every month a period touches, clipped to the period, across a year end", () => {
    expect(monthColumns("2026-11-15", "2027-02-03")).toEqual([
      { key: "2026-11", from: "2026-11-15", to: "2026-11-30", role: "month" },
      { key: "2026-12", from: "2026-12-01", to: "2026-12-31", role: "month" },
      { key: "2027-01", from: "2027-01-01", to: "2027-01-31", role: "month" },
      { key: "2027-02", from: "2027-02-01", to: "2027-02-03", role: "month" },
    ]);
    expect(monthColumns("2028-02-01", "2028-02-29")).toEqual([{ key: "2028-02", from: "2028-02-01", to: "2028-02-29", role: "month" }]);
  });

  it("works out gross, operating and net profit and their margins per column", () => {
    const section = (key: string, total: string[]) => ({ key, label: key, rows: [], total });
    const totals = profitAndLossTotals([section("revenue", ["1000.0000", "0.0000"]), section("cost_of_sales", ["600.0000", "50.0000"]),
      section("operating_expenses", ["150.0000", "0.0000"]), section("other_income", ["10.0000", "0.0000"]), section("other_expenses", ["5.0000", "0.0000"])], 2);
    expect(totals.grossProfit).toEqual(["400.0000", "-50.0000"]);
    expect(totals.grossMarginPercent).toEqual(["40.0", null]);
    expect(totals.operatingProfit).toEqual(["250.0000", "-50.0000"]);
    expect(totals.netProfit).toEqual(["255.0000", "-50.0000"]);
    expect(totals.netMarginPercent).toEqual(["25.5", null]);
  });

  it("merges one report per month into one row per key, zero where a month lacks the row", () => {
    const merged = mergeColumns([
      [{ key: "account:1", label: "Sales", amounts: ["10.0000"] }, { key: "group:a", label: "A", amounts: ["5.0000"], rows: [{ key: "account:2", label: "B", amounts: ["5.0000"] }] }],
      [{ key: "group:a", label: "A", amounts: ["7.0000"], rows: [{ key: "account:3", label: "C", amounts: ["7.0000"] }] }],
    ]);
    expect(merged).toEqual([
      { key: "account:1", label: "Sales", amounts: ["10.0000", "0.0000"] },
      { key: "group:a", label: "A", amounts: ["5.0000", "7.0000"], rows: [
        { key: "account:2", label: "B", amounts: ["5.0000", "0.0000"] }, { key: "account:3", label: "C", amounts: ["0.0000", "7.0000"] }] },
    ]);
  });

  it("keys rows without an id by their label in any script", () => {
    expect(labelKey("Net Income")).toBe("net_income");
    expect(labelKey("  صافي الدخل ")).toBe("صافي_الدخل");
    expect(labelKey("!!")).toBe("row");
  });
});
