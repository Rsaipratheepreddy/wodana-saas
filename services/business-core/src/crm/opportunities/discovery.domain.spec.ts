import { describe, expect, it } from "vitest";
import { areaIn, coordinatesProblem, discoveryMissing, roundCoordinate, type DiscoveryFacts } from "./discovery.domain";

const complete: DiscoveryFacts = { area: "1500.00", areaUnit: "sqft", spaces: 3, propertyLocation: "Jumeirah Golf Estates", clientEmail: "maya@example.com", floorPlanAssetId: "f1", designPackageId: "p1", latitude: 25.0657, longitude: 55.1713 };

describe("opportunity discovery (PLM-040)", () => {
  it("lists everything that blocks the Design Quote stage", () => {
    expect(discoveryMissing({ facts: null, enquiryType: "not_sure", clientType: null, questions: [{ key: "style", label: "Design style", required: true }, { key: "pets", label: "Pets", required: false }], answers: {} }).map((item) => item.key))
      .toEqual(["floorPlan", "area", "clientEmail", "propertyLocation", "enquiryType", "clientType", "question:style"]);
  });

  it("is ready once the facts and required answers are in, asking for spaces only for per-space packages", () => {
    const base = { facts: { ...complete, spaces: null }, enquiryType: "fit_out", clientType: "homeowner", questions: [{ key: "style", label: "Design style", required: true }], answers: { style: "Warm minimal" } };
    expect(discoveryMissing({ ...base, packagePricing: "per_area" })).toEqual([]);
    expect(discoveryMissing({ ...base, packagePricing: "per_space" })).toEqual([{ key: "spaces", label: "Number of spaces" }]);
    expect(discoveryMissing({ ...base, answers: { style: "  " } }).map((item) => item.key)).toEqual(["question:style"]);
  });

  it("converts area exactly between square metres and square feet", () => {
    expect(areaIn("100", "sqm", "sqft")).toBe("1076.39");
    expect(areaIn("1076.39", "sqft", "sqm")).toBe("100.00");
    expect(areaIn("250.5", "sqft", "sqft")).toBe("250.50");
  });

  it("takes a property position only as both coordinates, in range", () => {
    expect(coordinatesProblem(null, null)).toBeNull();
    expect(coordinatesProblem(-90, 180)).toBeNull();
    expect(coordinatesProblem(51.5, null)).toMatch(/both/);
    expect(coordinatesProblem(90.1, 0)).toMatch(/latitude/);
    expect(coordinatesProblem(0, -180.1)).toMatch(/longitude/);
    expect(coordinatesProblem(Number.NaN, 0)).toMatch(/latitude/);
    expect(roundCoordinate(-33.868812345)).toBe(-33.8688123);
  });
});
