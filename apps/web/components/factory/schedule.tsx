"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, Gantt, SegmentedControl, Skeleton, useDesignSystem, type GanttDay, type GanttGroup } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { ScheduleState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { orderNumber } from "./factory-labels";
import styles from "./factory.module.css";

const DAY = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

/**
 * The next weeks in the factory: each workcenter's work orders as bars, and first the days a workcenter
 * has more hours booked than it can do, with the work orders that fill them.
 */
export function Schedule({ api, refreshKey, onOpen }: { api: FactoryApi; refreshKey: number; onOpen: (orderId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const { locale } = useDesignSystem();
  const [span, setSpan] = useState<"14" | "28" | "56">("28");
  const [state, setState] = useState<ScheduleState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.schedule(undefined, Number(span))); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The schedule didn't load.")); }
  }, [api, span, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const { days, groups } = useMemo(() => {
    if (!state) return { days: [] as GanttDay[], groups: [] as GanttGroup[] };
    const worked = new Set(state.days);
    const dayLabel = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric" });
    const monthLabel = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", year: "numeric" });
    const list: GanttDay[] = [];
    for (let at = time(state.from); at <= time(state.to); at += DAY) {
      const moment = new Date(at);
      list.push({ date: iso(at), label: dayLabel.format(moment), month: !list.length || moment.getUTCDate() === 1 ? monthLabel.format(moment) : undefined, off: !worked.has(iso(at)), today: iso(at) === state.from });
    }
    const index = (date: string) => Math.max(0, Math.min(list.length - 1, Math.round((time(date) - time(state.from)) / DAY)));
    const runsPast = (start: string, end: string) => { const before = time(start) < time(state.from), after = time(end) > time(state.to); return before && after ? "both" as const : before ? "start" as const : after ? "end" as const : undefined; };
    const busy = new Set(state.conflicts.flatMap((conflict) => conflict.orders));
    const rows = (centerId: string | null) => state.orders.filter((order) => order.workcenterId === centerId).map((order) => ({
      id: order.id, ariaLabel: busy.has(order.id) ? t("{order} {item}, on a day over capacity", { order: orderNumber(order.number), item: order.title }) : `${orderNumber(order.number)} ${order.title}`,
      label: <><span className={styles.number}>{orderNumber(order.number)}</span>{busy.has(order.id) ? <span className={styles.lateText}>{t("Over")}</span> : null}<span>{`${order.title} · ${order.projectReference}`}</span></>,
      start: index(order.plannedStart!), end: index(order.plannedEnd!), tone: order.status === "on_hold" ? "blocked" as const : "default" as const, critical: busy.has(order.id),
      barLabel: order.plannedHours ? t("{order} · {hours} h", { order: orderNumber(order.number), hours: Number(order.plannedHours) }) : orderNumber(order.number),
      continues: runsPast(order.plannedStart!, order.plannedEnd!),
    }));
    return {
      days: list,
      groups: [...state.workcenters.map((center) => ({ id: center.id, label: center.hoursPerDay ? t("{name} · {hours} h a day", { name: center.name, hours: Number(center.hoursPerDay) }) : center.name, rows: rows(center.id) })),
        { id: "none", label: t("No workcenter"), rows: rows(null) }].filter((group) => group.rows.length),
    };
  }, [state, locale, t]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  return <div className={styles.stack}>
    <div className={styles.filters}>
      <SegmentedControl label={t("Show")} value={span} onChange={(value) => setSpan(value as "14" | "28" | "56")}
        options={[{ id: "14", label: t("2 weeks") }, { id: "28", label: t("4 weeks") }, { id: "56", label: t("8 weeks") }]} />
    </div>
    {state.conflicts.length ? <section className={styles.stack} aria-label={t("Over capacity")}>
      <h3 className={styles.subhead}>{t("Over capacity")}</h3>
      <ul className={styles.list}>{state.conflicts.map((conflict) => <li key={`${conflict.workcenterId}:${conflict.date}`}>
        <span className={styles.nameCell}><span>{`${conflict.workcenterName} · ${format.day(conflict.date)}`}</span>
          <small>{state.orders.filter((order) => conflict.orders.includes(order.id)).map((order) => orderNumber(order.number)).join(", ")}</small></span>
        <span className={styles.lateText}>{t("{hours} of {capacity} hours", { hours: conflict.hours, capacity: conflict.capacity })}</span>
      </li>)}</ul>
    </section> : null}
    {!groups.length ? <EmptyState illustration={null} title={t("Nothing scheduled in these weeks")} description={t("Give work orders a workcenter and dates to see them here.")} />
      : <Gantt ariaLabel={t("Schedule")} labelHeader={t("Work order")} days={days} groups={groups} onRowAction={onOpen} />}
  </div>;
}
