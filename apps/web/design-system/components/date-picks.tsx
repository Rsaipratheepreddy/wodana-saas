"use client";

import { useContext } from "react";
import { DatePickerStateContext } from "react-aria-components";
import { Time, toCalendarDateTime, toZoned, type CalendarDate, type DateValue } from "@internationalized/date";
import { useT } from "@/lib/i18n/i18n-provider";
import { useDesignSystem } from "../foundations/provider";
import { useWorkingCalendar } from "../foundations/working-days";

export type DateLimits = { minValue?: DateValue | null; maxValue?: DateValue | null; isDateUnavailable?: (date: DateValue) => boolean };

/** When a quick pick with a time lands: 10:00, the start of a working morning. */
const MORNING = new Time(10);

/**
 * One-tap dates for a date field: Today, Tomorrow (10:00 when the field has a time) and the next working day
 * of the workspace's week. A pick outside the field's limits is not offered. Renders inside a `DateField`.
 */
export function DateQuickPicks({ isDisabled, limits, onPicked }: { isDisabled?: boolean; limits: DateLimits; onPicked?: () => void }) {
  const t = useT();
  const state = useContext(DatePickerStateContext);
  const { locale } = useDesignSystem();
  const calendar = useWorkingCalendar();
  if (!state) return null;
  const today = calendar.today();
  const tomorrow = today.add({ days: 1 });
  const nextWorking = calendar.nextWorkingDay(today);
  const current = state.value;
  const withTime = state.hasTime;
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, MORNING.hour, MORNING.minute));
  // Today keeps the time already chosen, else the next full hour.
  const now = new Date();
  const todayTime = current && "hour" in current ? new Time(current.hour, current.minute) : new Time(Math.min(now.getHours() + 1, 23));
  const at = (date: CalendarDate, time: Time): DateValue => {
    if (!withTime) return date;
    const local = toCalendarDateTime(date, time);
    return current && "timeZone" in current ? toZoned(local, current.timeZone) : local;
  };
  const picks = [
    { id: "today", label: t("Today"), value: at(today, todayTime) },
    { id: "tomorrow", label: withTime ? t("Tomorrow {time}", { time: timeLabel }) : t("Tomorrow"), value: at(tomorrow, MORNING) },
    ...(nextWorking.compare(tomorrow) !== 0 ? [{ id: "next-working-day", label: t("Next working day"), value: at(nextWorking, MORNING) }] : []),
  ].filter(({ value }) => (!limits.minValue || value.compare(limits.minValue as never) >= 0)
    && (!limits.maxValue || value.compare(limits.maxValue as never) <= 0)
    && !limits.isDateUnavailable?.(value));
  if (!picks.length || isDisabled) return null;
  return <div aria-label={t("Quick dates")} className="wd-quick-picks" role="group">
    {picks.map((pick) => <button aria-pressed={Boolean(current && current.compare(pick.value as never) === 0)} className="wd-chip" key={pick.id} onClick={() => { state.setValue(pick.value); state.setOpen(false); onPicked?.(); }} type="button">{pick.label}</button>)}
  </div>;
}
