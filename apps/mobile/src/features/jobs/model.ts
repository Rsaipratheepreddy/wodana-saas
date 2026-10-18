import { appRouteFor } from '../../core/deep-links';
import { key } from '../../core/i18n';

/**
 * The job journey on the phone (the web's apps/web/lib/jobs/journey.ts, from `GET jobs/overview`, `GET jobs/:id/journey`
 * and `GET jobs/my-day`), without native code so node tests import it: chapters and their calm hues, the step now and
 * where it is worked in the app, the order of My day, and what a capture from a job is filed against.
 */
export type JourneyChapter = 'win' | 'design' | 'price' | 'make' | 'install' | 'care';
export type JourneyLane = 'client' | 'sales' | 'design' | 'finance' | 'delivery';
export type JourneyStepState = 'done' | 'now' | 'next' | 'upcoming' | 'skipped';
export type JourneyStep = {
  key: string; chapter: JourneyChapter; lane: JourneyLane; label: string; state: JourneyStepState;
  doneAt: string | null; doneBy: string | null; dueAt: string | null; href: string | null; note?: string | null;
};
export type JourneyView = {
  jobId: string; reference: string; title: string | null; client: string | null;
  chapters: Array<{ key: JourneyChapter; state: 'done' | 'now' | 'upcoming' | 'skipped'; done: number; total: number }>;
  lanes: JourneyLane[];
  steps: JourneyStep[];
  now: (JourneyStep & { owner: string | null; doneWhen: string }) | null;
  next: JourneyStep[];
  /** Exact decimal string from the server. */
  value: { amount: string; currency: string } | null;
  targetDate: string | null;
};
/** One row of the Jobs list, summarised from its journey. */
export type JobRow = {
  id: string; reference: string; title: string | null; client: string | null; chapter: JourneyChapter | null;
  now: { label: string; owner: string | null; dueAt: string | null; late: boolean } | null;
  progress: { done: number; total: number }; value: { amount: string; currency: string } | null; targetDate: string | null;
};
export type JobsPage = { items: JobRow[]; total: number; limit: number; offset: number };

export type MyDayUrgency = 'late' | 'today' | 'later';
/** One step of mine (`GET jobs/my-day`): mine by name ("owner") or through a seat I hold ("seat"). */
export type MyStep = {
  jobId: string; reference: string; title: string | null; client: string | null; chapter: JourneyChapter;
  step: { key: string; label: string; lane: JourneyLane; doneWhen: string; owner: string | null; dueAt: string | null; href: string | null };
  urgency: MyDayUrgency; why: 'owner' | 'seat'; progress: { done: number; total: number };
};
export type JobsMyDay = {
  generatedAt: string; today: string; timeZone: string;
  counts: { late: number; today: number; later: number; total: number };
  items: MyStep[]; truncated: boolean;
};

export const CHAPTERS: readonly JourneyChapter[] = ['win', 'design', 'price', 'make', 'install', 'care'];
export const CHAPTER_LABEL: Record<JourneyChapter, string> = {
  win: key('Win'), design: key('Design'), price: key('Price'), make: key('Make'), install: key('Install'), care: key('Care'),
};
/** Each chapter's chip colour, the web's CHAPTER_HUE: calm hues only (viz-1, viz-2, viz-6), never a state colour. */
export const CHAPTER_HUE: Record<JourneyChapter, 1 | 2 | 6> = { win: 1, design: 2, price: 6, make: 1, install: 2, care: 6 };
export const LANE_LABEL: Record<JourneyLane, string> = {
  client: key('Client'), sales: key('Sales'), design: key('Design team'), finance: key('Finance'), delivery: key('Delivery'),
};
export const STATE_LABEL: Record<JourneyStepState, string> = {
  done: key('Done'), now: key('Now'), next: key('Next'), upcoming: key('Later'), skipped: key('Not in this job'),
};

/** The chapters in order, each with its steps (empty chapters left out). */
export function chapterBands(view: Pick<JourneyView, 'chapters' | 'steps'>) {
  return view.chapters.map((chapter) => ({ ...chapter, steps: view.steps.filter((step) => step.chapter === chapter.key) })).filter((band) => band.steps.length > 0);
}

/** How far along a job is, 0–1 (a count of steps, never money). */
export const progressShare = (progress: { done: number; total: number }) => (progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0);

const UUID = /^[0-9a-fA-F-]{36}$/;
function parse(href: string | null | undefined) {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://app.invalid');
    const parts = url.pathname.split('/').filter(Boolean);
    return { url, parts: parts[0] === 'workspace' ? parts.slice(1) : parts };
  } catch { return null; }
}

