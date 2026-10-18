/** Milliseconds a time zone is ahead of UTC at a given instant. */
function offsetAt(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant / 1000) * 1000;
}

/** A wall-clock date and time in an IANA time zone, as a UTC ISO instant. */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return new Date(instant).toISOString();
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function zonedToday(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function wallParts(instant: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * An instant as a Date whose own (browser-local) fields read the wall clock in `timeZone`. Calendar layouts
 * compute days and minutes with ordinary Date getters, so handing them wall-clock dates draws the workspace's
 * day, not the viewer's. For layout and display only; `fromWallClock` turns one back into the real instant.
 */
export function atWallClock(instant: Date | string | number, timeZone: string): Date {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(value.getTime())) return new Date(NaN);
  const parts = wallParts(value, timeZone);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, value.getMilliseconds());
}

/** The real instant a wall-clock Date (see `atWallClock`) stands for in `timeZone`. */
export function fromWallClock(wall: Date, timeZone: string): Date {
  if (!Number.isFinite(wall.getTime())) return new Date(NaN);
  const instant = zonedToUtc(`${wall.getFullYear()}-${pad(wall.getMonth() + 1)}-${pad(wall.getDate())}`, `${pad(wall.getHours())}:${pad(wall.getMinutes())}`, timeZone);
  return instant ? new Date(Date.parse(instant) + wall.getSeconds() * 1000 + wall.getMilliseconds()) : new Date(NaN);
}

/** "yyyy-mm-ddThh:mm" in `timeZone` for an instant: the value a date-and-time field shows. */
export function zonedDateTime(value: unknown, timeZone: string): string {
  if (!value) return "";
  const date = new Date(value instanceof Date ? value.getTime() : String(value));
  if (!Number.isFinite(date.getTime())) return "";
  const parts = wallParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** A date-and-time field's "yyyy-mm-ddThh:mm" in `timeZone` as a UTC ISO instant; null when invalid or the zone skips that time. */
export function zonedDateTimeToIso(value: string, timeZone: string): string | null {
  const [date = "", time = ""] = value.split("T");
  const instant = zonedToUtc(date, time.slice(0, 5), timeZone);
  return instant && zonedDateTime(instant, timeZone) === `${date}T${time.slice(0, 5)}` ? instant : null;
}
