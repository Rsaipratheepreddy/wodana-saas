import { describe, expect, it } from "vitest";
import { FINANCIAL_STATEMENT_SOURCES, statementChange } from "./financial-statements.js";

describe("financial statements contract", () => {
  it("names the four sources", () => {
    expect(FINANCIAL_STATEMENT_SOURCES).toEqual(["ledger", "zoho_books", "quickbooks", "operational_cash"]);
  });

  it("works out change and percentage exactly", () => {
    expect(statementChange("120000.0000", "100000.0000")).toEqual({ change: "20000.0000", percent: "20.0" });
    expect(statementChange("90000.0000", "100000.0000")).toEqual({ change: "-10000.0000", percent: "-10.0" });
    expect(statementChange("1.0000", "3.0000")).toEqual({ change: "-2.0000", percent: "-66.7" });
    expect(statementChange("-50.0000", "-100.0000")).toEqual({ change: "50.0000", percent: "50.0" });
    expect(statementChange("10.0000", "0.0000")).toEqual({ change: "10.0000", percent: null });
    expect(statementChange("0.0005", "0")).toEqual({ change: "0.0005", percent: null });
  });
});
