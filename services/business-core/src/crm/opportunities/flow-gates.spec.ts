import { describe, expect, it } from "vitest";
import {
  clientTypeDecided, flowOf, moveBlockers, nextStepPlan, requirementsUpTo, stepForStage, stepRequirements, suggestedFlow,
  type FlowFacts, type FlowStep, type OpportunityFlow,
} from "./flow-gates";

/** Nothing done yet. */
const empty = (flow: OpportunityFlow): FlowFacts => ({
  flow, enquiryTypeResolved: true, clientTypeResolved: false, clientEmail: false, propertyLocation: false, floorPlanOrArea: false,
  introCompleted: false, discoveryMissing: [], furniturePath: null, feasibilityConfirmed: false, quotationExists: false, paymentProof: false,
});
/** Everything done. */
const complete = (flow: OpportunityFlow): FlowFacts => ({
  flow, enquiryTypeResolved: true, clientTypeResolved: true, clientEmail: true, propertyLocation: true, floorPlanOrArea: true,
  introCompleted: true, discoveryMissing: [], furniturePath: "take_home_now", feasibilityConfirmed: false, quotationExists: true, paymentProof: true,
});
const keys = (flow: OpportunityFlow, step: FlowStep, facts: FlowFacts) => stepRequirements(flow, step, facts).map((item) => item.key);
const STAGES = [
  { code: "qualified", position: 1 }, { code: "qualification", position: 2 }, { code: "proposal", position: 3 },
  { code: "negotiation", position: 4 }, { code: "won", position: 5 }, { code: "lost", position: 6 },
];
const at = (code: string) => STAGES.find((stage) => stage.code === code)!;
const move = (facts: FlowFacts, from: string, to: string, targetStatus = to === "won" ? "won" : "open") =>
  moveBlockers({ facts, from: at(from), to: at(to), firstPosition: 1, stages: STAGES, targetStatus }).map((item) => item.key);

