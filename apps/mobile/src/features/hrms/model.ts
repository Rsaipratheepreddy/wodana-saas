import type { AttendanceSession, LeaveType, WorkCalendar, WorkMode } from '../../../../../packages/contracts/src/hrms';
import { key } from '../../core/i18n';
import { addDays } from '../../core/format-core';

/** An open session older than a day and a half needs a check-out fixed, not just a check-out. */
export function isStale(session: Pick<AttendanceSession, 'startedAt' | 'endedAt'> | null | undefined, now = Date.now()) {
  return !!session && !session.endedAt && now - new Date(session.startedAt).getTime() > 36 * 3600_000;
}

/** Minutes since an instant, for "checked in 3h 12m". */
export const minutesSince = (instant: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(instant).getTime()) / 60000));

/** The place choices a person has; remote only when HR allows it for them. */
export function modesFor(remoteAllowed: boolean): WorkMode[] {
  return remoteAllowed ? ['office', 'site', 'field', 'remote'] : ['office', 'site', 'field'];
}
export const MODE_LABEL: Record<WorkMode, string> = { office: key('Office'), site: key('Site'), field: key('Field'), remote: key('Remote') };

/**
 * Leave days as the server counts them: working, non-holiday days on the person's calendar, half a day
 * for a half-day request. Shown before sending; the server's count is the one that's kept.
 */
export function leaveDays(start: string, end: string, part: 'full' | 'first_half' | 'second_half', calendar: Pick<WorkCalendar, 'workingDays' | 'holidays'> | null | undefined) {
  if (!start || !end || end < start) return 0;
  const holidays = new Set(calendar?.holidays ?? []);
  const working = new Set(calendar?.workingDays ?? [1, 2, 3, 4, 5]);
  let count = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (working.has(weekday) && !holidays.has(day)) count += 1;
    if (count > 400) break;
  }
  return part === 'full' ? count : count ? 0.5 : 0;
}

/** Half days need one day and a type that allows them. */
export const canHalfDay = (type: Pick<LeaveType, 'allowHalfDay'> | undefined, start: string, end: string) => !!type?.allowHalfDay && !!start && start === end;

/** What the server says about attendance evidence, in the person's words (the server's text is the key). */
export const ISSUE_LABELS = [
  key('Photo was not captured'), key('Photo capture was delayed'), key('Device action was delayed; recorded time uses server receipt'),
  key('Location missing'), key('Location outside'), key('Location uncertain'), key('Workplace boundary is not configured'),
  key('Departure from the previous site is unverified'), key('Attendance overlaps approved leave'),
  key('No group photo'), key('Site boundary is not set up'), key('Marked on a later day'),
];

export type Presence = 'present' | 'half_day' | 'absent';
/** A crew day's head count: whole days, half days, absences and the days of work they add up to. */
export function crewTotals(workers: Array<{ presence: Presence; overtimeHours?: number | string }>) {
  const present = workers.filter((worker) => worker.presence === 'present').length;
  const half = workers.filter((worker) => worker.presence === 'half_day').length;
  const absent = workers.filter((worker) => worker.presence === 'absent').length;
  const overtime = workers.reduce((sum, worker) => sum + (Number(worker.overtimeHours) || 0), 0);
  return { present, half, absent, days: present + half / 2, overtime: Math.round(overtime * 100) / 100 };
}

/** A crew day can be sent only with someone there, and at most 200 people. */
export const crewDayReady = (workers: Array<{ presence: Presence }>) => workers.length > 0 && workers.length <= 200 && workers.some((worker) => worker.presence !== 'absent');

/** What an attendance review is about. */
export const REVIEW_KIND: Record<string, string> = { exception: key('Check-in to review'), correction: key('Time correction'), missing_checkout: key('Missed check-out') };
