import { describe, expect, it } from "vitest";
import { ageParty, bucketFor } from "./ageing";
import { add, fiscalYearStart, neg, quarterOf, sub, toCsv } from "./report-math";
import { contributions, fillBoxes, type TaxReportLayout } from "./vat-report";

const layout: TaxReportLayout = {
  code: "T", name: "Test return", regionLabel: "Region",
  regions: [{ code: "N", name: "North", box: "1a" }, { code: "S", name: "South", box: "1b" }],
  boxes: [
    { box: "1a", label: "North", section: "sales", columns: ["amount", "vat", "adjustment"], from: { taxBox: "1", region: "N" } },
    { box: "1b", label: "South", section: "sales", columns: ["amount", "vat", "adjustment"], from: { taxBox: "1", region: "S" } },
    { box: "3", label: "Reverse charge", section: "sales", columns: ["amount", "vat"], from: { rcOutputBox: "3" } },
    { box: "4", label: "Zero", section: "sales", columns: ["amount"], from: { baseBox: "4" } },
    { box: "8", label: "Totals", section: "sales", columns: ["amount", "vat", "adjustment"], formula: { op: "sum", boxes: ["1a", "1b", "3", "4"] } },
    { box: "9", label: "Expenses", section: "purchases", columns: ["amount", "vat", "adjustment"], from: { taxBox: "9" } },
    { box: "10", label: "RC expenses", section: "purchases", columns: ["amount", "vat", "adjustment"], from: { taxBox: "10" } },
    { box: "11", label: "Totals", section: "purchases", columns: ["amount", "vat", "adjustment"], formula: { op: "sum", boxes: ["9", "10"] } },
    { box: "12", label: "Due", section: "net", columns: ["vat"], formula: { op: "vat_of", boxes: ["8"] } },
    { box: "13", label: "Recoverable", section: "net", columns: ["vat"], formula: { op: "vat_of", boxes: ["11"] } },
    { box: "14", label: "Payable", section: "net", columns: ["vat"], formula: { op: "difference", boxes: ["12", "13"] } },
  ],
};

let id = 0;
const line = (patch: Record<string, unknown>) => ({
  lineId: String(++id), debit: "0", credit: "0", taxBase: null, taxRegion: null, partyType: null, partyId: null, taxCode: "SR", treatment: "standard",
  direction: "sales", baseBox: "1", taxBox: "1", rcOutputBox: null, accountId: "a", accountCode: "2200", accountName: "VAT", vatRole: "vat_output",
  journalId: "j", journalNumber: "JV-1", journalDate: "2026-10-01", sourceType: "client_invoice", sourceEvent: "issued", sourceLabel: "", sourceHref: "", ...patch,
}) as never;

describe("tax return boxes", () => {
  it("places output tax by region, zero-rated bases, reverse charge on both sides, and works out the totals", () => {
    const lines = [
      line({ credit: "50", taxBase: "1000", taxRegion: "N" }),
      line({ credit: "25", taxBase: "500", taxRegion: "s" }),
      line({ debit: "5", taxBase: "100", taxRegion: "N" }), // a credit note reduces box 1a
      line({ credit: "300", vatRole: null, taxCode: "ZR", treatment: "zero", baseBox: "4", taxBox: null, accountCode: "4100" }),
      line({ debit: "10", taxBase: "200", direction: "purchases", baseBox: "9", taxBox: "9", vatRole: "vat_input", treatment: "standard" }),
      line({ debit: "20", taxBase: "400", direction: "purchases", baseBox: "10", taxBox: "10", rcOutputBox: "3", vatRole: "vat_input", treatment: "reverse_charge" }),
      line({ credit: "20", taxBase: "400", direction: "purchases", baseBox: "10", taxBox: "10", rcOutputBox: "3", vatRole: "vat_output", treatment: "reverse_charge" }),
      line({ credit: "7", taxBase: "140", vatRole: "vat_advance_contra" }),
      line({ credit: "9", taxBase: "180", taxRegion: "XX" }),
    ];
    const { contributions: items, unplaced } = contributions(lines, layout, null);
    const boxes = Object.fromEntries(fillBoxes(layout, items).map((box) => [box.box, box]));
    expect(boxes["1a"]).toMatchObject({ amount: "900.0000", vat: "45.0000", adjustment: "0.0000", computed: false });
    expect(boxes["1b"]).toMatchObject({ amount: "500.0000", vat: "25.0000" });
    expect(boxes["3"]).toMatchObject({ amount: "400.0000", vat: "20.0000", adjustment: null });
    expect(boxes["4"]).toMatchObject({ amount: "300.0000", vat: null });
    expect(boxes["8"]).toMatchObject({ amount: "2100.0000", vat: "90.0000", computed: true });
    expect(boxes["9"]).toMatchObject({ amount: "200.0000", vat: "10.0000" });
    expect(boxes["10"]).toMatchObject({ amount: "400.0000", vat: "20.0000" });
    expect(boxes["11"]).toMatchObject({ amount: "600.0000", vat: "30.0000" });
    expect(boxes["12"]).toMatchObject({ amount: null, vat: "90.0000" });
    expect(boxes["13"]).toMatchObject({ vat: "30.0000" });
    expect(boxes["14"]).toMatchObject({ vat: "60.0000" });
    // The line whose region the layout doesn't know is held for review, never guessed.
    expect(unplaced).toHaveLength(1);
  });

  it("falls back to the company's region for lines without one", () => {
    const { contributions: items, unplaced } = contributions([line({ credit: "5", taxBase: "100" })], layout, "S");
    expect(unplaced).toHaveLength(0);
    expect(fillBoxes(layout, items).find((box) => box.box === "1b")).toMatchObject({ amount: "100.0000", vat: "5.0000" });
  });
});

describe("ageing", () => {
  it("buckets by days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, -5].map(bucketFor)).toEqual(["current", "1_30", "1_30", "31_60", "31_60", "61_90", "61_90", "over_90", "current"]);
  });

  it("settles the oldest items first and shows money paid ahead as negative", () => {
    const aged = ageParty([
      { day: "2026-06-01", due: "2026-06-01", amount: 100n },
      { day: "2026-09-01", due: "2026-09-15", amount: 200n },
      { day: "2026-09-20", due: "2026-09-20", amount: -150n },
    ], "2026-10-01");
    expect(aged).toEqual({ current: 0n, "1_30": 150n, "31_60": 0n, "61_90": 0n, over_90: 0n });
    expect(ageParty([{ day: "2026-09-01", due: "2026-09-01", amount: -50n }], "2026-10-01").current).toBe(-50n);
  });
});

describe("report arithmetic", () => {
  it("adds exact decimals and works out the financial year and quarter", () => {
    expect(add("0.1000", "0.2000", "105000")).toBe("105000.3000");
    expect(sub("1", "2.5")).toBe("-1.5000");
    expect(neg("0")).toBe("0.0000");
    expect(fiscalYearStart("2026-10-08", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-08", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
    expect(quarterOf("2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(quarterOf("2026-02-28")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("writes CSV that a spreadsheet can't run, keeping negative numbers", () => {
    expect(toCsv([["=SUM(A1)", "-12.5000", "-x", 'a "b"']])).toBe(`"'=SUM(A1)","-12.5000","'-x","a ""b"""\r\n`);
  });
});
