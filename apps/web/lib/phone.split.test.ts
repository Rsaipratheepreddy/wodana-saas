import { describe, expect, it } from "vitest";
import { exampleMobile, groupNational, phoneCountry, phoneDigits, phoneProblem, splitPhone } from "./phone";

describe("exampleMobile", () => {
  it("gives the region's own example mobile number, never a fixed country's", () => {
    expect(exampleMobile(phoneCountry(undefined, "en-GB"))).toMatch(/^\+44 7/);
    expect(exampleMobile(phoneCountry(undefined, "en-IN"))).toMatch(/^\+91 /);
    expect(exampleMobile(phoneCountry(undefined, "en"))).toBeNull();
  });
});

const text = {
  mobile: (c: string, digits: string) => `Enter a valid mobile number for ${c} (${digits} digits)`,
  phone: (c: string) => `Enter a valid phone number for ${c}`,
  chooseCountry: "Choose the country code",
};

describe("splitPhone", () => {
  it("moves a stored or pasted country code into the picker (PLM-034)", () => {
    expect(splitPhone("+917780768279", "IN")).toEqual({ country: "IN", national: "7780768279" });
    expect(splitPhone("+971528638482", "AE")).toEqual({ country: "AE", national: "528638482" });
    expect(splitPhone("+44 7400 123456", "AE")).toEqual({ country: "GB", national: "7400123456" });
    expect(splitPhone("+1 416 555 0123", "CA")).toEqual({ country: "CA", national: "4165550123" });
    expect(splitPhone("00971 50 123 4567", "IN")).toEqual({ country: "AE", national: "501234567" });
  });
  it("drops the trunk 0 and a calling code typed without +", () => {
    expect(splitPhone("050 123 4567", "AE")).toEqual({ country: "AE", national: "501234567" });
    expect(splitPhone("971501234567", "AE")).toEqual({ country: "AE", national: "501234567" });
    expect(splitPhone("917780768279", "IN")).toEqual({ country: "IN", national: "7780768279" });
  });
  it("leaves unfinished input alone while typing", () => {
    expect(splitPhone("50 12", "AE")).toEqual({ country: "AE", national: "50 12" });
    expect(splitPhone("", "AE")).toEqual({ country: "AE", national: "" });
  });
});

describe("phoneProblem", () => {
  it("explains length problems per country with the digit count from the metadata (PLM-021)", () => {
    expect(phoneProblem("5012345678", "AE", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for United Arab Emirates (9 digits)");
    expect(phoneProblem("50123", "AE", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for United Arab Emirates (9 digits)");
    expect(phoneDigits("IN", { mobile: true })).toBe("10");
    expect(phoneDigits("DE", { mobile: true })).toBe("10–11");
  });
  it("accepts exactly a country's mobile length and refuses one digit less or more", () => {
    expect(phoneProblem("9876543210", "IN", text, { mobile: true, locale: "en" })).toBeNull();
    expect(phoneProblem("987654321", "IN", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for India (10 digits)");
    expect(phoneProblem("98765432101", "IN", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for India (10 digits)");
    expect(phoneProblem("98765abc10", "IN", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for India (10 digits)");
  });
  it("accepts valid mobiles and rejects a landline in a mobile field", () => {
    expect(phoneProblem("501234567", "AE", text, { mobile: true })).toBeNull();
    expect(phoneProblem("7780768279", "IN", text, { mobile: true })).toBeNull();
    expect(phoneProblem("43001234", "AE", text, { mobile: true, locale: "en" })).toBe("Enter a valid mobile number for United Arab Emirates (9 digits)");
    expect(phoneProblem("43001234", "AE", text)).toBeNull();
    expect(phoneProblem("4300", "AE", text, { locale: "en" })).toBe("Enter a valid phone number for United Arab Emirates");
  });
  it("asks for a country when none is chosen", () => {
    expect(phoneProblem("501234567", "", text)).toBe("Choose the country code");
  });
});

describe("groupNational", () => {
  it("groups a valid local number after its code and keeps anything unfinished as typed", () => {
    expect(groupNational("0507421938", "AE")).toBe("50 742 1938");
    expect(groupNational("507421938", "ae")).toBe("50 742 1938");
    expect(groupNational("050 742", "AE")).toBe("050 742");
    expect(groupNational("", "AE")).toBe("");
  });
});
