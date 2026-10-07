import { describe, expect, it } from "vitest";
import { dateProblem, parseLines, totals } from "./manual-journals";
import { findColumns, parseCsv, parseOpening, readAmount } from "./opening-balances";

describe("opening balances from a trial balance file", () => {
  it("reads quoted cells, semicolons, tabs, CRLF and a BOM", () => {
    expect(parseCsv("﻿Code,Name\r\n1100,\"Bank, main\"\r\n")).toEqual([["Code", "Name"], ["1100", "Bank, main"]]);
    expect(parseCsv("1100;Bank;10;\n")).toEqual([["1100", "Bank", "10", ""]]);
    expect(parseCsv("1100\tBank\t10\t\n")).toEqual([["1100", "Bank", "10", ""]]);
    expect(parseCsv("\"a \"\"b\"\"\",c")).toEqual([["a \"b\"", "c"]]);
  });

  it("reads amounts as a trial balance writes them, exactly", () => {
    expect(readAmount("1,234.50")).toEqual({ units: 12345000n });
    expect(readAmount("(500)")).toEqual({ units: -5000000n });
    expect(readAmount("")).toEqual({ units: 0n });
    expect(readAmount("abc")).toHaveProperty("error");
    expect(readAmount("1.23456")).toHaveProperty("error");
  });

  it("finds the columns by the header, or by position", () => {
    expect(findColumns([["Account code", "Account name", "Dr", "Cr"]])).toMatchObject({ code: 0, name: 1, debit: 2, credit: 3, header: true });
    expect(findColumns([["1100", "500", ""]])).toMatchObject({ code: 0, debit: 1, credit: 2, header: false, name: null });
    expect(findColumns([["1100"]])).toBeNull();
  });

  it("names each problem by its row in the file and adds up both sides", () => {
    const parsed = parseOpening("Code,Name,Debit,Credit\n1100,Bank,500,\n\n1200,AR,10,5\n,Nameless,5,\n1100,Bank again,1,\n2100,AP,-300,\n3900,Equity,,abc\n");
    expect(parsed.errors).toEqual([
      { row: 4, message: "Enter a debit or a credit, not both" },
      { row: 5, message: "The account code is missing" },
      { row: 6, message: "Account 1100 is already on row 2" },
      { row: 8, message: "\"abc\" is not an amount" },
    ]);
    expect(parsed.rows).toEqual([
      { row: 2, code: "1100", debit: "500.0000", credit: "0.0000", description: "Bank" },
      { row: 7, code: "2100", debit: "0.0000", credit: "300.0000", description: "AP" },
    ]);
    expect(parsed).toMatchObject({ debit: "500.0000", credit: "300.0000" });
    expect(parseOpening("Code,Debit,Credit\n").errors).toEqual([{ row: null, message: "The file has no balances." }]);
    expect(parseOpening("just one column\n").errors[0].row).toBeNull();
  });
});

describe("manual journal lines", () => {
  it("takes a debit or a credit per line, never both and never a float", () => {
    const lines = parseLines([
      { accountId: "00000000-0000-4000-8000-000000000001", debit: "1,500.50" },
      { accountId: "00000000-0000-4000-8000-000000000002", credit: "1500.5", party: { type: "vendor", id: "00000000-0000-4000-8000-000000000003" } },
    ]);
    expect(lines.map((line) => [line.debit, line.credit, line.party?.type ?? null])).toEqual([["1500.5000", "0.0000", null], ["0.0000", "1500.5000", "vendor"]]);
    expect(totals(lines)).toEqual({ debit: 15005000n, credit: 15005000n, balanced: true });
    expect(() => parseLines([{ accountId: "00000000-0000-4000-8000-000000000001", debit: "1", credit: "1" }])).toThrow(/Line 1: enter a debit or a credit/);
    expect(() => parseLines([{ accountId: "00000000-0000-4000-8000-000000000001", debit: "0.00001" }])).toThrow(/four decimals/);
    expect(() => parseLines([{ accountId: "nope", debit: "1" }])).toThrow(/account/);
  });

  it("refuses a date before the start or on or before the lock date", () => {
    const settings = { startDate: "2026-10-01", lockDate: "2026-10-05" };
    expect(dateProblem(settings, "2026-09-30")).toMatch(/starts on 2026-10-01/);
    expect(dateProblem(settings, "2026-10-05")).toMatch(/locked up to 2026-10-05/);
    expect(dateProblem(settings, "2026-10-06")).toBeNull();
  });
});
