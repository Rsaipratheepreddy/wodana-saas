import {
  MAX_SNOOZE_DAYS, REMINDER_SETTINGS_DEFAULTS, type MyDayGroup, type MyDayItem, type MyDayResponse, type MyDaySnoozeInput, type MyDayUrgency, type ReminderKind,
} from '../../../../../packages/contracts/src/reminders';
import { addDays, isoDay, wallTimeToIso, zoneOffsetMinutes } from '../../core/format-core';
import { key } from '../../core/i18n';
import { dueLabel, type Label } from './home-model';

/**
 * My day on the phone (`GET my-day`, plan §6.24a), without native code (node tests import it): what comes
 * first, how a row reads, the snooze choices and what a command's answer changes in the cached list.
 */

/** Most urgent first; snoozed items wait at the end. */
export const URGENCY_ORDER: readonly MyDayUrgency[] = ['overdue', 'today', 'waiting', 'upcoming', 'snoozed'];
export const URGENCY_LABEL: Record<MyDayUrgency, string> = {
  overdue: key('Overdue'), today: key('Today'), waiting: key('Waiting'), upcoming: key('Upcoming'), snoozed: key('Snoozed'),
};
/** The toolbar chips, the web's: everything open, then one urgency. */
export const FILTERS = ['all', 'overdue', 'today', 'waiting', 'upcoming', 'snoozed'] as const;
export type MyDayFilter = (typeof FILTERS)[number];
export const isFilter = (value: unknown): value is MyDayFilter => typeof value === 'string' && (FILTERS as readonly string[]).includes(value);

/** One row with the job it belongs to. */
export type MyDayEntry = { item: MyDayItem; group: MyDayGroup };

const rank = (urgency: MyDayUrgency) => URGENCY_ORDER.indexOf(urgency);
const dueTime = (item: MyDayItem) => {
  if (!item.dueAt) return Number.POSITIVE_INFINITY;
  const time = Date.parse(item.dueAt);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};
/** Urgency, then critical before the rest, then the earliest due. */
export function compareItems(a: MyDayItem, b: MyDayItem) {
  return rank(a.urgency) - rank(b.urgency) || Number(b.critical) - Number(a.critical) || dueTime(a) - dueTime(b);
}

/**
 * Today's list: the most urgent open items across jobs (overdue, today, waiting, upcoming), never a snoozed one.
 * `skipKinds` leaves out what another row of Today already counts (approvals have their own row).
 */
export function topItems(data: MyDayResponse | null | undefined, limit: number, skipKinds: readonly ReminderKind[] = []): MyDayEntry[] {
  if (!data) return [];
  const skipped = new Set(skipKinds);
  return data.groups
    .flatMap((group) => group.items.map((item) => ({ item, group })))
    .filter(({ item }) => item.urgency !== 'snoozed' && !item.snoozed && !skipped.has(item.kind))
    .sort((a, b) => compareItems(a.item, b.item))
    .slice(0, limit);
}

/**
 * The full list, one job after another in the server's order (the job with the most urgent item first, work with
 * no job last), each job's items most urgent first. "All" is what is open (snoozed items wait under their chip, as
 * the server answers); a chip keeps only its urgency, also while its own answer is on its way.
 */
export function groupedEntries(data: MyDayResponse | null | undefined, filter: MyDayFilter = 'all'): MyDayEntry[] {
  if (!data) return [];
  const shown = (item: MyDayItem) => (filter === 'all' ? item.urgency !== 'snoozed' : item.urgency === filter);
  return data.groups.flatMap((group) => group.items.filter(shown).sort(compareItems).map((item) => ({ item, group })));
}

/** A job's heading: its reference and title ("J-104 · Villa 402"), either alone when that is all there is, or `fallback` for work with no job. */
export const groupHeading = (group: Pick<MyDayGroup, 'jobReference' | 'title'>, fallback: string) =>
  [...new Set([group.jobReference, group.title].filter(Boolean))].join(' · ') || fallback;

/**
 * A row's second line: its context, then its job, once (QA-013) and leaving out what the title already says (a
 * bill's supplier, an invoice's client): no part repeats.
 */
export function rowDetail(item: Pick<MyDayItem, 'title' | 'context'>, job = '') {
  const said = new Set(item.title.split(' · ').map((part) => part.trim()));
  const parts = [...(item.context ?? '').split(' · '), ...(job ? job.split(' · ') : [])].map((part) => part.trim())
    .filter((part) => part && !said.has(part));
  return [...new Set(parts)].join(' · ');
}

/** The second line from a context and a job alone (no title to leave out). */
export function myDayDetail(context: string | null | undefined, job: string) {
  return rowDetail({ title: '', context: context ?? '' }, job);
}

/** "Reminded 2× · escalated", "Reminded 1×", "Escalated", or nothing before the first reminder. */
export function remindedLabel(item: Pick<MyDayItem, 'reminders'>): Label | null {
  const { sent, escalationLevel } = item.reminders;
  if (sent > 0) return escalationLevel > 0 ? { key: key('Reminded {count}× · escalated'), values: { count: sent } } : { key: key('Reminded {count}×'), values: { count: sent } };
  return escalationLevel > 0 ? { key: key('Escalated') } : null;
}

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type DueFormat = { time: (value: string) => string; date: (value: string) => string; when: (value: string) => string };
/**
 * When a row is due, on the person's calendar (`today` and `timeZone` come with the list): "2 days late",
 * "Today 16:00", "Since 12 Sep" for what waits on them, "Tomorrow" or "Due 14 Oct" ahead, "Snoozed until 15 Oct, 08:00".
 */
