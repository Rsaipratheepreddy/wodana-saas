"use client";

import { parseDate } from "@internationalized/date";
import { DateField, MultiSelectField, SegmentedControl, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { AnswerValue, Question, QuestionnaireAnswers } from "@/lib/setup/questionnaires";

/** The answers a form starts with: what the job already answered, as each field holds it. */
export function initialAnswers(questionnaire: Pick<QuestionnaireAnswers, "questions" | "answers"> | null | undefined): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const question of questionnaire?.questions ?? []) {
    const stored = questionnaire?.answers[question.key] ?? null;
    out[question.key] = question.kind === "multi_choice" ? (stored ? stored.split("\n") : []) : stored;
  }
  return out;
}

/** The required questions not answered yet, by label (the form says them in one line). */
export const unansweredRequired = (questions: Question[], answers: Record<string, AnswerValue>) =>
  questions.filter((question) => question.required && (answers[question.key] === null || answers[question.key] === undefined || answers[question.key] === ""
    || (Array.isArray(answers[question.key]) && !(answers[question.key] as string[]).length))).map((question) => question.label);

/**
 * §0.3 P3: the firm's questions as form fields (one field per question, by its answer type), the same wherever a
 * questionnaire is answered: the kick-off, the handover checklist, a warranty claim.
 */
export function QuestionnaireFields({ questions, answers, onChange }: { questions: Question[]; answers: Record<string, AnswerValue>; onChange: (key: string, value: AnswerValue) => void }) {
  const t = useT();
  return <>{questions.map((question) => {
    const value = answers[question.key] ?? null;
    const common = { key: question.key, label: question.label, isRequired: question.required, description: question.help };
    switch (question.kind) {
      case "long_text": return <TextAreaField {...common} maxLength={4000} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(question.key, next)} />;
      case "number": return <TextInput {...common} inputMode="decimal" value={typeof value === "string" ? value : ""} onChange={(next) => onChange(question.key, next.replace(/[^\d.-]/g, ""))} />;
      case "yes_no": return <div className="wd-field" key={question.key}>
        <span className="wd-field-label">{question.label}</span>
        <SegmentedControl label={question.label} value={value === "yes" || value === true ? "yes" : value === "no" || value === false ? "no" : ""}
          options={[{ id: "yes", label: t("Yes") }, { id: "no", label: t("No") }]} onChange={(next) => onChange(question.key, next)} />
      </div>;
      case "choice": return <SelectField {...common} accent="neutral" selectedKey={typeof value === "string" && value ? value : null}
        items={(question.options ?? []).map((option) => ({ id: option, label: option }))} onSelectionChange={(next) => onChange(question.key, next ? String(next) : null)} />;
      case "multi_choice": return <MultiSelectField key={question.key} label={question.label} isRequired={question.required} items={(question.options ?? []).map((option) => ({ id: option, label: option }))}
        selectedKeys={new Set(Array.isArray(value) ? value : [])} onSelectionChange={(keys) => onChange(question.key, [...keys].map(String))} />;
      case "date": return <DateField {...common} value={typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDate(value) : null}
        onChange={(date) => onChange(question.key, date?.toString() ?? null)} />;
      default: return <TextInput {...common} maxLength={500} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(question.key, next)} />;
    }
  })}</>;
}
