import {
  DESIGN_STAGE_LABELS, FIELD_LABELS, answerOptions, checkMeta, type AnswerOptions, type BranchQuestion, type FlowStep,
} from "@/lib/flows/flow-model";
import { tKey, type Translate } from "@/lib/i18n/keys";

/** "Done when …" in plain words: the check, with the design stage it names, or the details that must be filled in. */
export function doneWhen(step: FlowStep, t: Translate): string {
  if (step.check === "details_complete" && step.needs?.length) {
    const fields = step.needs.map((field) => t(FIELD_LABELS[field]));
    return fields.length === 1 ? t("Done when: {field} is filled in", { field: fields[0] }) : t("Done when: {fields} are filled in", { fields: fields.join(", ") });
  }
  const check = t(checkMeta(step.check).label);
  const detail = step.check === "design_stage_done" && step.designStage ? t(DESIGN_STAGE_LABELS[step.designStage]) : null;
  return t("Done when: {check}", { check: detail ? `${check} · ${detail}` : check });
}

const DEADLINE_TEXT = { working_hours: tKey("{count} working hours"), hours: tKey("{count} hours"), days: tKey("{count} days") } as const;
export function deadlineText(deadline: FlowStep["deadline"], t: Translate): string | null {
  return deadline ? t(DEADLINE_TEXT[deadline.unit], { count: deadline.amount }) : null;
}

/** An answer as the branch shows it: its letter (sub-paths) and plain name. */
export function answerLabel(question: BranchQuestion, value: string, options: AnswerOptions, t: Translate): { letter?: string; label: string } {
  const option = answerOptions(question, options).find((item) => item.value === value);
  if (!option) return { label: value.replaceAll("_", " ") };
  return { letter: option.letter, label: question === "subPath" ? t(option.label as never) : option.label };
}
