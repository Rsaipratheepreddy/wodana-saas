import { describe, expect, it } from "vitest";
import { agreementHasSignedEvidence, agreementIsOperational, dealChecklist, DEAL_CHECK_LABELS, dealPaymentProofReady, quoteHasVerifiedReceipt, requestBlocksRelease } from "./release-integrity";

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

describe("the deal checklist, read from the records (§0.3 P0)", () => {
  const quote = { id: "q1", round: "main", lines: [{ id: "l1" }], status: "accepted", hash: "h", clientDecision: { decision: "accept", quoteHash: "h", acceptedTotal: 100, selectedOptionLineIds: [] } };
  const agreement = { status: "executed", evidence: "Signed 14 Oct", files: [], quoteId: "q1", quoteHash: "h", acceptedTotal: 100, selectedOptionLineIds: [], reference: "STU-AGR-2026-00001", terms: "" };
  const data = (over: Record<string, unknown> = {}) => ({ servicePath: { scope: {} }, agreement, payments: [{ id: "p1", sourceQuoteId: "q1", status: "verified" }], materialApprovals: [], ...over }) as never;
  it("is all done once the agreement, its document, the proof and the priced lines are on record", () => {
    expect(dealChecklist(data(), quote as never, undefined)).toEqual({ agreement: true, documents: true, payment: true, boq: true, margin: true, materials: true });
  });
  it("names what is missing, and never asks a design-fee round for priced lines", () => {
    const missing = dealChecklist(data({ agreement: null, payments: [] }), { ...quote, lines: [] } as never, undefined);
    expect(Object.entries(missing).filter(([, ok]) => !ok).map(([key]) => key)).toEqual(["agreement", "documents", "payment", "boq"]);
    expect(DEAL_CHECK_LABELS.payment).toBe("proof of payment or a Finance-verified receipt");
    expect(dealChecklist(data(), { ...quote, round: "design", lines: [] } as never, undefined).boq).toBe(true);
  });
});
