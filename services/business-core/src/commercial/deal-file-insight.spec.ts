import { describe, expect, it } from "vitest";
import { acceptedQuoteTotals } from "./commercial.domain";
import { dealMoney, dealRisks, dealSections, type DealLive } from "./deal-file-insight";
import type { CommercialData, DealFile, Quote } from "./commercial.types";

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: "q-main", number: 5, kind: "quotation", status: "accepted", round: "main", title: "Main", currency: "AED", validUntil: "2026-10-12", discount: 0, taxRate: 5,
  terms: "", exclusions: "", total: 105000.3, lines: [{ id: "l1", room: "Kitchen", title: "Cabinets", quantity: 1, unit: "nos", unitCost: 60000, rate: 100000 } as never],
  requestIds: [], paymentTerms: [], createdAt: "2026-10-01T00:00:00.000Z", ...over,
} as Quote);
const dealFile = (over: Partial<DealFile> = {}): DealFile => ({
  id: "df", reference: "DF-2026-1", revision: 1, ownerReviewId: "r", quoteId: "q-main", quoteNumber: 5, quoteHash: "h", agreementReference: "A-1", paymentIds: [],
  value: 105000.3, cost: 60000, margin: 40, commission: 0, commissionLines: [], enquiryReference: "E-0004", status: "active", approvedAt: "2026-10-04T00:00:00.000Z", approvedBy: "Cece", ...over,
});
const data = (over: Partial<CommercialData> = {}): CommercialData => ({
  revision: 1, quotes: [quote({ id: "q-design", number: 2, round: "design", total: 15000 }), quote()], requests: [], agreement: null,
  audit: [{ id: "a", at: "", actor: "", action: "approve", note: "" }], release: null,
  payments: [
    { id: "p0", sourceQuoteId: "q-design", title: "Design fee", amount: 15000, dueDate: "2026-09-20", requiredForRelease: true, status: "verified", proof: "", reference: "" },
    { id: "p1", sourceQuoteId: "q-main", title: "Deposit 50%", amount: 52500.15, dueDate: "2026-10-05", requiredForRelease: true, status: "verified", proof: "", reference: "" },
    { id: "p2", sourceQuoteId: "q-main", title: "Balance before installation", amount: 52500.15, dueDate: "2026-11-30", requiredForRelease: false, status: "pending", proof: "", reference: "" },
  ],
  dealFile: dealFile(), ...over,
});
const live = (over: Partial<DealLive> = {}): DealLive => ({
  caseId: "c", opportunityId: "o", projectId: null, flow: null, furniturePath: null, materialsChange: false, proofCount: 1, designStages: {}, boqLines: 0,
  workOrders: { total: 0, ready: 0, drawingsApproved: 0 }, supplierOrders: { total: 0, arrived: 0 }, fulfilment: { collected: 0, delivered: 0, installed: 0 }, proposals: [], ...over,
});

describe("Deal File money (PLM-066)", () => {
  it("shows agreed, paid and outstanding per proposal and in total, exactly, with the next payment due", () => {
    const money = dealMoney(data());
    expect(money).toMatchObject({ currency: "AED", agreed: "120000.30", received: "67500.15", outstanding: "52500.15" });
    expect(money.rounds).toEqual([
      { round: "design", quoteNumber: 2, agreed: "15000.00", received: "15000.00", outstanding: "0.00" },
      { round: "main", quoteNumber: 5, agreed: "105000.30", received: "52500.15", outstanding: "52500.15" },
    ]);
    expect(money.nextDue).toEqual({ title: "Balance before installation", amount: "52500.15", dueDate: "2026-11-30" });
  });

  it("never shows an overpayment as a negative balance", () => {
    const over = data({ payments: [{ id: "x", sourceQuoteId: "q-main", title: "All", amount: 200000, dueDate: "", requiredForRelease: true, status: "verified", proof: "", reference: "" }] });
    expect(dealMoney(over).rounds[1].outstanding).toBe("0.00");
  });
});

describe("Deal File checks", () => {
  it("names what a reviewer looks for", () => {
    expect(dealRisks(data({ payments: [] }), { marginFloorPercent: "45", proofCount: 0, outstanding: "1" }))
      .toEqual(["payment_proof_missing", "commission_missing", "margin_below_floor", "balance_outstanding"]);
    expect(dealRisks(data({ dealFile: dealFile({ commissionLines: [{ recipientName: "A", type: "sales", basis: "percent", value: 2, amount: 2100 }] as never }) }),
      { marginFloorPercent: "30", proofCount: 1, outstanding: "0" })).toEqual([]);
  });
});

describe("Deal File margin", () => {
  it("never measures a margin when a charged line has no cost", () => {
    const lines = [{ id: "l1", room: "Kitchen", title: "Cabinets", quantity: 1, unit: "nos", unitCost: 90000, rate: 100000 },
      { id: "l2", room: "Kitchen", title: "Worktop", quantity: 1, unit: "nos", unitCost: 0, rate: 100000 }] as never;
    const partial = data({ quotes: [quote({ lines, total: 200000 })] });
    expect(acceptedQuoteTotals(partial.quotes[0])).toMatchObject({ costMissing: true });
    expect(dealRisks(partial, { marginFloorPercent: "60", proofCount: 1, outstanding: "0" })).not.toContain("margin_below_floor");
    const costed = data({ quotes: [quote({ lines: [(lines as unknown as Array<Record<string, unknown>>)[0]] as never, total: 100000 })] });
    expect(acceptedQuoteTotals(costed.quotes[0])).toMatchObject({ costMissing: false, margin: 10 });
    expect(dealRisks(costed, { marginFloorPercent: "60", proofCount: 1, outstanding: "0" })).toContain("margin_below_floor");
  });
});

