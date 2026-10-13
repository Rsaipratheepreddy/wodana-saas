import { describe, expect, it } from "vitest";
import { designGroup } from "./portal-designs";

describe("PLM-153: the client's Designs folder", () => {
  it("files each design by its stage, else by what kind of file it is", () => {
    expect(designGroup("concepts", "Other")).toBe("concepts");
    expect(designGroup(null, "Concept / mood board")).toBe("concepts");
    expect(designGroup("space_planning", "Other")).toBe("layouts");
    expect(designGroup(null, "2D floor plan")).toBe("layouts");
    expect(designGroup("material_selection", "Other")).toBe("materials");
    expect(designGroup(null, "Material / finish board")).toBe("materials");
    expect(designGroup("renders", "Other")).toBe("renders");
    expect(designGroup(null, "3D render")).toBe("renders");
    expect(designGroup(null, "Elevation")).toBe("drawings");
  });
});