describe("pipeline flow gates (PLM-121/122)", () => {
  describe("each flow × step on its own", () => {
    const table: Array<[OpportunityFlow, FlowStep, string[]]> = [
      ["design", "new", ["clientEmail", "propertyLocation", "floorPlanOrArea"]],
      ["design", "qualified", ["introMeeting", "clientType"]],
      ["design", "proposal", []],
      ["design", "negotiation", []],
      ["design", "won", ["paymentProof"]],
      ["fit_out", "new", ["clientEmail", "propertyLocation", "floorPlanOrArea"]],
      ["fit_out", "qualified", ["introMeeting", "clientType"]],
      ["fit_out", "proposal", []],
      ["fit_out", "negotiation", []],
      ["fit_out", "won", ["paymentProof"]],
      ["furniture", "new", []],
      ["furniture", "qualified", ["furniturePath", "clientType"]],
      ["furniture", "proposal", ["quotation"]],
      ["furniture", "negotiation", []],
      ["furniture", "won", ["paymentProof"]],
      ["basic", "new", []],
      ["basic", "qualified", []],
      ["basic", "proposal", []],
      ["basic", "negotiation", []],
      ["basic", "won", ["paymentProof"]],
    ];
    it.each(table)("%s · %s needs %j when nothing is done", (flow, step, expected) => {
      expect(keys(flow, step, empty(flow))).toEqual(expected);
    });
    it.each(table)("%s · %s needs nothing once everything is done", (flow, step) => {
      expect(keys(flow, step, complete(flow))).toEqual([]);
    });
  });

  it("keeps a 'not sure yet' enquiry in the first column whatever the flow (PLM-007)", () => {
    for (const flow of ["design", "fit_out", "furniture", "basic"] as const) {
      const facts = { ...complete(flow), enquiryTypeResolved: false };
      expect(move(facts, "qualified", "qualification")).toContain("enquiryType");
      expect(move(facts, "qualified", "won")).toContain("enquiryType");
    }
  });

  it("design and fit-out need the full discovery form for Proposal, without repeating earlier items", () => {
    const facts = { ...complete("design"), floorPlanOrArea: false, discoveryMissing: [
      { key: "floorPlan", label: "Floor plan" }, { key: "area", label: "Area" }, { key: "clientEmail", label: "Client email" }, { key: "question:style", label: "Style" },
    ] };
    expect(keys("design", "proposal", facts)).toEqual(["discovery:question:style"]);
    // With an area but no floor plan, the floor plan is still needed for Proposal.
    expect(keys("design", "proposal", { ...facts, floorPlanOrArea: true })).toEqual(["discovery:floorPlan", "discovery:area", "discovery:question:style"]);
  });

  it("furniture: no floor plan, area or intro; bespoke needs the factory's feasibility", () => {
    const facts = { ...empty("furniture"), clientTypeResolved: true, furniturePath: "bespoke" as const };
    expect(keys("furniture", "qualified", facts)).toEqual(["feasibility"]);
    expect(keys("furniture", "qualified", { ...facts, feasibilityConfirmed: true })).toEqual([]);
    for (const path of ["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory"] as const)
      expect(keys("furniture", "qualified", { ...facts, furniturePath: path })).toEqual([]);
  });

  it("checks every step a jump passes, cumulatively", () => {
    expect(requirementsUpTo("design", "won", empty("design")).map((item) => item.key))
      .toEqual(["clientEmail", "propertyLocation", "floorPlanOrArea", "introMeeting", "clientType", "paymentProof"]);
    expect(move(empty("furniture"), "qualified", "won")).toEqual(["furniturePath", "clientType", "quotation", "paymentProof"]);
    // Interior design straight to Won is refused until everything exists.
    expect(move(complete("design"), "qualified", "won")).toEqual([]);
    expect(move({ ...complete("design"), paymentProof: false }, "qualified", "won")).toEqual(["paymentProof"]);
  });

  it("lets furniture skip Negotiation: Proposal → Won needs only the proof", () => {
    const facts = { ...complete("furniture"), paymentProof: false };
    expect(move(facts, "proposal", "won")).toEqual(["paymentProof"]);
    expect(move(complete("furniture"), "proposal", "won")).toEqual([]);
  });

  it("always allows moving back, losing and reopening", () => {
    const facts = empty("design");
    expect(move(facts, "proposal", "qualified")).toEqual([]);
    expect(move(facts, "negotiation", "qualification")).toEqual([]);
    expect(move(facts, "proposal", "lost", "lost")).toEqual([]);
    expect(move(facts, "proposal", "proposal")).toEqual([]);
  });

  it("gives a custom column the needs of the known steps before it", () => {
    const stages = [{ code: "qualified", position: 1 }, { code: "proposal", position: 2 }, { code: "site_visit", position: 3 }, { code: "won", position: 4 }];
    const blockers = moveBlockers({ facts: empty("furniture"), from: stages[1], to: stages[2], firstPosition: 1, stages, targetStatus: "open" });
    expect(blockers.map((item) => item.key)).toEqual(["furniturePath", "clientType", "quotation"]);
    expect(stepForStage({ code: "anything", position: 1 }, 1)).toBe("new");
    expect(stepForStage({ code: "anything", position: 2 }, 1)).toBeNull();
  });

  it("plans the next step, skipping optional Negotiation for furniture", () => {
    expect(nextStepPlan({ facts: complete("furniture"), current: "proposal", status: "open" })).toMatchObject({ next: "won", skippable: true, missing: [] });
    expect(nextStepPlan({ facts: complete("design"), current: "proposal", status: "open" })).toMatchObject({ next: "negotiation", skippable: false });
    expect(nextStepPlan({ facts: empty("basic"), current: "negotiation", status: "open" }).missing.map((item) => item.key)).toEqual(["paymentProof"]);
    expect(nextStepPlan({ facts: complete("basic"), current: "won", status: "won" })).toMatchObject({ next: null, missing: [] });
  });

  it("reads flows and client types generically", () => {
    expect(flowOf("furniture")).toBe("furniture");
    expect(flowOf(null)).toBe("basic");
    expect(flowOf("something_else")).toBe("basic");
    expect(suggestedFlow("Furniture Only")).toBe("furniture");
    expect(suggestedFlow("interior_design_furniture")).toBe("design");
    expect(suggestedFlow("Concepts / Early Ideas")).toBe("design");
    expect(suggestedFlow("Renovation / Fit-Out")).toBe("fit_out");
    expect(suggestedFlow("Architecture")).toBe("basic");
    expect(clientTypeDecided("end_user")).toBe(true);
    expect(clientTypeDecided("TBC")).toBe(false);
    expect(clientTypeDecided("")).toBe(false);
    expect(clientTypeDecided(null)).toBe(false);
  });
});
