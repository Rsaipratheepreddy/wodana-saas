import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { confirmable, parseRequirementInput, requirementState, sizeText } from "./project-factory-requirements";

describe("PLM-166: where a made line's requirements stand", () => {
  const recipe = (state: "none" | "unverified" | "verified") => state === "verified" ? { state, lines: [], labourHours: "0", verified: { at: "2026-10-15T08:00:00.000Z", byName: "Rami" } } as const
    : state === "unverified" ? { state, components: 2 } as const : { state } as const;

  it("takes a verified recipe first, then the factory's record (confirmed or waiting), else needs requirements", () => {
    expect(requirementState({ made: true, recipe: recipe("verified"), factory: null })).toBe("verified");
    expect(requirementState({ made: true, recipe: recipe("unverified"), factory: { status: "confirmed" } })).toBe("confirmed");
    expect(requirementState({ made: true, recipe: recipe("unverified"), factory: { status: "pending" } })).toBe("pending");
    expect(requirementState({ made: true, recipe: recipe("unverified"), factory: null })).toBe("needs_requirements");
    expect(requirementState({ made: true, recipe: recipe("none"), factory: null })).toBe("needs_requirements");
  });

  it("asks nothing of a line that isn't made in the factory", () => {
    expect(requirementState({ made: false, recipe: recipe("none"), factory: null })).toBe("not_needed");
  });

  it("confirms a record once it says something: a material or the labour hours", () => {
    expect(confirmable({ status: "pending", items: [], labourHours: null })).toEqual({ ok: false, reason: "empty" });
    expect(confirmable({ status: "pending", items: [], labourHours: "4" })).toEqual({ ok: true });
    expect(confirmable({ status: "confirmed", items: [], labourHours: "4" })).toEqual({ ok: false, reason: "already_confirmed" });
  });

  it("validates what the factory records: kinds from the list, numbers for quantities and hours", () => {
    const parsed = parseRequirementInput({ items: [{ componentType: "board", name: " 18mm MDF ", quantity: "2.5", unit: "sheet" }], labourHours: "6", notes: " Edge banding on site " });
    expect(parsed).toEqual({ items: [{ componentType: "board", name: "18mm MDF", quantity: "2.5", unit: "sheet", catalogItemId: null, note: "" }], labourHours: "6", notes: "Edge banding on site" });
    expect(() => parseRequirementInput({ items: [{ componentType: "labour", name: "Hours", quantity: "1" }] })).toThrow(BadRequestException);
    expect(() => parseRequirementInput({ items: [{ componentType: "board", name: "MDF", quantity: "two" }] })).toThrow(/number/);
    expect(() => parseRequirementInput({ items: [], labourHours: "x" })).toThrow(/labour hours/);
    expect(parseRequirementInput({ items: [], labourHours: "" }).labourHours).toBeNull();
  });

  it("reads a line's size from the quotation line, in the order length × width × height", () => {
    expect(sizeText({ length: "180.0000", width: "60", height: "240", dimensionUnit: "cm" })).toBe("180 × 60 × 240 cm");
    expect(sizeText({ length: null, width: "60", height: null, dimensionUnit: null })).toBe("60");
    expect(sizeText({ length: null, width: null, height: null, dimensionUnit: "cm" })).toBeNull();
  });
});
