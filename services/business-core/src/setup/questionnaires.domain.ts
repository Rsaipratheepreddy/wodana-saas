/**
 * §0.3 P3, the Setup module's questionnaires: the questions a firm asks at a step of the job (the kick-off, the
 * handover checklist, a warranty claim), edited by the firm's admin, published as numbered versions. A job answers the
 * version that was published when it first answered (running jobs keep theirs); a new job follows the latest one.
 *
 * Questions are configuration (stored as JSON on the questionnaire and its versions); answers are rows.
 */

export const QUESTIONNAIRE_PURPOSES = ["kickoff", "handover", "warranty_claim"] as const;
export type QuestionnairePurpose = (typeof QUESTIONNAIRE_PURPOSES)[number];
export const isQuestionnairePurpose = (value: unknown): value is QuestionnairePurpose =>
  typeof value === "string" && (QUESTIONNAIRE_PURPOSES as readonly string[]).includes(value);

export const QUESTION_KINDS = ["text", "long_text", "number", "yes_no", "choice", "multi_choice", "date"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type Question = {
  key: string;
  label: string;
  kind: QuestionKind;
  /** Asked, and must be answered before the step completes; questions are optional unless the firm marks them. */
  required: boolean;
  /** The choices of a choice or multi-choice question. */
  options?: string[];
  /** The enquiry types the question is asked on; none means every job. */
  jobTypes?: string[];
  help?: string;
};

export const MAX_QUESTIONS = 80;
export const MAX_OPTIONS = 30;

/** Where each questionnaire is answered and who answers it (shown in Setup; the English text is the label key). */
export const QUESTIONNAIRE_INFO: Record<QuestionnairePurpose, { name: string; step: string }> = {
  kickoff: { name: "Kick-off meeting", step: "Recorded with the kick-off" },
  handover: { name: "Handover checklist", step: "Answered before the handover pack is issued" },
  warranty_claim: { name: "Warranty claim", step: "Asked when the client reports a problem" },
};

/** The questions every firm starts with: generic, each one optional until the firm says otherwise. */
export const KIT_QUESTIONS: Record<QuestionnairePurpose, Question[]> = {
  kickoff: [
    { key: "attendees", label: "Who attended the meeting?", kind: "text", required: false },
    { key: "brief_confirmed", label: "Did the client confirm the brief?", kind: "yes_no", required: false },
    { key: "style", label: "Which style direction was agreed?", kind: "text", required: false },
    { key: "priorities", label: "What matters most to the client?", kind: "long_text", required: false },
    { key: "decision_maker", label: "Who signs off the design?", kind: "text", required: false },
    { key: "updates", label: "How would the client like weekly updates?", kind: "choice", required: false, options: ["Call", "Portal update"] },
  ],
  handover: [
    { key: "clean", label: "Is the site cleaned and cleared?", kind: "yes_no", required: false },
    { key: "snags_walked", label: "Did the client walk the snag list with us?", kind: "yes_no", required: false },
    { key: "manuals", label: "Were manuals and warranties handed over?", kind: "yes_no", required: false },
    { key: "keys", label: "Were keys and access cards returned?", kind: "yes_no", required: false },
    { key: "meter_readings", label: "Meter readings at handover", kind: "text", required: false },
  ],
  warranty_claim: [
    { key: "started", label: "When did you first notice it?", kind: "date", required: false },
    { key: "urgent", label: "Is it stopping you from using the room?", kind: "yes_no", required: false },
  ],
};

const oneLine = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const keyOf = (value: unknown) => oneLine(value, 60).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** The questions as stored: well-formed entries only, in order, no duplicate keys, at most MAX_QUESTIONS. */
export function normaliseQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const item of value as Array<Partial<Question>>) {
    const label = oneLine(item?.label, 300);
    const key = keyOf(item?.key) || keyOf(label);
    if (!label || !key || seen.has(key)) continue;
    const kind = (QUESTION_KINDS as readonly string[]).includes(item?.kind ?? "") ? item!.kind as QuestionKind : "text";
    seen.add(key);
    const options = kind === "choice" || kind === "multi_choice"
      ? [...new Set((Array.isArray(item?.options) ? item!.options : []).map((option) => oneLine(option, 120)).filter(Boolean))].slice(0, MAX_OPTIONS) : [];
    const jobTypes = [...new Set((Array.isArray(item?.jobTypes) ? item!.jobTypes : []).map((type) => oneLine(type, 60)).filter(Boolean))].slice(0, 20);
    const help = oneLine(item?.help, 300);
    out.push({ key, label, kind, required: item?.required === true, ...(options.length ? { options } : {}), ...(jobTypes.length ? { jobTypes } : {}), ...(help ? { help } : {}) });
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

/** What stops a draft from being published, in the firm admin's words; empty when it's ready. */
export function healthCheck(questions: Question[]): string[] {
  const problems: string[] = [];
  if (!questions.length) problems.push("Add at least one question.");
  for (const question of questions) {
    if ((question.kind === "choice" || question.kind === "multi_choice") && (question.options?.length ?? 0) < 2) problems.push(`Give "${question.label}" at least two choices.`);
  }
  return problems;
}

/** The questions a job of this enquiry type is asked. */
export const questionsFor = (questions: Question[], jobType: string | null) =>
  questions.filter((question) => !question.jobTypes?.length || (jobType !== null && question.jobTypes.includes(jobType)));

export type AnswerValue = string | number | boolean | string[] | null;

/**
 * One answer, checked against its question and written as text (a number as digits, yes/no as "yes"/"no", a day as
 * YYYY-MM-DD, several choices joined by a new line). Null means not answered. Throws a message for the person.
 */
export function answerText(question: Question, value: AnswerValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (question.kind) {
    case "text": { const text = oneLine(value, 500); return text || null; }
    case "long_text": { const text = typeof value === "string" ? value.trim().slice(0, 4000) : ""; return text || null; }
    case "number": {
      const text = String(value).trim();
      if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(text)) throw new Error(`Answer "${question.label}" with a number.`);
      return text;
    }
    case "yes_no": {
      if (value === true || value === "yes") return "yes";
      if (value === false || value === "no") return "no";
      throw new Error(`Answer "${question.label}" with yes or no.`);
    }
    case "date": {
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`Choose a day for "${question.label}".`);
      return text;
    }
    case "choice": {
      const text = oneLine(value, 120);
      if (!question.options?.includes(text)) throw new Error(`Choose one of the choices for "${question.label}".`);
      return text;
    }
    case "multi_choice": {
      const picked = (Array.isArray(value) ? value : [value]).map((item) => oneLine(item, 120)).filter(Boolean);
      if (picked.some((item) => !question.options?.includes(item))) throw new Error(`Choose from the choices for "${question.label}".`);
      return picked.length ? [...new Set(picked)].join("\n") : null;
    }
  }
}

/** The required questions still unanswered, by label. */
export const missingRequired = (questions: Question[], answers: Record<string, string | null>) =>
  questions.filter((question) => question.required && !answers[question.key]).map((question) => question.label);
