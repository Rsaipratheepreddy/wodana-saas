import { describe, expect, it } from "vitest";
import { projectDisplayName } from "./format";

describe("projectDisplayName", () => {
  it("drops only the client's own name in front of the title", () => {
    expect(projectDisplayName("Mariam Al Suwaidi · Villa 27 furniture", "Mariam Al Suwaidi")).toBe("Villa 27 furniture");
    expect(projectDisplayName("Business Bay office · reception and boardroom", "Yusuf Rahman")).toBe("Business Bay office · reception and boardroom");
    expect(projectDisplayName("Business Bay office · reception and boardroom")).toBe("Business Bay office · reception and boardroom");
  });
});
