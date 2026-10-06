import { describe, expect, it } from "vitest";
import { balanceAfter, expectedRefundOn, invoiceAmounts, money, netOfTax, nextStatus, refundTotal, requestReference } from "./finance-requests";
import { moneyText, present, type RequestRow } from "./finance-requests.store";

describe("finance requests", () => {
  it("numbers requests FR-0001 onwards", () => {
    expect(requestReference(7)).toBe("FR-0007");
    expect(requestReference(12345)).toBe("FR-12345");
  });

  it("lets Finance move a request: start, back to the requester, done or rejected, never from a closed one", () => {
    expect(nextStatus("new", "start")).toBe("in_progress");
    expect(nextStatus("in_progress", "ask")).toBe("needs_info");
    expect(nextStatus("new", "done")).toBe("done");
    expect(nextStatus("needs_info", "reject")).toBe("rejected");
    expect(() => nextStatus("in_progress", "start")).toThrow(/new request/);
    expect(() => nextStatus("needs_info", "done")).toThrow(/waiting for its requester/);
    expect(() => nextStatus("done", "reject")).toThrow(/closed/);
    expect(() => nextStatus("rejected", "ask")).toThrow();
  });

  it("adds an invoice up tax-exclusive at the company's rate, to the currency's precision", () => {
    // The tracker's example: 10,000 before tax at 5% is 10,500.
    expect(invoiceAmounts([{ description: "Kitchen", quantity: "1", unitPrice: "10000" }], "5", "AED")).toMatchObject({ net: "10000.0000", tax: "500.0000", total: "10500.0000" });
    const three = invoiceAmounts([{ description: "Panels", quantity: "3", unitPrice: "33.3335" }, { description: "Fixing", quantity: "1", unitPrice: "0.001" }], "5", "KWD");
    expect(three.lines.map((line) => line.amount)).toEqual(["100.0010", "0.0010"]);
    expect(three).toMatchObject({ net: "100.0020", tax: "5.0000", total: "105.0020" });
    // A rate the region sets (e.g. 18%) and a discount line.
    expect(invoiceAmounts([{ description: "Work", quantity: "1", unitPrice: "1000" }, { description: "Discount", quantity: "1", unitPrice: "-100" }], "18", "INR"))
      .toMatchObject({ net: "900.0000", tax: "162.0000", total: "1062.0000" });
  });

  it("takes tax out of what the client pays at a payment stage, and adds up refunds and balances exactly", () => {
    expect(netOfTax("10500", "5", "AED")).toBe("10000.0000");
    expect(netOfTax("100", "5", "AED")).toBe("95.2400");
    expect(refundTotal([{ amount: "1200.5" }, { amount: "99.5" }], "AED")).toBe("1300.0000");
    expect(balanceAfter("10000", "7000")).toBe("3000.0000");
  });

  it("shows the expected refund day only when the firm set its days", () => {
    expect(expectedRefundOn("2026-10-06T08:00:00.000Z", 15)).toBe("2026-10-21");
    expect(expectedRefundOn("2026-10-06", null)).toBeNull();
    expect(expectedRefundOn(null, 15)).toBeNull();
  });

  it("refuses amounts with more decimals than the currency uses, or none at all", () => {
    expect(money("10.5", "Amount", "AED")).toBe("10.5000");
    expect(() => money("10.555", "Amount", "AED")).toThrow(/more decimals than AED/);
    expect(money("10.555", "Amount", "KWD")).toBe("10.5550");
    expect(() => money("0", "Amount", "AED")).toThrow(/more than zero/);
    expect(() => money(12.3456789, "Amount", "AED")).toThrow();
  });

  it("keeps Finance's notes and the client's bank details with Finance", () => {
    const row = { internalNote: "Chase QuickBooks", bankDetails: "IBAN AE07 0331 2345", reference: "FR-0001" } as RequestRow;
    expect(present(row, true)).toMatchObject({ internalNote: "Chase QuickBooks", bankDetails: "IBAN AE07 0331 2345", hasBankDetails: true });
    expect(present(row, false)).toMatchObject({ internalNote: null, bankDetails: null, hasBankDetails: true });
  });

  it("writes amounts for notices in the request's currency", () => {
    expect(moneyText("10500", "AED")).toBe("AED 10,500.00");
    expect(moneyText("1234.5", "KWD")).toBe("KWD 1,234.500");
  });
});
