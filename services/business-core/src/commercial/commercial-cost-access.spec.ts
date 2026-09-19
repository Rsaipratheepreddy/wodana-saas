import { describe, expect, it } from "vitest";
import type { CommercialData, Quote, QuoteLine } from "./commercial.types";
import { commercialDataForCostAccess, manualLineAuthorizations, preserveUnauthorizedCosts } from "./commercial.service";

const line = (id: string, unitCost: number): QuoteLine => ({ id, room: "Kitchen", title: "Cabinet", specification: "", material: "", finish: "", quantity: 1, unit: "nos", unitCost, rate: 100 });
const quote = (lines: QuoteLine[]): Quote => ({ id: "quote", number: 1, kind: "quotation", status: "draft", title: "Quote", currency: "AED", validUntil: "2026-12-31", discount: 0, taxRate: 0, terms: "", exclusions: "", lines, requestIds: [], paymentTerms: [], createdAt: "2026-09-18", total: 100 });

describe("commercial cost permissions", () => {
  it("redacts internal costs and frozen deal margin without mutating server truth", () => {
    const data = { quotes: [quote([line("line", 65)])], requests: [], agreement: null, payments: [], audit: [], revision: 1, dealFile: { id: "deal", reference: "D1", revision: 1, ownerReviewId: "review", quoteId: "quote", quoteNumber: 1, quoteHash: "hash", agreementReference: "A1", paymentIds: [], value: 100, cost: 65, margin: 35, commission: 0, status: "active", approvedAt: "2026-09-18", approvedBy: "Owner" } } as CommercialData;
    const visible = commercialDataForCostAccess(data, false);
    expect(visible.quotes[0].lines[0].unitCost).toBe(0);
    expect(visible.dealFile).toMatchObject({ cost: 0, margin: 0 });
    expect(data.quotes[0].lines[0].unitCost).toBe(65);
    expect(commercialDataForCostAccess(data, true)).toBe(data);
  });

  it("preserves stored costs and drops injected new-line costs without manage permission", () => {
    const incoming = [line("existing", 999), line("new", 999)];
    preserveUnauthorizedCosts(incoming, new Map([["existing", line("existing", 65)]]), false);
    expect(incoming.map((item) => item.unitCost)).toEqual([65, 0]);
    const permitted = [line("existing", 80)];
    preserveUnauthorizedCosts(permitted, new Map([["existing", line("existing", 65)]]), true);
    expect(permitted[0].unitCost).toBe(80);
  });

  it("requires a fresh authorization only when a manual line or its reason is introduced", () => {
    const legacy = line("legacy", 0);
    const previous = new Map([[legacy.id, legacy]]);
    expect(manualLineAuthorizations([legacy], previous)).toEqual([]);
    const authorized = { ...line("manual", 0), manualReason: "Client-requested one-off work" };
    expect(manualLineAuthorizations([authorized], previous)).toEqual([authorized]);
    expect(() => manualLineAuthorizations([{ ...authorized, catalogLinks: [{ role: "work", recordId: "work", version: 1, snapshot: { id: "work", name: "Work", code: "W", kind: "work", version: 1, catalogId: "catalog" } }] }], previous)).toThrow(/belongs only/);
  });
});
