export const SLA_CALCULATION_MODES = ["elapsed", "business"] as const;
export type SlaCalculationMode = (typeof SLA_CALCULATION_MODES)[number];

export const SLA_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type SlaDayKey = (typeof SLA_DAY_KEYS)[number];

export type SlaWorkWindow = { start: string; end: string };

export type ElapsedSlaSchedule = {
  version: 1;
  mode: "elapsed";
};

export type BusinessSlaSchedule = {
  version: 1;
  mode: "business";
  timezone: string;
  weeklyHours: Partial<Record<SlaDayKey, SlaWorkWindow[]>>;
  holidays: string[];
  dateOverrides: Record<string, SlaWorkWindow[]>;
};

export type SlaSchedule = ElapsedSlaSchedule | BusinessSlaSchedule;

export class SlaScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlaScheduleValidationError";
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_HOLIDAYS = 1_000;
const MAX_OVERRIDES = 1_000;
const MAX_WINDOWS_PER_DAY = 8;
const MAX_SEARCH_DAYS = 366 * 400;

type Interval = { start: number; end: number };
type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new SlaScheduleValidationError(message);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${context} contains unsupported field: ${unknown[0]}`);
}

function normalizeDate(value: unknown, context: string): string {
  if (typeof value !== "string") fail(`${context} must use YYYY-MM-DD`);
  const match = DATE_PATTERN.exec(value);
  if (!match) fail(`${context} must use YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    fail(`${context} is not a valid calendar date`);
  }
  return value;
}

function timeToMinute(value: string, allowEndOfDay: boolean, context: string): number {
  if (allowEndOfDay && value === "24:00") return 1_440;
  if (!TIME_PATTERN.test(value)) fail(`${context} must use 24-hour HH:mm format`);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeWindows(value: unknown, context: string): SlaWorkWindow[] {
  if (!Array.isArray(value)) fail(`${context} must be an array of working windows`);
  if (value.length > MAX_WINDOWS_PER_DAY) {
    fail(`${context} supports at most ${MAX_WINDOWS_PER_DAY} working windows`);
  }
  const windows = value.map((candidate, index) => {
    if (!isRecord(candidate)) fail(`${context}[${index}] must be an object`);
    assertAllowedKeys(candidate, new Set(["start", "end"]), `${context}[${index}]`);
    if (typeof candidate.start !== "string" || typeof candidate.end !== "string") {
      fail(`${context}[${index}] requires start and end times`);
    }
    const start = timeToMinute(candidate.start, false, `${context}[${index}].start`);
    const end = timeToMinute(candidate.end, true, `${context}[${index}].end`);
    if (start === end) fail(`${context}[${index}] must have different start and end times`);
    return { start: candidate.start, end: candidate.end, startMinute: start, endMinute: end };
  });
  windows.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const previousEnd = previous.endMinute <= previous.startMinute ? previous.endMinute + 1_440 : previous.endMinute;
    if (windows[index].startMinute < previousEnd) fail(`${context} contains overlapping working windows`);
  }
  return windows.map(({ start, end }) => ({ start, end }));
}

function validateWeeklyOverlap(weeklyHours: Partial<Record<SlaDayKey, SlaWorkWindow[]>>): void {
  const weekMinutes = 7 * 1_440;
  const intervals: Interval[] = [];
  SLA_DAY_KEYS.forEach((day, dayIndex) => {
    for (const window of weeklyHours[day] ?? []) {
      const start = dayIndex * 1_440 + timeToMinute(window.start, false, "window.start");
      const rawEnd = timeToMinute(window.end, true, "window.end");
      const end = dayIndex * 1_440 + (rawEnd <= start % 1_440 ? rawEnd + 1_440 : rawEnd);
      if (end <= weekMinutes) intervals.push({ start, end });
      else {
        intervals.push({ start, end: weekMinutes });
        intervals.push({ start: 0, end: end - weekMinutes });
      }
    }
  });
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end) {
      fail("weeklyHours contains overlapping working windows across days");
    }
  }
}

function normalizeMode(value: unknown): SlaCalculationMode | undefined {
  if (value === undefined) return undefined;
  if (value === "elapsed" || value === "business") return value;
  fail("calculationMode must be elapsed or business");
}

