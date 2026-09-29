import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseProgress, fromPlan, reportBody, reportProblems, stepOf, tagPhoto } from '../src/features/projects/report-model';

const plan = { crew: [{ trade: 'Carpenters', people: 3, hours: '8.00' }], plan: { today: [], tomorrow: { day: '2026-09-28', tasks: [{ id: 't1', title: 'Fit carcasses' }, { id: 't2', title: 'Template the worktop' }] } } };
const label = (text: string) => text;

test('a new day starts from the plan: yesterday\'s crew and tomorrow\'s work', () => {
  const draft = fromPlan(plan);
  assert.deepEqual(draft.workforce, [{ trade: 'Carpenters', people: 3, hours: 8 }]);
  assert.deepEqual(draft.next.map((item) => item.workItemId), ['t1', 't2']);
});

test('one tap per task: finished today leaves tomorrow; a second tap clears it', () => {
  let draft = chooseProgress(fromPlan(plan), 't1', 100);
  assert.deepEqual(draft.tasks, { t1: { progress: 100, note: '' } });
  assert.deepEqual(draft.next.map((item) => item.workItemId), ['t2']);
  draft = chooseProgress(draft, 't1', null);
  assert.deepEqual(draft.tasks, {});
  assert.deepEqual([stepOf(10), stepOf(30), stepOf(80), stepOf(100)], [10, 25, 75, 100]);
});

test('a before and after pair points both ways, in the same room', () => {
  let draft = tagPhoto(fromPlan(plan), 'a', { areaId: 'kitchen', phase: 'before' });
  draft = tagPhoto(draft, 'a', { pairId: 'b' });
  assert.deepEqual(draft.photos.b, { areaId: 'kitchen', phase: 'after', pairId: 'a' });
  draft = tagPhoto(draft, 'a', { pairId: null });
  assert.equal(draft.photos.b.pairId, null);
});

test('the server gets complete parts, and a submit needs a photo or why no work was done', () => {
  const draft = { ...chooseProgress(fromPlan(plan), 't1', 50), issues: [{ id: 'i1', severity: 'major' as const, description: ' Tiles cracked ', internal: true }] };
  const body = reportBody(draft, '2026-09-27');
  assert.deepEqual(body.tasks, [{ workItemId: 't1', progress: 50, note: '' }]);
  assert.deepEqual(body.issues, [{ id: 'i1', severity: 'major', description: 'Tiles cracked', internal: true }]);
  assert.deepEqual(body.workforce, [{ trade: 'Carpenters', people: 3, hours: 8 }]);
  assert.deepEqual(reportProblems(draft, 0, true, label), ['Add a photo, or say why no work was done.']);
  assert.deepEqual(reportProblems(draft, 1, true, label), []);
});
