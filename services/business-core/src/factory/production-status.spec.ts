import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCTION_STEPS, normaliseProductionSteps, orderStep, parseProductionSteps, parseProductionWeeks, projectProduction, visibleStep, type ProjectOrder,
} from "./production-status";

const order = (patch: Partial<ProjectOrder>): ProjectOrder => ({
  status: "planned", heldFrom: null, pending: "0", toCheck: "0", left: "4", plannedStart: "2026-10-01", plannedEnd: "2026-10-20", startedOn: null, readyOn: null, ...patch,
});

describe("production status (PLM-063)", () => {
  it("reads each work order's step from its state and output", () => {
    expect(orderStep(order({ status: "planned" }))).toBe("scheduled");
    expect(orderStep(order({ status: "released" }))).toBe("scheduled");
    expect(orderStep(order({ status: "in_production", left: "2" }))).toBe("in_production");
    // Everything made: waiting for its approval or its check.
    expect(orderStep(order({ status: "in_production", left: "0", pending: "4" }))).toBe("quality_check");
    expect(orderStep(order({ status: "in_production", left: "0", toCheck: "1" }))).toBe("quality_check");
    expect(orderStep(order({ status: "ready", left: "0" }))).toBe("ready");
    expect(orderStep(order({ status: "short_closed" }))).toBe("ready");
    expect(orderStep(order({ status: "on_hold", heldFrom: "in_production" }))).toBe("in_production");
    expect(orderStep(order({ status: "on_hold", heldFrom: "released" }))).toBe("scheduled");
    expect(orderStep(order({ status: "cancelled" }))).toBeNull();
  });

  it("shows a kind as the last step the firm keeps at or before it", () => {
    const noCheck = [{ kind: "scheduled", label: "" }, { kind: "in_production", label: "Making" }, { kind: "ready", label: "" }] as const;
    expect(visibleStep("quality_check", [...noCheck])).toEqual({ kind: "in_production", label: "Making" });
    expect(visibleStep("scheduled", [{ kind: "in_production", label: "" }, { kind: "ready", label: "" }])).toEqual({ kind: "in_production", label: "" });
  });

  it("takes the project's least advanced work order, and Ready only when everything is made", () => {
    const steps = DEFAULT_PRODUCTION_STEPS;
    const orders = [order({ status: "ready", left: "0", startedOn: "2026-10-02", readyOn: "2026-10-15" }), order({ status: "in_production", left: "1", startedOn: "2026-10-03", plannedEnd: "2026-10-25" })];
    const running = projectProduction(orders, { steps, today: "2026-10-10", slotOn: null, allMade: false, targetWeeks: null });
    expect(running.step?.kind).toBe("in_production");
    expect(running.planned).toEqual({ start: "2026-10-01", end: "2026-10-25", days: 25 });
    expect(running.actual).toEqual({ start: "2026-10-02", end: null, days: 9 });
    expect(running).toMatchObject({ late: false, orders: 2, ready: 1, held: false });
    // All work orders ready but a line still to plan: not ready yet.
    const ready = [order({ status: "ready", left: "0", startedOn: "2026-10-02", readyOn: "2026-10-22" })];
    expect(projectProduction(ready, { steps, today: "2026-10-23", slotOn: null, allMade: false, targetWeeks: null }).step?.kind).toBe("quality_check");
    const done = projectProduction(ready, { steps, today: "2026-10-23", slotOn: null, allMade: true, targetWeeks: 2 });
    expect(done.step?.kind).toBe("ready");
    expect(done.actual).toEqual({ start: "2026-10-02", end: "2026-10-22", days: 21 });
    // Finished two days after its planned end, and over the firm's two-week target.
    expect(done).toMatchObject({ late: true, overTarget: true });
  });

  it("is late once today passes the planned finish, plans from the factory slot, and has no step before any work order", () => {
    expect(projectProduction([order({})], { steps: DEFAULT_PRODUCTION_STEPS, today: "2026-10-21", slotOn: null, allMade: false, targetWeeks: null }).late).toBe(true);
    const none = projectProduction([], { steps: DEFAULT_PRODUCTION_STEPS, today: "2026-10-21", slotOn: "2026-11-01", allMade: false, targetWeeks: null });
    expect(none).toMatchObject({ step: null, planned: { start: "2026-11-01", end: null, days: null }, actual: { start: null, end: null, days: null }, late: false, orders: 0 });
    expect(projectProduction([order({ status: "cancelled" })], { steps: DEFAULT_PRODUCTION_STEPS, today: "2026-10-21", slotOn: null, allMade: false, targetWeeks: null }).orders).toBe(0);
  });

  it("keeps the firm's steps valid: known kinds in order, each once, ending with Ready", () => {
    expect(parseProductionSteps([{ kind: "in_production", label: " Making " }, { kind: "ready", label: "" }])).toEqual([{ kind: "in_production", label: "Making" }, { kind: "ready", label: "" }]);
    expect(() => parseProductionSteps([{ kind: "ready" }])).toThrow("between 2 and 4");
    expect(() => parseProductionSteps([{ kind: "ready" }, { kind: "scheduled" }])).toThrow("their order");
    expect(() => parseProductionSteps([{ kind: "scheduled" }, { kind: "in_production" }])).toThrow("ends with Ready");
    expect(() => parseProductionSteps([{ kind: "scheduled" }, { kind: "scheduled" }, { kind: "ready" }])).toThrow("once");
    expect(() => parseProductionSteps([{ kind: "painting" }, { kind: "ready" }])).toThrow("Unknown");
    expect(normaliseProductionSteps("nonsense")).toEqual(DEFAULT_PRODUCTION_STEPS);
    expect(normaliseProductionSteps([{ kind: "ready", label: "Done" }, { kind: "scheduled", label: "" }])).toEqual([{ kind: "scheduled", label: "" }, { kind: "ready", label: "Done" }]);
    expect(parseProductionWeeks("8")).toBe(8);
    expect(parseProductionWeeks("")).toBeNull();
    expect(() => parseProductionWeeks(0)).toThrow("1 to 52");
  });
});
