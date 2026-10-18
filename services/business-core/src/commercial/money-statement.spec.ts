import { describe, expect, it } from "vitest";
import { buildStatement } from "./money-statement";
import type { CommercialData } from "./commercial.types";

type Data = Pick<CommercialData, "quotes" | "payments" | "receipts" | "allocations">;
const quote = (patch: Record<string, unknown>) => ({ id: "q", number: 1, kind: "quotation", round: "main", status: "accepted", title: "Quotation", currency: "AED", total: 0, ...patch }) as never;
const payment = (patch: Record<string, unknown>) => ({ id: "p", title: "Advance", amount: 0, dueDate: "", requiredForRelease: false, status: "pending", ...patch }) as never;
const receipt = (patch: Record<string, unknown>) => ({ id: "r", paymentId: "p", legalEntityId: "e", currency: "AED", amount: 0, source: "manual", status: "finance_verified",
  reference: "", evidence: "", ...patch }) as never;
const contract = { legalEntityId: "e", currency: "AED" } as never;
const allocate = (id: string, receiptId: string, paymentId: string, amount: number, reversedAt?: string) =>
  ({ id, receiptId, paymentId, legalEntityId: "e", currency: "AED", amount, createdAt: "", createdBy: "", ...(reversedAt ? { reversedAt } : {}) });
const statement = (data: Partial<Data> & { financeContext?: unknown }, posted: Record<string, string> = {}) => buildStatement({ quotes: [], payments: [], receipts: [], allocations: [],
  financeContext: contract, ...data } as never,
  { currency: "AED", today: "2026-10-17", posted: new Map(Object.entries(posted)) });

