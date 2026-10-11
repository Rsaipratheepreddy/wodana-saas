import { fromDate, parseTime, toCalendarDate, toCalendarDateTime, toZoned, type CalendarDate } from "@internationalized/date";
import type { MyDayCounts, MyDayItem, MyDayResponse, MyDayUrgency } from "@wodana/contracts";
import type { MessageKey, Translate } from "@/lib/i18n/keys";
import { tKey } from "@/lib/i18n/keys";
import { MAX_SNOOZE_DAYS } from "./contract";

/** Home's order: what is late, then today's, then what waits on the person, then what comes up; snoozed last. */
const URGENCY_RANK: Record<MyDayUrgency, number> = { overdue: 0, today: 1, waiting: 2, upcoming: 3, snoozed: 4 };

export const MY_DAY_URGENCY_LABELS: Record<MyDayUrgency, MessageKey> = {
  overdue: tKey("Overdue"), today: tKey("Today"), upcoming: tKey("Upcoming"), waiting: tKey("Waiting"), snoozed: tKey("Snoozed"),
};
/** The toolbar's chips, in the order people work through them. */
export const MY_DAY_CHIPS: MyDayUrgency[] = ["overdue", "today", "waiting", "upcoming", "snoozed"];

const due = (item: MyDayItem) => (item.dueAt ? Date.parse(item.dueAt) : Number.POSITIVE_INFINITY);

/** Everything due on the person, most urgent first (snoozed items left out), for Home's Today list. */
export function topMyDayItems(response: MyDayResponse, limit: number): MyDayItem[] {
  return response.groups.flatMap((group) => group.items)
    .filter((item) => item.urgency !== "snoozed" && !item.snoozed)
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || due(a) - due(b))
    .slice(0, limit);
}

/** What is due now or coming (snoozed items wait until they wake). */
export const openCount = (counts: MyDayCounts) => counts.overdue + counts.today + counts.waiting + counts.upcoming;

/** The list without the items whose command is waiting for its undo window, counts included. */
export function withoutItems(response: MyDayResponse, hidden: ReadonlySet<string>): MyDayResponse {
  if (!hidden.size) return response;
  const counts = { ...response.counts };
  const groups = response.groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!hidden.has(item.id)) return true;
      counts[item.urgency] = Math.max(0, counts[item.urgency] - 1);
      counts.total = Math.max(0, counts.total - 1);
      return false;
    }),
  })).filter((group) => group.items.length);
  return { ...response, counts, groups };
}

/** The calendar day of an instant in a time zone (YYYY-MM-DD). */
export function localDay(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** When an item is due, in the person's zone: "3 days late", "Today 15:00", "Tomorrow", "Since Sun 20 Sept", "Tue 14 Oct". */
export function dueLabel(item: Pick<MyDayItem, "dueAt" | "urgency" | "snoozed">, context: { today: string; timeZone: string; locale: string; t: Translate }) {
  const { today, timeZone, locale, t } = context;
  const zone = (value: string) => (isDateOnly(value) ? "UTC" : timeZone);
  const instant = (value: string) => new Date(isDateOnly(value) ? `${value}T12:00:00Z` : value);
  const time = (value: string) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
  const date = (value: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: zone(value) }).format(instant(value));
  if (item.snoozed) return t("Snoozed until {date}", { date: `${date(item.snoozed.until)} ${time(item.snoozed.until)}` });
  if (!item.dueAt) return "";
  if (item.urgency === "waiting") return t("Since {date}", { date: date(item.dueAt) });
  const day = isDateOnly(item.dueAt) ? item.dueAt : localDay(item.dueAt, timeZone);
  const late = dayDiff(day, today);
  if (late === 1) return t("1 day late");
  if (late > 1) return t("{count} days late", { count: late });
  if (late === 0) return isDateOnly(item.dueAt) ? t("Today") : t("Today {time}", { time: time(item.dueAt) });
  if (late === -1) return isDateOnly(item.dueAt) ? t("Tomorrow") : t("Tomorrow {time}", { time: time(item.dueAt) });
  return date(item.dueAt);
}

export type SnoozePreset = { id: "later" | "tomorrow" | "next-week"; label: MessageKey; until: Date };

/**
 * One-tap snooze times in the person's zone: later today (three hours on, rounded up to the hour), tomorrow and a
 * week on at the start of the working day. Each must land before `latest` (14 days, or the next working day for a
 * critical item).
 */
export function snoozePresets({ timeZone, morning, latest, now = new Date() }: { timeZone: string; morning: string; latest: Date; now?: Date }): SnoozePreset[] {
  const current = fromDate(now, timeZone);
  const today = toCalendarDate(current);
  const start = (() => { try { return parseTime(morning); } catch { return parseTime("09:00"); } })();
  const at = (date: CalendarDate) => toZoned(toCalendarDateTime(date, start), timeZone).toDate();
  let later = current.add({ hours: 3 });
  if (later.minute || later.second || later.millisecond) later = later.add({ hours: 1 }).set({ minute: 0, second: 0, millisecond: 0 });
  const presets: SnoozePreset[] = [
    ...(toCalendarDate(later).compare(today) === 0 ? [{ id: "later" as const, label: tKey("Later today"), until: later.toDate() }] : []),
    { id: "tomorrow", label: tKey("Tomorrow"), until: at(today.add({ days: 1 })) },
    { id: "next-week", label: tKey("Next week"), until: at(today.add({ days: 7 })) },
  ];
  return presets.filter((preset) => preset.until.getTime() > now.getTime() && preset.until.getTime() <= latest.getTime());
}

/** The latest a snooze may reach: 14 days on, or the end of the next working day for a critical item. */
export function latestSnooze({ critical, timeZone, nextWorkingDay, now = new Date() }: { critical: boolean; timeZone: string; nextWorkingDay: CalendarDate; now?: Date }) {
  if (!critical) return new Date(now.getTime() + MAX_SNOOZE_DAYS * 86_400_000);
  return toZoned(toCalendarDateTime(nextWorkingDay, parseTime("23:59")), timeZone).toDate();
}
