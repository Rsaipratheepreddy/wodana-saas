import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Dec } from "../catalog-core/decimal";
import { rankAlternatives } from "../client-portal/portal-alternatives";
import { feedCards, whatChanged, type FeedSource } from "../client-portal/portal-feed";
import { budgetTracker, ChangeRuleError, cleanDraft, cleanLine, impactLine, nextStatus, priceImpact, submitProblem } from "./change-request.domain";

const line = (overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), source: "custom", action: "add", title: "Extra shelf", quantity: "2", unitPrice: "450.50", ...overrides });

describe("change request lines (§6.20)", () => {
  it("prices lines exactly: quantity × rate, an omission takes it off, a replacement states its net", () => {
    expect(cleanLine(line(), 0).amount).toBe("901.00");
    expect(cleanLine(line({ source: "quote_line", action: "omit", quoteId: "q1", quoteLineId: "b", quantity: "2.25", unitPrice: "800" }), 0).amount).toBe("-1800.00");
    expect(cleanLine(line({ action: "replace", amount: "-120.35", quantity: undefined, unitPrice: undefined }), 0).amount).toBe("-120.35");
    expect(cleanLine(line({ source: "allowance", action: "draw", quoteId: "q1", quoteLineId: "x", quantity: "1", unitPrice: "0.10" }), 0).amount).toBe("0.10");
    // 0.1 + 0.2 in floats is 0.30000000000000004; here it is exact.
    expect(priceImpact([{ amount: "0.10" }, { amount: "0.20" }])).toBe("0.30");
  });

  it("refuses lines that don't say what they change", () => {
    expect(() => cleanLine(line({ source: "nope" }), 0)).toThrow(ChangeRuleError);
    expect(() => cleanLine(line({ source: "allowance", action: "add", quoteId: "q", quoteLineId: "l" }), 0)).toThrow(/only an allowance/);
    expect(() => cleanLine(line({ quantity: "-1" }), 2)).toThrow(/Line 3: quantity/);
    expect(() => cleanLine(line({ unitPrice: "1.234" }), 0)).toThrow(/two decimals/);
    expect(() => cleanLine(line({ source: "quote_line", action: "omit" }), 0)).toThrow(/quote line/);
    expect(() => cleanLine(line({ source: "ledger", action: "replace" }), 0)).toThrow(/changed material/);
    expect(() => cleanLine(line({ action: "replace", amount: "abc" }), 0)).toThrow(/replacement/);
    const id = randomUUID();
    expect(() => cleanDraft({ title: "Two", lines: [line({ id }), line({ id })] })).toThrow(/share an id/);
    expect(() => cleanDraft({ title: "", lines: [] })).toThrow(/Name the change/);
    expect(() => cleanDraft({ title: "Late", timeImpactDays: 1.5 })).toThrow(/whole number/);
    expect(submitProblem({ title: "x", timeImpactDays: 0, designImpact: "", lines: [] })).toMatch(/Add what changes/);
    expect(submitProblem({ title: "x", timeImpactDays: 3, designImpact: "", lines: [] })).toBeNull();
  });

  it("moves through its states only forward: draft → approval → client → decided; declined is final", () => {
    expect(nextStatus("draft", "submit")).toBe("pending_approval");
    expect(nextStatus("pending_approval", "returned")).toBe("draft");
    expect(nextStatus("pending_approval", "internal_approved")).toBe("with_client");
    expect(nextStatus("with_client", "client_approved")).toBe("approved");
    expect(() => nextStatus("declined", "client_approved")).toThrow(/fresh assessment/);
    expect(() => nextStatus("approved", "withdraw")).toThrow(/already approved/);
    expect(() => nextStatus("pending_approval", "edit")).toThrow(/waiting for approval/);
    expect(impactLine("-1250.5", -3, "AED")).toBe("-1250.50 AED · -3 days");
    expect(impactLine("0", 0, "INR")).toBe("No price or time impact");
  });
});

