import { describe, expect, it } from "vitest";
import type { RecipePreviewDto } from "./catalog.dto";
import { applySurveyMeasurement } from "./catalog-recipe-measurement";

const caseId = "10000000-0000-4000-a000-000000000001";
const entryId = "10000000-0000-4000-a000-000000000002";
const measurementId = "10000000-0000-4000-a000-000000000003";
const widthId = "10000000-0000-4000-a000-000000000004";
const heightId = "10000000-0000-4000-a000-000000000005";

const input = (): RecipePreviewDto => ({
  templateId: "10000000-0000-4000-a000-000000000006",
  executionId: "10000000-0000-4000-a000-000000000007",
  grade: "Standard",
  dimensionUnit: "ft",
  quantity: 1,
  currency: "AED",
  survey: {
    caseId,
    entryId,
    measurementId,
    measurementVersion: 3,
    bindings: [
      { axis: "width", dimensionId: widthId },
      { axis: "height", dimensionId: heightId },
    ],
  },
});

const survey = () => ({
  id: measurementId,
  version: 3,
  status: "verified",
  entryId,
  dimensions: [
    { id: widthId, name: "Opening width", unit: "ft", measured: 8, measuredMetres: 2.4384 },
    { id: heightId, name: "Opening height", unit: "mm", measured: 2700, measuredMetres: 2.7 },
  ],
});

describe("survey-backed assembly measurements", () => {
  it("uses pinned verified survey dimensions and preserves their provenance", () => {
    const result = applySurveyMeasurement(input(), survey());
    expect(result.input.width).toBe(8);
    expect(result.input.height).toBeCloseTo(8.85826771654);
    expect(result.source).toMatchObject({
      measurementId,
      measurementVersion: 3,
      status: "verified",
      dimensions: [
        { axis: "width", dimensionId: widthId, surveyValue: 8, surveyUnit: "ft", appliedValue: 8, adjusted: false },
        { axis: "height", dimensionId: heightId, surveyValue: 2700, surveyUnit: "mm", adjusted: false },
      ],
    });
    expect(result.changes).toEqual([]);
  });

  it("allows a human adjustment only with an explicit reason", () => {
    const request = input();
    request.survey!.adjustments = [{ axis: "height", value: 9, reason: "Allow for finished-floor build-up." }];
    const result = applySurveyMeasurement(request, survey());
    expect(result.input.height).toBe(9);
    expect(result.source?.dimensions[1]).toMatchObject({ adjusted: true, appliedValue: 9, adjustmentReason: "Allow for finished-floor build-up." });
    expect(result.changes[0]).toContain("Height adjusted");
  });

  it("rejects stale, unverified or silently replaced survey measurements", () => {
    expect(() => applySurveyMeasurement(input(), { ...survey(), version: 4 })).toThrow("survey changed");
    expect(() => applySurveyMeasurement(input(), { ...survey(), status: "recheck" })).toThrow("Verify the site survey");
    expect(() => applySurveyMeasurement({ ...input(), width: 8.2 }, survey())).toThrow("reasoned width adjustment");
  });
});
