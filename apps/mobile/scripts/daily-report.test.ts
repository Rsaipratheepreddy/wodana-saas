import assert from 'node:assert/strict';
import test from 'node:test';
import { makeFormat } from '../src/core/format-core';
import { translate } from '../src/core/i18n';
import { chooseProgress, fromPlan, photoRow, reportBody, reportProblems, stepOf, tagPhoto, taskRow } from '../src/features/projects/report-model';

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
  assert.deepEqual(body.issues, [{ id: 'i1', severity: 'major', description: 'Tiles cracked', internal: true, ownerId: null, dueOn: null }]);
  assert.deepEqual(body.workforce, [{ trade: 'Carpenters', people: 3, hours: 8 }]);
  assert.deepEqual(reportProblems(draft, 0, true, label), ['Add a photo, or say why no work was done.']);
  assert.deepEqual(reportProblems(draft, 1, true, label), []);
});

const t = (key: string, vars?: Record<string, string | number>) => translate({}, key, vars);

test('a photo\'s row names its room once chosen; "Choose a room" shows only until then', () => {
  const areaName = (id: string | null) => (id === 'kitchen' ? 'Kitchen' : null);
  assert.deepEqual(photoRow(undefined, 0, ['a', 'b'], areaName, t), { title: 'Photo 1', detail: 'Choose a room' });
  assert.deepEqual(photoRow({ areaId: 'kitchen', phase: null, pairId: null }, 0, ['a', 'b'], areaName, t), { title: 'Kitchen' });
  assert.deepEqual(photoRow({ areaId: 'kitchen', phase: 'before', pairId: 'b' }, 0, ['a', 'b'], areaName, t), { title: 'Kitchen', detail: 'Before · Paired with photo 2' });
  assert.deepEqual(photoRow({ areaId: null, phase: 'after', pairId: null }, 1, ['a', 'b'], areaName, t), { title: 'Photo 2', detail: 'After' });
});

test('a task\'s due day is the same calendar day in every zone, with its full year when it isn\'t this year\'s; "late" is the plan\'s call', () => {
  const task = { id: 't1', title: 'Fit on site', status: 'todo' as const, progress: null, dueDate: '2026-12-01', overdue: false, packageName: 'Living room' };
  const year = new Date().getUTCFullYear();
  for (const timeZone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Dubai']) {
    const row = taskRow({ ...task, dueDate: `${year + 1}-12-01` }, makeFormat({ locale: 'en-GB', timeZone }), t);
    assert.equal(row.detail, `Living room · Due 1 Dec ${year + 1}`, timeZone);
    assert.equal(row.overdue, false);
  }
  const dubai = makeFormat({ locale: 'en-GB', timeZone: 'Asia/Dubai' });
  assert.equal(taskRow({ ...task, dueDate: `${year}-12-01` }, dubai, t).detail, 'Living room · Due 1 Dec');
  assert.deepEqual(taskRow({ ...task, status: 'in_progress', progress: 25, overdue: true, dueDate: `${year}-10-01` }, dubai, t),
    { id: 't1', title: 'Fit on site', overdue: true, done: false, detail: 'Living room · Due 1 Oct · Now 25%' });
  assert.deepEqual(taskRow({ ...task, status: 'done', progress: 100, dueDate: null, packageName: null }, dubai, t), { id: 't1', title: 'Fit on site', overdue: false, done: true, detail: '' });
});
