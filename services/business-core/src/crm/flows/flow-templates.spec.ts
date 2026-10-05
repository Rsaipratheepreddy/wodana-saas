import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES } from "../../workspaces/role-templates";
import { allSteps, validateFlowDefinition } from "./flow-definition";
import { FLOW_TEMPLATE_GROUPS, FLOW_TEMPLATES, flowTemplate } from "./flow-templates";

const ROLE_CODES = new Set(ROLE_TEMPLATES.map((role) => role.code));

describe("the flow template library", () => {
  it.each(FLOW_TEMPLATES.map((template) => [template.key, template] as const))("%s passes the publisher's validator", (_key, template) => {
    const result = validateFlowDefinition(structuredClone(template.definition));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("has unique keys and names, a group, a one-line description and step names that are verbs", () => {
    expect(new Set(FLOW_TEMPLATES.map((template) => template.key)).size).toBe(FLOW_TEMPLATES.length);
    expect(new Set(FLOW_TEMPLATES.map((template) => template.name.toLowerCase())).size).toBe(FLOW_TEMPLATES.length);
    for (const template of FLOW_TEMPLATES) {
      expect(template.key).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
      expect(FLOW_TEMPLATE_GROUPS).toContain(template.group);
      expect(template.description.length).toBeLessThanOrEqual(140);
      expect(template.description).not.toMatch(/\n/);
      for (const step of allSteps(template.definition))
        expect(step.name, `${template.key}.${step.key}`).toMatch(/^[A-Z][a-z']+ /);
    }
    expect(FLOW_TEMPLATE_GROUPS.every((group) => FLOW_TEMPLATES.some((template) => template.group === group))).toBe(true);
  });

  it("names only roles a firm kit can give a workspace", () => {
    for (const template of FLOW_TEMPLATES)
      for (const step of allSteps(template.definition)) {
        expect(ROLE_CODES.has(step.role), `${template.key}.${step.key} role ${step.role}`).toBe(true);
        for (const role of step.notify ?? []) expect(ROLE_CODES.has(role), `${template.key}.${step.key} tells ${role}`).toBe(true);
      }
  });

  it("is generic product content: no currency, country or firm in any label", () => {
    const text = JSON.stringify(FLOW_TEMPLATES);
    expect(text).not.toMatch(/\b(AED|INR|USD|EUR|GBP|SAR|Dubai|UAE|Emirate|India|Palm|ODG)\b/i);
  });

  it("suggests no Concepts / early ideas enquiry type: a concept client is Interior design with the Concept package (PLM-127)", () => {
    const suggested = FLOW_TEMPLATES.flatMap((template) => template.suggestedEnquiryTypes.map((type) => type.toLowerCase()));
    expect(suggested.some((type) => type.includes("concept") || type.includes("early ideas"))).toBe(false);
    expect(flowTemplate("design_concept")?.suggestedEnquiryTypes).toEqual(["Interior design"]);
  });

  it("finds a template by key and refuses an unknown one", () => {
    expect(flowTemplate("furniture_bespoke")?.name).toBe("Bespoke furniture");
    expect(flowTemplate("missing")).toBeUndefined();
  });
});
