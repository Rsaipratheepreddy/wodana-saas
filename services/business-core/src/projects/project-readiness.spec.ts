import { describe, expect, it } from "vitest";
import type { CommercialData } from "../commercial/commercial.types";
import { assertManufacturingPaymentReady, commercialExecutionReady } from "./project-readiness";
import { financeGatePaymentsReady } from "../commercial/release-integrity";

const fixture = () =>
  ({
    release: { quoteId: "q", dealFileId: "deal" },
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
    agreement: {
      quoteId: "q",
      quoteHash: "quote-hash",
      selectedOptionLineIds: [],
      acceptedTotal: 100,
      legalEntityId: "entity",
      currency: "AED",
      status: "executed",
      evidence: "Signed contract SIG-100",
      reference: "AGR-100",
      terms: "Terms",
    },
    ownerReview: { id: "review", quoteId: "q", status: "approved", financeReviewedById: "finance-user" },
    dealFile: {
      id: "deal",
      quoteId: "q",
      paymentProofUrl: "https://example.com/proof/receipt-100",
      commissionLines: [{ recipientName: "Sales", type: "sales", basis: "amount", value: 10, amount: 10 }],
    },
    materialApprovals: [
      {
        id: "approval",
        quoteId: "q",
        lineId: "line",
        materialRowId: "material",
        status: "approved",
      },
    ],
    quotes: [
      {
        id: "q",
        kind: "quotation",
        status: "accepted",
        hash: "quote-hash",
        clientDecision: {
          decision: "accept",
          quoteHash: "quote-hash",
          selectedOptionLineIds: [],
          baseTotal: 100,
          optionsTotal: 0,
          acceptedTotal: 100,
          decidedAt: "2026-09-18T00:00:00.000Z",
          decidedBy: "Client",
        },
        lines: [
          {
            id: "line",
            room: "Room",
            title: "Joinery",
            material: "Oak veneer",
          },
        ],
      },
    ],
    payments: [
      {
        id: "p",
        legalEntityId: "entity",
        currency: "AED",
        amount: 100,
        requiredForRelease: true,
        status: "verified",
        reference: "RECEIPT-100",
      },
    ],
    receipts: [
      {
        id: "receipt",
        paymentId: "p",
        legalEntityId: "entity",
        currency: "AED",
        amount: 100,
        source: "manual",
        status: "finance_verified",
        reference: "RECEIPT-100",
        evidence: "Bank record",
        reportedAt: "2026-09-18T00:00:00.000Z",
        reportedBy: "Operations",
        verifiedAt: "2026-09-18T00:05:00.000Z",
        verifiedBy: "Finance",
      },
    ],
    allocations: [
      {
        id: "allocation",
        receiptId: "receipt",
        paymentId: "p",
        legalEntityId: "entity",
        currency: "AED",
        amount: 100,
        createdAt: "2026-09-18T00:00:00.000Z",
        createdBy: "Operations",
      },
    ],
    requests: [],
  }) as unknown as CommercialData;

describe("execution commercial readiness", () => {
  it("requires the accepted release, owner Deal File and material approval", () => {
    const data = fixture();
    expect(commercialExecutionReady(data)).toBe(true);
    data.dealFile = null;
    expect(commercialExecutionReady(data)).toBe(false);
    data.dealFile = fixture().dealFile;
    data.materialApprovals![0].status = "proposed";
    expect(commercialExecutionReady(data)).toBe(false);
    data.materialApprovals![0].status = "approved";
    data.quotes[0].status = "superseded";
    expect(commercialExecutionReady(data)).toBe(false);
    expect(commercialExecutionReady(null)).toBe(false);
  });

  it("rejects demonstration agreement and payment evidence", () => {
    const data = fixture();
    data.agreement!.evidence = "Demonstration agreement; not a live contract";
    expect(commercialExecutionReady(data)).toBe(false);
    data.agreement!.evidence = "Signed contract SIG-100";
    data.payments[0].reference = "Demonstration ledger";
    expect(commercialExecutionReady(data)).toBe(false);
  });

  it("stops execution when invoice evidence is stale or payment reverses", () => {
    const data = fixture(),
      payment = data.payments[0];
    payment.invoice = {
      id: "invoice",
      accountId: "company",
      provider: "quickbooks",
      balance: 0,
      refreshedAt: new Date().toISOString(),
    } as typeof payment.invoice;
    expect(commercialExecutionReady(data)).toBe(true);
    payment.invoice!.balance = 20;
    expect(commercialExecutionReady(data)).toBe(false);
    payment.invoice!.balance = 0;
    payment.invoice!.refreshedAt = new Date(
      Date.now() - 25 * 3_600_000,
    ).toISOString();
    expect(commercialExecutionReady(data)).toBe(false);
    payment.requiredForRelease = false;
    expect(commercialExecutionReady(data)).toBe(false);
  });

  it("uses the explicit accepted production milestone for H3", () => {
    const data = fixture();
    expect(financeGatePaymentsReady(data, "production")).toBe(true);
    data.payments[0].requiredForProduction = true;
    expect(financeGatePaymentsReady(data, "production")).toBe(true);
    data.receipts![0].status = "rejected";
    expect(financeGatePaymentsReady(data, "production")).toBe(false);
  });

  it("blocks the Palm Manufacturing stage until the contracted production payment is verified", () => {
    const data = fixture();
    data.payments[0].requiredForProduction = true;
    expect(() => assertManufacturingPaymentReady("design_build_deal_first", "manufacturing", data)).not.toThrow();
    data.receipts![0].status = "rejected";
    expect(() => assertManufacturingPaymentReady("design_build_deal_first", "manufacturing", data)).toThrow("production payment");
    expect(() => assertManufacturingPaymentReady("standard_delivery", "manufacturing", data)).not.toThrow();
    expect(() => assertManufacturingPaymentReady("design_build_deal_first", "site_works", data)).not.toThrow();
  });
});
