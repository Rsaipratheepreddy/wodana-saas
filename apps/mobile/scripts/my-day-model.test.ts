import assert from 'node:assert/strict';
import test from 'node:test';
import type { MyDayCounts, MyDayGroup, MyDayItem, MyDayResponse } from '../../../packages/contracts/src/reminders';
import {
  applyActionResult, groupedEntries, groupHeading, isFilter, myDayDueLabel, remindedLabel, rowActions, snoozeInput, snoozePresets, snoozeProblem, topItems,
} from '../src/features/today/my-day-model';

const item = (id: string, overrides: Partial<MyDayItem> = {}): MyDayItem => ({
  id, kind: 'work.due', module: 'projects', title: `Item ${id}`, context: 'Kitchen', href: `/workspace/projects/${id}`,
  dueAt: null, urgency: 'today', critical: false, audience: 'staff', owner: null,
  reminders: { sent: 0, escalationLevel: 0, nextAt: null }, snoozed: null, actions: ['open', 'snooze'], completeLabel: null, version: 1, ...overrides,
});
const counts = (values: Partial<MyDayCounts> = {}): MyDayCounts => ({ overdue: 0, today: 0, upcoming: 0, waiting: 0, snoozed: 0, total: 0, ...values });
const response = (groups: MyDayGroup[], values?: Partial<MyDayCounts>): MyDayResponse => ({
  generatedAt: '2026-10-11T06:00:00Z', scope: 'me', timeZone: 'Asia/Dubai', today: '2026-10-11', counts: counts(values), groups,
});
const snoozedUntil = { until: '2026-10-12T04:00:00.000Z', reason: 'Client travelling' };

// Two jobs and the work that belongs to none, in the server's order; snoozed "d" is as a cached list may hold it after a snooze.
const data = response([
  { jobId: 'j1', jobReference: 'J-1', title: 'Villa 402', href: '/workspace/jobs/j1', items: [
    item('a', { urgency: 'upcoming', dueAt: '2026-10-13T08:00:00Z' }),
    item('b', { urgency: 'today', dueAt: '2026-10-11T12:00:00Z' }),
  ] },
  { jobId: 'j2', jobReference: 'J-2', title: 'Flat 7', href: '/workspace/jobs/j2', items: [
    item('c', { urgency: 'overdue', dueAt: '2026-10-09T08:00:00Z' }),
    item('d', { urgency: 'snoozed', snoozed: snoozedUntil }),
    item('e', { urgency: 'waiting', kind: 'approval.waiting', module: 'approvals', critical: true }),
    item('f', { urgency: 'today', critical: true, dueAt: '2026-10-11T15:00:00Z' }),
  ] },
  { jobId: null, jobReference: null, title: '', href: null, items: [
    item('g', { urgency: 'waiting', kind: 'crm.reply_waiting', module: 'sales', dueAt: '2026-10-10T08:00:00Z' }),
  ] },
], { overdue: 1, today: 2, upcoming: 1, waiting: 2, snoozed: 1, total: 6 });
const ids = (entries: { item: MyDayItem }[]) => entries.map((entry) => entry.item.id);

test('Today shows the most urgent open items across jobs: overdue, today (critical first), waiting, upcoming; never a snoozed one', () => {
  assert.deepEqual(ids(topItems(data, 10)), ['c', 'f', 'b', 'e', 'g', 'a'], 'within waiting, critical before the earliest due');
  assert.deepEqual(ids(topItems(data, 10, ['approval.waiting'])), ['c', 'f', 'b', 'g', 'a'], 'approvals have their own row on Today');
  assert.deepEqual(ids(topItems(data, 2)), ['c', 'f']);
  assert.equal(topItems(data, 1)[0].group.jobReference, 'J-2', 'each row keeps its job');
  assert.deepEqual(topItems(null, 6), []);
});

