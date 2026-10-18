import { describe, expect, it } from "vitest";
import { expectedWindow, fulfilmentPlan, type FulfilmentFacts } from "./deal-fulfilment";
import { FURNITURE_RULES, ruleFor, type FulfilmentRule } from "./fulfilment-rules";

const rules = FURNITURE_RULES.map((rule) => ({ ...rule, version: 1 })) as FulfilmentRule[];
// A Sunday-to-Thursday week (a region pack's), with one holiday.
const calendar = { workingDays: [0, 1, 2, 3, 4], holidays: ["2026-10-07"] };
const facts = (patch: Partial<FulfilmentFacts> = {}): FulfilmentFacts => ({
  wonAt: "2026-10-01T09:00:00.000Z", collectedAt: null, deliveredAt: null, transfer: { requestedAt: null, at: null }, deliveryOn: null, deliveryBookedAt: null,
  supplierOrders: { placed: 0, firstPlacedAt: null, received: 0, lastReceivedAt: null },
  production: { projectId: null, drawingApprovedAt: null, slotOn: null, slotAt: null, total: 0, started: 0, ready: 0, firstStartedAt: null, lastReadyAt: null },
  catalogueDays: null, cancelledAt: null, ...patch,
});

describe("Furniture Only fulfilment (PLM-126)", () => {
  it("counts lead times in the region's working days and the firm's holidays", () => {
    // Thursday 1 Oct + 3–4 working days: Sun 4, Mon 5, Tue 6, (Wed 7 holiday), Thu 8.
    expect(expectedWindow({ leadMinDays: 3, leadMaxDays: 4, leadFromCatalogue: false }, "2026-10-01", null, calendar)).toEqual({ from: "2026-10-06", by: "2026-10-08" });
    // The catalogue's own time stretches it (Teddy rugs: 7–10 from the supplier).
    expect(expectedWindow({ leadMinDays: 3, leadMaxDays: 4, leadFromCatalogue: true }, "2026-10-01", 10, calendar)).toEqual({ from: "2026-10-18", by: "2026-10-18" });
    expect(expectedWindow({ leadMinDays: null, leadMaxDays: null, leadFromCatalogue: true }, "2026-10-01", null, calendar)).toBeNull();
    expect(expectedWindow({ leadMinDays: 0, leadMaxDays: 0, leadFromCatalogue: false }, "2026-10-01T10:00:00Z", null, calendar)).toEqual({ from: "2026-10-01", by: "2026-10-01" });
  });

  it("A: paid, then collected the same day", () => {
    const open = fulfilmentPlan("take_home_now", ruleFor(rules, "take_home_now"), facts(), calendar, "2026-10-01");
    expect(open.steps).toEqual([{ key: "paid", state: "done", at: "2026-10-01T09:00:00.000Z" }, { key: "collected", state: "current", at: null }]);
    expect(open).toMatchObject({ late: false, handedOver: false, expected: { from: "2026-10-01", by: "2026-10-01" } });
    expect(fulfilmentPlan("take_home_now", ruleFor(rules, "take_home_now"), facts(), calendar, "2026-10-04").late).toBe(true);
    expect(fulfilmentPlan("take_home_now", ruleFor(rules, "take_home_now"), facts({ collectedAt: "2026-10-01T10:00:00Z" }), calendar, "2026-10-04")).toMatchObject({ late: false, handedOver: true });
  });

  it("B: a transfer from the factory only when asked, then the booked delivery", () => {
    const rule = ruleFor(rules, "in_stock_delivery");
    expect(fulfilmentPlan("in_stock_delivery", rule, facts(), calendar, "2026-10-02").steps.map((step) => step.key)).toEqual(["delivery_booked", "delivered"]);
    const asked = fulfilmentPlan("in_stock_delivery", rule, facts({ transfer: { requestedAt: "2026-10-01T10:00:00Z", at: null } }), calendar, "2026-10-02");
    expect(asked.steps.map((step) => [step.key, step.state])).toEqual([["transfer", "current"], ["delivery_booked", "pending"], ["delivered", "pending"]]);
    const booked = fulfilmentPlan("in_stock_delivery", rule, facts({ transfer: { requestedAt: "2026-10-01T10:00:00Z", at: "2026-10-04T08:00:00Z" }, deliveryBookedAt: "2026-10-04T09:00:00Z" }), calendar, "2026-10-09");
    expect(booked.steps.map((step) => step.state)).toEqual(["done", "done", "current"]);
    expect(booked.late).toBe(true);
  });

  it("C: ordered, received, then collected or delivered", () => {
    const rule = ruleFor(rules, "supplier_order");
    const plan = fulfilmentPlan("supplier_order", rule, facts({ supplierOrders: { placed: 1, firstPlacedAt: "2026-10-01T12:00:00Z", received: 1, lastReceivedAt: "2026-10-05T12:00:00Z" },
      collectedAt: "2026-10-06T08:00:00Z", catalogueDays: 7 }), calendar, "2026-10-20");
    expect(plan.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(plan).toMatchObject({ handedOver: true, late: false });
  });

  it("E: counts from the drawing approval; nothing is current once the order is cancelled", () => {
    const rule = ruleFor(rules, "bespoke");
    const waiting = fulfilmentPlan("bespoke", rule, facts(), calendar, "2026-12-01");
    expect(waiting).toMatchObject({ expected: null, late: false });
    const made = fulfilmentPlan("bespoke", rule, facts({ production: { projectId: "p", drawingApprovedAt: "2026-10-04T08:00:00Z", slotOn: "2026-10-10", slotAt: "2026-10-05T08:00:00Z",
      total: 2, started: 2, ready: 1, firstStartedAt: "2026-10-11T08:00:00Z", lastReadyAt: null } }), calendar, "2026-10-12");
    expect(made.steps.map((step) => [step.key, step.state])).toEqual([["drawing_approved", "done"], ["slot_booked", "done"], ["in_production", "done"], ["ready", "current"],
      ["delivery_booked", "pending"], ["delivered", "pending"]]);
    expect(made.expected).toEqual({ from: "2026-11-02", by: "2026-11-16" });
    const cancelled = fulfilmentPlan("bespoke", rule, facts({ cancelledAt: "2026-10-05T08:00:00Z" }), calendar, "2026-12-01");
    expect(cancelled).toMatchObject({ cancelled: true, late: false });
    expect(cancelled.steps.every((step) => step.state === "pending")).toBe(true);
  });
});
