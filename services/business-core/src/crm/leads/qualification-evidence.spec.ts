import { describe, expect, it, vi } from "vitest";
import { evaluateQualification, validateQualificationQuestionDefinitions } from "./qualification-evidence";

function client(input: {
  serviceType?: string | null;
  form?: Record<string, unknown> | null;
  questions?: Record<string, unknown>[];
  answers?: Array<{ questionKey: string; value: unknown; capturedAt: Date }>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT enquiry.service_type")) {
      return { rows: [{ service_type: input.serviceType ?? null }], rowCount: 1 };
    }
    if (sql.includes("FROM crm_qualification_forms")) {
      return input.form ? { rows: [input.form], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM crm_qualification_questions")) {
      return { rows: input.questions ?? [], rowCount: input.questions?.length ?? 0 };
    }
    if (sql.includes("FROM crm_lead_qualification_values")) {
      return { rows: input.answers ?? [], rowCount: input.answers?.length ?? 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query };
}

const form = {
  id: "form", code: "design", name: "Design qualification", service_type: "interior_design", version: 3,
};

describe("CRM qualification evidence", () => {
  it("selects the service-specific form and treats false and zero as completed answers", async () => {
    const db = client({
      serviceType: "interior_design",
      form,
      questions: [
        { id: "q1", key: "budget_confirmed", label: "Budget confirmed", data_type: "boolean", required: true, position: 1, scoring: { true: 10 }, configuration: {} },
        { id: "q2", key: "rooms", label: "Rooms", data_type: "number", required: true, position: 2, scoring: {}, configuration: {} },
      ],
      answers: [{ questionKey: "budget_confirmed", value: false, capturedAt: new Date("2026-09-15T08:00:00Z") }],
    });
    const result = await evaluateQualification(db as never, "workspace", "lead", { rooms: 0 }, true);
    expect(result).toMatchObject({ ready: true, missingRequired: [] });
    expect(result.evidence).toMatchObject({ selection: "service_specific", serviceType: "interior_design" });
    expect(result.evidence.form).toMatchObject({ id: "form", version: 3 });
    expect(result.evidence.answers.map(answer => [answer.questionKey, answer.value])).toEqual([
      ["budget_confirmed", false], ["rooms", 0],
    ]);
    expect(result.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    const formQuery = db.query.mock.calls.find(([sql]) => sql.includes("FROM crm_qualification_forms"))?.[0];
    expect(formQuery).toContain("CASE WHEN $2::text IS NOT NULL AND service_type=$2::text");
    expect(formQuery).toContain("FOR SHARE");
  });

  it("reports readiness during capture and blocks completion when a required answer is missing", async () => {
    const db = client({
      form: { ...form, service_type: null },
      questions: [{ id: "q1", key: "decision_maker", label: "Decision maker", data_type: "boolean", required: true, position: 1, scoring: {}, configuration: {} }],
    });
    expect(await evaluateQualification(db as never, "workspace", "lead")).toMatchObject({
      ready: false, missingRequired: ["decision_maker"],
      evidence: { selection: "global" },
    });
    await expect(evaluateQualification(db as never, "workspace", "lead", {}, true))
      .rejects.toThrow("Qualification requirements are not met");
  });

  it.each([
    ["date", "2026-02-30", {}],
    ["select", "unknown", { options: ["villa", "apartment"] }],
    ["multi_select", ["villa", "villa"], { options: ["villa", "apartment"] }],
    ["boolean", "yes", {}],
    ["number", "10", {}],
  ])("rejects invalid %s answers", async (dataType, value, configuration) => {
    const db = client({
      form: { ...form, service_type: null },
      questions: [{ id: "q", key: "answer", label: "Answer", data_type: dataType, required: false, position: 1, scoring: {}, configuration }],
    });
    await expect(evaluateQualification(db as never, "workspace", "lead", { answer: value }))
      .rejects.toThrow(`Qualification answer answer must match ${dataType}`);
  });

  it("allows a tenant with no active form to qualify while preserving ad-hoc answers", async () => {
    const db = client({ answers: [{ questionKey: "notes", value: "Verified by phone", capturedAt: new Date("2026-09-15T08:00:00Z") }] });
    const result = await evaluateQualification(db as never, "workspace", "lead", {}, true);
    expect(result).toMatchObject({ ready: true, evidence: { selection: "none", form: null } });
    expect(result.evidence.answers[0]).toMatchObject({ questionKey: "notes", value: "Verified by phone" });
  });
});

describe("CRM qualification form definitions", () => {
  it("requires bounded unique select options and numeric scoring", () => {
    expect(() => validateQualificationQuestionDefinitions([
      { key: "type", label: "Type", dataType: "select", position: 1, configuration: { options: ["villa", "villa"] } },
    ])).toThrow("requires unique string options");
    expect(() => validateQualificationQuestionDefinitions([
      { key: "fit", label: "Fit", dataType: "boolean", position: 1, scoring: { true: "high" } },
    ])).toThrow("must contain numeric values");
  });
});
