"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AttendanceDay, AttendanceHistory, HrmsEmployee } from "@wodana/contracts";
import { DataGrid, EmptyState, ErrorState, InlineNotice, addDays, monthLabel, shiftMonth, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import type { Attendance } from "./check-in";
import { PendingCaptureNotice } from "./check-in";
import { DaySheet } from "./day-sheet";
import { PeriodStepper } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import { DayStatus, dayState, useHrmsLabels } from "./hrms-labels";
import styles from "./hrms.module.css";

/** Where a day was spent: the places worked, the leave taken, or where the person is now. */
/** Where a day was worked: each place by name, or the way of working ("Office") when it was general work there. */
export function dayWhere(day: AttendanceDay, modeName: (mode: string) => string = (mode) => mode) {
  const places = [...new Set(day.breakdown.map((item) => item.name || modeName(item.mode)).filter(Boolean))];
  return places.length ? places.join(", ") : day.place ?? day.leaveType ?? "";
}

/** My attendance: today in one line, then my days for a month; a day opens with its events, photos and reviews. */
export function AttendanceTab({ api, employee, attendance, openDay, onOpenDay }: {
  api: HrmsApi; employee: HrmsEmployee; attendance: Attendance; openDay: string | null; onOpenDay: (day: string | null) => void;
}) {
  const t = useT();
  const { mode: modeName } = useHrmsLabels();
  const format = useHrmsFormat();
  const { locale } = useDesignSystem();
  const zone = employee.calendar.timezone;
  const today = format.today(zone);
  const [month, setMonth] = useState(() => (openDay ?? today).slice(0, 7));
  const [linked, setLinked] = useState(openDay);
  // A link to a day in another month shows that month.
  if (openDay !== linked) {
    setLinked(openDay);
    if (openDay && openDay.slice(0, 7) !== month) setMonth(openDay.slice(0, 7));
  }
  const from = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const to = last < today ? last : today;
  const [history, setHistory] = useState<{ key: string; value: AttendanceHistory } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const key = `${from}:${to}`;
    try { setHistory({ key, value: await api.history({ from, to }) }); setError(""); } catch (cause) { setError(format.failure(cause, t("Your days didn't load."))); }
  }, [api, from, to, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, attendance.revision]);
  const loaded = history?.key === `${from}:${to}` ? history.value : null;
  const rows = useMemo(() => (loaded?.days ?? []).filter((day) => day.date <= today).sort((a, b) => b.date.localeCompare(a.date)), [loaded, today]);
  const columns = useMemo<DataGridColumn<AttendanceDay>[]>(() => [
    { id: "date", header: t("Date"), accessorFn: (row) => row.date, size: 150, meta: { primary: true, renderCell: (row) => format.day(row.date) } },
    { id: "in", header: t("In"), accessorFn: (row) => row.firstIn ?? "", size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.time(row.firstIn, row.timezone)}</span> } },
    { id: "out", header: t("Out"), accessorFn: (row) => row.lastOut ?? "", size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.time(row.lastOut, row.timezone)}</span> } },
    { id: "hours", header: t("Hours"), accessorFn: (row) => row.elapsedMinutes, size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.duration(row.elapsedMinutes)}</span> } },
    { id: "where", header: t("Where"), accessorFn: (row) => dayWhere(row, modeName), size: 220, meta: { mobileHidden: true } },
    { id: "status", header: t("Status"), accessorFn: (row) => dayState(row), size: 160, meta: { renderCell: (row) => <DayStatus state={dayState(row)} /> } },
  ], [t, format]);
  const open = openDay ? loaded?.days.find((day) => day.date === openDay) ?? null : null;
  const firstMonth = employee.activeFrom.slice(0, 7);
  return <>
    <TodayLine api={api} employee={employee} attendance={attendance} today={today} />
    {attendance.storage === "unavailable" ? <InlineNotice tone="error" message={t("This browser can't keep captures, so you can't check in here. Allow site storage and reload.")} /> : null}
    {attendance.error ? <InlineNotice tone="error" message={attendance.error} /> : null}
    <PendingCaptureNotice attendance={attendance} timezone={zone} />
    {error && !loaded ? <ErrorState description={error} onRetry={() => void load()} /> : <DataGrid<AttendanceDay> ariaLabel={t("My days")} columns={columns} data={rows}
      getRowId={(row) => row.date} isLoading={!loaded} onRowAction={(row) => onOpenDay(row.date)} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search days")}
      toolbarLeading={<PeriodStepper label={monthLabel(month, locale)} previousLabel={t("Previous month")} nextLabel={t("Next month")} canPrevious={month > firstMonth} canNext={month < today.slice(0, 7)}
        onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />}
      emptyContent={<EmptyState title={t("No days this month")} />} />}
    {loaded && open ? <DaySheet api={api} day={open} history={loaded} today={today} onClose={() => onOpenDay(null)} onChanged={() => void load()} /> : null}
  </>;
}

/** Today in one line: where I stand, where I am and since when, and the hours so far. */
function TodayLine({ api, employee, attendance, today }: { api: HrmsApi; employee: HrmsEmployee; attendance: Attendance; today: string }) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const zone = employee.calendar.timezone;
  const [day, setDay] = useState<{ value: AttendanceDay | null; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    api.history({ from: today, to: today }).then((result) => { if (live) setDay({ value: result.days[0] ?? null, at: Date.now() }); }).catch(() => { if (live) setDay({ value: null, at: Date.now() }); });
    return () => { live = false; };
  }, [api, today, attendance.revision]);
  useEffect(() => {
    if (!attendance.checkedIn) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [attendance.checkedIn]);
  if (attendance.current === undefined || !day) return <div className={styles.today} aria-busy="true" />;
  const active = attendance.current?.segments.find((segment) => !segment.endedAt) ?? null;
  const running = attendance.checkedIn && day.value?.open ? Math.max(0, Math.floor((now - day.at) / 60_000)) : 0;
  const minutes = (day.value?.elapsedMinutes ?? 0) + running;
  const state = attendance.checkedIn ? "checked_in" : day.value ? dayState(day.value) : "not_checked_in";
  const parts = attendance.checkedIn && active
    ? [active.context.location?.name ?? labels.mode(active.mode), t("since {time}", { time: format.time(active.startedAt, zone) }), format.duration(minutes)]
    : [state === "on_leave" ? day.value?.leaveType ?? "" : "", format.duration(minutes)];
  return <div className={styles.today} role="group" aria-label={t("Today")}>
    <DayStatus state={state} />
    <span className={styles.parts}>{parts.filter(Boolean).map((part) => <span key={part}>{part}</span>)}</span>
  </div>;
}
