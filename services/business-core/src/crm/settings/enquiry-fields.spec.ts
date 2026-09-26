import { describe, expect, it } from "vitest";
import { customFieldId, customFieldRef, questionShape } from "./enquiry-fields";

const field = (dataType: string, configuration: Record<string, unknown> = {}) => ({ id: "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f", label: "Field", dataType, configuration, visible: true });

describe("custom enquiry fields on forms", () => {
  it("round-trips a field reference and ignores anything else", () => {
    expect(customFieldId(customFieldRef(field("text").id))).toBe(field("text").id);
    expect(customFieldId("custom")).toBeNull();
    expect(customFieldId("cf:../../x")).toBeNull();
  });
  it("asks each field type the matching way, with the field's own choices", () => {
    expect(questionShape(field("select", { options: ["Villa", "Apartment"] }))).toEqual({ type: "dropdown", options: [{ id: "Villa", label: "Villa" }, { id: "Apartment", label: "Apartment" }] });
    expect(questionShape(field("multi_select", { options: ["A"] })).type).toBe("checkboxes");
    expect(questionShape(field("number")).type).toBe("number");
    expect(questionShape(field("date")).type).toBe("date");
    expect(questionShape(field("text", { multiline: true })).type).toBe("paragraph");
    expect(questionShape(field("text")).type).toBe("text");
  });
});
