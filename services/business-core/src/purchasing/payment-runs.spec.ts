import { describe, expect, it } from "vitest";
import { bankFile, runPayments, runReference } from "./payment-runs";

const bill = (vendorId: string, number: string, patch: { legalEntityId?: string; currency?: string } = {}) => ({
  vendorId, supplierName: vendorId === "v1" ? "Nile Marble" : "Atlas Joinery", legalEntityId: patch.legalEntityId ?? "e1", companyName: patch.legalEntityId === "e2" ? "Studio Two" : "Studio",
  currency: patch.currency ?? "AED", number,
});

describe("payment runs", () => {
  it("makes one payment per supplier, company and currency, adding up its invoices exactly", () => {
    const payments = runPayments([
      { invoiceId: "b1", amount: "100.1000", bill: bill("v1", "INV-1") },
      { invoiceId: "b2", amount: "0.2000", bill: bill("v1", "INV-2") },
      { invoiceId: "b3", amount: "50.0000", bill: bill("v1", "INV-3", { legalEntityId: "e2" }) },
      { invoiceId: "b4", amount: "7", bill: bill("v1", "INV-4", { currency: "JPY" }) },
      { invoiceId: "b5", amount: "10.0050", bill: bill("v2", "A-9", { currency: "KWD" }) },
    ]);
    expect(payments.map(({ supplierName, companyName, currency, amount, invoices }) => [supplierName, companyName, currency, amount, invoices.map((invoice) => invoice.number)])).toEqual([
      ["Atlas Joinery", "Studio", "KWD", "10.005", ["A-9"]],
      ["Nile Marble", "Studio", "AED", "100.30", ["INV-1", "INV-2"]],
      ["Nile Marble", "Studio", "JPY", "7", ["INV-4"]],
      ["Nile Marble", "Studio Two", "AED", "50.00", ["INV-3"]],
    ]);
    expect(payments[1]).toMatchObject({ key: "v1|e1|AED", invoices: [{ invoiceId: "b1", amount: "100.1000" }, { invoiceId: "b2", amount: "0.2000" }] });
  });

  it("names the run and its invoices in the transfer's reference, within 120 characters", () => {
    expect(runReference(3, ["INV-1", "INV-2"])).toBe("Run 3: INV-1, INV-2");
    const many = Array.from({ length: 40 }, (_, index) => `INV-${1000 + index}`);
    const reference = runReference(12, many);
    expect(reference.length).toBeLessThanOrEqual(120);
    expect(reference).toMatch(/^Run 12: INV-1000, INV-1001, .*INV-10\d\d \+\d+$/);
    const shown = reference.replace(/^Run 12: /, "").replace(/ \+\d+$/, "").split(", ").length;
    expect(reference.endsWith(` +${40 - shown}`)).toBe(true);
    expect(runReference(7, ["X".repeat(118)])).toBe("Run 7: +1");
  });

  it("writes the bank file: quoted where needed, formulas kept as text, and whole account numbers only for people who verify bank details", () => {
    const lines = [
      { supplier: "Nile Marble, LLC", accountName: 'The "Nile" Co', bank: "Emirates NBD", accountNumber: "AE07 0331 2345 6789 0123 456", swift: "EBILAEAD", amount: "1050.5", currency: "AED",
        reference: "Run 3: INV-1, INV-2" },
      { supplier: "=HYPERLINK(\"x\")", accountName: "Line\nbreak", bank: "@Bank", accountNumber: "1234567", swift: "", amount: "7", currency: "JPY", reference: "-5" },
    ];
    expect(bankFile(lines, true)).toBe([
      "Supplier,Account name,Bank,Account number,SWIFT,Amount,Currency,Reference",
      '"Nile Marble, LLC","The ""Nile"" Co",Emirates NBD,AE07 0331 2345 6789 0123 456,EBILAEAD,1050.50,AED,"Run 3: INV-1, INV-2"',
      `"'=HYPERLINK(""x"")","Line\nbreak",'@Bank,1234567,,7,JPY,'-5`,
      "",
    ].join("\r\n"));
    const masked = bankFile(lines, false).split("\r\n");
    expect(masked[1]).toContain(",•••• 3456,");
    expect(masked[2]).toContain(",•••• 4567,");
    expect(masked.join("")).not.toContain("0331");
    expect(bankFile([], false)).toBe("Supplier,Account name,Bank,Account number,SWIFT,Amount,Currency,Reference\r\n");
  });
});