export function normalizeSlaSchedule(
  input: unknown,
  requestedMode?: unknown,
): SlaSchedule {
  const value = input === undefined ? {} : input;
  if (!isRecord(value)) fail("schedule must be an object");
  const columnMode = normalizeMode(requestedMode);
  const documentMode = normalizeMode(value.mode);
  if (columnMode && documentMode && columnMode !== documentMode) {
    fail("calculationMode must match schedule.mode");
  }
  const inferredBusiness = ["timezone", "weeklyHours", "holidays", "dateOverrides"].some(
    (key) => value[key] !== undefined,
  );
  const mode = columnMode ?? documentMode ?? (inferredBusiness ? "business" : "elapsed");
  const version = value.version ?? 1;
  if (version !== 1) fail("schedule.version must be 1");

  if (mode === "elapsed") {
    assertAllowedKeys(value, new Set(["version", "mode"]), "elapsed schedule");
    return { version: 1, mode: "elapsed" };
  }

  assertAllowedKeys(
    value,
    new Set(["version", "mode", "timezone", "weeklyHours", "holidays", "dateOverrides"]),
    "business schedule",
  );
  if (typeof value.timezone !== "string" || !value.timezone.trim()) {
    fail("business schedule requires an IANA timezone");
  }
  const timezone = value.timezone.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    fail("business schedule timezone must be a valid IANA timezone");
  }
  if (!isRecord(value.weeklyHours)) fail("business schedule requires weeklyHours");
  assertAllowedKeys(value.weeklyHours, new Set(SLA_DAY_KEYS), "weeklyHours");
  const weeklyHours: Partial<Record<SlaDayKey, SlaWorkWindow[]>> = {};
  for (const day of SLA_DAY_KEYS) {
    if (value.weeklyHours[day] !== undefined) {
      weeklyHours[day] = normalizeWindows(value.weeklyHours[day], `weeklyHours.${day}`);
    }
  }
  if (!Object.values(weeklyHours).some((windows) => windows.length)) {
    fail("business schedule requires at least one recurring working window");
  }
  validateWeeklyOverlap(weeklyHours);

  const rawHolidays = value.holidays ?? [];
  if (!Array.isArray(rawHolidays)) fail("holidays must be an array of dates");
  if (rawHolidays.length > MAX_HOLIDAYS) fail(`holidays supports at most ${MAX_HOLIDAYS} dates`);
  const holidays = [...new Set(rawHolidays.map((date, index) => normalizeDate(date, `holidays[${index}]`)))].sort();

  const rawOverrides = value.dateOverrides ?? {};
  if (!isRecord(rawOverrides)) fail("dateOverrides must be an object keyed by date");
  if (Object.keys(rawOverrides).length > MAX_OVERRIDES) {
    fail(`dateOverrides supports at most ${MAX_OVERRIDES} dates`);
  }
  const dateOverrides: Record<string, SlaWorkWindow[]> = {};
  for (const [date, windows] of Object.entries(rawOverrides).sort(([left], [right]) => left.localeCompare(right))) {
    const validDate = normalizeDate(date, "dateOverrides key");
    dateOverrides[validDate] = normalizeWindows(windows, `dateOverrides.${validDate}`);
  }

  return { version: 1, mode: "business", timezone, weeklyHours, holidays, dateOverrides };
}

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, created);
  return created;
}

function wallParts(instant: number, timezone: string): WallParts {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function wallEpoch(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function dateFromParts(parts: WallParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addCivilDays(date: string, amount: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) fail("Internal SLA date is invalid");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount))
    .toISOString()
    .slice(0, 10);
}

function localDate(instant: number, timezone: string): string {
  return dateFromParts(wallParts(instant, timezone));
}

function wallTimeInstant(
  date: string,
  time: string,
  timezone: string,
  edge: "start" | "end",
): number {
  let targetDate = date;
  let targetTime = time;
  if (time === "24:00") {
    targetDate = addCivilDays(date, 1);
    targetTime = "00:00";
  }
  const [year, month, day] = targetDate.split("-").map(Number);
  const [hour, minute] = targetTime.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (const hourDelta of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = target + hourDelta * 3_600_000;
    offsets.add(Math.round((wallEpoch(wallParts(sample, timezone)) - sample) / 60_000));
  }
  const candidates = [...offsets].map((offset) => target - offset * 60_000);
  const exact = candidates
    .filter((candidate) => wallEpoch(wallParts(candidate, timezone)) === target)
    .sort((left, right) => left - right);
  if (exact.length) return edge === "start" ? exact[0] : exact[exact.length - 1];

  // A boundary inside a daylight-saving gap has no exact instant. Use the
  // first representable wall time after it (Temporal's compatible behaviour).
  const shifted = candidates
    .map((candidate) => ({ candidate, wall: wallEpoch(wallParts(candidate, timezone)) }))
    .filter(({ wall }) => wall > target)
    .sort((left, right) => left.wall - right.wall || left.candidate - right.candidate);
  if (shifted.length) return shifted[0].candidate;
  fail(`Unable to resolve ${date} ${time} in ${timezone}`);
}

