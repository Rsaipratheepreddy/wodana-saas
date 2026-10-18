import { describe, expect, it } from "vitest";
import { agreementHasSignedEvidence, agreementIsOperational, dealPaymentProofReady, quoteHasVerifiedReceipt, requestBlocksRelease } from "./release-integrity";

const message = { status: "open" as const };

describe("what holds up release (Q-29)", () => {
  it("a client's plain portal message never does", () => {
    expect(requestBlocksRelease(message)).toBe(false);
  });

  it("an open change to a quote, a change case or an undecided decision does, until it is closed", () => {
    expect(requestBlocksRelease({ ...message, quoteId: "q1" })).toBe(true);
    expect(requestBlocksRelease({ ...message, status: "under_review", control: { kind: "variation", sourceLineIds: [], quoteIds: [], dispositions: [] } } as never)).toBe(true);
    expect(requestBlocksRelease({ ...message, status: "awaiting_decision", decisionRequest: {} } as never)).toBe(true);
    for (const status of ["resolved", "declined", "withdrawn"] as const) expect(requestBlocksRelease({ status, quoteId: "q1" })).toBe(false);
  });
});

describe("the signed agreement on record (M6)", () => {
  const file = { id: "f1", name: "signed.png", mimeType: "image/png", byteSize: 10, hasPreview: true, addedAt: "2026-09-29", addedBy: "u" };
  it("is the uploaded signed document, or a written description of it", () => {
    expect(agreementHasSignedEvidence({ evidence: "", files: [file] })).toBe(true);
    expect(agreementHasSignedEvidence({ evidence: "Signed 28 Sep", files: [] })).toBe(true);
    expect(agreementHasSignedEvidence({ evidence: "  ", files: [] })).toBe(false);
    expect(agreementHasSignedEvidence(null)).toBe(false);
    expect(agreementIsOperational({ status: "executed", evidence: "", files: [file], quoteId: "q", reference: "A", terms: "" })).toBe(true);
  });
});

describe("the Deal File's proof of payment", () => {
  const data = { payments: [{ id: "p1", sourceQuoteId: "q1", status: "verified" }, { id: "p2", sourceQuoteId: "q2", status: "pending" }] } as never;
  it("is a link, or a receipt Finance verified in Wodana for that quotation", () => {
    expect(dealPaymentProofReady(data, "https://bank.example/receipt", "q2")).toBe(true);
    expect(quoteHasVerifiedReceipt(data, "q1")).toBe(true);
    expect(dealPaymentProofReady(data, undefined, "q1")).toBe(true);
    expect(dealPaymentProofReady(data, undefined, "q2")).toBe(false);
  });
});
