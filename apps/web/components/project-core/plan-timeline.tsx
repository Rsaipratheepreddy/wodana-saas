"use client";

import { useMemo } from "react";
import { Gantt, useDesignSystem, type GanttDay, type GanttGroup, type GanttRow } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkBoard, WorkItem } from "@/lib/project-core/types";
import { TypeIcon, isOpen } from "./work-labels";
import styles from "./work.module.css";

const DAY = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

/**
 * The plan on a timeline: each item from its start to its due date, grouped like the list, with days
 * off shaded, today and the handover date drawn across, and the baseline under each bar.
 */
export function PlanTimeline({ board, items, onOpen }: { board: WorkBoard; items: WorkItem[]; onOpen: (id: string) => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), [timeZone]);

  const { days, index } = useMemo(() => {
    const dates = items.flatMap((item) => [item.startDate, item.dueDate, item.baselineStart, item.baselineDue]).filter((value): value is string => Boolean(value));
    const known = [...dates, today, ...(board.promiseDate ? [board.promiseDate] : [])].sort();
    const from = time(known[0]) - 3 * DAY;
    const to = Math.min(time(known[known.length - 1]) + 7 * DAY, from + 400 * DAY);
    const working = new Set(board.calendar.workingDays);
    const holidays = new Set(board.calendar.holidays);
    const dayLabel = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric" });
    const monthLabel = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" });
    const list: GanttDay[] = [];
    for (let at = from; at <= to; at += DAY) {
      const date = iso(at);
      const moment = new Date(at);
      list.push({ date, label: dayLabel.format(moment), month: !list.length || moment.getUTCDate() === 1 ? monthLabel.format(moment) : undefined,
        off: !working.has(moment.getUTCDay()) || holidays.has(date), today: date === today });
    }
    return { days: list, index: (date: string) => Math.round((time(date) - from) / DAY) };
  }, [items, board.calendar, board.promiseDate, locale, today]);

  const last = days.length - 1;
  const clamp = (value: number) => Math.max(0, Math.min(last, value));
  const row = (item: WorkItem, depth: 0 | 1): GanttRow => {
    const start = item.startDate ?? item.dueDate;
    const end = item.dueDate ?? item.startDate;
    const baseline = item.baselineStart ?? item.baselineDue;
    const baselineEnd = item.baselineDue ?? item.baselineStart;
    const blocked = item.blockedBy.length > 0 && isOpen(item.status);
    return {
      id: item.id, depth,
      label: <><TypeIcon type={item.type} /><span className={styles.number}>#{item.number}</span><span>{item.title}</span></>,
      ariaLabel: `#${item.number} ${item.title}`,
      ...(start && end ? { start: clamp(index(start)), end: clamp(index(end)) } : {}),
      baseline: baseline && baselineEnd && (baseline !== start || baselineEnd !== end) ? { start: clamp(index(baseline)), end: clamp(index(baselineEnd)) } : null,
      tone: item.status === "done" ? "done" : end && end < today && isOpen(item.status) ? "late" : blocked ? "blocked" : "default",
    };
  };
  const shown = new Set(items.map((item) => item.id));
  const top = items.filter((item) => !item.parentId || !shown.has(item.parentId));
  const withChildren = (list: WorkItem[]) => list.flatMap((item) => [row(item, 0), ...items.filter((child) => child.parentId === item.id).map((child) => row(child, 1))]);
  const dated = (item: WorkItem) => Boolean(item.startDate || item.dueDate) || items.some((child) => child.parentId === item.id && (child.startDate || child.dueDate));
  const groups: GanttGroup[] = [
    ...board.packages.map((item) => ({ id: item.id, label: item.name, rows: withChildren(top.filter((entry) => entry.packageId === item.id && dated(entry))) })),
    { id: "none", label: board.packages.length ? t("No package") : t("Work"), rows: withChildren(top.filter((entry) => (!entry.packageId || !board.packages.some((item) => item.id === entry.packageId)) && dated(entry))) },
    { id: "undated", label: t("No dates"), rows: top.filter((entry) => !dated(entry)).map((entry) => row(entry, 0)) },
  ].filter((group) => group.rows.length);
  const handover = board.promiseDate ? index(board.promiseDate) : null;

  return <Gantt ariaLabel={t("Timeline")} labelHeader={t("Work")} days={days} groups={groups} onRowAction={onOpen}
    markers={handover !== null && handover >= 0 && handover <= last ? [{ index: handover, label: t("Handover") }] : []} />;
}
