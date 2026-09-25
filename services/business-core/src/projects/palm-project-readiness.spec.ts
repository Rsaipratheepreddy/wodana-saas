import { describe, expect, it } from "vitest";
import type { CommercialData, DealFile, OwnerReview, Quote } from "../commercial/commercial.types";
import { assertPalmCommercialStageReady } from "./project-readiness";

const design = { id: "design", kind: "quotation", round: "design", status: "accepted", lines: [] } as Quote;
const main = { id: "main", kind: "quotation", round: "main", status: "draft", lines: [] } as Quote;
const data = (): CommercialData => ({
  palmFlow: {
    scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true },
    selectedAt: "now", selectedBy: "sales",
  },
  revision: 1, quotes: [design, { ...main }], requests: [], agreement: null,
  ownerReview: { id: "review-design", quoteId: "design", status: "approved" } as OwnerReview,
  dealFile: { id: "deal-1", quoteId: "design", ownerReviewId: "review-design", status: "active" } as DealFile,
  payments: [], audit: [], release: null,
});

const advance = (to: string, value: CommercialData) =>
  assertPalmCommercialStageReady("design_build_deal_first", to, value);

describe("Palm project stage evidence", () => {
  it("blocks every stage when the first paid Deal File is missing or inconsistent", () => {
    expect(() => assertPalmCommercialStageReady("design_build_deal_first", "site_visit", null))
      .toThrow("first paid, Owner-approved Deal File");
    const missing = data();
    missing.dealFile = null;
    expect(() => advance("site_visit", missing)).toThrow("first paid, Owner-approved Deal File");
    const changed = data();
    changed.ownerReview!.status = "returned";
    expect(() => advance("design_specifications", changed)).toThrow("first paid, Owner-approved Deal File");
    expect(() => assertPalmCommercialStageReady("default_delivery", "site_visit", null)).not.toThrow();
  });

  it("keeps the first design approval valid while the main round is in review", () => {
    const value = data();
    value.designRound = {
      quoteId: "design", agreement: {} as NonNullable<CommercialData["agreement"]>,
      ownerReview: value.ownerReview!, dealFile: value.dealFile!,
    };
    value.ownerReview = { id: "review-main", quoteId: "main", status: "pending_finance" } as OwnerReview;
    expect(() => advance("site_visit", value)).not.toThrow();
  });
  it("does not let the design quote masquerade as the main quotation", () => {
    const value = data();
    value.quotes = [design];
    expect(() => advance("main_qs_review", value)).toThrow("main quotation");
    expect(() => advance("main_client_approval", value)).toThrow("QS");
    expect(() => advance("main_agreement_payment", value)).toThrow("main quotation");
  });

  it("requires a reviewed current estimate before client issue", () => {
    const value = data();
    value.quotes[1].status = "internal_approved";
    expect(() => advance("main_client_approval", value)).toThrow("QS");
  });

  it("requires the main paid agreement before the material list and sign-off before procurement", () => {
    const value = data();
    value.quotes[1].status = "accepted";
    expect(() => advance("material_list_signoff", value)).toThrow("main agreement");
    expect(() => advance("procurement", value)).toThrow("material sign-off");
  });
});
