import {
  DESIGN_STAGE_LABELS, FIELD_LABELS, answerOptions, checkMeta, type AnswerOptions, type BranchQuestion, type FlowStep,
} from "@/lib/flows/flow-model";
import { tKey, type Translate } from "@/lib/i18n/keys";

/** "Done when …" in plain words: the check, with the design stage or the details it names. */
export function doneWhen(step: FlowStep, t: Translate): string {
  const check = t(checkMeta(step.check).label);
  const detail = step.check === "design_stage_done" && step.designStage ? t(DESIGN_STAGE_LABELS[step.designStage])
    : step.check === "details_complete" && step.needs?.length ? step.needs.map((field) => t(FIELD_LABELS[field])).join(", ") : null;
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
