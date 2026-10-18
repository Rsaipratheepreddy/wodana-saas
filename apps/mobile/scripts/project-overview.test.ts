import assert from 'node:assert/strict';
import test from 'node:test';
import { blockerLabel, inPlanFilter, planFilterOf, stageLateBy } from '../src/features/projects/overview-model';

test('what holds a project up reads in the web\'s words, one or many', () => {
  assert.equal(blockerLabel('late_work', 1), 'task late');
  assert.equal(blockerLabel('late_work', 3), 'tasks late');
  assert.equal(blockerLabel('client_decisions', 2), 'waiting on the client');
  assert.equal(blockerLabel('funds_short', 1), 'spent beyond what the client paid');
});

test('a stage is late only while work is open past its planned end', () => {
  assert.equal(stageLateBy({ end: '2026-09-20', open: 2 }, '2026-09-29'), 9);
  assert.equal(stageLateBy({ end: '2026-09-29', open: 2 }, '2026-09-29'), 0);
  assert.equal(stageLateBy({ end: '2026-09-20', open: 0 }, '2026-09-29'), 0);
  assert.equal(stageLateBy({ end: null, open: 2 }, '2026-09-29'), 0);
  assert.equal(stageLateBy(undefined, '2026-09-29'), 0);
});

test('the plan\'s quick filters: late, blocked (a blocker or waiting on unfinished work), snags, done', () => {
  const base = { status: 'todo' as const, dueDate: null as string | null, type: 'task' as const, blockedBy: [] as Array<{ status: string }> };
  const today = '2026-09-29';
  assert.equal(inPlanFilter({ ...base, dueDate: '2026-09-28' }, 'late', today), true);
  assert.equal(inPlanFilter({ ...base, dueDate: '2026-09-29' }, 'late', today), false);
  assert.equal(inPlanFilter({ ...base, status: 'done', dueDate: '2026-09-01' }, 'late', today), false);
  assert.equal(inPlanFilter({ ...base, type: 'blocker' }, 'blocked', today), true);
  assert.equal(inPlanFilter({ ...base, blockedBy: [{ status: 'in_progress' }] }, 'blocked', today), true);
  assert.equal(inPlanFilter({ ...base, blockedBy: [{ status: 'done' }] }, 'blocked', today), false);
  assert.equal(inPlanFilter({ ...base, type: 'snag' }, 'snags', today), true);
  assert.equal(inPlanFilter({ ...base, status: 'cancelled' }, 'done', today), true);
  assert.equal(planFilterOf('late'), 'late');
  assert.equal(planFilterOf('materials'), 'blocked');
  assert.equal(planFilterOf('drop tables'), null);
});
