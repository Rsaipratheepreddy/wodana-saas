import { UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  answerText, KIT_QUESTIONS, missingRequired, normaliseQuestions, questionsFor,
  type AnswerValue, type Question, type QuestionnairePurpose,
} from "./questionnaires.domain";

type Db = Pick<PoolClient, "query">;
export type AnswerSubject = { type: "case" | "handover_pack" | "warranty_claim"; id: string };

/** The firm's questionnaire as stored, or the kit's questions when the firm hasn't touched it yet (revision 0). */
export async function loadQuestionnaire(db: Db, workspaceId: string, purpose: QuestionnairePurpose) {
  const row = (await db.query<{ draft: unknown; revision: number; publishedNumber: number; updatedAt: Date }>(
    `SELECT draft, revision, published_number AS "publishedNumber", updated_at AS "updatedAt" FROM setup_questionnaires WHERE workspace_id = $1 AND purpose = $2`,
    [workspaceId, purpose])).rows[0];
  if (!row) return { draft: KIT_QUESTIONS[purpose], revision: 0, publishedNumber: 0, updatedAt: null as string | null };
  return { draft: normaliseQuestions(row.draft), revision: row.revision, publishedNumber: row.publishedNumber, updatedAt: new Date(row.updatedAt).toISOString() };
}

/** The questions of one published version (0 is the kit's). */
export async function versionQuestions(db: Db, workspaceId: string, purpose: QuestionnairePurpose, number: number): Promise<Question[] | null> {
  if (number === 0) return KIT_QUESTIONS[purpose];
  const row = (await db.query<{ questions: unknown }>(`SELECT questions FROM setup_questionnaire_versions WHERE workspace_id = $1 AND purpose = $2 AND number = $3`,
    [workspaceId, purpose, number])).rows[0];
  return row ? normaliseQuestions(row.questions) : null;
}

/** The version a new job answers: the latest published (the kit's while nothing is published). */
export async function publishedQuestions(db: Db, workspaceId: string, purpose: QuestionnairePurpose) {
  const number = (await db.query<{ number: number }>(`SELECT published_number AS number FROM setup_questionnaires WHERE workspace_id = $1 AND purpose = $2`,
    [workspaceId, purpose])).rows[0]?.number ?? 0;
  return { number, questions: (await versionQuestions(db, workspaceId, purpose, number)) ?? KIT_QUESTIONS[purpose] };
}

export type QuestionnaireAnswers = {
  purpose: QuestionnairePurpose;
  version: number;
  questions: Question[];
  answers: Record<string, string | null>;
  answeredAt: string | null;
  answeredBy: string | null;
};

/** A job's questionnaire: the version it answered (or the one it will), the questions for its type, and its answers so far. */
export async function readAnswers(db: Db, workspaceId: string, purpose: QuestionnairePurpose, subject: AnswerSubject, jobType: string | null): Promise<QuestionnaireAnswers> {
  const rows = (await db.query<{ key: string; answer: string | null; version: number; at: Date; by: string | null }>(
    `SELECT answer.question_key AS key, answer.answer, answer.version_number AS version, answer.answered_at AS at,
            coalesce(person.display_name, answer.answered_by_name) AS by
       FROM setup_questionnaire_answers answer LEFT JOIN users person ON person.id = answer.answered_by
      WHERE answer.workspace_id = $1 AND answer.purpose = $2 AND answer.subject_type = $3 AND answer.subject_id = $4
      ORDER BY answer.answered_at DESC`, [workspaceId, purpose, subject.type, subject.id])).rows;
  const pinned = rows.length ? rows[0].version : null;
  const version = pinned ?? (await publishedQuestions(db, workspaceId, purpose)).number;
  const questions = questionsFor((await versionQuestions(db, workspaceId, purpose, version)) ?? KIT_QUESTIONS[purpose], jobType);
  const answers: Record<string, string | null> = {};
  for (const question of questions) answers[question.key] = rows.find((row) => row.key === question.key)?.answer ?? null;
  return { purpose, version, questions, answers, answeredAt: rows[0] ? new Date(rows[0].at).toISOString() : null, answeredBy: rows[0]?.by ?? null };
}

/**
 * Writes a job's answers to its questionnaire (unknown keys refused; answers checked against their questions). With
 * `complete`, every required question must be answered: one error lists them all. Answering nothing writes nothing.
 */
export async function writeAnswers(db: Db, workspaceId: string, purpose: QuestionnairePurpose, subject: AnswerSubject,
  values: Record<string, AnswerValue> | undefined, by: { userId: string | null; name: string | null }, jobType: string | null, options: { complete: boolean }) {
  const current = await readAnswers(db, workspaceId, purpose, subject, jobType);
  const merged: Record<string, string | null> = { ...current.answers };
  const changed: Array<{ question: Question; text: string | null }> = [];
  for (const [key, value] of Object.entries(values ?? {})) {
    const question = current.questions.find((item) => item.key === key);
    if (!question) throw new UnprocessableEntityException("A question changed. Reload and answer again.");
    let text: string | null;
    try { text = answerText(question, value); } catch (error) { throw new UnprocessableEntityException((error as Error).message); }
    if (text === merged[key]) continue;
    merged[key] = text;
    changed.push({ question, text });
  }
  if (options.complete) {
    const missing = missingRequired(current.questions, merged);
    if (missing.length) throw new UnprocessableEntityException(`Answer first: ${missing.join("; ")}`);
  }
  for (const { question, text } of changed) {
    await db.query(
      `INSERT INTO setup_questionnaire_answers (workspace_id, purpose, subject_type, subject_id, version_number, question_key, question_label, answer, answered_by, answered_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (workspace_id, purpose, subject_type, subject_id, question_key)
       DO UPDATE SET answer = excluded.answer, question_label = excluded.question_label, answered_by = excluded.answered_by, answered_by_name = excluded.answered_by_name, answered_at = now()`,
      [workspaceId, purpose, subject.type, subject.id, current.version, question.key, question.label, text, by.userId, by.name?.slice(0, 200) ?? null]);
  }
  return { changed: changed.length, version: current.version };
}
