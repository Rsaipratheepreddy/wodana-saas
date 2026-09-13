import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/auth/client';
import { loadHomeUpdates } from '../src/home/updates';
import type { AttendanceReview, AttendanceSession, HrmsBootstrap, LeaveRequest } from '../../../packages/contracts/src/hrms';

const now = new Date('2026-09-07T08:00:00Z');
const calendar = { id: 'calendar', name: 'Studio', timezone: 'Asia/Dubai', workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: '09:00', halfDay: '13:00', dayEnd: '18:00' };
const employee = { membershipId: 'self', userId: 'user', name: 'Member', enabled: true, remoteAllowed: true, managerId: null, activeFrom: '2026-01-01', activeTo: null, calendar, version: 1 };
const bootstrap = (): HrmsBootstrap => ({ membershipId: 'self', employee, settings: null, calendars: [calendar], workspace: { name: 'Studio', timezone: calendar.timezone },
  permissions: { self: true, team: false, manage: false, evidence: false, manageProjects: false } });
const leave = (overrides: Partial<LeaveRequest> = {}): LeaveRequest => ({ id: 'leave', membershipId: 'self', name: 'Member', leaveTypeId: 'casual', leaveTypeName: 'Casual leave', startDate: '2026-09-10', endDate: '2026-09-10',
  dayPart: 'first_half', days: 0.5, reason: 'Private reason', status: 'pending', decisionReason: null, cancellationReason: null, createdAt: now.toISOString(), version: 1, canDecide: false, ...overrides });
const review = (overrides: Partial<AttendanceReview> = {}): AttendanceReview => ({ id: 'review', membershipId: 'other', sessionId: 'session', eventId: null, kind: 'correction', reason: 'Private reason',
  status: 'pending', requestedAt: now.toISOString(), decisionReason: null, createdAt: now.toISOString(), canDecide: true, ...overrides });
function harness(boot = bootstrap(), values: Record<string, unknown> = {}) {
  const paths: string[] = [];
  const sources: Record<string, unknown> = { bootstrap: boot, 'attendance/current': null, 'leave/requests?scope=self&year=2026': [], 'reviews?scope=team': [], 'leave/requests?scope=team': [], ...values };
  const read = async <T>(path: string): Promise<T> => {
    paths.push(path);
    assert.ok(path.startsWith('/workspaces/workspace/hrms/'));
    const key = path.replace('/workspaces/workspace/hrms/', '');
    assert.ok(key in sources, `Unexpected endpoint ${key}`);
    if (sources[key] instanceof Error) throw sources[key];
    return sources[key] as T;
  };
  return { paths, read };
}

test('a member sees their upcoming leave and attendance, without querying team data', async () => {
  const h = harness(bootstrap(), { 'leave/requests?scope=self&year=2026': [leave(), leave({ id: 'other', membershipId: 'other' })] });
  const result = await loadHomeUpdates(h.read, 'workspace', now);
  assert.deepEqual(result.items.map(item => item.destination.tab), ['leave', 'attendance']);
  assert.equal(result.items[0].description, 'Sep 10 · 0.5 days');
  assert.ok(h.paths.every(path => !path.includes('scope=team')));
  assert.doesNotMatch(JSON.stringify(result), /Private reason|other/);
});

test('approvals count only actionable requests for other members and open the matching queue', async () => {
  const boot = bootstrap(); boot.permissions.team = true;
  const h = harness(boot, { 'reviews?scope=team': [review(), review({ membershipId: 'self' }), review({ canDecide: false }), review({ status: 'approved' })],
    'leave/requests?scope=team': [leave({ membershipId: 'other', canDecide: true, status: 'cancellation_pending' }), leave({ canDecide: true })] });
  const result = await loadHomeUpdates(h.read, 'workspace', now);
  assert.equal(result.items[0].title, '2 requests need your review');
  assert.equal(result.items[0].description, '1 attendance · 1 leave');
  assert.deepEqual(result.items[0].destination, { tab: 'approvals', reviewView: 'attendance' });
  const onlyLeave = harness(boot, { 'leave/requests?scope=team': [leave({ membershipId: 'other', canDecide: true })] });
  assert.deepEqual((await loadHomeUpdates(onlyLeave.read, 'workspace', now)).items[0].destination, { tab: 'approvals', reviewView: 'leave' });
});

test('a failed source cannot produce misleading approval totals or check-in prompts', async () => {
  const boot = bootstrap(); boot.permissions.team = true;
  const h = harness(boot, { 'attendance/current': new Error('offline'), 'reviews?scope=team': [review()], 'leave/requests?scope=team': new Error('offline'), 'leave/requests?scope=self&year=2026': [leave()] });
  const result = await loadHomeUpdates(h.read, 'workspace', now);
  assert.equal(result.partial, true);
  assert.deepEqual(result.items.map(item => item.destination.tab), ['leave']);
});

test('restricted and disabled profiles do not trigger employee or team reads', async () => {
  const denied = harness(bootstrap(), { bootstrap: new ApiError('Forbidden', 403) });
  assert.equal((await loadHomeUpdates(denied.read, 'workspace', now)).restricted, true);
  assert.equal(denied.paths.length, 1);
  const boot = bootstrap(); boot.employee = null;
  const disabled = harness(boot);
  assert.equal((await loadHomeUpdates(disabled.read, 'workspace', now)).items[0].id, 'setup');
  assert.equal(disabled.paths.length, 1);
  const unavailable = harness(boot, { bootstrap: new Error('offline') });
  await assert.rejects(loadHomeUpdates(unavailable.read, 'workspace', now), /offline/);
});

test('stale sessions take priority while current leave uses the employee calendar date', async () => {
  const session: AttendanceSession = { id: 'open', startedAt: '2026-09-04T05:00:00Z', endedAt: null, calendar, version: 1, segments: [], pendingReviewCount: 0, rejectedReviewCount: 0 };
  const boot = bootstrap(); boot.permissions.team = true;
  const h = harness(boot, { 'attendance/current': session, 'reviews?scope=team': [review()],
    'leave/requests?scope=self&year=2026': [leave({ startDate: '2026-09-07', endDate: '2026-09-07', status: 'approved' })] });
  const result = await loadHomeUpdates(h.read, 'workspace', new Date('2026-09-06T21:00:00Z'));
  assert.deepEqual(result.items.map(item => item.title), ['Your checkout needs attention', 'You have approved leave today']);
  assert.equal(result.items.length, 2);
});

test('year filters follow the employee timezone at the year boundary', async () => {
  const boot = bootstrap();
  const h = harness(boot, { 'leave/requests?scope=self&year=2027': [] });
  await loadHomeUpdates(h.read, 'workspace', new Date('2026-12-31T21:00:00Z'));
  assert.ok(h.paths.some(path => path.endsWith('scope=self&year=2027')));
});
