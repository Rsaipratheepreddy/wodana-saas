import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ROLES } from "../books-contract";
import { functionalLines, LedgerError, ledgerDecimal, postingDate, reverseLines, type PostedLine, type ResolvedLine } from "./ledger";
import { templateProblems, type BooksTemplate } from "./templates";

const line = (accountId: string, side: "debit" | "credit", amount: string, extra: Partial<ResolvedLine> = {}): ResolvedLine => ({ accountId, side, amount, ...extra });
const show = (lines: ReturnType<typeof functionalLines>) =>
  lines.map((row) => [row.accountId, ledgerDecimal.format4(row.debit), ledgerDecimal.format4(row.credit)]);

describe("posting date", () => {
  const settings = { startDate: "2026-10-01", lockDate: null };
  it("posts on the event day inside the open period", () => {
    expect(postingDate(settings, "2026-10-05")).toEqual({ journalDate: "2026-10-05", late: false });
  });
  it("skips what happened before the start date", () => {
    expect(postingDate(settings, "2026-09-30")).toEqual({ refused: "before_start" });
  });
  it("moves an automatic posting on or before the lock date to the first open day, marked late", () => {
    const locked = { startDate: "2026-09-01", lockDate: "2026-09-30" };
    expect(postingDate(locked, "2026-09-29")).toEqual({ journalDate: "2026-10-01", late: true });
    expect(postingDate(locked, "2026-09-30")).toEqual({ journalDate: "2026-10-01", late: true });
    expect(postingDate(locked, "2026-10-01")).toEqual({ journalDate: "2026-10-01", late: false });
  });
  it("refuses a manual journal in a locked period", () => {
    expect(postingDate({ startDate: "2026-09-01", lockDate: "2026-09-30" }, "2026-09-29", { allowLate: false })).toEqual({ refused: "locked" });
  });
  it("never moves a late posting before the start date and refuses days that don't exist", () => {
    expect(postingDate({ startDate: "2026-10-10", lockDate: "2026-10-12" }, "2026-10-11")).toEqual({ journalDate: "2026-10-13", late: true });
    expect(() => postingDate(settings, "2026-02-30")).toThrow(LedgerError);
    expect(() => postingDate(settings, "5 Oct")).toThrow(LedgerError);
  });
});

