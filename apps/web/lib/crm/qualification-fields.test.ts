import { describe, expect, it } from "vitest";
import { initialQualificationValues, qualificationAnswerText, qualificationEvidenceRows, qualificationEvidenceSnapshot, qualificationFields, qualificationValues, type QualificationQuestion } from "./qualification-fields";

const questions: QualificationQuestion[] = [
  { key: "scope_confirmed", label: "Scope confirmed", dataType: "boolean", required: true },
  { key: "property_type", label: "Property type", dataType: "select", required: true, configuration: { options: ["Villa", "Apartment"] } },
  { key: "services", label: "Services", dataType: "multi_select", required: false, configuration: { options: ["Design", "Build"] } },
  { key: "estimated_budget", label: "Estimated budget", dataType: "number", required: false },
  { key: "visit_date", label: "Visit date", dataType: "date", required: false },
];

describe("tenant qualification fields", () => {
  it("uses configured questions and options rather than fixed CRM fields", () => {
    expect(qualificationFields(questions)).toMatchObject([
      { key: "scope_confirmed", required: true, options: [{ id: "true" }, { id: "false" }] },
      { key: "property_type", required: true, options: [{ id: "Villa" }, { id: "Apartment" }] },
      { key: "services", type: "multi-select" },
      { key: "estimated_budget", type: "number" },
      { key: "visit_date", type: "date" },
    ]);
  });

  it("preserves typed answers, including false, numbers, dates and multiple selections", () => {
    const initial = initialQualificationValues(questions, {
      scope_confirmed: false, property_type: "Villa", services: ["Design"], estimated_budget: 125000, visit_date: "2026-09-18",
    });
    expect(initial.scope_confirmed).toBe("false");
    expect(qualificationValues(questions, initial)).toEqual({
      scope_confirmed: false, property_type: "Villa", services: ["Design"], estimated_budget: 125000, visit_date: "2026-09-18",
    });
  });

  it("clears optional answers without losing required false answers", () => {
    expect(qualificationValues(questions, { scope_confirmed: "false", property_type: "Apartment", services: [], estimated_budget: null, visit_date: "" })).toEqual({
      scope_confirmed: false, property_type: "Apartment", services: [], estimated_budget: null, visit_date: null,
    });
    expect(qualificationAnswerText(false)).toBe("No");
    expect(qualificationAnswerText(["Design", "Build"])).toBe("Design, Build");
  });

  it("renders the frozen qualification snapshot with the original question labels", () => {
    const evidence = {
      version: 1,
      leadId: "lead-1",
      serviceType: "interiors",
      selection: "service_specific" as const,
      evaluatedAt: "2026-09-17T08:00:00.000Z",
      form: { id: "form-1", code: "palm", name: "Palm enquiry", version: 4, questions },
      answers: [
        { questionKey: "scope_confirmed", value: true },
        { questionKey: "property_type", value: "Villa" },
      ],
    };
    expect(qualificationEvidenceSnapshot(evidence)).toEqual(evidence);
    expect(qualificationEvidenceRows(evidence)).toEqual([
      { key: "scope_confirmed", label: "Scope confirmed", value: "Yes", capturedAt: null },
      { key: "property_type", label: "Property type", value: "Villa", capturedAt: null },
    ]);
    expect(qualificationEvidenceSnapshot({ answers: [] })).toBeNull();
  });
});
