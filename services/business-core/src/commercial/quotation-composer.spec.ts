import { describe, expect, it } from "vitest";
import type { Quote, QuoteLine } from "./commercial.types";
import {
  compareQuotationRevisions,
  mergeQuotationProposal,
  quotationComposerReadiness,
  quoteDraftHash,
  type QuotationProposalItem,
} from "./quotation-composer";

const line = (overrides: Partial<QuoteLine> = {}): QuoteLine => ({
  id: "line-1",
  room: "Kitchen",
  title: "Cabinetry",
  specification: "Confirmed specification",
  material: "Oak",
  finish: "Matte",
  quantity: 2,
  unit: "nos",
  unitCost: 0,
  rate: 100,
  scopeId: "scope-1",
  scopeVersion: 1,
  specificationVersion: 1,
  ...overrides,
});
const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: "quote-1",
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Proposal",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 5,
  terms: "Terms",
  exclusions: "",
  lines: [],
  rooms: [],
  requestIds: [],
  paymentTerms: [
    { id: "pay-1", title: "Advance", percent: 100, trigger: "Acceptance", requiredForRelease: true },
  ],
  createdAt: "2026-09-15T00:00:00.000Z",
  total: 0,
  ...overrides,
});
const item = (overrides: Partial<QuotationProposalItem> = {}): QuotationProposalItem => ({
  id: "proposal-1",
  roomId: "room-1",
  roomName: "Kitchen",
  line: line(),
  sourceIds: ["scope-1"],
  reason: "Confirmed scope",
  status: "ready",
  ...overrides,
});

describe("quotation composer boundaries", () => {
  it("detects every material draft change in the proposal binding", () => {
    const source = quote({ lines: [line()], total: 210 });
    expect(quoteDraftHash(source)).not.toBe(
      quoteDraftHash({ ...source, lines: [{ ...source.lines[0], quantity: 3 }] }),
    );
    expect(quoteDraftHash(source)).not.toBe(
      quoteDraftHash({ ...source, paymentTerms: [{ ...source.paymentTerms[0], trigger: "Before work" }] }),
    );
  });

  it("adds selected items without replacing manual work and skips exact scope duplicates", () => {
    const manual = line({ id: "manual", scopeId: undefined, title: "Manual note" });
    const first = mergeQuotationProposal(quote({ lines: [manual] }), [item()], ["proposal-1"]);
    expect(first.quote.lines.map((value) => value.id)).toEqual(["manual", "line-1"]);
    expect(first.quote.rooms).toEqual([{ id: "room-1", name: "Kitchen" }]);
    const retry = mergeQuotationProposal(first.quote, [item()], ["proposal-1"]);
    expect(retry.added).toEqual([]);
    expect(retry.skipped).toEqual(["proposal-1"]);
    expect(retry.quote.lines).toHaveLength(2);
  });

  it("does not add an AI catalog item already represented by an imported scope line", () => {
    const catalogLink = {
      role: "work",
      recordId: "work-1",
      version: 1,
      snapshot: { id: "work-1", name: "Cabinetry", code: "CAB", kind: "work", version: 1, catalogId: "catalog-1" },
    };
    const existing = line({ catalogLinks: [catalogLink] });
    const aiItem = item({
      line: line({ id: "ai-line", scopeId: undefined, catalogLinks: [catalogLink] }),
    });
    const result = mergeQuotationProposal(
      quote({ lines: [existing], rooms: [{ id: "room-1", name: "Kitchen" }] }),
      [aiItem],
      [aiItem.id],
    );
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([aiItem.id]);
    expect(result.quote.lines).toEqual([existing]);
  });

  it("rejects unknown, repeated, empty and oversized selections", () => {
    expect(() => mergeQuotationProposal(quote(), [item()], [])).toThrow(/Choose at least/);
    expect(() => mergeQuotationProposal(quote(), [item()], ["proposal-1", "proposal-1"])).toThrow(/only once/);
    expect(() => mergeQuotationProposal(quote(), [item()], ["unknown"])).toThrow(/unavailable/);
    expect(() =>
      mergeQuotationProposal(
        quote({ lines: Array.from({ length: 300 }, (_, index) => line({ id: `l-${index}`, scopeId: `s-${index}` })) }),
        [item({ line: line({ scopeId: "new" }) })],
        ["proposal-1"],
      ),
    ).toThrow(/300 items/);
  });

  it("reports actionable blockers and warnings without changing the submit contract", () => {
    const readiness = quotationComposerReadiness(
      quote({
        validUntil: "2020-01-01",
        paymentTerms: [],
        lines: [
          line({ rate: 0, catalogPrice: {
            status: "price_required", source: "catalog", mode: "on_request", catalogId: "catalog",
            work: { id: "work", version: 1 }, quantity: 2, currency: "AED", pricingDate: "2026-09-15",
            taxRate: 5, resolvedAt: "2026-09-15T00:00:00.000Z", issue: { code: "price_required", message: "Confirm price." },
          } }),
          line({ id: "custom", scopeId: undefined, title: "One-off feature", rate: 50 }),
        ],
      }),
      { confirmed: false, current: false },
      "2026-09-15",
    );
    expect(readiness.readyForReview).toBe(false);
    expect(readiness.blockers.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["CONFIRM_DEFINITION", "CONFIRM_PRICE", "ADD_SELLING_RATE", "ADD_PAYMENT_TERMS", "UPDATE_VALIDITY"]),
    );
    expect(readiness.warnings.map((issue) => issue.code)).toContain("CUSTOM_ITEM");
  });

  it("compares revision changes by durable scope/catalog identity", () => {
    const before = quote({ id: "old", lines: [line()], total: 200 });
    const current = quote({ lines: [line({ quantity: 3 }), line({ id: "new", scopeId: "scope-2" })], total: 450 });
    expect(compareQuotationRevisions(current, before)).toEqual({
      previousQuoteId: "old", added: 1, removed: 0, changed: 1, totalDelta: 250,
    });
  });
});
