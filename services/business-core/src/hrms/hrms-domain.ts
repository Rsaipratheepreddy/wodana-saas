import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export type Calendar = {
  id?: string;
  name: string;
  timezone: string;
  workingDays: number[];
  holidays: string[];
  dayStart: string;
  halfDay: string;
  dayEnd: string;
};
export type LeaveUnit = {
  date: string;
  part: "first_half" | "second_half";
  days: number;
};
export type Position = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
  mock?: boolean;
};
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function dateOnly(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException("Use a valid calendar date.");
  return value;
}
export function addDays(value: string, days: number): string {
  return new Date(Date.parse(dateOnly(value)) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function dateRange(from: string, to: string, max = 93): string[] {
  dateOnly(from);
  dateOnly(to);
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count < 1 || count > max)
    throw new BadRequestException(`Choose a date range of 1–${max} days.`);
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}
export function localDate(value: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  dateOnly(date);
  const target = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  let value = target;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    const get = (key: string) => parts.find((p) => p.type === key)!.value;
    const wall = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    const delta = target - wall;
    value += delta;
    if (!delta) break;
  }
  return new Date(value);
}
export function validateCalendar(
  calendar: Omit<Calendar, "holidays" | "id"> & { holidays?: string[] },
): void {
  if (!calendar.name.trim())
    throw new BadRequestException("Name the work calendar.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: calendar.timezone }).format();
  } catch {
    throw new BadRequestException("Choose a valid IANA timezone.");
  }
  if (
    !(
      calendar.dayStart < calendar.halfDay && calendar.halfDay < calendar.dayEnd
    )
  )
    throw new BadRequestException(
      "Working hours must run from start, through half-day, to end.",
    );
  calendar.holidays?.forEach(dateOnly);
}
/** Every date of a holiday, in order. */
export function holidayDates(startsOn: string, endsOn: string): string[] {
  dateOnly(startsOn);
  dateOnly(endsOn);
  if (endsOn < startsOn)
    throw new BadRequestException("A holiday ends on or after the day it starts.");
  const dates = dateRange(startsOn, endsOn, 31);
  const years = [startsOn, endsOn].map((date) => Number(date.slice(0, 4)));
  if (years.some((year) => year < 2000 || year > 2200))
    throw new BadRequestException("Choose a date between 2000 and 2200.");
  return dates;
}
export function leaveUnits(
  start: string,
  end: string,
  part: string,
  calendar: Calendar,
): LeaveUnit[] {
  if (part !== "full" && start !== end)
    throw new BadRequestException("Half-day leave must use one date.");
  const units: LeaveUnit[] = [];
  for (const date of dateRange(start, end, 366)) {
    if (
      !calendar.workingDays.includes(
        new Date(`${date}T12:00:00Z`).getUTCDay(),
      ) ||
      calendar.holidays.includes(date)
    )
      continue;
    if (part !== "second_half")
      units.push({ date, part: "first_half", days: 0.5 });
    if (part !== "first_half")
      units.push({ date, part: "second_half", days: 0.5 });
  }
  if (!units.length)
    throw new BadRequestException(
      "Leave must include a scheduled working day.",
    );
  return units;
}
export function distanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function locationEvidence(
  position: Position | null | undefined,
  site: { latitude: number; longitude: number; radiusM: number } | null,
  now: Date,
  maxAccuracy: number,
  maxAge: number,
) {
  if (!position) return { status: "missing", distanceM: null, accuracyM: null };
  const age = (now.getTime() - Date.parse(position.capturedAt)) / 1000;
  const distance = site ? distanceM(position, site) : null;
  if (
    !Number.isFinite(age) ||
    age < -30 ||
    age > maxAge ||
    position.mock ||
    position.accuracyM > maxAccuracy
  )
    return {
      status: "uncertain",
      distanceM: distance,
      accuracyM: position.accuracyM,
    };
  if (!site)
    return {
      status: "captured",
      distanceM: null,
      accuracyM: position.accuracyM,
    };
  return {
    status:
      distance! + position.accuracyM <= site.radiusM
        ? "inside"
        : distance! - position.accuracyM > site.radiusM
          ? "outside"
          : "uncertain",
    distanceM: distance,
    accuracyM: position.accuracyM,
  };
}
export function splitInterval(
  start: Date | string,
  end: Date | string,
  timeZone: string,
): Array<{ date: string; milliseconds: number }> {
  const result: Array<{ date: string; milliseconds: number }> = [];
  let cursor = new Date(start).getTime();
  const finish = new Date(end).getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(finish) || finish < cursor)
    throw new BadRequestException("Invalid attendance interval.");
  while (cursor < finish) {
    const date = localDate(new Date(cursor), timeZone);
    const boundary = zonedInstant(
      addDays(date, 1),
      "00:00",
      timeZone,
    ).getTime();
    const next = Math.min(finish, boundary);
    if (next <= cursor)
      throw new BadRequestException("Unable to resolve the calendar boundary.");
    result.push({ date, milliseconds: next - cursor });
    cursor = next;
  }
  return result;
}
export function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return (
    '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""') + '"'
  );
}

function knownLocale(locale: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat(locale || "en").resolvedOptions().locale;
  } catch {
    return "en";
  }
}
/** A date or a run of dates for a notice, in the workspace's locale ("5–7 Oct 2026"). */
export function formatDates(start: string, end: string, locale?: string | null): string {
  const format = new Intl.DateTimeFormat(knownLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const from = new Date(`${dateOnly(start)}T00:00:00Z`);
  return start === end
    ? format.format(from)
    : format.formatRange(from, new Date(`${dateOnly(end)}T00:00:00Z`));
}
/** A moment for a notice, on the person's clock ("27 Sep, 09:12"). */
export function formatWhen(
  instant: Date | string,
  timeZone: string,
  locale?: string | null,
): string {
  return new Intl.DateTimeFormat(knownLocale(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}
