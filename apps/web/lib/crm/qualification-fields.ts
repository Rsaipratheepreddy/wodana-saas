import type { FieldSpec } from "@/components/crm/crm-workbench";

export type QualificationQuestion = {
  key: string;
  label: string;
  dataType: "text" | "number" | "boolean" | "date" | "select" | "multi_select";
  required: boolean;
  configuration?: { options?: string[] };
};

export type QualificationEvidenceSnapshot = {
  version: number;
  leadId: string;
  serviceType: string | null;
  selection: "service_specific" | "global" | "none";
  evaluatedAt: string;
  form: null | { id: string; code: string; name: string; version: number; questions: QualificationQuestion[] };
  answers: Array<{ questionKey: string; value: unknown; capturedAt?: string | null }>;
};

export function qualificationEvidenceSnapshot(value: unknown): QualificationEvidenceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const evidence = value as Partial<QualificationEvidenceSnapshot>;
  if (!Array.isArray(evidence.answers) || typeof evidence.leadId !== "string") return null;
  return evidence as QualificationEvidenceSnapshot;
}

export function qualificationEvidenceRows(value: unknown) {
  const evidence = qualificationEvidenceSnapshot(value);
  if (!evidence) return [];
  const labels = new Map((evidence.form?.questions ?? []).map(question => [question.key, question.label]));
  return evidence.answers.map(answer => ({
    key: answer.questionKey,
    label: labels.get(answer.questionKey) ?? answer.questionKey.replaceAll("_", " ").replace(/^./, first => first.toUpperCase()),
    value: qualificationAnswerText(answer.value),
    capturedAt: answer.capturedAt ?? null,
  }));
}

export function qualificationFields(questions: QualificationQuestion[]): FieldSpec[] {
  return questions.map((question) => ({
    key: question.key,
    label: question.label,
    required: question.required,
    ...(question.dataType === "number" ? { type: "number" as const }
      : question.dataType === "date" ? { type: "date" as const }
      : question.dataType === "multi_select" ? { type: "multi-select" as const }
      : question.dataType === "boolean" || question.dataType === "select" ? { type: "text" as const }
      : { type: "text" as const }),
    ...(question.dataType === "boolean" ? { options: [{ id: "true", label: "Yes" }, { id: "false", label: "No" }] }
      : question.dataType === "select" || question.dataType === "multi_select"
        ? { options: (question.configuration?.options ?? []).map((option) => ({ id: option, label: option })) }
        : {}),
  }));
}

export function initialQualificationValues(questions: QualificationQuestion[], answers: Record<string, unknown>) {
  return Object.fromEntries(questions.map((question) => {
    const answer = answers[question.key];
    return [question.key, question.dataType === "boolean" && typeof answer === "boolean" ? String(answer) : answer ?? (question.dataType === "multi_select" ? [] : "")];
  }));
}

export function qualificationValues(questions: QualificationQuestion[], values: Record<string, unknown>) {
  return Object.fromEntries(questions.map((question) => {
    const value = values[question.key];
    return [question.key, value === undefined || value === null || value === "" ? null
      : question.dataType === "boolean" ? value === "true"
      : value];
  }));
}

export function qualificationAnswerText(answer: unknown) {
  if (answer === true) return "Yes";
  if (answer === false) return "No";
  if (Array.isArray(answer)) return answer.length ? answer.join(", ") : "Not provided";
  return answer === null || answer === undefined || answer === "" ? "Not provided" : String(answer);
}