describe("functional lines", () => {
  const rounding = () => "rounding";
  it("keeps balanced lines in the same currency, rounded to its decimals", () => {
    expect(show(functionalLines([line("ar", "debit", "105000"), line("revenue", "credit", "100000"), line("vat", "credit", "5000")], "1", 2, rounding)))
      .toEqual([["ar", "105000.0000", "0.0000"], ["revenue", "0.0000", "100000.0000"], ["vat", "0.0000", "5000.0000"]]);
  });
  it("converts at the rate and sends the rounding residual to the rounding account", () => {
    const lines = functionalLines([line("cost", "debit", "100.00"), line("ap", "credit", "33.33"), line("ap", "credit", "33.33"), line("ap", "credit", "33.34")],
      "3.6725", 2, rounding);
    expect(show(lines)).toEqual([
      ["cost", "367.2500", "0.0000"], ["ap", "0.0000", "122.4000"], ["ap", "0.0000", "122.4000"], ["ap", "0.0000", "122.4400"], ["rounding", "0.0000", "0.0100"],
    ]);
    const debit = lines.reduce((sum, row) => sum + row.debit, 0n), credit = lines.reduce((sum, row) => sum + row.credit, 0n);
    expect(debit).toBe(credit);
  });
  it("rounds to three decimals for currencies that have them, and drops lines that round to nothing", () => {
    const lines = functionalLines([line("a", "debit", "1.0000"), line("b", "credit", "0.9999"), line("c", "credit", "0.0001")], "1", 3, rounding);
    expect(show(lines)).toEqual([["a", "1.0000", "0.0000"], ["b", "0.0000", "1.0000"]]);
  });
  it("uses an exact functional amount as given (reversals)", () => {
    const lines = functionalLines([line("a", "debit", "10", { functionalAmount: "36.73" }), line("b", "credit", "10", { functionalAmount: "36.73" })], "3.6725", 2, rounding);
    expect(show(lines)).toEqual([["a", "36.7300", "0.0000"], ["b", "0.0000", "36.7300"]]);
  });
  it("refuses unbalanced, negative, over-precise and one-sided drafts", () => {
    expect(() => functionalLines([line("a", "debit", "10"), line("b", "credit", "9.99")], "1", 2, rounding)).toThrow(/don't balance/);
    expect(() => functionalLines([line("a", "debit", "-10"), line("b", "credit", "-10")], "1", 2, rounding)).toThrow(LedgerError);
    expect(() => functionalLines([line("a", "debit", "1.00001"), line("b", "credit", "1.00001")], "1", 2, rounding)).toThrow(/decimals/);
    expect(() => functionalLines([line("a", "debit", "10")], "1", 2, rounding)).toThrow(/two lines/);
    expect(() => functionalLines([line("a", "debit", "10", { functionalAmount: "50" }), line("b", "credit", "10")], "1", 2, rounding)).toThrow(/more than rounding/);
  });
  it("converts the tax base like the amount", () => {
    const lines = functionalLines([line("ap", "credit", "105"), line("cost", "debit", "100"), line("vat", "debit", "5", { taxBase: "100", taxCodeId: "t" })], "3.6725", 2, rounding);
    expect(ledgerDecimal.format4(lines[2].taxBase!)).toBe("367.2500");
  });
});

describe("reversing lines", () => {
  it("swaps each side and keeps the exact functional amounts, accounts and dimensions", () => {
    const posted: PostedLine[] = [
      { id: "1", journalId: "j", position: 0, accountId: "ar", debit: "385.6125", credit: "0.0000", docAmount: "105.0000", description: "Invoice", projectId: "p",
        caseId: null, businessUnitId: null, partyType: "client", partyId: "c", taxCodeId: null, taxBase: null, taxRegion: null },
      { id: "2", journalId: "j", position: 1, accountId: "vat", debit: "0.0000", credit: "18.3600", docAmount: "5.0000", description: "", projectId: null,
        caseId: null, businessUnitId: null, partyType: null, partyId: null, taxCodeId: "sr", taxBase: "367.2500", taxRegion: "DXB" },
    ];
    expect(reverseLines(posted)).toMatchObject([
      { account: { accountId: "ar" }, side: "credit", amount: "105.0000", functionalAmount: "385.6125", projectId: "p", party: { type: "client", id: "c" } },
      { account: { accountId: "vat" }, side: "debit", amount: "5.0000", functionalAmount: "18.3600", taxCodeId: "sr", functionalTaxBase: "367.2500", taxRegion: "DXB", party: null },
    ]);
  });
});

/** The templates as migration 0283 seeds them. */
const templatesSql = readFileSync(resolve(__dirname, "../../../drizzle/0283_books_templates.sql"), "utf8");
const templates = new Map([...templatesSql.matchAll(/VALUES \('books', '([A-Z]+)', (\d+), \$template\$([\s\S]*?)\$template\$::jsonb/g)]
  .map((match) => [match[1], JSON.parse(match[3]) as BooksTemplate]));

describe("chart templates (0283)", () => {
  it("ships AE and IFRS, each applicable with an account for every posting role", () => {
    expect([...templates.keys()]).toEqual(["AE", "IFRS"]);
    for (const [code, template] of templates) {
      expect(templateProblems(template), code).toEqual([]);
      expect(Object.keys(template.roles).sort(), code).toEqual([...ACCOUNT_ROLES].sort());
      expect(template.paymentAccounts.length, code).toBe(12);
    }
  });

  it("gives AE about sixty accounts with the fixed codes", () => {
    const ae = templates.get("AE")!;
    expect(ae.accounts.length).toBeGreaterThanOrEqual(55);
    expect(ae.accounts.length).toBeLessThanOrEqual(70);
    const byCode = new Map(ae.accounts.map((account) => [account.code, account]));
    const fixed: Record<string, string> = {
      "1100": "bank", "1150": "petty_cash", "1200": "trade_receivables", "1210": "vat_recoverable", "1300": "inventory", "1310": "stock_in_transit",
      "2100": "trade_payables", "2110": "grni", "2120": "employee_claims", "2200": "vat_output", "2210": "vat_on_advances", "2300": "client_advances",
      "3100": "retained_earnings", "3900": "opening_balance_equity", "4100": "project_revenue", "4900": "other_income", "5100": "project_materials",
      "5200": "subcontract", "5300": "labour", "5400": "site_expenses", "5500": "price_variance", "5600": "other_project_costs", "5700": "cogs",
      "6100": "general_expenses", "6200": "stock_adjustments", "6300": "labour_absorbed", "6900": "fx_gain_loss", "6990": "rounding",
    };
    for (const [code, key] of Object.entries(fixed)) expect(byCode.get(code)?.key, code).toBe(key);
    const role = (name: keyof BooksTemplate["roles"]) => ae.accounts.find((account) => account.key === ae.roles[name])!.code;
    expect([role("ar_control"), role("ap_control"), role("vat_output"), role("vat_input"), role("grni"), role("rounding")]).toEqual(["1200", "2100", "2200", "1210", "2110", "6990"]);
    expect(byCode.get("1200")).toMatchObject({ isControl: true, allowManual: false });
  });

  it("gives AE the UAE VAT codes with the VAT 201 boxes they feed", () => {
    const codes = templates.get("AE")!.taxCodes.map((tax) => [tax.code, tax.direction, tax.rate, tax.treatment, tax.baseBox, tax.taxBox, tax.rcOutputBox, tax.recoverable]);
    expect(codes).toEqual([
      ["SR", "sales", "5", "standard", "1", "1", null, false],
      ["SR", "purchases", "5", "standard", "9", "9", null, true],
      ["ZR", "sales", "0", "zero", "4", null, null, false],
      ["ZR", "purchases", "0", "zero", null, null, null, false],
      ["EX", "sales", "0", "exempt", "5", null, null, false],
      ["EX", "purchases", "0", "exempt", null, null, null, false],
      ["OS", "sales", "0", "out_of_scope", null, null, null, false],
      ["OS", "purchases", "0", "out_of_scope", null, null, null, false],
      ["RC", "purchases", "5", "reverse_charge", "10", "10", "3", true],
      ["IG", "purchases", "5", "import_reverse_charge", "10", "10", "6", true],
    ]);
    expect(templates.get("IFRS")!.taxCodes).toEqual([]);
    expect(templates.get("IFRS")!.taxReport).toBeNull();
  });

  it("lays out VAT 201 as configuration: 1a to 1g by emirate, 2 to 14, totals and net tax as formulas", () => {
    const layout = templates.get("AE")!.taxReport as { regions: Array<{ code: string; box: string }>; boxes: Array<{ box: string; from?: unknown; formula?: { op: string; boxes: string[] } }> };
    expect(layout.boxes.map((box) => box.box)).toEqual(["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"]);
    expect(layout.regions.map((region) => region.box)).toEqual(["1a", "1b", "1c", "1d", "1e", "1f", "1g"]);
    const formula = (box: string) => layout.boxes.find((row) => row.box === box)!.formula;
    expect(formula("8")).toEqual({ op: "sum", boxes: ["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7"] });
    expect(formula("11")).toEqual({ op: "sum", boxes: ["9", "10"] });
    expect(formula("12")).toEqual({ op: "vat_of", boxes: ["8"] });
    expect(formula("13")).toEqual({ op: "vat_of", boxes: ["11"] });
    expect(formula("14")).toEqual({ op: "difference", boxes: ["12", "13"] });
    // Every box a tax code feeds is on the return.
    const boxes = new Set(layout.boxes.map((box) => box.box));
    for (const tax of templates.get("AE")!.taxCodes) {
      for (const box of [tax.baseBox, tax.taxBox, tax.rcOutputBox]) if (box && box !== "1") expect(boxes, `${tax.code} ${box}`).toContain(box);
    }
  });

  it("finds what is wrong with a broken template", () => {
    const ae = templates.get("AE")!;
    const broken: BooksTemplate = { ...ae, roles: { ...ae.roles, rounding: "nowhere" }, accounts: [...ae.accounts, { ...ae.accounts[0] }] };
    expect(templateProblems(broken)).toEqual(expect.arrayContaining(["duplicate key bank", "duplicate code 1100", "role rounding names unknown account nowhere"]));
  });
});
