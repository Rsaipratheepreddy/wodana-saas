import { describe, expect, it } from "vitest";
import { previewNumber, validateSequence, validateTaxRates } from "./tax-numbering.domain";

const vat = { model: "vat", label: "VAT", registrationLabel: "TRN" };

describe("tax rates", () => {
  it("normalizes codes and keeps exact decimal strings", () => {
    expect(validateTaxRates(vat, [{ code: "Standard", label: "Standard", rate: "5", isDefault: true }, { code: "Zero rated", label: "Zero rated", rate: 0, isDefault: false }]))
      .toEqual([{ code: "standard", label: "Standard", rate: "5", isDefault: true }, { code: "zero_rated", label: "Zero rated", rate: "0", isDefault: false }]);
  });
  it("rejects rates for a country without tax, bad values, duplicates and a missing default", () => {
    expect(() => validateTaxRates({ model: "none", label: null, registrationLabel: null }, [{ code: "x", label: "X", rate: "5", isDefault: true }])).toThrow(/no sales tax/);
    expect(() => validateTaxRates(vat, [{ code: "s", label: "S", rate: "105", isDefault: true }])).toThrow(/between 0 and 100/);
    expect(() => validateTaxRates(vat, [{ code: "s", label: "S", rate: "5.12345", isDefault: true }])).toThrow(/between 0 and 100/);
    expect(() => validateTaxRates(vat, [{ code: "s", label: "S", rate: "5", isDefault: true }, { code: "S", label: "S2", rate: "0", isDefault: false }])).toThrow(/Two rates/);
    expect(() => validateTaxRates(vat, [{ code: "s", label: "S", rate: "5", isDefault: false }])).toThrow(/exactly one default/);
  });
  it("allows no rates at all (tax not configured yet)", () => {
    expect(validateTaxRates(vat, [])).toEqual([]);
  });
});

describe("document numbering", () => {
  it("requires the year in a yearly prefix and only moves forward", () => {
    expect(() => validateSequence({ prefix: "QUO-", padding: 5, resetPolicy: "annual" }, { nextNumber: 1, currentPeriod: null })).toThrow(/\{YYYY\}/);
    expect(() => validateSequence({ prefix: "QUO-", padding: 5, resetPolicy: "never", nextNumber: 3 }, { nextNumber: 10, currentPeriod: 2026 })).toThrow(/only move forward/);
    expect(validateSequence({ prefix: "QUO-{YYYY}-", padding: 4, resetPolicy: "annual", nextNumber: 250 }, { nextNumber: 1, currentPeriod: null }))
      .toEqual({ prefix: "QUO-{YYYY}-", suffix: "", padding: 4, resetPolicy: "annual", nextNumber: 250 });
  });
  it("previews the next number, with the suffix after it", () => {
    expect(previewNumber("MAIN-QUO-{YYYY}-", 5, 42, 2026)).toBe("MAIN-QUO-2026-00042");
    expect(previewNumber("Q-", 4, 7, 2026, "-PL/{YYYY}")).toBe("Q-0007-PL/2026");
  });
  it("keeps the saved suffix unless a new one is sent, and refuses an unprintable one", () => {
    expect(validateSequence({ prefix: "Q-", padding: 4, resetPolicy: "never" }, { nextNumber: 3, currentPeriod: null, suffix: "-DXB" }).suffix).toBe("-DXB");
    expect(validateSequence({ prefix: "Q-", suffix: " -AD ", padding: 4, resetPolicy: "never" }, { nextNumber: 3, currentPeriod: null, suffix: "-DXB" }).suffix).toBe("-AD");
    expect(() => validateSequence({ prefix: "Q-", suffix: "<b>", padding: 4, resetPolicy: "never" }, { nextNumber: 1, currentPeriod: null })).toThrow(/suffix/);
  });
});