test('the full list goes job by job in the server\'s order, each job most urgent first; snoozed items only under their chip', () => {
  assert.deepEqual(ids(groupedEntries(data)), ['b', 'a', 'c', 'f', 'e', 'g']);
  assert.deepEqual(ids(groupedEntries(data, 'today')), ['b', 'f'], 'a chip keeps only its urgency');
  assert.deepEqual(ids(groupedEntries(data, 'snoozed')), ['d']);
  assert.deepEqual(groupedEntries(undefined), []);
  assert.equal(groupHeading({ jobReference: 'J-2', title: 'Flat 7' }, 'Other work'), 'J-2 · Flat 7');
  assert.equal(groupHeading({ jobReference: 'J-9', title: 'J-9' }, 'Other work'), 'J-9', 'a job without a title shows its reference once');
  assert.equal(groupHeading({ jobReference: null, title: '' }, 'Other work'), 'Other work');
  assert.ok(isFilter('snoozed') && isFilter('upcoming') && isFilter('all'));
  assert.ok(!isFilter('team') && !isFilter(undefined) && !isFilter(['today']));
});

test('a row says how often it was chased and whether it escalated', () => {
  assert.equal(remindedLabel(item('x')), null);
  assert.deepEqual(remindedLabel(item('x', { reminders: { sent: 2, escalationLevel: 0, nextAt: null } })), { key: 'Reminded {count}×', values: { count: 2 } });
  assert.deepEqual(remindedLabel(item('x', { reminders: { sent: 2, escalationLevel: 1, nextAt: null } })), { key: 'Reminded {count}× · escalated', values: { count: 2 } });
  assert.deepEqual(remindedLabel(item('x', { reminders: { sent: 0, escalationLevel: 1, nextAt: null } })), { key: 'Escalated' });
});

test('when a row is due reads on the person\'s calendar', () => {
  const format = { time: (value: string) => value.slice(11, 16), date: (value: string) => `<${value}>`, when: (value: string) => `[${value}]` };
  const due = (overrides: Partial<MyDayItem>) => myDayDueLabel(item('x', overrides), '2026-10-11', 'Asia/Dubai', format);
  assert.deepEqual(due({ urgency: 'upcoming', dueAt: '2026-10-12T05:00:00Z' }), { key: 'Tomorrow' });
  assert.deepEqual(due({ urgency: 'upcoming', dueAt: '2026-10-11T21:00:00Z' }), { key: 'Tomorrow' }, 'already the 12th in the person\'s zone');
  assert.deepEqual(due({ urgency: 'upcoming', dueAt: '2026-10-14' }), { key: 'Due {date}', values: { date: '<2026-10-14>' } });
  assert.deepEqual(due({ urgency: 'snoozed', snoozed: snoozedUntil, dueAt: '2026-10-09T08:00:00Z' }), { key: 'Snoozed until {date}', values: { date: '[2026-10-12T04:00:00.000Z]' } });
  assert.deepEqual(due({ urgency: 'overdue', dueAt: '2026-10-09T08:00:00Z' }), { key: '{count} days late', values: { count: 2 } });
  assert.deepEqual(due({ urgency: 'today', dueAt: '2026-10-11T12:00:00Z' }), { key: 'Today {time}', values: { time: '12:00' } });
  assert.deepEqual(due({ urgency: 'waiting', dueAt: '2026-10-01T08:00:00Z' }), { key: 'Since {date}', values: { date: '<2026-10-01>' } });
  assert.equal(due({ urgency: 'today', dueAt: null }), null);
});

test('swipe offers Done only when the module allows it, Snooze for an open item and Wake now for a snoozed one', () => {
  assert.deepEqual(rowActions(item('x', { actions: ['open', 'snooze', 'complete'] })), { complete: true, snooze: true, wake: false });
  assert.deepEqual(rowActions(item('x', { actions: ['open', 'snooze', 'complete'], urgency: 'snoozed', snoozed: snoozedUntil })), { complete: true, snooze: false, wake: true });
  assert.deepEqual(rowActions(item('x', { actions: ['open'] })), { complete: false, snooze: false, wake: false });
});

