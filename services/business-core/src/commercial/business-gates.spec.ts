import { describe, expect, it } from "vitest";
import type { CommercialData, Quote } from "./commercial.types";
import {
  financeGatePaymentsReady,
  ownerReviewInputsReady,
  variationReleasePaymentsReady,
} from "./release-integrity";

const quote: Quote = {
  id: "quote",
  number: 1,
  kind: "quotation",
  status: "accepted",
  title: "Contract",
  currency: "AED",
  validUntil: "2026-12-31",
  discount: 0,
  taxRate: 0,
  terms: "Terms",
  exclusions: "",
  lines: [],
  paymentTerms: [],
  requestIds: [],
  createdAt: "2026-09-18T00:00:00.000Z",
  total: 100,
  hash: "accepted-hash",
  clientDecision: {
    decision: "accept",
    quoteHash: "accepted-hash",
    selectedOptionLineIds: [],
    baseTotal: 100,
    optionsTotal: 0,
    acceptedTotal: 100,
    decidedAt: "2026-09-18T00:00:00.000Z",
    decidedBy: "Client",
  },
};

function fixture(): CommercialData {
  return {
    revision: 1,
    quotes: [structuredClone(quote)],
    requests: [],
    agreement: {
      quoteId: quote.id,
      quoteHash: quote.hash,
      selectedOptionLineIds: [],
      acceptedTotal: 100,
      reference: "AGR-1",
      terms: "Terms",
      evidence: "Signed agreement SIG-1",
      status: "executed",
    },
    payments: [
      {
        id: "payment",
        title: "Contract deposit",
        amount: 100,
        dueDate: "2026-09-20",
        requiredForRelease: true,
        requiredForProduction: true,
        status: "pending",
        proof: "",
        reference: "",
      },
    ],
    audit: [],
    ownerReview: null,
    dealFile: null,
    materialApprovals: [],
    release: null,
  };
}

describe("four business gates", () => {
  it("keeps Owner Review independent from receipt verification", () => {
    const data = fixture();
    expect(ownerReviewInputsReady(data, data.quotes[0])).toBe(true);
    expect(financeGatePaymentsReady(data, "release")).toBe(false);
  });

  it("never treats an empty release-payment set as a satisfied H2 gate", () => {
    const data = fixture();
    data.payments[0].requiredForRelease = false;
    expect(financeGatePaymentsReady(data, "release")).toBe(false);
  });

  it("requires structured finance truth for a positive accepted variation", () => {
    const data = fixture();
    const variation = {
      ...structuredClone(quote),
      id: "variation",
      kind: "variation" as const,
      direction: "addition" as const,
      total: 25,
    };
    data.financeContext = {
      legalEntityId: "entity",
      code: "PLM-AE",
      displayName: "Palm Living UAE",
      registeredName: "Palm Living Interiors LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      currency: "AED",
      taxValidation: "unvalidated",
      boundAt: "2026-09-18T00:00:00.000Z",
    };
    data.payments = [{
      ...data.payments[0],
      id: "variation-payment",
      sourceQuoteId: variation.id,
      legalEntityId: "entity",
      currency: "AED",
      amount: 25,
      status: "verified",
      reference: "RCT-25",
    }];
    data.receipts = [{
      id: "receipt",
      paymentId: "variation-payment",
      legalEntityId: "entity",
      currency: "AED",
      amount: 25,
      source: "provider",
      status: "provider_confirmed",
      reference: "RCT-25",
      evidence: "Provider settlement",
      reportedAt: "2026-09-18T00:00:00.000Z",
      reportedBy: "Accounting provider",
    }];
    data.allocations = [{
      id: "allocation",
      receiptId: "receipt",
      paymentId: "variation-payment",
      legalEntityId: "entity",
      currency: "AED",
      amount: 25,
      createdAt: "2026-09-18T00:00:00.000Z",
      createdBy: "Accounting provider",
    }];
    expect(variationReleasePaymentsReady(data, variation)).toBe(false);
    data.receipts[0].status = "finance_verified";
    expect(variationReleasePaymentsReady(data, variation)).toBe(true);
  });
});
