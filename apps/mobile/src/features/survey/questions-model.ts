import { key } from '../../core/i18n';

/**
 * The site visit's questions on the phone (`GET pre-projects/:caseId/design-journey`): the firm's published list as the
 * job carries it, the groups asked on this job (the general questions, then the checklists that apply), and what the
 * phone sends. Questions are optional unless the firm marked them required. Pure functions (node tests import them).
 */
export type CheckStatus = 'confirmed' | 'pending' | 'not_applicable';
export const CHECK_STATUSES: readonly CheckStatus[] = ['confirmed', 'pending', 'not_applicable'];
export const CHECK_LABEL: Record<CheckStatus, string> = { confirmed: key('Confirmed'), pending: key('Pending'), not_applicable: key('Not applicable') };

export type SiteChecklistItem = {
  key: string; question: string; scope?: string | null; section?: string | null; kind?: 'answer' | 'check'; required?: boolean;
  answer: string | null; status?: CheckStatus | null; answeredByName: string | null; answeredAt: string | null;
};
export type SiteChecklistGroup = { scope: string | null; section?: string | null; applies?: boolean; required: boolean; keys: string[]; pending?: number };
/** The part of the design journey the phone reads. */
export type DesignJourneyView = {
  journey?: unknown | null;
  stages?: Array<{ stage: string; status: string; version: number }>;
  siteVisit?: { within: 'stage' | 'task'; open: boolean; done: boolean; version: number } | null;
  checklist?: SiteChecklistItem[];
  checklistGroups?: SiteChecklistGroup[];
  canEdit?: boolean;
};
export type SiteAnswer = { key: string; answer: string; status: CheckStatus | null };
export type AnswerDraft = { answer: string; status: CheckStatus | null };
export type QuestionGroup = { id: string; title: string | null; questions: SiteChecklistItem[] };

const kickoffOpen = (view: DesignJourneyView) => view.stages?.some((stage) => stage.stage === 'kickoff' && stage.status === 'active') ?? false;

/** The version the answers are recorded against: the kick-off's while it is the current step, else the site visit's. */
export function answerVersion(view: DesignJourneyView): number | null {
  const kickoff = view.stages?.find((stage) => stage.stage === 'kickoff' && stage.status === 'active');
  if (kickoff) return kickoff.version;
  return view.siteVisit?.version ?? null;
}

/** Whether this question can be answered now: while the kick-off or the visit is open; a checklist line also after the visit. */
export function answerable(view: DesignJourneyView, item: Pick<SiteChecklistItem, 'kind'>) {
  if (view.canEdit === false || answerVersion(view) === null) return false;
  if (kickoffOpen(view) || view.siteVisit?.open) return true;
  return !!view.siteVisit?.done && item.kind === 'check';
}

/** The groups asked on this job, in the server's order (general questions first), each with its questions; empty groups left out. */
export function askedGroups(view: DesignJourneyView): QuestionGroup[] {
  const checklist = view.checklist ?? [];
  const byKey = new Map(checklist.map((item) => [item.key, item]));
  const groups = view.checklistGroups ?? [];
  if (!groups.length) return checklist.length ? [{ id: 'all', title: null, questions: checklist }] : [];
  return groups.filter((group) => group.required).map((group) => ({
    id: group.scope ? `scope:${group.scope}` : `section:${group.section ?? ''}`,
    title: group.scope ?? group.section ?? null,
    questions: group.keys.map((entry) => byKey.get(entry)).filter((item): item is SiteChecklistItem => Boolean(item)),
  })).filter((group) => group.questions.length > 0);
}

/** The answers as saved, to edit. */
export const draftsFrom = (checklist: readonly SiteChecklistItem[]): Record<string, AnswerDraft> =>
  Object.fromEntries(checklist.map((item) => [item.key, { answer: item.answer ?? '', status: item.status ?? null }]));

/** Answered: a checklist line has its status, a question its words. */
export const isAnswered = (item: Pick<SiteChecklistItem, 'kind'>, draft: AnswerDraft | undefined) =>
  item.kind === 'check' ? !!draft?.status : !!draft?.answer.trim();

/** How many asked questions the firm marked required are still unanswered. */
export const requiredLeft = (groups: readonly QuestionGroup[], drafts: Record<string, AnswerDraft>) =>
  groups.flatMap((group) => group.questions).filter((item) => item.required && !isAnswered(item, drafts[item.key])).length;

/** What changed against what is saved: only these are sent (an emptied answer clears it). */
export function changedAnswers(drafts: Record<string, AnswerDraft>, checklist: readonly SiteChecklistItem[]): SiteAnswer[] {
  return checklist.flatMap((item) => {
    const draft = drafts[item.key];
    if (!draft) return [];
    const answer = draft.answer.trim().slice(0, 4000);
    const status = item.kind === 'check' ? draft.status : null;
    // A checklist line's note goes with its status (the server's rule): without one it isn't sent yet.
    if (item.kind === 'check' && answer && !status) return [];
    return answer === (item.answer ?? '').trim() && status === (item.kind === 'check' ? item.status ?? null : null) ? [] : [{ key: item.key, answer, status }];
  });
}
