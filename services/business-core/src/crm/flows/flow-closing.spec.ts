import { describe, expect, it } from "vitest";
import { closingEventFor, closingRows, inferClosing, TEMPLATE_CLOSING } from "./flow-closing";
import { FLOW_TEMPLATES } from "./flow-templates";
import { STARTER_FLOWS } from "./starter-flows";

describe("PLM-102 closing events per enquiry type (configuration)", () => {
  it("gives every template and starter flow a closing default (CeCe's table)", () => {
    for (const template of FLOW_TEMPLATES) expect(TEMPLATE_CLOSING[template.key], template.key).toBeDefined();
    for (const code of Object.keys(STARTER_FLOWS)) expect(TEMPLATE_CLOSING[code], code).toBeDefined();
    expect(TEMPLATE_CLOSING.furniture_all_paths.paths).toEqual({
      take_home_now: "collected", in_stock_delivery: "delivered", supplier_order: "delivered", core_collection_factory: "delivered", bespoke: "delivered",
    });
    expect(TEMPLATE_CLOSING.design_concept.default).toBe("design_handover");
    expect(TEMPLATE_CLOSING.design_and_furniture.default).toBe("all_produced_delivered_installed");
    expect(TEMPLATE_CLOSING.full_fit_out.default).toBe("completion_handover");
  });

  it("reads a flow of unknown origin from its steps the way the templates are built", () => {
    expect(inferClosing(STARTER_FLOWS.furniture.definition)).toBe(TEMPLATE_CLOSING.furniture);
    expect(inferClosing(STARTER_FLOWS.design.definition).default).toBe("design_handover");
    expect(inferClosing(STARTER_FLOWS.fit_out.definition).default).toBe("completion_handover");
    for (const key of ["design_concept", "design_and_furniture", "fit_out_joinery", "full_fit_out", "renovation", "furniture_bespoke"]) {
      const template = FLOW_TEMPLATES.find((item) => item.key === key)!;
      expect(inferClosing(template.definition).default, key).toBe(TEMPLATE_CLOSING[key].default);
    }
  });

  it("takes the path's own rule, else the flow's", () => {
    const rules = closingRows(TEMPLATE_CLOSING.furniture).map((row) => ({ ...row, version: 1 }));
    expect(closingEventFor(rules, "take_home_now")).toBe("collected");
    // Guide J: a supplier order (Furniture C) closes on delivery.
    expect(closingEventFor(rules, "supplier_order")).toBe("delivered");
    expect(closingEventFor(rules, null)).toBe("delivered");
    expect(closingEventFor([], "bespoke")).toBeNull();
  });
});
