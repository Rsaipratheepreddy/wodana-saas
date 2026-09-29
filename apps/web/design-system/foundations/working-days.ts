"use client";

import { useMemo } from "react";
import { today as todayIn, type CalendarDate } from "@internationalized/date";
import { useDesignSystem } from "./provider";

type WeekInfo = { firstDay?: number; weekend?: number[] };
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/** The region locale's own working week (0 = Sunday … 6 = Saturday), from its weekend. Monday to Friday if unknown. */
export function localeWorkingDays(locale: string): number[] {
  try {
    const info = new Intl.Locale(locale) as LocaleWithWeek;
    const weekend = (info.getWeekInfo?.() ?? info.weekInfo)?.weekend;
    if (weekend?.length) return [0, 1, 2, 3, 4, 5, 6].filter((day) => !weekend.some((off) => off % 7 === day));
  } catch { /* an unknown locale works Monday to Friday */ }
  return [1, 2, 3, 4, 5];
}

/** The day of the week of a calendar date, 0 = Sunday. */
export function weekday(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Working-day arithmetic for a working week and its days off. */
export function workingCalendar(workingDays: readonly number[], holidays: readonly string[] = []) {
  const days = new Set(workingDays.length ? workingDays : [1, 2, 3, 4, 5]);
  const off = new Set(holidays);
  const isWorkingDay = (date: CalendarDate) => days.has(weekday(date)) && !off.has(date.toString());
  /** The first working day after `date`. */
  const nextWorkingDay = (date: CalendarDate) => {
    let day = date.add({ days: 1 });
    for (let guard = 0; !isWorkingDay(day) && guard < 400; guard += 1) day = day.add({ days: 1 });
    return day;
  };
  return { isWorkingDay, nextWorkingDay };
}

/**
 * The workspace's working calendar: its work calendar or region pack when the workspace sent one, else the
 * week of its region locale. `today` is the workspace's date, in its time zone.
 */
export function useWorkingCalendar() {
  const { holidays, regionLocale, timeZone, workingDays } = useDesignSystem();
  return useMemo(() => {
    const calendar = workingCalendar(workingDays?.length ? workingDays : localeWorkingDays(regionLocale), holidays);
    const today = () => todayIn(timeZone);
    return { ...calendar, today, nextWorkingDayFromToday: () => calendar.nextWorkingDay(today()), timeZone };
  }, [holidays, regionLocale, timeZone, workingDays]);
}