describe("Deal File contents per enquiry type (PLM-123)", () => {
  const keys = (sections: ReturnType<typeof dealSections>) => sections.map((section) => section.key);
  it("holds the common part for every type, each linking to its live record", () => {
    const sections = dealSections(data(), live(), null);
    expect(keys(sections)).toEqual(["enquiry", "client", "quotation", "payment_proofs", "finance_values", "commission", "approval", "history"]);
    expect(sections.find((section) => section.key === "quotation")?.href).toBe("/workspace/pre-projects/cases/c/quotations");
    expect(sections.find((section) => section.key === "payment_proofs")?.href).toBe("/workspace/crm/opportunities?record=o");
  });

  it("adds the furniture path's sections: drawing for D/E, supplier orders for C, collection only for A", () => {
    expect(keys(dealSections(data(), live({ flow: "furniture", furniturePath: "take_home_now" }), null)).slice(8)).toEqual(["items", "collection"]);
    expect(keys(dealSections(data(), live({ flow: "furniture", furniturePath: "supplier_order" }), null)).slice(8)).toEqual(["items", "collection_delivery", "supplier_orders", "proof_of_delivery"]);
    const bespoke = dealSections(data(), live({ flow: "furniture", furniturePath: "bespoke", materialsChange: true, fulfilment: { collected: 0, delivered: 1, installed: 0 } }), null);
    expect(keys(bespoke).slice(8)).toEqual(["items", "collection_delivery", "approved_drawing", "materials_approval", "proof_of_delivery"]);
    expect(bespoke.find((section) => section.key === "proof_of_delivery")?.state).toBe("present");
  });

  it("follows the order's path: a supplier or in-stock order lists no BOQ, drawings or production, and the permit once", () => {
    const delivered = { design: false, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: false, installation: true };
    const permit = { required: true, collected: false, planned: false };
    for (const projectId of [null, "p"]) {
      const supplier = dealSections(data(), live({ projectId, flow: "furniture", furniturePath: "supplier_order", permit }), delivered);
      expect(keys(supplier).slice(8)).toEqual(["items", "collection_delivery", "supplier_orders", "building_permit", "proof_of_delivery"]);
    }
    expect(keys(dealSections(data(), live({ flow: "furniture", furniturePath: "in_stock_delivery" }), delivered)).slice(8)).toEqual(["items", "collection_delivery", "proof_of_delivery"]);
    // Before a path is chosen, a scope without manufacturing makes nothing either.
    expect(keys(dealSections(data(), live({ flow: "furniture" }), delivered))).not.toContain("production");
    // The order's own BOQ choice still asks for one.
    expect(keys(dealSections(data(), live({ flow: "furniture", furniturePath: "supplier_order", boqRequired: true }), delivered))).toContain("boq");
    // A made piece keeps its production part, and the permit is listed once.
    const made = keys(dealSections(data(), live({ flow: "furniture", furniturePath: "bespoke", permit }), { ...delivered, manufacturing: true }));
    expect(made).toEqual(expect.arrayContaining(["boq", "technical_drawings", "production"]));
    expect(made.filter((key) => key === "building_permit")).toHaveLength(1);
  });

  it("counts a payment Finance verified as the payment proof", () => {
    const section = (over: Partial<DealLive>, value = data()) => dealSections(value, live(over), null).find((item) => item.key === "payment_proofs")?.state;
    expect(section({ proofCount: 0 })).toBe("present");
    expect(section({ proofCount: 0 }, data({ payments: [] }))).toBe("missing");
  });

  it("counts the project's client-approved technical drawings as the approved drawing, before any work order records one", () => {
    const state = (over: Partial<DealLive>, key: string) => dealSections(data(), live({ projectId: "p", flow: "furniture", furniturePath: "bespoke", ...over }),
      { design: false, mainQuotation: false, materialSelection: false, procurement: false, manufacturing: true, siteWorks: false, installation: false })
      .find((section) => section.key === key)?.state;
    expect(state({}, "approved_drawing")).not.toBe("present");
    expect(state({ drawingsClientApproved: true }, "approved_drawing")).toBe("present");
    expect(state({ workOrders: { total: 2, ready: 0, drawingsApproved: 0 } }, "technical_drawings")).not.toBe("present");
    expect(state({ workOrders: { total: 2, ready: 0, drawingsApproved: 0 }, drawingsClientApproved: true }, "technical_drawings")).toBe("present");
  });

  it("adds Full ID's design stages, and Proposal 2 with production for ID & Furniture", () => {
    const scope = { design: true, mainQuotation: true, materialSelection: true, procurement: false, manufacturing: true, siteWorks: false, installation: true };
    const sections = dealSections(data(), live({ projectId: "p", designStages: { inspiration: "done", site_visit: "done", concepts: "active", material_selection: "locked", approval: "locked" },
      proposals: [{ kind: "design", valueStatus: "approved", wonAt: "2026-09-20" }, { kind: "main", valueStatus: "entered", wonAt: null }] }), scope);
    expect(keys(sections).slice(8)).toEqual(["design_fee_proposal", "inspiration", "site_visit", "concepts", "material_list", "design_approval",
      "main_quotation", "boq", "technical_drawings", "production", "delivery_installation", "proof_of_delivery"]);
    expect(sections.find((section) => section.key === "concepts")).toMatchObject({ state: "open", href: "/workspace/pre-projects/cases/c/designs" });
    expect(sections.find((section) => section.key === "main_quotation")?.state).toBe("present");
    expect(sections.find((section) => section.key === "boq")?.href).toBe("/workspace/projects/p");
  });
});
