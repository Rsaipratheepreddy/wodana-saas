import { describe, expect, it } from "vitest";
import { freezeHash } from "./commercial.domain";
import { commercialCommandPermission } from "./commercial.service";
import { qsEstimateCurrent, qsEstimateHash } from "./qs-estimate";
import type { Quote } from "./commercial.types";

const quote: Quote = {
  id: "q", number: 1, kind: "quotation", round: "design", status: "internal_review",
  title: "Design package", currency: "AED", validUntil: "2026-12-31",
  discount: 0, taxRate: 0, terms: "Terms", exclusions: "",
  lines: [{ id: "l", room: "General", title: "Moodboards", specification: "", material: "", finish: "", quantity: 1, unit: "package", unitCost: 400, rate: 800 }],
  requestIds: [], paymentTerms: [], createdAt: "2026-09-24T00:00:00Z", total: 800,
};

describe("QS quotation estimate", () => {
  it("uses a separate reviewer permission", () => {
    expect(commercialCommandPermission("qs_approve")).toBe("commercial.estimate");
    expect(commercialCommandPermission("decide_owner_review")).toBe("commercial.deal.approve");
  });

  it("invalidates the review after cost or client-facing price changes", () => {
    const reviewed = structuredClone(quote);
    reviewed.qsEstimate = {
      quoteHash: qsEstimateHash(reviewed), cost: 400, sellingTotal: 800,
      reviewedAt: "2026-09-24T10:00:00Z", reviewedById: "qs", reviewedBy: "QS",
    };
    expect(qsEstimateCurrent(reviewed)).toBe(true);
    const oldClientHash = freezeHash(reviewed);
    reviewed.lines[0].unitCost = 450;
    expect(freezeHash(reviewed)).toBe(oldClientHash);
    expect(qsEstimateCurrent(reviewed)).toBe(false);
    reviewed.lines[0].unitCost = 400;
    reviewed.lines[0].rate = 850;
    expect(qsEstimateCurrent(reviewed)).toBe(false);
  });

  it("binds client acceptance to the quotation round", () => {
    expect(freezeHash({ ...quote, round: "design" })).not.toBe(freezeHash({ ...quote, round: "main" }));
  });
});
