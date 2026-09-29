import { describe, expect, it } from "vitest";
import { groupNational, phoneProblem, splitPhone } from "./phone";

const text = {
  tooShort: (c: string, code: string, n: number) => `Too short — ${c} numbers are ${n} digits after ${code}`,
  tooLong: (c: string, code: string, n: number) => `Too long — ${c} numbers are ${n} digits after ${code}`,
  invalid: (c: string) => `Not a valid ${c} number`,
  notMobile: (c: string) => `Not a ${c} mobile number`,
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
  it("explains length problems per country (PLM-021)", () => {
    expect(phoneProblem("5012345678", "AE", text, { mobile: true })).toMatch(/^Too long — United Arab Emirates numbers are 9 digits after \+971/);
    expect(phoneProblem("50123", "AE", text, { mobile: true })).toMatch(/^Too short/);
  });
  it("accepts valid mobiles and rejects a landline in a mobile field", () => {
    expect(phoneProblem("501234567", "AE", text, { mobile: true })).toBeNull();
    expect(phoneProblem("7780768279", "IN", text, { mobile: true })).toBeNull();
    expect(phoneProblem("43001234", "AE", text, { mobile: true })).toBe("Not a United Arab Emirates mobile number");
    expect(phoneProblem("43001234", "AE", text)).toBeNull();
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
