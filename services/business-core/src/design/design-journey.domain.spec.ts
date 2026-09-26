import { describe, expect, it } from "vitest";
import { journeyStages, nextStage, siteEvidenceProblem } from "./design-journey.domain";

describe("design journey (PLM-047..053)", () => {
  it("includes space planning and renders only when the package does", () => {
    expect(journeyStages({ includesSpacePlanning: false, includesRenders: false })).toEqual(["inspiration", "site_visit", "concepts", "material_selection", "approval"]);
    expect(journeyStages({ includesSpacePlanning: true, includesRenders: true })).toEqual(["inspiration", "site_visit", "concepts", "space_planning", "material_selection", "renders", "approval"]);
  });
  it("moves to the next stage in order", () => {
    const order = journeyStages({ includesSpacePlanning: false, includesRenders: true });
    expect(nextStage(order, "material_selection")).toBe("renders");
    expect(nextStage(order, "approval")).toBeNull();
  });
  it("needs every wall measured with a photo before the site visit is done", () => {
    expect(siteEvidenceProblem([])).toMatch(/Record the measurements/);
    expect(siteEvidenceProblem([{ title: "Living wall A", status: "incomplete", files: 1 }])).toBe("Finish the measurements for Living wall A");
    expect(siteEvidenceProblem([{ title: "Kitchen", status: "measured", files: 0 }])).toBe("Add a photo for Kitchen");
    expect(siteEvidenceProblem([{ title: "Kitchen", status: "verified", files: 2 }])).toBeNull();
  });
});
