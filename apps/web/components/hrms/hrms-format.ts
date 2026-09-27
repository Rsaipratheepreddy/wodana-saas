"use client";

import { useMemo } from "react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { HrmsError, localDay } from "@/lib/hrms/client";

type WeekInfo = { firstDay?: number };
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/** The first day of the week in a locale, as 0 (Sunday) to 6. */
export function weekStart(locale: string) {
  try {
    const info = new Intl.Locale(locale) as LocaleWithWeek;
    return ((info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? 1) % 7;
  } catch {
    return 1;
  }
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** Dates, times, durations and day counts for People, in the workspace's locale; times in the zone they happened in. */
export function useHrmsFormat() {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const plural = new Intl.PluralRules(locale);
    const thisYear = localDay(timeZone).slice(0, 4);
    const first = weekStart(locale);
    const weekday = (day: number, style: "short" | "long") => new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)));
    const week = Array.from({ length: 7 }, (_, index) => (first + index) % 7).map((day) => ({ day, short: weekday(day, "short"), long: weekday(day, "long") }));
    const shortDate = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", ...(date.slice(0, 4) === thisYear ? {} : { year: "numeric" }) }).format(utc(date));
    return {
      /** Today in a time zone (the workspace's by default), as YYYY-MM-DD. */
      today: (zone = timeZone) => localDay(zone),
      /** A moment's time of day where it happened: "9:05 AM". */
      time: (value: string | null | undefined, zone: string) => (value ? new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : ""),
      /** A wall-clock time (HH:MM) as the locale writes it. */
      clock: (value: string) => {
        const [hour, minute] = value.split(":").map(Number);
        return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
      },
      /** A calendar day in a list: "Mon, 21 Sep". */
      day: (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(utc(date)),
      /** A calendar day as a title: "Monday, 21 September 2026". */
      longDay: (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(utc(date)),
      /** A calendar day without the year when it's this year: "21 Sep". */
      date: shortDate,
      /** A run of days: "21–23 Sep", or one day. */
      range: (start: string, end: string) => {
        if (start === end) return shortDate(start);
        const format = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", ...(start.slice(0, 4) === thisYear && end.slice(0, 4) === thisYear ? {} : { year: "numeric" }) });
        return format.formatRange ? format.formatRange(utc(start), utc(end)) : `${format.format(utc(start))}–${format.format(utc(end))}`;
      },
      /** When something was asked, in the workspace's zone: "21 Sep, 9:05 AM". */
      moment: (value: string | null) => (value ? new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : ""),
      /** Worked time: "7h 30m"; nothing for none. */
      duration: (minutes: number) => {
        if (minutes <= 0) return "";
        const hours = Math.floor(minutes / 60), rest = minutes % 60;
        return hours ? t("{hours}h {minutes}m", { hours: number.format(hours), minutes: number.format(rest) }) : t("{minutes}m", { minutes: number.format(rest) });
      },
      /** "1 day", "2.5 days". */
      days: (count: number) => (plural.select(count) === "one" ? t("{count} day", { count: number.format(count) }) : t("{count} days", { count: number.format(count) })),
      number: (value: number) => number.format(value),
      /** A distance in the locale's units: "150 m". */
      metres: (value: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "meter", maximumFractionDigits: 0 }).format(value),
      /** A unit's symbol or name for a field's suffix: "m", "s", "h", "days". */
      unit: (unit: "meter" | "second" | "hour" | "day") => {
        const parts = new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: unit === "day" ? "long" : "narrow" }).formatToParts(unit === "day" ? 2 : 1);
        return parts.filter((part) => part.type === "unit").map((part) => part.value).join("") || unit;
      },
      year: (value: number) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric" }).format(new Date(Date.UTC(value, 0, 1))),
      /** The week in the locale's order, from its first day. */
      week,
      /** Working days as a span where they run together: "Mon–Fri", else a list. */
      workingWeek: (days: number[]) => {
        const set = new Set(days);
        if (!set.size) return t("No working days");
        if (set.size === 7) return t("Every day");
        const starts = week.filter((item) => set.has(item.day) && !set.has((item.day + 6) % 7));
        if (starts.length === 1 && set.size > 1) {
          const start = starts[0].day, end = (start + set.size - 1) % 7;
          return `${weekday(start, "short")}–${weekday(end, "short")}`;
        }
        return week.filter((item) => set.has(item.day)).map((item) => item.short).join(", ");
      },
      /** A failed request's message; a lost connection says so in the person's language. */
      failure: (cause: unknown, fallback: string) =>
        cause instanceof HrmsError && cause.status === 0 ? t("You're offline. Try again when you're connected.") : cause instanceof Error && cause.message ? cause.message : fallback,
    };
  }, [locale, timeZone, t]);
}
export type HrmsFormat = ReturnType<typeof useHrmsFormat>;
