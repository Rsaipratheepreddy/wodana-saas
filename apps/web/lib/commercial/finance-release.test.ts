import { describe, expect, it } from "vitest";
import type { CommercialData } from "./types";
import { activeDeliveryQuote, commercialReleaseInputsReady, commercialReleaseReady, financeGatePaymentsReady, requestBlocksRelease } from "./release";

function fixture(): CommercialData {
  return {
    revision: 1,
    financeContext: {
      legalEntityId: "entity",
      code: "PLM-AE",
      displayName: "Palm Living UAE",
      registeredName: "Palm Living Interiors LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      currency: "AED",
      taxValidation: "unvalidated",
      boundAt: "2026-09-18T00:00:00.000Z",
    },
    quotes: [{
      id: "quote",
      number: 1,
      kind: "quotation",
      status: "accepted",
      title: "Works",
      currency: "AED",
      validUntil: "2026-10-01",
      discount: 0,
      taxRate: 0,
      terms: "Terms",
      exclusions: "",
      lines: [],
      requestIds: [],
      paymentTerms: [],
      createdAt: "2026-09-18T00:00:00.000Z",
      hash: "hash",
      total: 100,
      clientDecision: {
        decision: "accept",
        quoteHash: "hash",
        selectedOptionLineIds: [],
        baseTotal: 100,
        optionsTotal: 0,
        acceptedTotal: 100,
        decidedAt: "2026-09-18T00:00:00.000Z",
        decidedBy: "Client",
      },
    }],
    requests: [],
    agreement: {
      quoteId: "quote",
      quoteHash: "hash",
      selectedOptionLineIds: [],
      acceptedTotal: 100,
      legalEntityId: "entity",
      currency: "AED",
      reference: "AGR-1",
      terms: "Terms",
      evidence: "Signed document",
      status: "executed",
    },
    payments: [{
      id: "payment",
      legalEntityId: "entity",
      currency: "AED",
      title: "Advance",
      amount: 100,
      dueDate: "2026-09-20",
      requiredForRelease: true,
      status: "proof_submitted",
      proof: "",
      reference: "INV-1",
    }],
    receipts: [{
      id: "receipt",
      paymentId: "payment",
      legalEntityId: "entity",
      currency: "AED",
      amount: 100,
      source: "provider",
      status: "provider_confirmed",
      reference: "INV-1",
      evidence: "Provider settlement",
      reportedAt: "2026-09-18T00:00:00.000Z",
      reportedBy: "Accounting provider",
    }],
    allocations: [{
      id: "allocation",
      receiptId: "receipt",
      paymentId: "payment",
      legalEntityId: "entity",
      currency: "AED",
      amount: 100,
      createdAt: "2026-09-18T00:00:00.000Z",
      createdBy: "Accounting provider",
    }],
    financeDocuments: [],
    credits: [],
    audit: [],
    ownerReview: {
      id: "review",
      quoteId: "quote",
      quoteHash: "hash",
      status: "approved",
      commission: 0,
      checklist: { agreement: true, boq: true, documents: true, margin: true, materials: true, payment: true },
      submissionNote: "Ready",
      submittedAt: "2026-09-18T00:00:00.000Z",
      submittedBy: "Sales",
      submittedById: "sales",
      financeReviewedById: "finance",
    },
    dealFile: {
      id: "deal",
      reference: "DF-1",
      revision: 1,
      ownerReviewId: "review",
      quoteId: "quote",
      quoteNumber: 1,
      quoteHash: "hash",
      agreementReference: "AGR-1",
      paymentIds: ["payment"],
      value: 100,
      cost: 50,
      margin: 50,
      commission: 0,
      commissionLines: [{ recipientName: "Sales", type: "sales", basis: "amount", value: 1, amount: 1 }],
      paymentProofUrl: "https://example.com/payment-proof",
      status: "active",
      approvedAt: "2026-09-18T00:00:00.000Z",
      approvedBy: "Owner",
    },
    materialApprovals: [],
    release: null,
  };
}