export function myDayDueLabel(item: Pick<MyDayItem, 'dueAt' | 'urgency' | 'snoozed'>, today: string, timeZone: string, format: DueFormat): Label | null {
  if (item.snoozed) return { key: key('Snoozed until {date}'), values: { date: format.when(item.snoozed.until) } };
  if (!item.dueAt) return null;
  if (item.urgency === 'upcoming') {
    const day = isDateOnly(item.dueAt) ? item.dueAt : isoDay(item.dueAt, timeZone);
    const ahead = dayDiff(today, day);
    if (ahead === 1) return { key: key('Tomorrow') };
    if (ahead > 1) return { key: key('Due {date}'), values: { date: format.date(day) } };
  }
  return dueLabel({ due: item.dueAt, urgency: item.urgency }, today, timeZone, format);
}

/** The commands a row offers by swipe: Done only when the server lists "complete", Wake now for a snoozed one. */
export function rowActions(item: Pick<MyDayItem, 'actions' | 'snoozed' | 'urgency'>) {
  const snoozed = !!item.snoozed || item.urgency === 'snoozed';
  return {
    complete: item.actions.includes('complete'),
    snooze: !snoozed && item.actions.includes('snooze'),
    wake: snoozed && item.actions.includes('snooze'),
  };
}

// ---- Snooze ------------------------------------------------------------------------------------------------

export type SnoozePresetId = 'later_today' | 'tomorrow' | 'next_week';
export type SnoozePreset = { id: SnoozePresetId; label: string; until: string };
export const PRESET_LABEL: Record<SnoozePresetId, string> = { later_today: key('Later today'), tomorrow: key('Tomorrow'), next_week: key('Next week') };

const HOUR = 3_600_000;
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The snooze choices, in the person's time zone: later today (three hours on, on the hour, while it is still
 * before the evening's quiet hours), tomorrow and in a week when the quiet hours end (the reminder settings'
 * defaults). A critical item snoozes only to the next working day, so it never offers a week.
 */
export function snoozePresets(now: Date, timeZone: string, critical: boolean, hours: { morning: string; evening: string } = { morning: REMINDER_SETTINGS_DEFAULTS.quietEnd, evening: REMINDER_SETTINGS_DEFAULTS.quietStart }): SnoozePreset[] {
  const today = isoDay(now, timeZone);
  const presets: SnoozePreset[] = [];
  // Later today, rounded up to the hour on the local clock (a zone may sit half an hour off UTC).
  const offset = zoneOffsetMinutes(now, timeZone) * 60_000;
  const local = new Date(Math.ceil((now.getTime() + 3 * HOUR + offset) / HOUR) * HOUR);
  const day = local.toISOString().slice(0, 10);
  const clock = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  if (day === today && clock < hours.evening) presets.push({ id: 'later_today', label: PRESET_LABEL.later_today, until: wallTimeToIso(day, clock, timeZone) });
  presets.push({ id: 'tomorrow', label: PRESET_LABEL.tomorrow, until: wallTimeToIso(addDays(today, 1), hours.morning, timeZone) });
  if (!critical) presets.push({ id: 'next_week', label: PRESET_LABEL.next_week, until: wallTimeToIso(addDays(today, 7), hours.morning, timeZone) });
  return presets;
}

export type SnoozeProblem = 'reason' | 'past' | 'too_far';
/** What stops a snooze before it is sent: a reason is required, and it ends in the future within 14 days. */
export function snoozeProblem(input: { until: string | null | undefined; reason: string }, now: Date, maxDays = MAX_SNOOZE_DAYS): SnoozeProblem | null {
  if (!input.reason.trim()) return 'reason';
  const until = input.until ? Date.parse(input.until) : Number.NaN;
  if (!Number.isFinite(until) || until <= now.getTime()) return 'past';
  if (until - now.getTime() > maxDays * 24 * HOUR) return 'too_far';
  return null;
}

/** The snooze command for the item as the person saw it (its version), with the reason trimmed. */
export const snoozeInput = (item: Pick<MyDayItem, 'version'>, until: string, reason: string): MyDaySnoozeInput => ({ until, reason: reason.trim(), version: item.version });

// ---- Command answers -----------------------------------------------------------------------------------------

/**
 * The cached list after a command answered with the item as it is now: replaced in place, or gone (null) when it
 * closed or left the person's list. Counts follow so the chips agree until the refetch lands; like the server's,
 * the total counts what is open (not what is snoozed).
 */
export function applyActionResult(data: MyDayResponse, id: string, next: MyDayItem | null): MyDayResponse {
  const before = data.groups.flatMap((group) => group.items).find((item) => item.id === id);
  if (!before) return data;
  const groups = data.groups
    .map((group) => ({ ...group, items: next ? group.items.map((item) => (item.id === id ? next : item)) : group.items.filter((item) => item.id !== id) }))
    .filter((group) => group.items.length);
  const counts = { ...data.counts };
  counts[before.urgency] = Math.max(0, counts[before.urgency] - 1);
  if (before.urgency !== 'snoozed') counts.total = Math.max(0, counts.total - 1);
  if (next) {
    counts[next.urgency] += 1;
    if (next.urgency !== 'snoozed') counts.total += 1;
  }
  return { ...data, groups, counts };
}
