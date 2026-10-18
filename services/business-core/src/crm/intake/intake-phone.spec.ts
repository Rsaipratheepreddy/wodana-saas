import { describe, expect, it } from "vitest";
import { countryFromLocale, needsWorkspacePhoneCountry, normalizeIntakePartyPhones, phoneDigits, phoneProblem, staffPhoneProblems } from "./intake-phone";

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

  it("checks a staff-typed mobile against the chosen country, with the digit count from the metadata", () => {
    expect(phoneDigits("IN")).toBe("10");
    expect(phoneDigits("AE")).toBe("9");
    expect(phoneProblem("9876543210", "IN", "mobile")).toBeNull();
    expect(phoneProblem("987654321", "IN", "mobile")).toBe("Enter a valid mobile number for India (10 digits)");
    expect(phoneProblem("98765432101", "IN", "mobile")).toBe("Enter a valid mobile number for India (10 digits)");
    expect(phoneProblem("9876543210", "AE", "mobile")).toBe("Enter a valid mobile number for United Arab Emirates (9 digits)");
    expect(phoneProblem("98765abc10", "IN", "mobile")).toBe("Enter a valid mobile number for India (10 digits)");
    // A landline is a valid phone, never a mobile.
    expect(phoneProblem("43001234", "AE", "mobile")).toMatch(/valid mobile number/);
    expect(phoneProblem("43001234", "AE", "phone")).toBeNull();
    expect(phoneProblem("+971501234567", "IN", "mobile")).toBeNull();
    expect(phoneProblem("501234567", undefined, "mobile")).toBe("Choose the country code");
  });

  it("puts each staff-typed number problem on its field", () => {
    expect(staffPhoneProblems({ mobile: "98765", mobileCountryCode: "IN", phone: "020 7946 0018", phoneCountryCode: "GB" }))
      .toEqual([{ key: "mobile", label: "Enter a valid mobile number for India (10 digits)" }]);
    expect(staffPhoneProblems({ mobile: "050 123 4567" }, "AE")).toEqual([]);
  });

  it("derives the form default from the workspace locale", () => {
    expect(countryFromLocale("en-AE")).toBe("AE");
    expect(countryFromLocale("bad locale")).toBeUndefined();
  });
});
