import { describe, expect, it } from "vitest";
import { STARTER_FLOWS } from "../crm/flows/starter-flows";
import { FLOW_TEMPLATES } from "../crm/flows/flow-templates";
import type { FlowDefinition } from "../crm/flows/flow-definition";
import { FURNITURE_RULES, NO_RULE, ruleFor } from "../fulfilment/fulfilment-rules";
import type { FurniturePath } from "../crm/opportunities/flow-gates";
import { FULL_PLAN, pathSteps, planFor } from "./case-plan";

const furniture = STARTER_FLOWS.furniture.definition;
const rules = FURNITURE_RULES.map((rule) => ({ ...rule, version: 0 }));
const plan = (path: FurniturePath | null, extra: Partial<Parameters<typeof planFor>[0]> = {}, definition: FlowDefinition = furniture) =>
  planFor({ definition, path, rule: ruleFor(rules, path), areas: null, journey: null, ...extra });

describe("planning case plan from the job's configuration (PLM-121/126/098)", () => {
  it("sends stock and supplier orders (A, B, C) straight to the quotation, the agreement and fulfilment", () => {
    for (const path of ["take_home_now", "in_stock_delivery", "supplier_order"] as const) {
      expect(plan(path)).toEqual({ source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "fulfilment" });
    }
  });

  it("sends a core collection order (D) to production, with a site visit only when its path asks for one", () => {
    expect(plan("core_collection_factory")).toEqual({ source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "production" });
    const withVisit = structuredClone(furniture);
    withVisit.branches[0].answers.find((answer) => answer.value === "core_collection_factory")!.steps
      .push({ key: "measure", name: "Measure the site", role: "sales", check: "site_visit_recorded", column: "qualification" });
    expect(plan("core_collection_factory", {}, withVisit)).toMatchObject({ phases: ["design", "price", "agree", "release"], siteVisit: true, design: false });
    // Another path's site visit is not this path's.
    expect(plan("in_stock_delivery", {}, withVisit)).toMatchObject({ siteVisit: false });
  });

  it("keeps the full journey for bespoke pieces (E) that need a BOQ", () => {
    expect(plan("bespoke")).toBe(FULL_PLAN);
  });

  it("keeps the full journey for an enquiry type without path rules, or a job without a flow", () => {
    expect(planFor({ definition: STARTER_FLOWS.design.definition, path: null, rule: null, areas: null, journey: null })).toBe(FULL_PLAN);
    expect(planFor({ definition: STARTER_FLOWS.fit_out.definition, path: null, rule: { ...NO_RULE }, areas: null, journey: null })).toBe(FULL_PLAN);
    expect(plan(null)).toBe(FULL_PLAN);
  });

  it("follows the firm's own rule, never the path's name", () => {
    // A firm that makes its in-stock pieces to order with a BOQ gets the full journey for that path.
    expect(plan("in_stock_delivery", { rule: { ...ruleFor(rules, "in_stock_delivery"), reserveOn: "production_booked", deductOn: "production_started", boqRequired: true } })).toBe(FULL_PLAN);
    // A stock order that needs a BOQ confirms its scope first.
    expect(plan("supplier_order", { rule: { ...ruleFor(rules, "supplier_order"), boqRequired: true } }).phases).toEqual(["define", "price", "agree", "release"]);
    // A made-to-order path set to skip the factory after Won is fulfilled like ready-made goods.
    expect(plan("core_collection_factory", { areas: ["delivery"] }).release).toBe("fulfilment");
  });

  it("asks for design when the path's steps do, and ignores auto-passed steps", () => {
    const design = FLOW_TEMPLATES.find((template) => template.key === "design_and_furniture")!.definition;
    expect(plan("in_stock_delivery", {}, design)).toMatchObject({ phases: ["discover", "design", "price", "agree", "release"], siteVisit: true, design: true });
    const auto = structuredClone(design);
    for (const step of auto.steps) if (step.check === "site_visit_recorded" || step.check === "package_chosen") { step.auto = true; delete step.optional; }
    expect(plan("in_stock_delivery", {}, auto)).toMatchObject({ siteVisit: false, design: false });
  });

  it("never hides a design journey that already started", () => {
    expect(plan("in_stock_delivery", { journey: "site_and_materials" })).toMatchObject({ phases: ["design", "price", "agree", "release"], siteVisit: true, design: false });
  });

  it("reads the path's own branch and every answer of other branches", () => {
    const keys = (path: FurniturePath | null) => pathSteps(furniture, path).map((step) => step.key);
    expect(keys("bespoke")).toContain("feasibility");
    expect(keys("in_stock_delivery")).not.toContain("feasibility");
    expect(keys(null)).not.toContain("feasibility");
  });
});
