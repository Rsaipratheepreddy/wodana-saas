import { describe, expect, it } from "vitest";
import { headlineValue, parseProposalAmount, parseProposalKind, valueStatusFrom, wonProposalKind } from "./opportunity-proposals";

describe("opportunity proposals (PLM-101 / PLM-103 / PLM-009)", () => {
  it("accepts a decimal text and refuses negatives, separators and words", () => {
    expect(parseProposalAmount("125000")).toBe("125000");
    expect(parseProposalAmount(" 125000.50 ")).toBe("125000.50");
    for (const bad of ["-1", "1,000", "abc", "", "1.12345"]) expect(() => parseProposalAmount(bad)).toThrow(/number/);
    expect(parseProposalKind("design")).toBe("design");
    expect(() => parseProposalKind("other")).toThrow(/Proposal 1/);
  });

  it("wins the round it knows, else the first proposal not yet Won, design before main", () => {
    expect(wonProposalKind([], "main")).toBe("main");
    expect(wonProposalKind([], null)).toBe("main");
    expect(wonProposalKind([{ kind: "design", wonAt: null }], null)).toBe("design");
    expect(wonProposalKind([{ kind: "design", wonAt: "2026-10-01" }, { kind: "main", wonAt: null }], null)).toBe("main");
  });

  it("sums the proposals into one headline value exactly, only in one currency", () => {
    expect(headlineValue([{ amount: "0.1", currencyCode: "AED" }, { amount: "0.2", currencyCode: "AED" }])).toEqual({ amount: "0.3", currencyCode: "AED" });
    expect(headlineValue([{ amount: "15000", currencyCode: "AED" }, { amount: "185000.25", currencyCode: "AED" }])).toEqual({ amount: "200000.25", currencyCode: "AED" });
    expect(headlineValue([{ amount: "1", currencyCode: "AED" }, { amount: "1", currencyCode: "EUR" }])).toBeNull();
    expect(headlineValue([{ amount: null, currencyCode: null }])).toBeNull();
  });

  it("reads the value's status from its approval: Finance's step verifies, the last locks, a change keeps the lock", () => {
    expect(valueStatusFrom({ status: "pending", currentStep: 1, previousAmount: null }, "entered")).toBe("entered");
    expect(valueStatusFrom({ status: "pending", currentStep: 2, previousAmount: null }, "entered")).toBe("verified");
    expect(valueStatusFrom({ status: "approved", currentStep: 2, previousAmount: null }, "verified")).toBe("approved");
    expect(valueStatusFrom({ status: "pending", currentStep: 1, previousAmount: "15000" }, "approved")).toBe("approved");
    expect(valueStatusFrom({ status: "returned", currentStep: 1, previousAmount: null }, "entered")).toBe("entered");
    expect(valueStatusFrom(null, "empty")).toBe("empty");
  });
});
