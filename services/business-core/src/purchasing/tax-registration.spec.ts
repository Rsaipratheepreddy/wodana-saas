import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTaxNumber, normaliseTaxNumber, type TaxNumberRule } from "./tax-registration";

// The formats the region packs carry (migration 0263), so the test checks what ships.
const formats = new Map([...readFileSync(resolve(__dirname, "../../drizzle/0263_purchasing_line_status.sql"), "utf8")
  .matchAll(/\('([A-Z]{2})', '(\{"pattern".*?\})'::jsonb\)/g)]
  .map((match) => [match[1], JSON.parse(match[2]) as { pattern: string; example: string }]));
const rule = (code: string, label: string): TaxNumberRule => ({ label, ...formats.get(code)! });

describe("supplier tax numbers in the workspace country's format (PLM-111)", () => {
  it("gives a format only to countries with one fixed format", () => {
    expect([...formats.keys()].sort()).toEqual(["AE", "AU", "BH", "GB", "IN", "OM", "SA"]);
  });

  it.each([...formats.entries()])("%s: its example passes its own format", (_code, format) => {
    expect(new RegExp(format.pattern).test(format.example)).toBe(true);
  });

  it("checks a UAE TRN: 15 digits, typed with spaces or dashes", () => {
    const trn = rule("AE", "TRN");
    expect(checkTaxNumber(" 100-1234-5670-0003 ", trn)).toBe("100123456700003");
    expect(checkTaxNumber("100 123 456 700 003", trn)).toBe("100123456700003");
    expect(() => checkTaxNumber("10012345670000", trn)).toThrow("TRN should look like 100123456700003.");
    expect(() => checkTaxNumber("1001234567000031", trn)).toThrow(/TRN should look like/);
    expect(() => checkTaxNumber("TRN100123456700", trn)).toThrow(/TRN should look like/);
  });

  it("checks other countries by their own rule, never the UAE's", () => {
    expect(checkTaxNumber("27aapfu0939f1zv", rule("IN", "GSTIN"))).toBe("27AAPFU0939F1ZV");
    expect(() => checkTaxNumber("100123456700003", rule("IN", "GSTIN"))).toThrow("GSTIN should look like 27AAPFU0939F1ZV.");
    expect(checkTaxNumber("300123456700003", rule("SA", "VAT number"))).toBe("300123456700003");
    expect(() => checkTaxNumber("100123456700003", rule("SA", "VAT number"))).toThrow(/VAT number should look like/);
    expect(checkTaxNumber("GB 123 4567 89", rule("GB", "VAT registration number"))).toBe("GB123456789");
  });

  it("keeps any number as typed where the country has no fixed format, and an empty one empty", () => {
    const none: TaxNumberRule = { label: "Sales tax permit", pattern: null, example: null };
    expect(checkTaxNumber(" ST-12/34 ", none)).toBe("ST-12/34");
    expect(checkTaxNumber("   ", rule("AE", "TRN"))).toBe("");
    expect(normaliseTaxNumber("om 11-0001.2345")).toBe("OM1100012345");
  });
});
