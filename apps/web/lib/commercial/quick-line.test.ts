import { describe, expect, it } from "vitest";
import { describeQuickLine, parseQuickLine } from "./quick-line";

describe("quick line parser", () => {
  it("reads room, quantity, dimensions, material and rate from one sentence", () => {
    const draft = parseQuickLine("Master bedroom: 2 wardrobes 2400x2600x600 oak veneer matte 18500", ["Master bedroom"]);
    expect(draft).toMatchObject({ room: "Master bedroom", quantity: 2, unit: "nos", title: "Wardrobes", material: "Oak veneer", finish: "Matte", rate: 18500, optional: false });
    expect(draft?.dimensions).toEqual({ length: 2400, height: 2600, depth: 600, unit: "mm" });
  });
  it("accepts currency, thousands shorthand and units", () => {
    expect(parseQuickLine("Kitchen: 12 sqm quartz countertop AED 1,250")).toMatchObject({ room: "Kitchen", quantity: 12, unit: "sqm", title: "Countertop", material: "Quartz", rate: 1250 });
    expect(parseQuickLine("Living room: media wall @ 18.5k")).toMatchObject({ title: "Media wall", rate: 18500, quantity: 1 });
    expect(parseQuickLine("wardrobe x3 optional 9000")).toMatchObject({ room: null, quantity: 3, optional: true, rate: 9000 });
  });
  it("keeps unpriced lines honest and rejects empty input", () => {
    expect(parseQuickLine("Pantry: 1 set open shelving")).toMatchObject({ room: "Pantry", rate: null, unit: "set" });
    expect(parseQuickLine("   ")).toBeNull();
    expect(describeQuickLine(parseQuickLine("Pantry: shelving")!, "AED")).toContain("Unpriced");
  });
});
