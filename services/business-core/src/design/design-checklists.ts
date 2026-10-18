import type { PoolClient } from "pg";
import {
  groupSiteQuestions, normaliseChecklistScopes, normaliseSiteQuestions, pendingChecks, workOrderChecklists,
  type CheckStatus, type ChecklistScope, type SiteQuestion, type SiteQuestionGroup,
} from "./design-journey.domain";

type Db = Pick<PoolClient, "query">;

export type ChecklistAnswer = { key: string; answer: string; status: CheckStatus | null; answeredByName: string | null; answeredAt: Date; version: number };
export type ChecklistChoice = { scopeKey: string; scope: string; applies: boolean; version: number; chosenByName: string | null; chosenAt: Date };

/**
 * A job's question list as its journey froze it, the names it is matched on (its rooms and areas, and the lines of its
 * quotations), the designer's choices per checklist, the answers, and the list grouped from all of them.
 */
export type JobChecklist = {
  questions: SiteQuestion[]; scopes: ChecklistScope[]; names: string[]; choices: ChecklistChoice[]; answers: ChecklistAnswer[]; groups: SiteQuestionGroup[];
};

/** The job's names the checklists match: its rooms and areas in the brief, and the lines of its quotations. */
export async function jobNames(db: Db, workspaceId: string, caseId: string) {
  const rooms = (await db.query<{ name: string }>(`SELECT name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY name`, [workspaceId, caseId])).rows.map((row) => row.name);
  const lines = (await db.query<{ title: string }>(
    `SELECT DISTINCT line.title FROM commercial_quote_lines line WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.title <> '' ORDER BY line.title LIMIT 500`,
    [workspaceId, caseId])).rows.map((row) => row.title);
  return [...rooms, ...lines];
}

export async function readJobChecklist(db: Db, workspaceId: string, caseId: string): Promise<JobChecklist | null> {
  const journey = (await db.query<{ questions: unknown; scopes: unknown }>(
    `SELECT site_visit_questions AS questions, site_visit_scopes AS scopes FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
  if (!journey) return null;
  const questions = normaliseSiteQuestions(journey.questions);
  const scopes = normaliseChecklistScopes(journey.scopes);
  const names = await jobNames(db, workspaceId, caseId);
  const choices = (await db.query<ChecklistChoice>(
    `SELECT choice.scope_key AS "scopeKey", choice.scope, choice.applies, choice.version, account.display_name AS "chosenByName", choice.chosen_at AS "chosenAt"
       FROM design_checklist_choices choice LEFT JOIN users account ON account.id = choice.chosen_by
      WHERE choice.workspace_id = $1 AND choice.case_id = $2`, [workspaceId, caseId])).rows;
  const answers = (await db.query<ChecklistAnswer>(
    `SELECT answer.question_key AS key, answer.answer, answer.status, account.display_name AS "answeredByName", answer.answered_at AS "answeredAt", answer.version
       FROM design_site_visit_answers answer LEFT JOIN users account ON account.id = answer.answered_by WHERE answer.workspace_id = $1 AND answer.case_id = $2`,
    [workspaceId, caseId])).rows;
  const groups = groupSiteQuestions(questions, names, { scopes, chosen: new Map(choices.map((choice) => [choice.scopeKey, choice.applies])) });
  return { questions, scopes, names, choices, answers, groups };
}

/** The open items of the job: pending lines of the checklists that apply. */
export const jobPending = (job: Pick<JobChecklist, "groups" | "answers">) =>
  pendingChecks(job.groups, (key) => job.answers.find((answer) => answer.key === key)?.status ?? null);

export type ChecklistItemView = {
  key: string; question: string; kind: "answer" | "check"; answer: string | null; status: CheckStatus | null; answeredByName: string | null; answeredAt: Date | null;
};
export type ChecklistGroupView = { scope: string | null; section: string | null; everyJob: boolean; pending: number; items: ChecklistItemView[] };

/** A group as read on the project and the factory: its questions with their answers, and its open items. */
export function groupView(group: SiteQuestionGroup, answers: ChecklistAnswer[]): ChecklistGroupView {
  const items = group.questions.map((question): ChecklistItemView => {
    const found = answers.find((answer) => answer.key === question.key);
    return { key: question.key, question: question.question, kind: question.kind === "check" ? "check" : "answer", answer: found?.answer || null, status: found?.status ?? null,
      answeredByName: found?.answeredByName ?? null, answeredAt: found?.answeredAt ?? null };
  });
  return { scope: group.scope, section: group.section, everyJob: group.everyJob, pending: items.filter((item) => item.status === "pending").length, items };
}

/**
 * The project's brief: the general questions by section, then the checklists that apply to the job, read-only, with the
 * open items counted. Null before the job's design (or site visit) started.
 */
export async function projectBrief(db: Db, workspaceId: string, caseId: string | null) {
  const job = caseId ? await readJobChecklist(db, workspaceId, caseId) : null;
  if (!job) return { groups: [], pending: 0 };
  const groups = job.groups.filter((group) => group.applies).map((group) => groupView(group, job.answers));
  return { groups, pending: groups.reduce((sum, group) => sum + group.pending, 0) };
}

/** A work order's checklists: those of the job that match its item, package or room (all of the job's when none does). */
export async function workOrderBrief(db: Db, workspaceId: string, caseId: string, orderNames: string[]) {
  const job = await readJobChecklist(db, workspaceId, caseId);
  if (!job) return { groups: [], pending: 0 };
  const groups = workOrderChecklists(job.groups, job.scopes, orderNames).map((group) => groupView(group, job.answers));
  return { groups, pending: groups.reduce((sum, group) => sum + group.pending, 0) };
}
