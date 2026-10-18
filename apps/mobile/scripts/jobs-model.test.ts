import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  captureTarget, CHAPTER_HUE, chapterBands, chapterCounts, filterJobs, jobDetail, orderMySteps, progressShare, stepRoute, stepsFor, urgencyOf,
  type JobRow, type JourneyStep, type MyStep,
} from '../src/features/jobs/model';

const CASE = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const LEAD = '33333333-3333-4333-8333-333333333333';
const step = (reference: string, dueAt: string | null, urgency: MyStep['urgency'] = 'later'): MyStep => ({
  jobId: `job-${reference}`, reference, title: `Villa ${reference}`, client: 'Client', chapter: 'design',
  step: { key: 'design:site_visit', label: 'Site visit', lane: 'design', doneWhen: 'Site visit: done', owner: null, dueAt, href: `/workspace/pre-projects/cases/${CASE}/designs` },
  urgency, why: 'seat', progress: { done: 3, total: 40 },
});

test('My day orders my steps late first, then due today, then the rest; earliest first and undated last', () => {
  const now = new Date('2026-10-17T08:00:00Z');
  const ordered = orderMySteps([
    step('J-6', null), step('J-5', '2026-10-20'), step('J-4', '2026-10-17T15:00:00Z'), step('J-3', '2026-10-17'),
    step('J-2', '2026-10-15'), step('J-1', '2026-10-10T10:00:00Z'), step('J-0', '2026-10-17T07:30:00Z'),
  ], now, 'UTC');
  assert.deepEqual(ordered.map((item) => [item.reference, item.urgency]), [
    ['J-1', 'late'], ['J-2', 'late'], ['J-0', 'late'], ['J-3', 'today'], ['J-4', 'today'], ['J-5', 'later'], ['J-6', 'later'],
  ]);
});

test('the phone works lateness out again on its own clock, in the person\'s time zone', () => {
  // The server said "today" at breakfast; by the evening the time has passed and it reads late.
  const kept = [step('J-1', '2026-10-17T12:00:00Z', 'today'), step('J-2', '2026-10-18', 'later')];
  assert.deepEqual(orderMySteps(kept, new Date('2026-10-17T18:00:00Z'), 'UTC').map((item) => item.urgency), ['late', 'later']);
  // 21:00 UTC on the 17th is already the 18th in a zone five and a half hours east.
  assert.equal(urgencyOf('2026-10-17T21:00:00Z', new Date('2026-10-17T08:00:00Z'), 'Asia/Kolkata'), 'later');
  assert.equal(urgencyOf('2026-10-17T21:00:00Z', new Date('2026-10-17T08:00:00Z'), 'UTC'), 'today');
  assert.equal(urgencyOf(null, new Date(), 'UTC'), 'later');
});

test('My day chips keep the steps of their urgency', () => {
  const items = orderMySteps([step('A', '2026-10-01'), step('B', '2026-10-17'), step('C', null)], new Date('2026-10-17T08:00:00Z'), 'UTC');
  assert.deepEqual(stepsFor(items, 'overdue').map((item) => item.reference), ['A']);
  assert.deepEqual(stepsFor(items, 'today').map((item) => item.reference), ['B']);
  assert.deepEqual(stepsFor(items, 'upcoming').map((item) => item.reference), ['C']);
  assert.deepEqual(stepsFor(items, 'snoozed'), []);
  assert.equal(stepsFor(items, 'all').length, 3);
});

