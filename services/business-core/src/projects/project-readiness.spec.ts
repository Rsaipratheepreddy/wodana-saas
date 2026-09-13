import { describe, expect, it } from "vitest";
import type { CommercialData } from "../commercial/commercial.types";
import { commercialExecutionReady } from "./project-readiness";

const fixture = () =>
  ({
    release: { quoteId: "q", dealFileId: "deal" },
    agreement: {
      quoteId: "q",
      status: "executed",
      evidence: "Signed contract SIG-100",
      reference: "AGR-100",
      terms: "Terms",
    },
    ownerReview: { id: "review", quoteId: "q", status: "approved" },
    dealFile: { id: "deal", quoteId: "q" },
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
        requiredForRelease: true,
        status: "verified",
        reference: "RECEIPT-100",
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
    data.dealFile = { id: "deal", quoteId: "q" } as CommercialData["dealFile"];
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
    expect(commercialExecutionReady(data)).toBe(true);
  });
});