describe("web commercial finance readiness", () => {
  it("does not treat provider confirmation as finance verification", () => {
    const data = fixture();
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.receipts![0].status = "finance_verified";
    data.payments[0].status = "verified";
    expect(commercialReleaseInputsReady(data)).toBe(true);
    data.ownerReview!.financeReviewedById = undefined;
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.ownerReview!.financeReviewedById = "finance";
    data.dealFile!.paymentProofUrl = undefined;
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.dealFile!.paymentProofUrl = "https://example.com/payment-proof";
    data.payments[0].requiredForRelease = false;
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.payments[0].requiredForRelease = true;
    data.allocations![0].reversedAt = "2026-09-18T01:00:00.000Z";
    expect(commercialReleaseInputsReady(data)).toBe(false);
  });

  it("uses the paid main round, not the earlier design round, for Palm delivery", () => {
    const data = fixture();
    const main = { ...data.quotes[0], round: "main" as const };
    const design = { ...data.quotes[0], id: "design", round: "design" as const };
    data.quotes = [design, main];
    data.servicePath = { selectedAt: "2026-09-18T00:00:00.000Z", selectedBy: "sales", scope: {
      design: true, mainQuotation: true, materialSelection: false, procurement: true,
      manufacturing: false, siteWorks: false, installation: true,
    } };
    data.payments[0].sourceQuoteId = main.id;
    data.payments[0].status = "verified";
    data.receipts![0].status = "finance_verified";
    data.payments.push({ ...data.payments[0], id: "design-payment", sourceQuoteId: design.id, status: "proof_submitted" });
    expect(activeDeliveryQuote(data)?.id).toBe(main.id);
    expect(financeGatePaymentsReady(data, main.id)).toBe(true);
    expect(financeGatePaymentsReady(data)).toBe(false);
    expect(commercialReleaseInputsReady(data)).toBe(true);
    data.release = { id: "release", at: "2026-09-18T01:00:00.000Z", by: "Owner", quoteId: main.id, dealFileId: data.dealFile!.id, note: "Ready" };
    expect(commercialReleaseReady(data)).toBe(true);
    data.agreement!.quoteId = design.id;
    expect(commercialReleaseInputsReady(data)).toBe(false);
  });

  it("does not release a Palm material-list path with no actual client selections", () => {
    const data = fixture();
    data.quotes[0].round = "main";
    data.servicePath = { selectedAt: "2026-09-18T00:00:00.000Z", selectedBy: "sales", scope: {
      design: false, mainQuotation: true, materialSelection: true, procurement: true,
      manufacturing: false, siteWorks: false, installation: true,
    } };
    data.payments[0].sourceQuoteId = data.quotes[0].id;
    data.payments[0].status = "verified";
    data.receipts![0].status = "finance_verified";
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.servicePath.scope.materialSelection = false;
    expect(commercialReleaseInputsReady(data)).toBe(true);
  });

  it("is held by open changes and client decisions, never by a client's plain message (Q-29)", () => {
    const data = fixture();
    data.receipts![0].status = "finance_verified";
    data.payments[0].status = "verified";
    const request = { id: "r1", number: 1, title: "When do you start?", detail: "", status: "open" as const, owner: "", dueDate: "", resolution: "", comments: [], createdAt: "2026-09-18T00:00:00.000Z" };
    data.requests = [request];
    expect(requestBlocksRelease(request)).toBe(false);
    expect(commercialReleaseInputsReady(data)).toBe(true);
    data.requests = [{ ...request, quoteId: "quote" }];
    expect(commercialReleaseInputsReady(data)).toBe(false);
    data.requests = [{ ...request, quoteId: "quote", status: "resolved" }];
    expect(commercialReleaseInputsReady(data)).toBe(true);
    expect(requestBlocksRelease({ ...request, control: { kind: "variation", sourceLineIds: [], quoteIds: [], dispositions: [] } } as never)).toBe(true);
  });
});
