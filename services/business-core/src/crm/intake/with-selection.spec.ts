import { describe, expect, it } from "vitest";
import { withSelection } from "./lead-forms.service";

describe("picked items on an enquiry", () => {
  it("adds what the visitor picked under their own words", () => {
    expect(withSelection("Need a kitchen", ["Wardrobe", " Kitchen "])).toBe("Need a kitchen\n\nInterested in: Wardrobe, Kitchen");
    expect(withSelection(undefined, ["Wardrobe"])).toBe("Interested in: Wardrobe");
    expect(withSelection("Hi", [])).toBe("Hi");
  });
});
