import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** §0.3 P3: the Setup module's questionnaires (the server's shapes). */
export type QuestionnairePurpose = "kickoff" | "handover" | "warranty_claim";
export type QuestionKind = "text" | "long_text" | "number" | "yes_no" | "choice" | "multi_choice" | "date";
export type Question = { key: string; label: string; kind: QuestionKind; required: boolean; options?: string[]; jobTypes?: string[]; help?: string };

export type QuestionnaireSummary = { purpose: QuestionnairePurpose; name: string; step: string; questions: number; required: number; version: number; draftChanged: boolean; updatedAt: string | null };
export type ElsewhereQuestionnaire = { key: "consultation" | "site_visit"; name: string; step: string; questions: number; required: number; href: string };
export type QuestionnaireList = { questionnaires: QuestionnaireSummary[]; elsewhere: ElsewhereQuestionnaire[] };
export type QuestionnaireVersion = { number: number; note: string; publishedAt: string; by: string | null; questions: number };
export type Questionnaire = {
  purpose: QuestionnairePurpose; name: string; step: string; revision: number; draft: Question[]; version: number; draftChanged: boolean; problems: string[];
  versions: QuestionnaireVersion[]; kit: Question[]; jobTypes: Array<{ id: string; label: string }>;
};

/** A job's answers to one questionnaire (carried by the step's own view). */
export type QuestionnaireAnswers = { purpose: QuestionnairePurpose; version: number; questions: Question[]; answers: Record<string, string | null>; answeredAt: string | null; answeredBy: string | null };
export type AnswerValue = string | boolean | string[] | null;

export const QUESTION_KIND_LABEL: Record<QuestionKind, MessageKey> = {
  text: tKey("Short answer"), long_text: tKey("Paragraph"), number: tKey("Number"), yes_no: tKey("Yes or no"), choice: tKey("One choice"), multi_choice: tKey("Several choices"), date: tKey("Date"),
};
/** The server's names and step lines, as message keys (the English text is the key). */
export const QUESTIONNAIRE_LABELS = [
  tKey("Kick-off meeting"), tKey("Handover checklist"), tKey("Warranty claim"), tKey("Consultation"), tKey("Site visit"),
  tKey("Recorded with the kick-off"), tKey("Answered before the handover pack is issued"), tKey("Asked when the client reports a problem"),
  tKey("Asked at the intro meeting"), tKey("Answered on the site measure"),
] as const;

async function call<T>(workspaceId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace/setup/${path}?workspaceId=${workspaceId}`, { ...init, cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Setup could not be saved.");
  return payload as T;
}

export const loadQuestionnaires = (workspaceId: string) => call<QuestionnaireList>(workspaceId, "questionnaires");
export const loadQuestionnaire = (workspaceId: string, purpose: QuestionnairePurpose) => call<Questionnaire>(workspaceId, `questionnaires/${purpose}`);
export const saveQuestionnaireDraft = (workspaceId: string, purpose: QuestionnairePurpose, revision: number, questions: Question[]) =>
  call<Questionnaire>(workspaceId, `questionnaires/${purpose}/draft`, { method: "PUT", body: JSON.stringify({ revision, questions }) });
export const publishQuestionnaire = (workspaceId: string, purpose: QuestionnairePurpose, revision: number, note: string) =>
  call<Questionnaire>(workspaceId, `questionnaires/${purpose}/publish`, { method: "POST", body: JSON.stringify({ revision, note: note || null }) });
export const restoreQuestionnaire = (workspaceId: string, purpose: QuestionnairePurpose, revision: number, number: number) =>
  call<Questionnaire>(workspaceId, `questionnaires/${purpose}/restore`, { method: "POST", body: JSON.stringify({ revision, number }) });

export const isQuestionnairePurpose = (value: string): value is QuestionnairePurpose => ["kickoff", "handover", "warranty_claim"].includes(value);
