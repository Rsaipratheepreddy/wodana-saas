import assert from 'node:assert/strict';
import test from 'node:test';
import { canHalfDay, crewDayReady, crewTotals, isStale, leaveDays, modesFor } from '../src/features/hrms/model';
import { empty, reportProblems } from '../src/features/projects/report-model';
import { mailLink, telLink, whatsappLink } from '../src/core/contact';

const t = (text: string) => text;
const weekFriSat = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-10-06'] };

test('crew presence adds up whole and half days, and a day needs someone there', () => {
  const workers = [{ presence: 'present' as const, overtimeHours: '2' }, { presence: 'half_day' as const, overtimeHours: 0 }, { presence: 'absent' as const }];
  assert.deepEqual(crewTotals(workers), { present: 1, half: 1, absent: 1, days: 1.5, overtime: 2 });
  assert.equal(crewDayReady(workers), true);
  assert.equal(crewDayReady([{ presence: 'absent' }]), false);
  assert.equal(crewDayReady([]), false);
});

test('leave counts working, non-holiday days on the person\'s calendar', () => {
  assert.equal(leaveDays('2026-10-04', '2026-10-10', 'full', weekFriSat), 4);
  assert.equal(leaveDays('2026-10-05', '2026-10-05', 'first_half', weekFriSat), 0.5);
  assert.equal(leaveDays('2026-10-09', '2026-10-10', 'full', weekFriSat), 0);
  assert.equal(leaveDays('2026-10-10', '2026-10-09', 'full', weekFriSat), 0);
  assert.equal(canHalfDay({ allowHalfDay: true }, '2026-10-05', '2026-10-05'), true);
  assert.equal(canHalfDay({ allowHalfDay: true }, '2026-10-05', '2026-10-06'), false);
  assert.equal(canHalfDay({ allowHalfDay: false }, '2026-10-05', '2026-10-05'), false);
});

test('an open session older than a day and a half needs its check-out fixed', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(isStale({ startedAt: '2026-09-25T20:00:00Z', endedAt: null }, now), true);
  assert.equal(isStale({ startedAt: '2026-09-27T05:00:00Z', endedAt: null }, now), false);
  assert.equal(isStale({ startedAt: '2026-09-20T05:00:00Z', endedAt: '2026-09-20T14:00:00Z' }, now), false);
  assert.deepEqual(modesFor(false), ['office', 'site', 'field']);
  assert.deepEqual(modesFor(true), ['office', 'site', 'field', 'remote']);
});

test('a daily report needs evidence or a no-work reason, and an outlook at risk needs its recovery', () => {
  assert.deepEqual(reportProblems(empty(), 0, false, t), []);
  assert.deepEqual(reportProblems(empty(), 0, true, t), ['Add a photo, or say why no work was done.']);
  assert.deepEqual(reportProblems({ ...empty(), noWork: true, noWorkReason: 'Rain' }, 0, true, t), []);
  assert.equal(reportProblems({ ...empty(), safety: 'incident' }, 1, true, t).length, 1);
  assert.equal(reportProblems({ ...empty(), forecast: 'blocked', impact: 'Glass late' }, 1, true, t).length, 1);
  assert.equal(reportProblems({ ...empty(), forecast: 'watch', impact: 'Glass late', recoveryOwnerId: 'm1', recoveryOn: '2026-10-01' }, 1, true, t).length, 0);
  assert.deepEqual(reportProblems({ ...empty(), lines: [{ boqLineId: 'l', installed: '-2', note: '' }] }, 1, true, t), ['A correction needs a note.']);
});

test('one-tap contact links use the number as stored, for any country', () => {
  assert.equal(telLink('+971 50 123 4567'), 'tel:+971501234567');
  assert.equal(whatsappLink('+971 50 123 4567'), 'https://wa.me/971501234567');
  assert.equal(whatsappLink('0044 7700 900123'), 'https://wa.me/447700900123');
  assert.equal(whatsappLink('123'), null);
  assert.equal(mailLink('client@example.com', 'ENQ-1'), 'mailto:client@example.com?subject=ENQ-1');
  assert.equal(mailLink('not an email'), null);
  assert.equal(telLink(null), null);
});
