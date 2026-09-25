import { describe, expect, it } from "vitest";
import { countryFromLocale, needsWorkspacePhoneCountry, normalizeIntakePartyPhones } from "./intake-phone";

describe("CRM intake phone normalization", () => {
  it("normalizes both local numbers using their own selected countries", () => {
    expect(normalizeIntakePartyPhones({ mobile: "050 123 4567", mobileCountryCode: "AE", phone: "020 7946 0018", phoneCountryCode: "GB" }))
      .toMatchObject({ mobile: "+971501234567", mobileCountryCode: "AE", phone: "+442079460018", phoneCountryCode: "GB" });
  });

  it("accepts an international number from integrations without a country hint", () => {
    expect(normalizeIntakePartyPhones({ mobile: "+971 50 123 4567" })).toMatchObject({ mobile: "+971501234567", mobileCountryCode: "AE" });
  });

  it("rejects ambiguous local input instead of persisting an unusable number", () => {
    expect(needsWorkspacePhoneCountry({ mobile: "050 123 4567" })).toBe(true);
    expect(normalizeIntakePartyPhones({ mobile: "050 123 4567" }, "AE")).toMatchObject({ mobile: "+971501234567" });
    expect(() => normalizeIntakePartyPhones({ mobile: "050 123 4567" })).toThrow(/country code/i);
    expect(() => normalizeIntakePartyPhones({ mobile: "050 123 4567", mobileCountryCode: "ZZ" })).toThrow(/country code/i);
  });

  it("derives the form default from the workspace locale", () => {
    expect(countryFromLocale("en-AE")).toBe("AE");
    expect(countryFromLocale("bad locale")).toBeUndefined();
  });
});
