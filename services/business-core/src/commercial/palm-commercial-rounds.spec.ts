import { describe, expect, it } from "vitest";
import { activeAcceptedBaseQuote, beginPalmMainRound } from "./palm-commercial-rounds";
import type { CommercialData } from "./commercial.types";

const approved = () => ({
  palmFlow: { scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true }, selectedAt: "now", selectedBy: "sales" },
  revision: 1,
  quotes: [{ id: "design", round: "design", kind: "quotation", status: "accepted" }],
  agreement: { quoteId: "design", reference: "AGR-D", status: "executed" },
  ownerReview: { id: "review-d", quoteId: "design", status: "approved" },
  dealFile: { id: "deal", reference: "DF-1", quoteId: "design", revision: 1 },
  requests: [], payments: [], audit: [], release: null,
}) as CommercialData;

describe("Palm's two commercial rounds", () => {
  it("keeps the first signed and paid round while preparing the main round", () => {
    const data = approved();
    beginPalmMainRound(data);
    expect(data.designRound).toMatchObject({ quoteId: "design", agreement: { reference: "AGR-D" }, ownerReview: { status: "approved" } });
    expect(data.agreement).toBeNull();
    expect(data.ownerReview).toBeNull();
    expect(data.dealFile?.id).toBe("deal");
    data.quotes.push({ id: "main", round: "main", kind: "quotation", status: "accepted" } as CommercialData["quotes"][number]);
    expect(activeAcceptedBaseQuote(data)?.id).toBe("main");
  });

  it("does not begin a second round before design Deal approval", () => {
    const data = approved();
    data.ownerReview = null;
    expect(() => beginPalmMainRound(data)).toThrow("paid, Owner-approved");
    expect(data.designRound).toBeUndefined();
    expect(data.agreement?.reference).toBe("AGR-D");
  });
});
