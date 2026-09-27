/**
 * Pure formatting for the workspace's region: locale, currency and time zone come from the server,
 * never from constants. Calendar dates are YYYY-MM-DD; instants are ISO strings.
 */
const deviceLocale = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en'; } catch { return 'en'; }
};
const deviceZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};
const safeLocale = (locale: string | null | undefined) => {
  const tag = locale || deviceLocale();
  // The tag as given, not as resolved: an extension such as -u-nu-latn (Latin digits) must reach every formatter.
  try { new Intl.DateTimeFormat(tag); return tag; } catch { return 'en'; }
};
const safeZone = (timeZone: string | null | undefined) => {
  const zone = timeZone || deviceZone();
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone; } catch { return 'UTC'; }
};
const fractionDigits = (currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
};

const parts = (date: Date, timeZone: string) => {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
};

/** How far a time zone is ahead of UTC at an instant, in minutes. */
export function zoneOffsetMinutes(instant: Date, timeZone: string) {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The instant a wall-clock time happens in a time zone: ("2026-10-05", "09:30", "Asia/Dubai") → ISO. */
export function wallTimeToIso(day: string, time: string, timeZone: string) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = zoneOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60000;
  // Across a daylight-saving change the offset at the result can differ from the guess's.
  const second = zoneOffsetMinutes(new Date(result), timeZone);
  if (second !== offset) { offset = second; result = guess - offset * 60000; }
  return new Date(result).toISOString();
}

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function isoDay(instant: Date | string, timeZone: string) {
  const p = parts(new Date(instant), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(day: string, count: number) {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** The first day of the week holding `day`; `startsOn` is 0 (Sunday) to 6 (Saturday). */
export function weekStart(day: string, startsOn = 1) {
  const weekday = new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday - startsOn + 7) % 7));
}

export function makeFormat(settings: { locale?: string | null; timeZone?: string | null; currency?: string | null }) {
  const locale = safeLocale(settings.locale);
  const timeZone = safeZone(settings.timeZone);
  const currency = settings.currency || '';
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const wallClock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const asDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const today = () => isoDay(new Date(), timeZone);
  const format = {
    locale, timeZone, currency,
    /** Today in the workspace, as YYYY-MM-DD. */
    today,
    /** A calendar date: "5 Oct", with the year when it isn't this year. */
    day: (value: string | null | undefined) => {
      if (!value) return '';
      const date = asDate(value);
      return date.getUTCFullYear() === asDate(today()).getUTCFullYear() ? day.format(date) : dayYear.format(date);
    },
    /** "Mon, 5 Oct". */
    weekday: (value: string) => weekday.format(asDate(value)),
    /** "Mon". */
    weekdayShort: (value: string) => weekdayShort.format(asDate(value)),
    /** "Monday, 5 October". */
    longDay: (value: string) => weekdayLong.format(asDate(value)),
    time: (value: string | Date | null | undefined) => (value ? time.format(new Date(value)) : ''),
    /** A wall-clock time given as HH:mm: "9:30 AM" or "09:30" as the locale writes it. */
    clockLabel: (value: string) => (/^\d{2}:\d{2}$/.test(value) ? wallClock.format(new Date(`2000-01-01T${value}:00Z`)) : value),
    /** An instant: "5 Oct, 09:30", or "Today, 09:30" style when it's today. */
    when: (value: string | Date | null | undefined) => {
      if (!value) return '';
      const date = new Date(value);
      return isoDay(date, timeZone) === today() ? time.format(date) : when.format(date);
    },
    /** A date relative to today: "today", "tomorrow", "in 3 days", "2 days ago". */
    fromToday: (value: string) => {
      const days = Math.round((asDate(value).getTime() - asDate(today()).getTime()) / 86400000);
      return relative.format(days, 'day');
    },
    /** How long ago an instant was: "5 min ago", "yesterday". */
    ago: (value: string | Date) => {
      const seconds = (new Date(value).getTime() - Date.now()) / 1000;
      const abs = Math.abs(seconds);
      if (abs < 60) return relative.format(Math.round(seconds), 'second');
      if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
      if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
      return relative.format(Math.round(seconds / 86400), 'day');
    },
    /** Money in the workspace currency (or the record's own); decimal strings stay exact up to the currency's places. */
    money: (amount: string | number | null | undefined, code = currency) => {
      if (amount === null || amount === undefined || amount === '') return '';
      if (!code) return format.number(Number(amount), 2);
      const places = fractionDigits(code);
      try { return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: places, maximumFractionDigits: places }).format(Number(amount)); }
      catch { return `${code} ${Number(amount).toFixed(places)}`; }
    },
    /** How many decimals the currency uses (2 for most, 0 for some). */
    moneyPlaces: (code = currency) => (code ? fractionDigits(code) : 2),
    number: (value: number | string, digits = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value)),
    percent: (share: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share),
    /** Minutes as "7h 30m". */
    duration: (minutes: number) => {
      const whole = Math.max(0, Math.round(minutes));
      const hours = Math.floor(whole / 60);
      const rest = whole % 60;
      return hours ? `${hours}h${rest ? ` ${String(rest).padStart(2, '0')}m` : ''}` : `${rest}m`;
    },
    /** A wall-clock time in the workspace's zone as an instant. */
    instant: (dayValue: string, clock: string) => wallTimeToIso(dayValue, clock, timeZone),
    /** An instant's wall-clock time in the workspace's zone, as HH:mm. */
    clock: (value: string | Date) => {
      const p = parts(new Date(value), timeZone);
      return `${String(p.hour % 24).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    },
    dayOf: (value: string | Date) => isoDay(value, timeZone),
  };
  return format;
}
export type Format = ReturnType<typeof makeFormat>;
