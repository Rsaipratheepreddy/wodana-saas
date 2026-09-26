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