function weekday(date: string): SlaDayKey {
  const [year, month, day] = date.split("-").map(Number);
  return SLA_DAY_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function windowsForDate(schedule: BusinessSlaSchedule, date: string): SlaWorkWindow[] {
  if (Object.prototype.hasOwnProperty.call(schedule.dateOverrides, date)) {
    return schedule.dateOverrides[date];
  }
  if (schedule.holidays.includes(date)) return [];
  return schedule.weeklyHours[weekday(date)] ?? [];
}

function intervalsForDate(schedule: BusinessSlaSchedule, date: string): Interval[] {
  return windowsForDate(schedule, date).map((window) => {
    const startMinute = timeToMinute(window.start, false, "window.start");
    const endMinute = timeToMinute(window.end, true, "window.end");
    const endDate = endMinute <= startMinute ? addCivilDays(date, 1) : date;
    const start = wallTimeInstant(date, window.start, schedule.timezone, "start");
    const end = wallTimeInstant(endDate, window.end === "24:00" ? "00:00" : window.end, schedule.timezone, "end");
    if (end <= start) fail(`Working window ${date} ${window.start}-${window.end} has no elapsed duration`);
    return { start, end };
  });
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

function nextBusinessInterval(schedule: BusinessSlaSchedule, instant: number): Interval {
  let batchStart = addCivilDays(localDate(instant, schedule.timezone), -1);
  let searched = 0;
  while (searched < MAX_SEARCH_DAYS) {
    const batchDays = Math.min(32, MAX_SEARCH_DAYS - searched);
    const intervals: Interval[] = [];
    for (let offset = 0; offset < batchDays; offset += 1) {
      intervals.push(...intervalsForDate(schedule, addCivilDays(batchStart, offset)));
    }
    const match = mergeIntervals(intervals).find((interval) => interval.end > instant);
    if (match) return match;
    searched += batchDays;
    batchStart = addCivilDays(batchStart, batchDays);
  }
  fail("SLA deadline exceeds the supported recurring-calendar horizon");
}

export function addSlaMinutes(start: Date, minutes: number, schedule: SlaSchedule): Date {
  if (!(start instanceof Date) || !Number.isFinite(start.getTime())) fail("SLA start must be a valid instant");
  if (!Number.isInteger(minutes) || minutes < 0) fail("SLA minutes must be a non-negative integer");
  if (minutes === 0) return new Date(start);
  if (schedule.mode === "elapsed") return new Date(start.getTime() + minutes * 60_000);

  let cursor = start.getTime();
  let remaining = minutes * 60_000;
  while (remaining > 0) {
    const interval = nextBusinessInterval(schedule, cursor);
    const usableStart = Math.max(cursor, interval.start);
    const available = interval.end - usableStart;
    if (remaining <= available) return new Date(usableStart + remaining);
    remaining -= available;
    cursor = interval.end;
  }
  return new Date(cursor);
}

export function remainingSlaMinutes(from: Date, deadline: Date, schedule: SlaSchedule): number {
  if (!(from instanceof Date) || !Number.isFinite(from.getTime())) fail("SLA remaining-time start must be a valid instant");
  if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) fail("SLA deadline must be a valid instant");
  if (deadline <= from) return 0;
  if (schedule.mode === "elapsed") return Math.ceil((deadline.getTime() - from.getTime()) / 60_000);

  let cursor = from.getTime();
  let businessMilliseconds = 0;
  while (cursor < deadline.getTime()) {
    const interval = nextBusinessInterval(schedule, cursor);
    if (interval.start >= deadline.getTime()) break;
    const usableStart = Math.max(cursor, interval.start);
    const usableEnd = Math.min(deadline.getTime(), interval.end);
    if (usableEnd > usableStart) businessMilliseconds += usableEnd - usableStart;
    cursor = Math.max(interval.end, usableStart + 1);
  }
  return Math.ceil(businessMilliseconds / 60_000);
}

export function calculateSlaDeadlines(
  startedAt: Date,
  warningAfterMinutes: number,
  breachAfterMinutes: number,
  schedule: SlaSchedule,
): { warningAt: Date; dueAt: Date } {
  if (!Number.isInteger(warningAfterMinutes) || warningAfterMinutes < 0) {
    fail("SLA warning minutes must be a non-negative integer");
  }
  if (!Number.isInteger(breachAfterMinutes) || breachAfterMinutes <= warningAfterMinutes) {
    fail("SLA breach minutes must be later than warning minutes");
  }
  return {
    warningAt: addSlaMinutes(startedAt, warningAfterMinutes, schedule),
    dueAt: addSlaMinutes(startedAt, breachAfterMinutes, schedule),
  };
}
