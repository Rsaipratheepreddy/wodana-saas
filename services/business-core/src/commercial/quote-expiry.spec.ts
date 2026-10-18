import { describe, expect, it } from "vitest";
import { freezeHash } from "./commercial.domain";
import type { Quote } from "./commercial.types";
import { qsEstimateCurrent, qsEstimateHash } from "./qs-estimate";
import { extendQuoteValidity } from "./quote-expiry";

function quote(fields: Partial<Quote> = {}): Quote {
  const base = {
    id: "q1", number: 3, kind: "quotation", status: "expired", title: "Kitchen", currency: "USD", validUntil: "2026-09-20", discount: 0, taxRate: 5,
    terms: "", exclusions: "", lines: [{ id: "l1", description: "Cabinets", quantity: 2, unit: "nos", rate: 100, unitCost: 60 }], requestIds: [], paymentTerms: [],
    createdAt: "2026-09-01T00:00:00.000Z", total: 210,
  } as unknown as Quote;
  const q = { ...base, ...fields } as Quote;
  q.hash = freezeHash(q);
  return q;
}

describe("extending a quote's validity (Q-7)", () => {
  it("sends an expired quote again with the same content and a new date, re-sealed", () => {
    const q = quote();
    const lines = JSON.stringify(q.lines);
    expect(extendQuoteValidity(q, "2026-10-15", "2026-09-29")).toEqual({ from: "2026-09-20", to: "2026-10-15" });
    expect(q).toMatchObject({ status: "issued", validUntil: "2026-10-15" });
    expect(JSON.stringify(q.lines)).toBe(lines);
    expect(q.hash).toBe(freezeHash(q));
  });

  it("keeps a current QS estimate current, so no new review round is needed", () => {
    const q = quote({ status: "issued" });
    q.qsEstimate = { quoteHash: "", cost: 120, sellingTotal: 210, reviewedAt: "", reviewedById: "qs", reviewedBy: "QS" };
    q.qsEstimate.quoteHash = qsEstimateHash(q);
    const before = qsEstimateCurrent(q);
    extendQuoteValidity(q, "2026-11-01", "2026-09-29");
    expect(qsEstimateCurrent(q)).toBe(before);
  });

  it("refuses a draft, a date that isn't after today, or more than a year out", () => {
    expect(() => extendQuoteValidity(quote({ status: "draft" }), "2026-10-15", "2026-09-29")).toThrow(/sent or expired/);
    expect(() => extendQuoteValidity(quote(), "2026-09-29", "2026-09-29")).toThrow(/after today/);
    expect(() => extendQuoteValidity(quote(), "2027-12-01", "2026-09-29")).toThrow(/up to a year/);
    expect(() => extendQuoteValidity(quote(), "someday", "2026-09-29")).toThrow(/valid date/);
  });
});