describe("the job's money statement (§0.3 P8), exact to the fils", () => {
  it("adds the design fee, the quotation and an accepted change; takes away a deduction", () => {
    const result = statement({ quotes: [
      quote({ id: "d", round: "design", title: "Design fee", total: 15000 }),
      quote({ id: "m", title: "Estimate", total: 100000.1, clientDecision: { acceptedTotal: 98765.43 } }),
      quote({ id: "v1", kind: "variation", title: "Extra shelf", total: 450.5 }),
      quote({ id: "v2", kind: "variation", direction: "deduction", title: "No wallpaper", total: 1200 }),
      quote({ id: "x", title: "Declined", status: "declined", total: 999 }),
    ] });
    expect(result.agreed).toBe("113015.93");
    expect(result.lines.map((line) => [line.kind, line.agreed])).toEqual([["design", "15000.00"], ["quotation", "98765.43"], ["addition", "450.50"], ["deduction", "-1200.00"]]);
    expect(result.due).toBe("113015.93");
    expect(result.checks).toEqual([]);
  });

  it("counts the money that arrived, part payments included, and says what's next and what's late", () => {
    const result = statement({
      quotes: [quote({ id: "m", total: 10000 })],
      payments: [payment({ id: "p1", sourceQuoteId: "m", title: "Advance", amount: 3333.33, dueDate: "2026-10-01" }),
        payment({ id: "p2", sourceQuoteId: "m", title: "Production", amount: 3333.33, dueDate: "2026-11-01" }),
        payment({ id: "p3", sourceQuoteId: "m", title: "Handover", amount: 3333.34, dueDate: "" })],
      receipts: [receipt({ id: "r1", paymentId: "p1", amount: 2000 }), receipt({ id: "r2", paymentId: "p1", amount: 500, status: "reported" })],
      allocations: [allocate("a1", "r1", "p1", 2000)],
    }, { r1: "2000.0000" });
    expect(result).toMatchObject({ agreed: "10000.00", received: "2000.00", due: "8000.00", overdue: "1333.33", credit: "0.00" });
    expect(result.next).toEqual({ id: "p1", title: "Advance", amount: "1333.33", dueDate: "2026-10-01" });
    expect(result.milestones.map((milestone) => [milestone.id, milestone.received, milestone.remaining, milestone.overdue])).toEqual([
      ["p1", "2000.00", "1333.33", true], ["p2", "0.00", "3333.33", false], ["p3", "0.00", "3333.34", false]]);
    expect(result.checks).toEqual([]);
  });

  it("follows the receipt's allocations, ignoring reversed ones", () => {
    const result = statement({
      quotes: [quote({ id: "m", total: 1000 })],
      payments: [payment({ id: "p1", sourceQuoteId: "m", amount: 600 }), payment({ id: "p2", sourceQuoteId: "m", amount: 400 })],
      receipts: [receipt({ id: "r1", paymentId: "p1", amount: 700 })],
      allocations: [allocate("a1", "r1", "p1", 600), allocate("a2", "r1", "p2", 100), allocate("a3", "r1", "p2", 300, "2026-10-02")],
    }, { r1: "700" });
    expect(result.milestones.map((milestone) => [milestone.id, milestone.received, milestone.remaining])).toEqual([["p1", "600.00", "0.00"], ["p2", "100.00", "300.00"]]);
    expect(result.next).toMatchObject({ id: "p2", amount: "300.00" });
    expect(result.unallocated).toBe("0.00");
  });

  it("keeps verified money that isn't allocated yet as received, shown apart (never spread by guesswork)", () => {
    const result = statement({ quotes: [quote({ id: "m", total: 1000 })], payments: [payment({ id: "p1", sourceQuoteId: "m", amount: 1000 })],
      receipts: [receipt({ id: "r1", paymentId: "p1", amount: 250 })] }, { r1: "250" });
    expect(result).toMatchObject({ received: "250.00", unallocated: "250.00", due: "750.00" });
    expect(result.milestones[0]).toMatchObject({ received: "0.00", remaining: "1000.00" });
  });

  it("before a finance contract, a verified milestone counts in full (as the portal reads it)", () => {
    const result = statement({ financeContext: undefined, quotes: [quote({ id: "m", total: 1000 })],
      payments: [payment({ id: "p1", sourceQuoteId: "m", amount: 400, status: "verified" }), payment({ id: "p2", sourceQuoteId: "m", amount: 600 })] });
    expect(result).toMatchObject({ received: "400.00", due: "600.00", unallocated: "0.00" });
  });

  it("shows a client in credit when they paid more than agreed", () => {
    const result = statement({ quotes: [quote({ id: "m", total: 500 })], receipts: [receipt({ id: "r1", amount: 500.01 })] }, { r1: "500.01" });
    expect(result).toMatchObject({ due: "0.00", credit: "0.01" });
  });

  it("flags a schedule a fils short of its quote, a receipt missing from the ledger and one posted for another amount", () => {
    const result = statement({
      quotes: [quote({ id: "m", title: "Estimate", total: 10000 })],
      payments: [payment({ id: "p1", sourceQuoteId: "m", amount: 5000 }), payment({ id: "p2", sourceQuoteId: "m", amount: 4999.99 })],
      receipts: [receipt({ id: "r1", paymentId: "p1", amount: 5000 }), receipt({ id: "r2", paymentId: "p2", amount: 100 })],
      allocations: [allocate("a1", "r1", "p1", 5000), allocate("a2", "r2", "p2", 100)],
    }, { r2: "99.99" });
    expect(result.checks).toEqual([
      { kind: "schedule_gap", quoteId: "m", title: "Estimate", difference: "0.01" },
      { kind: "not_posted", receiptId: "r1", amount: "5000.00", posted: null },
      { kind: "posted_differently", receiptId: "r2", amount: "100.00", posted: "99.99" },
    ]);
  });

  it("never drifts on amounts floating point can't hold (0.1 + 0.2)", () => {
    const result = statement({ quotes: [quote({ id: "a", total: 0.1 }), quote({ id: "b", total: 0.2 })], receipts: [receipt({ id: "r1", amount: 0.3 })] }, { r1: "0.3" });
    expect(result).toMatchObject({ agreed: "0.30", received: "0.30", due: "0.00", credit: "0.00" });
  });
});