test('chapter chips use the web\'s calm hues (blue, purple, teal), never a state colour', async () => {
  assert.deepEqual(CHAPTER_HUE, { win: 1, design: 2, price: 6, make: 1, install: 2, care: 6 });
  const web = await readFile(new URL('../../web/lib/jobs/journey.ts', import.meta.url), 'utf8');
  const literal = web.match(/CHAPTER_HUE[^=]*=\s*(\{[^}]*\})/)?.[1];
  assert.ok(literal, 'the web defines CHAPTER_HUE');
  const parsed = Object.fromEntries([...literal.matchAll(/(\w+):\s*(\d)/g)].map((match) => [match[1], Number(match[2])]));
  assert.deepEqual(parsed, CHAPTER_HUE, 'same mapping as apps/web/lib/jobs/journey.ts');
  for (const hue of Object.values(CHAPTER_HUE)) assert.ok([1, 2, 6].includes(hue), 'viz-3/4/5 (green, amber, red) are never a chapter');
});

test('the step now opens the matching phone screen when there is one, otherwise nothing', () => {
  assert.equal(stepRoute(`/workspace/pre-projects/cases/${CASE}/designs`), `/survey/${CASE}`);
  assert.equal(stepRoute(`/workspace/pre-projects/cases/${CASE}/payments`), '/approvals');
  assert.equal(stepRoute(`/workspace/pre-projects/cases/${CASE}/quotations`), null);
  assert.equal(stepRoute(`/workspace/pre-projects/cases/${CASE}/agreement`), null);
  assert.equal(stepRoute(`/workspace/projects/${PROJECT}`), `/projects/${PROJECT}`);
  assert.equal(stepRoute(`/workspace/projects/${PROJECT}/site`), `/projects/${PROJECT}/reports`);
  assert.equal(stepRoute(`/workspace/projects/${PROJECT}/handover`), `/projects/${PROJECT}/handover`);
  assert.equal(stepRoute(`/workspace/projects/${PROJECT}/money`), null);
  assert.equal(stepRoute(`/workspace/crm/leads?lead=${LEAD}`), `/sales/${LEAD}`);
  assert.equal(stepRoute(null), null);
});

test('a capture from a job is filed against its case and its project', () => {
  assert.deepEqual(captureTarget([`/workspace/crm/leads?lead=${LEAD}`, `/workspace/pre-projects/cases/${CASE}/designs`, `/workspace/projects/${PROJECT}/site`]), { caseId: CASE, projectId: PROJECT });
  assert.deepEqual(captureTarget([`/workspace/crm/leads?lead=${LEAD}`, null]), { caseId: null, projectId: null });
});

test('the Jobs list filters by chapter and search, counts each chapter, and reads progress as a share of steps', () => {
  const row = (id: string, chapter: JobRow['chapter'], label: string): JobRow => ({ id, reference: `J-${id}`, title: `Villa ${id}`, client: 'Client', chapter,
    now: chapter ? { label, owner: null, dueAt: null, late: false } : null, progress: { done: 2, total: 8 }, value: { amount: '1250.50', currency: 'USD' }, targetDate: null });
  const rows = [row('1', 'win', 'First contact'), row('2', 'design', 'Site visit'), row('3', 'design', 'Concepts'), row('4', null, '')];
  assert.deepEqual(filterJobs(rows, 'design', '').map((item) => item.id), ['2', '3']);
  assert.deepEqual(filterJobs(rows, 'all', 'site').map((item) => item.id), ['2']);
  assert.equal(chapterCounts(rows).get('design'), 2);
  assert.equal(progressShare({ done: 2, total: 8 }), 0.25);
  assert.equal(progressShare({ done: 0, total: 0 }), 0);
  assert.equal(jobDetail({ reference: 'J-1', title: 'Villa', client: 'Client' }), 'J-1 · Client');
  assert.equal(jobDetail({ reference: 'J-1', title: null, client: null }), '');
  const steps: JourneyStep[] = [{ key: 'a', chapter: 'win', lane: 'sales', label: 'A', state: 'done', doneAt: null, doneBy: null, dueAt: null, href: null }];
  assert.deepEqual(chapterBands({ chapters: [{ key: 'win', state: 'done', done: 1, total: 1 }, { key: 'care', state: 'upcoming', done: 0, total: 0 }], steps }).map((band) => band.key), ['win']);
});
