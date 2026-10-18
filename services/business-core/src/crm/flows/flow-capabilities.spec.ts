import { describe, expect, it } from "vitest";
import { flowCapabilities } from "./flow-capabilities";
import { flowTemplate } from "./flow-templates";
import { STARTER_FLOWS } from "./starter-flows";

const definition = (code: string) => structuredClone(STARTER_FLOWS[code].definition);

describe("flow capabilities: what a flow does, read from its steps", () => {
  it("reads the starter flows as the screens always showed them", () => {
    expect(flowCapabilities(definition("design"), "design")).toEqual({ intro: true, designPackage: true, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false });
    expect(flowCapabilities(definition("fit_out"), "fit_out")).toEqual({ intro: true, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: true, qsPricing: true });
    expect(flowCapabilities(definition("furniture"), "furniture")).toEqual({ intro: false, designPackage: false, furniturePath: true, clientApprovalOnSpot: true, siteVisit: false, qsPricing: false });
    expect(flowCapabilities(definition("basic"), "basic")).toEqual({ intro: false, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false });
  });

  it("gives a workspace's own copy of a starter, under any code, the starter's features", () => {
    expect(flowCapabilities(definition("design"), "interior_design_furniture")).toEqual(flowCapabilities(definition("design"), "design"));
    expect(flowCapabilities(definition("design"), "interior_design_furniture_2")).toMatchObject({ intro: true, designPackage: true });
    expect(flowCapabilities(definition("fit_out"), "full_fit_out")).toEqual(flowCapabilities(definition("fit_out"), "fit_out"));
    expect(flowCapabilities(definition("furniture"), "furniture_only")).toMatchObject({ furniturePath: true, clientApprovalOnSpot: true, intro: false });
  });

  it("reads branch paths and the library templates", () => {
    const bespokeOnly = definition("furniture");
    bespokeOnly.branches[0].answers = [{ value: "bespoke", steps: [{ key: "intro_meeting", name: "Meet", role: "sales", check: "intro_meeting_completed", column: "qualification" }] }];
    expect(flowCapabilities(bespokeOnly, "made_to_order")).toMatchObject({ intro: true, furniturePath: true });
    expect(flowCapabilities(flowTemplate("design_and_furniture")!.definition, "id_furniture")).toMatchObject({ intro: true, designPackage: true, siteVisit: true, qsPricing: false });
    expect(flowCapabilities(flowTemplate("full_fit_out")!.definition, "turnkey")).toMatchObject({ intro: true, designPackage: true, siteVisit: true, qsPricing: true });
    expect(flowCapabilities(flowTemplate("returning_customer")!.definition, "reorder")).toMatchObject({ intro: false, designPackage: false, clientApprovalOnSpot: true });
  });

  it("keeps a starter code's features when the firm edited its steps, and none without a definition", () => {
    const edited = definition("design");
    edited.steps = edited.steps.filter((step) => step.check !== "intro_meeting_completed" && step.check !== "package_chosen" && step.key !== "design_quote");
    expect(flowCapabilities(edited, "design")).toMatchObject({ intro: true, designPackage: true });
    expect(flowCapabilities(edited, "design_light")).toMatchObject({ intro: false, designPackage: false });
    expect(flowCapabilities(null, "fit_out")).toMatchObject({ intro: true, siteVisit: true });
    expect(flowCapabilities(null, "anything")).toMatchObject({ intro: false, designPackage: false, furniturePath: false });
  });
});
