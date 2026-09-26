import { describe, expect, it } from "vitest";
import { customFieldId, customFieldRef, normalizeCustomValues, questionShape } from "./enquiry-fields";

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

describe("staff-entered values for own enquiry fields", () => {
  const defs = [
    { id: "a", label: "Floor", dataType: "number", configuration: {}, visible: true },
    { id: "b", label: "Type", dataType: "select", configuration: { options: ["Villa", "Flat"] }, visible: true },
    { id: "c", label: "Rooms", dataType: "multi_select", configuration: { options: ["Kitchen", "Bath"] }, visible: true },
    { id: "d", label: "Move in", dataType: "date", configuration: {}, visible: true },
    { id: "e", label: "Notes", dataType: "text", configuration: {}, visible: true },
  ];
  it("keeps valid values, clears blanks and rejects wrong types or removed fields", () => {
    expect(normalizeCustomValues(defs, { a: "3", b: "Villa", c: ["Bath", "Bath"], d: "2026-10-01", e: "  quiet  " })).toEqual({ set: { a: "3", b: "Villa", c: ["Bath"], d: "2026-10-01", e: "quiet" }, clear: [] });
    expect(normalizeCustomValues(defs, { a: "", c: [], e: null })).toEqual({ set: {}, clear: ["a", "c", "e"] });
    expect(() => normalizeCustomValues(defs, { b: "Castle" })).toThrow("Type");
    expect(() => normalizeCustomValues(defs, { c: ["Garage"] })).toThrow("Rooms");
    expect(() => normalizeCustomValues(defs, { d: "2026-02-31" })).toThrow("Move in");
    expect(() => normalizeCustomValues(defs, { a: "abc" })).toThrow("Floor");
    expect(() => normalizeCustomValues(defs, { z: "x" })).toThrow("no longer exists");
  });
});