/**
 * Where the step now is worked on the phone, or null when the phone has no screen for it (the job page then shows no
 * action). A case's design and site steps open its survey (measurements, photos, the site questions); a payment to
 * verify opens Approvals; a project's plan, site days and handover open theirs. Quotations, agreements, deal approval,
 * scope and margins have no phone screen.
 */
export function stepRoute(href: string | null | undefined): string | null {
  const link = parse(href);
  if (!link) return null;
  const [area, ...rest] = link.parts;
  if (area === 'pre-projects') {
    const caseId = rest[0] === 'cases' ? rest[1] : rest[0];
    if (!caseId || !UUID.test(caseId)) return null;
    const section = (rest[0] === 'cases' ? rest[2] : rest[1]) ?? '';
    if (['', 'overview', 'designs', 'site'].includes(section)) return `/survey/${caseId}`;
    if (section === 'payments' || section === 'payment-plan') return '/approvals';
    return null;
  }
  if (area === 'projects') {
    const projectId = rest[0];
    if (!projectId || !UUID.test(projectId)) return null;
    const section = rest[1] ?? '';
    if (section === '') return `/projects/${projectId}`;
    if (section === 'plan') return `/projects/${projectId}/plan`;
    if (section === 'site' || section === 'updates') return `/projects/${projectId}/reports`;
    if (section === 'handover') return `/projects/${projectId}/handover`;
    return null;
  }
  return appRouteFor(href);
}

/** What a capture from a job is filed against: its planning case (survey photos by room) and its project (site photos). */
export function captureTarget(hrefs: ReadonlyArray<string | null | undefined>): { caseId: string | null; projectId: string | null } {
  let caseId: string | null = null;
  let projectId: string | null = null;
  for (const href of hrefs) {
    const link = parse(href);
    if (!link) continue;
    const [area, ...rest] = link.parts;
    if (area === 'pre-projects' && !caseId) {
      const id = rest[0] === 'cases' ? rest[1] : rest[0];
      if (id && UUID.test(id)) caseId = id;
    }
    if (area === 'projects' && !projectId && rest[0] && UUID.test(rest[0])) projectId = rest[0];
  }
  return { caseId, projectId };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** The calendar day of an instant in a time zone (YYYY-MM-DD). */
export function dayIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Late when its day (a date) or its time (an instant) has passed; today when it falls on today on the person's calendar;
 * otherwise later. The phone works it out again from its own clock, so a list kept on screen stays right.
 */
export function urgencyOf(dueAt: string | null | undefined, now: Date, timeZone: string): MyDayUrgency {
  if (!dueAt) return 'later';
  const today = dayIn(now, timeZone);
  if (DATE_ONLY.test(dueAt)) return dueAt < today ? 'late' : dueAt === today ? 'today' : 'later';
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return 'later';
  if (at.getTime() < now.getTime()) return 'late';
  return dayIn(at, timeZone) === today ? 'today' : 'later';
}

const RANK: Record<MyDayUrgency, number> = { late: 0, today: 1, later: 2 };
const dueTime = (value: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/** My steps, late first, then due today, then the rest; the earliest due first (undated last), then by job reference. */
export function orderMySteps(items: readonly MyStep[], now: Date, timeZone: string): MyStep[] {
  return items.map((item) => ({ ...item, urgency: urgencyOf(item.step.dueAt, now, timeZone) }))
    .sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || dueTime(a.step.dueAt) - dueTime(b.step.dueAt) || a.reference.localeCompare(b.reference));
}

/** The steps in one urgency (a My day chip): late, today or later; "all" keeps every one. */
export function stepsFor(items: readonly MyStep[], filter: 'all' | 'overdue' | 'today' | 'waiting' | 'upcoming' | 'snoozed') {
  if (filter === 'all') return [...items];
  const wanted: MyDayUrgency | null = filter === 'overdue' ? 'late' : filter === 'today' ? 'today' : filter === 'upcoming' ? 'later' : null;
  return wanted ? items.filter((item) => item.urgency === wanted) : [];
}

/** A job's second line: its reference and client, once each. */
export const jobDetail = (job: { reference: string; title: string | null; client: string | null }) =>
  [...new Set([job.title ? job.reference : null, job.client].filter((part): part is string => Boolean(part)))].join(' · ');

/** The Jobs list under a chapter filter and a search (reference, title, client, step now). */
export function filterJobs(rows: readonly JobRow[], chapter: 'all' | JourneyChapter, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => (chapter === 'all' || row.chapter === chapter)
    && (!needle || [row.reference, row.title, row.client, row.now?.label].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)));
}

/** How many jobs are in each chapter (the chips). */
export const chapterCounts = (rows: readonly JobRow[]) => new Map(CHAPTERS.map((chapter) => [chapter, rows.filter((row) => row.chapter === chapter).length] as const));