test('snooze offers later today, tomorrow and next week in the person\'s zone; a critical item never a week', () => {
  const morning = new Date('2026-10-11T05:10:00Z'); // 09:10 in Dubai
  assert.deepEqual(snoozePresets(morning, 'Asia/Dubai', false).map(({ id, label, until }) => [id, label, until]), [
    ['later_today', 'Later today', '2026-10-11T09:00:00.000Z'], // 13:00, three hours on and on the hour
    ['tomorrow', 'Tomorrow', '2026-10-12T04:00:00.000Z'], // 08:00, when the quiet hours end
    ['next_week', 'Next week', '2026-10-18T04:00:00.000Z'],
  ]);
  assert.deepEqual(snoozePresets(morning, 'Asia/Dubai', true).map((preset) => preset.id), ['later_today', 'tomorrow']);
  // A zone half an hour off UTC rounds on its own clock: 09:30 → 13:00 local.
  assert.equal(snoozePresets(new Date('2026-10-11T04:00:00Z'), 'Asia/Kolkata', false)[0].until, '2026-10-11T07:30:00.000Z');
  // In the evening (18:30, and 22:00 crossing midnight) there is no "later today" before the quiet hours.
  assert.deepEqual(snoozePresets(new Date('2026-10-11T14:30:00Z'), 'Asia/Dubai', false).map((preset) => preset.id), ['tomorrow', 'next_week']);
  assert.deepEqual(snoozePresets(new Date('2026-10-11T18:00:00Z'), 'Asia/Dubai', false).map((preset) => preset.id), ['tomorrow', 'next_week']);
  // Across a daylight-saving change the morning stays 08:00 on the wall clock.
  const beforeChange = snoozePresets(new Date('2026-10-30T13:00:00Z'), 'America/New_York', false);
  assert.deepEqual(beforeChange.slice(-2).map((preset) => preset.until), ['2026-10-31T12:00:00.000Z', '2026-11-06T13:00:00.000Z']);
  for (const preset of snoozePresets(morning, 'Asia/Dubai', false)) assert.equal(snoozeProblem({ until: preset.until, reason: 'Waiting on the client' }, morning), null, preset.id);
});

test('a snooze needs a reason and ends in the future within 14 days', () => {
  const now = new Date('2026-10-11T05:00:00Z');
  assert.equal(snoozeProblem({ until: '2026-10-12T04:00:00Z', reason: '   ' }, now), 'reason');
  assert.equal(snoozeProblem({ until: '2026-10-11T04:00:00Z', reason: 'Client away' }, now), 'past');
  assert.equal(snoozeProblem({ until: null, reason: 'Client away' }, now), 'past');
  assert.equal(snoozeProblem({ until: '2026-10-25T05:00:00Z', reason: 'Client away' }, now), null, 'exactly 14 days');
  assert.equal(snoozeProblem({ until: '2026-10-25T05:00:01Z', reason: 'Client away' }, now), 'too_far');
  assert.deepEqual(snoozeInput({ version: 3 }, '2026-10-12T04:00:00Z', '  Client away '), { until: '2026-10-12T04:00:00Z', reason: 'Client away', version: 3 });
});

test('a command\'s answer updates the cached list in place: replaced, or gone with its empty job; the total counts what is open', () => {
  const b = data.groups[0].items[1];
  const snoozed = applyActionResult(data, 'b', { ...b, urgency: 'snoozed', snoozed: snoozedUntil, version: 2 });
  assert.deepEqual(snoozed.groups[0].items.map((entry) => [entry.id, entry.urgency, entry.version]), [['a', 'upcoming', 1], ['b', 'snoozed', 2]]);
  assert.deepEqual(snoozed.counts, counts({ overdue: 1, today: 1, upcoming: 1, waiting: 2, snoozed: 2, total: 5 }));
  assert.deepEqual(ids(groupedEntries(snoozed)), ['a', 'c', 'f', 'e', 'g'], 'a snoozed item leaves "All" at once');
  const woken = applyActionResult(data, 'd', { ...data.groups[1].items[1], urgency: 'overdue', snoozed: null, version: 2 });
  assert.deepEqual(woken.counts, counts({ overdue: 2, today: 2, upcoming: 1, waiting: 2, snoozed: 0, total: 7 }));
  const done = applyActionResult(data, 'g', null);
  assert.deepEqual(done.groups.map((group) => group.jobId), ['j1', 'j2'], 'the job with nothing left goes');
  assert.deepEqual(done.counts, counts({ overdue: 1, today: 2, upcoming: 1, waiting: 1, snoozed: 1, total: 5 }));
  assert.equal(applyActionResult(data, 'missing', null), data, 'an item no longer listed changes nothing');
  assert.equal(data.groups[2].items.length, 1, 'the cached answer is never changed in place');
});
