import { describe, expect, it } from "vitest";
import { confirmCommissionAmounts, normalizeCommissionLines, paymentProofLink } from "./deal-submission";

describe("deal submission evidence", () => {
  it("requires one to three named commission lines and resolves percentages against the deal value", () => {
    expect(normalizeCommissionLines([{ recipientName: " Sales A ", type: "sales", basis: "percent", value: 2.5 }], 200000)).toEqual([
      { recipientName: "Sales A", type: "sales", basis: "percent", value: 2.5, amount: 5000 },
    ]);
    expect(() => normalizeCommissionLines([], 100)).toThrow("one and three");
    expect(() => normalizeCommissionLines(Array(4).fill({ recipientName: "A", type: "sales", basis: "amount", value: 1 }), 100)).toThrow("one and three");
    expect(() => normalizeCommissionLines([{ recipientName: "", type: "sales", basis: "amount", value: 1 }], 100)).toThrow("recipient");
    expect(() => normalizeCommissionLines([{ recipientName: "A", type: "sales", basis: "percent", value: 101 }], 100)).toThrow("valid value");
    expect(() => normalizeCommissionLines([{ recipientName: "A", type: "sales", basis: "percent", value: 60 }, { recipientName: "B", type: "designer", basis: "percent", value: 60 }], 100)).toThrow("cannot exceed");
  });

  it("lets Finance correct amounts but not silently change recipients", () => {
    const provisional = normalizeCommissionLines([{ recipientName: "Designer A", type: "designer", basis: "amount", value: 1500 }], 100000);
    expect(confirmCommissionAmounts(provisional, [{ recipientName: "Designer A", type: "designer", basis: "amount", value: 1750 }], 100000)[0].amount).toBe(1750);
    expect(() => confirmCommissionAmounts(provisional, [{ recipientName: "Other", type: "designer", basis: "amount", value: 1750 }], 100000)).toThrow("return the submission");
  });

  it("requires a secure proof link", () => {
    expect(paymentProofLink(" https://example.com/receipt ")).toBe("https://example.com/receipt");
    expect(() => paymentProofLink("http://example.com/receipt")).toThrow("HTTPS");
    expect(() => paymentProofLink("javascript:alert(1)")).toThrow("HTTPS");
  });
});
