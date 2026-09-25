import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Pack = {
  countryCode: string; name: string; locale: string; currency: string; currencyDecimals: number; timezone: string;
  weekStartsOn: number; unitSystem: "metric" | "imperial"; calendarPolicy: { workingDays: number[] };
  phone: { callingCode: string; nationalNumberLength: [number, number] };
  address: { levels: { key: string; label: string; required: boolean; options?: string[] }[]; postalCode: { label: string; required: boolean } | null };
  tax: { model: "vat" | "gst" | "sales_tax" | "none"; label: string | null; registrationLabel: string | null; status: string; rates: unknown[] };
};

const packs: Pack[] = [...readFileSync(resolve(__dirname, "../../drizzle/0006_international_region_packs.sql"), "utf8")
  .matchAll(/VALUES \('region', '([A-Z]{2})', \d+, '(.*)'::jsonb, true\)/g)]
  .map((match) => JSON.parse(match[2].replace(/''/g, "'")) as Pack);

describe("international region packs", () => {
  it("covers the launch countries with one pack each", () => {
    expect(packs.map((pack) => pack.countryCode).sort()).toEqual(["AE", "AU", "BH", "GB", "IN", "KW", "OM", "QA", "SA", "SG", "US"]);
  });

  it.each(packs.map((pack) => [pack.countryCode, pack] as const))("%s is a complete, valid country profile", (_code, pack) => {
    expect(Intl.supportedValuesOf("currency")).toContain(pack.currency);
    expect(new Intl.NumberFormat("en", { style: "currency", currency: pack.currency }).resolvedOptions().maximumFractionDigits).toBe(pack.currencyDecimals);
    expect(() => new Intl.DateTimeFormat("en", { timeZone: pack.timezone })).not.toThrow();
    expect(() => new Intl.DateTimeFormat(pack.locale)).not.toThrow();
    expect([0, 1]).toContain(pack.weekStartsOn);
    expect(pack.calendarPolicy.workingDays.length).toBeGreaterThanOrEqual(5);
    expect(pack.calendarPolicy.workingDays.every((day) => day >= 0 && day <= 6)).toBe(true);
    expect(pack.phone.callingCode).toMatch(/^\d{1,3}$/);
    // A required region level is always a real choice list, never an empty text box.
    for (const level of pack.address.levels.filter((item) => item.key === "region" && item.required)) {
      expect(level.options?.length).toBeGreaterThan(0);
      expect(new Set(level.options).size).toBe(level.options!.length);
    }
    // Tax: labels match the model and no rate is claimed before validation.
    expect(pack.tax.status).toBe("requires_validation");
    expect(pack.tax.rates).toEqual([]);
    if (pack.tax.model === "none") expect(pack.tax.label).toBeNull();
    else expect(pack.tax.label && pack.tax.registrationLabel).toBeTruthy();
  });

  it("uses the Gulf Sunday-to-Thursday week where it applies and Monday-to-Friday in the UAE", () => {
    const week = Object.fromEntries(packs.map((pack) => [pack.countryCode, pack.calendarPolicy.workingDays.join("")]));
    for (const code of ["SA", "QA", "KW", "BH", "OM"]) expect(week[code]).toBe("01234");
    expect(week.AE).toBe("12345");
  });
});