describe("R1 budget tracker", () => {
  it("adds approved changes and allowance overruns to the agreed value, in exact decimals, and keeps pending ones apart", () => {
    const budget = budgetTracker({
      currency: "AED",
      agreed: [{ id: "q1", title: "Main", amount: "100000.10", decidedAt: "2026-09-20T10:00:00Z" }],
      variations: [{ id: "v1", title: "Extra lights", amount: "1500.20", decidedAt: "2026-09-25T10:00:00Z" }, { id: "v2", title: "No shelf", amount: "-300", decidedAt: "2026-09-26T10:00:00Z" }],
      changes: [{ id: "c1", reference: "CR-001", title: "Marble upgrade", amount: "2600.00", draw: "600.00", decidedAt: "2026-10-01T10:00:00Z", method: "signed_link" }],
      pending: [{ id: "c2", reference: "CR-002", title: "Wallpaper", amount: "900", status: "with_client" }],
      allowances: [{ lineId: "a1", title: "Lighting allowance", included: "500.00", spent: "600.00" }, { lineId: "a2", title: "Tiles allowance", included: "2000", spent: "0" }],
    });
    expect(budget).toMatchObject({ agreed: "100000.10", changesTotal: "3200.20", allowanceIncluded: "2500.00", allowanceSpent: "600.00", allowanceOverrun: "100.00",
      pendingTotal: "900.00", forecast: "103300.30" });
    expect(budget.changes.map((item) => [item.kind, item.amount])).toEqual([["variation", "1500.20"], ["variation", "-300.00"], ["change_request", "2000.00"]]);
    expect(budget.allowances).toEqual([
      { lineId: "a1", title: "Lighting allowance", included: "500.00", spent: "600.00", over: "100.00", left: "0.00" },
      { lineId: "a2", title: "Tiles allowance", included: "2000.00", spent: "0.00", over: "0.00", left: "2000.00" }]);
    // Never a float: the same sums as decimals.
    expect(Dec.of(budget.forecast).cmp(Dec.of("100000.10").add("1500.20").sub("300").add("2000").add("100"))).toBe(0);
    expect(JSON.stringify(budget)).not.toMatch(/cost|margin|markup/i);
  });
});

describe("R2 alternatives", () => {
  it("ranks in stock first, then in budget, then past jobs, then the nearest price; at most three", () => {
    const ranked = rankAlternatives([
      { itemId: "a", title: "Pricey", unit: "sqm", price: "200", onHand: "0", pastJobs: 0 },
      { itemId: "b", title: "In stock, dear", unit: "sqm", price: "150", onHand: "50", pastJobs: 0 },
      { itemId: "c", title: "Cheap, used before", unit: "sqm", price: "70", onHand: "0", pastJobs: 2 },
      { itemId: "d", title: "Cheap", unit: "sqm", price: "75", onHand: "0", pastJobs: 0 },
      { itemId: "e", title: "No price", unit: "sqm", price: null, onHand: "0", pastJobs: 0 },
    ], { quantity: "12.5", total: Dec.of("1000") });
    expect(ranked.map((item) => [item.itemId, item.inStock, item.inBudget])).toEqual([["b", true, false], ["c", false, true], ["d", false, true]]);
    expect(ranked[1].total!.toFixed(2)).toBe("875.00");
  });
});

describe("AI2 feed and digest", () => {
  const project: FeedSource = {
    progress: { updates: [{ id: "u1", at: "2026-10-05T09:00:00.000Z", text: "Tiles in" }], cards: [{ id: "d1", date: "2026-10-06", sentAt: "2026-10-06T15:00:00.000Z", summary: "Grouting" }] },
    design: { designs: [{ title: "Kitchen", versions: [{ id: "v2", number: 2, status: "client_review", sharedAt: "2026-10-06T08:00:00.000Z" }] }] },
    choices: null,
    decisions: { quotes: [{ id: "q", title: "Main", number: 1, status: "accepted", issuedAt: "2026-09-01T00:00:00.000Z" }], handovers: [] },
    documents: [{ id: "x", kind: "design", title: "Kitchen", date: "2026-10-04", version: 2, changed: true }],
    payments: { milestones: [{ id: "m", title: "Advance", status: "paid", left: "0.00", invoice: { id: "i", number: "INV-1", issueDate: "2026-09-02" }, receipts: [{ id: "r", amount: "100.00", receivedOn: "2026-09-03" }] }] },
    messages: { requests: [{ id: "t", title: "Socket", comments: [{ id: "c1", at: "2026-10-06T10:00:00.000Z", text: "Hi", fromClient: true }, { id: "c2", at: "2026-10-06T11:00:00.000Z", text: "Done", fromClient: false }] }] },
    changes: [{ id: "cr", reference: "CR-001", title: "Shelf", status: "waiting", sharedAt: "2026-10-06T12:00:00.000Z", decidedAt: null, createdAt: "2026-10-05T00:00:00.000Z", raisedByClient: false },
      { id: "mine", reference: "CR-002", title: "Mine", status: "with_team", sharedAt: null, decidedAt: null, createdAt: "2026-10-06T13:00:00.000Z", raisedByClient: true }],
  };

  it("orders typed cards newest first", () => {
    expect(feedCards(project).map((card) => card.kind)).toEqual(["day", "change", "change", "reply", "design", "update", "document", "payment", "invoice", "quote"]);
    expect(feedCards(project).find((card) => card.kind === "document")).toMatchObject({ note: "V2", status: "changed" });
  });

  it("counts what happened since the last visit, nothing on a first visit, never the client's own request", () => {
    expect(whatChanged(project, null)).toBeNull();
    expect(whatChanged(project, "2026-10-05T12:00:00.000Z")!.items).toEqual([
      { kind: "day", count: 1, titles: ["2026-10-06"] }, { kind: "change", count: 1, titles: ["CR-001 · Shelf"] }, { kind: "reply", count: 1, titles: ["Socket"] },
      { kind: "design", count: 1, titles: ["Kitchen · V2"] }]);
  });
});
