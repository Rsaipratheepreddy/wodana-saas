"use client";

import { parseDate } from "@internationalized/date";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Phone, Plus, StickyNote } from "lucide-react";
import { Avatar, Button, Callout, IconButton, SelectField, DateField, Skeleton, useDesignSystem } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { calendarDayKey } from "@/lib/crm/calendar";
import { GRID_ORIGIN, HOUR_WIDTH, LANE_HEIGHT, layoutFollowUps } from "./follow-up-layout";
import styles from "./follow-up-timeline.module.css";

export function followUpDayRange(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
export function FollowUpTimeline({ workspaceId, day, onDayChange, now, revision, onCreate, onOpen, onList }: {
  onList?: () => void;
  workspaceId: string; day: string; onDayChange: (day: string) => void; now: number; revision: number;
  onCreate: (time?: string) => void; onOpen: (record: RecordData) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const router = useRouter();
  const [result, setResult] = useState<{ day: string; items: RecordData[]; error: string }>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const jumpToNow = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const items: RecordData[] = []; const seen = new Set<string>(); let cursor = "";
      try {
        const range = followUpDayRange(day);
        do {
          const query = new URLSearchParams({ limit: "100", ...range, ...(cursor ? { cursor } : {}) });
          const response = await crmRequest<{ data: RecordData[]; nextCursor?: string | null }>(workspaceId, `activities?${query}`, "GET", undefined, controller.signal);
          items.push(...response.data); cursor = response.nextCursor ?? "";
          if (cursor && seen.has(cursor)) throw new Error(tKey("Could not load the full schedule. Please retry."));
          seen.add(cursor);
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) setResult({ day, items: [...new Map(items.map(item => [item.id, item])).values()], error: "" });
      } catch (error) { if (!controller.signal.aborted) setResult({ day, items: [], error: (error as Error).message }); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [workspaceId, day, revision, retry]);
  useEffect(() => {
    if (!scroller.current) return;
    const dates = (result?.day === day ? result.items : []).filter(item => item.type !== "note" && item.status !== "cancelled").map(item => new Date(String(item.dueAt))).filter(date => Number.isFinite(date.getTime()) && calendarDayKey(date) === day);
    const first = dates.sort((a, b) => a.getTime() - b.getTime())[0];
    const current = new Date();
    const startHour = jumpToNow.current || day === calendarDayKey(current) ? current.getHours() + current.getMinutes() / 60 - 1 : first ? first.getHours() - 1 : 6;
    const direction = getComputedStyle(scroller.current).direction === "rtl" ? -1 : 1;
    scroller.current.scrollLeft = direction * Math.max(0, startHour * HOUR_WIDTH);
    if (result?.day === day) jumpToNow.current = false;
  }, [day, result]);
  const layout = layoutFollowUps(result?.day === day ? result.items : [], day);
  const items = layout.map(entry => entry.item);
  const today = calendarDayKey(new Date(now));
  const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const move = (amount: number) => { const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + amount); onDayChange(calendarDayKey(date)); };
  return <section className={styles.timeline} aria-label={t("Calendar timeline")}>
    <div className={styles.toolbar}>
      <div className={styles.viewChoice}><SelectField label={<span className="wd-visually-hidden">{t("Schedule view")}</span>} selectedKey="timeline" items={[{ id: "timeline", label: t("Timeline") }, { id: "kanban", label: t("Tasks · Kanban") }, { id: "list", label: t("Table") }]} onSelectionChange={key => { if (key === "list") onList?.(); if (key === "kanban") router.push("/workspace/crm/follow-ups?view=activity"); }} /></div>
      <div className={styles.dates}><span className={styles.hoursLabel}>{t("Hours")}</span><Button size="compact" onPress={() => { jumpToNow.current = day !== today; onDayChange(today); if (scroller.current) { const direction = getComputedStyle(scroller.current).direction === "rtl" ? -1 : 1; scroller.current.scrollLeft = direction * Math.max(0, hour * HOUR_WIDTH - HOUR_WIDTH); } }}>{t("Now")}</Button><IconButton size="compact" aria-label={t("Previous day")} onPress={() => move(-1)}><ChevronLeft size={16} /></IconButton><DateField label={<span className="wd-visually-hidden">{t("Schedule date")}</span>} value={parseDate(day)} onChange={value => { if (value) onDayChange(value.toString()); }} /><IconButton size="compact" aria-label={t("Next day")} onPress={() => move(1)}><ChevronRight size={16} /></IconButton><Button size="compact" variant="primary" onPress={() => onCreate()}><Plus size={15} />{t("Create new")}</Button></div>
    </div>
    {result?.day === day && result.error ? <Callout tone="warning" title={t("Could not load schedule")}>{translateKnown(t, result.error)}<Button size="compact" onPress={() => setRetry(value => value + 1)}>{t("Retry")}</Button></Callout> : null}
    <div ref={scroller} className={styles.scroller} tabIndex={0} aria-label={t("Hourly schedule, scroll horizontally")}>
      <div className={styles.canvas} style={{ inlineSize: GRID_ORIGIN + 24 * HOUR_WIDTH }}>
        <div className={styles.hours}>{Array.from({ length: 24 }, (_, hour) => <button type="button" key={hour} onClick={() => onCreate(`${String(hour).padStart(2, "0")}:00`)} aria-label={t("Add follow-up at {time}", { time: `${String(hour).padStart(2, "0")}:00` })}><span className={styles.hourLabel}>{new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: "numeric" })}</span></button>)}</div>
        {day === today ? <div className={styles.now} style={{ insetInlineStart: `${GRID_ORIGIN + hour * HOUR_WIDTH}px` }}><span>{t("Now · {time}", { time: new Date(now).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) })}</span></div> : null}
        <div className={styles.rows} style={{ minBlockSize: Math.max(480, (Math.max(0, ...layout.map(entry => entry.lane)) + 1) * LANE_HEIGHT + 32) }}>
          <div className={styles.grid} aria-hidden="true">{Array.from({ length: 48 }, (_, slot) => <span key={slot} data-hour={slot % 2 === 0} />)}</div>
          {layout.map(({ item, from, to, offset, width, lane, duration }) => {
            const format = (value: Date) => value.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
            const time = !to ? format(from) : calendarDayKey(to) !== calendarDayKey(from) ? t("{from} – {to} (+1 day)", { from: format(from), to: format(to) }) : `${format(from)} – ${format(to)}`;
            const label = `${String(item.title)} · ${time} · ${String(item.partyName ?? item.leadTitle ?? t("Follow-up"))}`;
            return <button key={String(item.id)} type="button" className={styles.card} data-kind={item.type} data-point={!duration} data-narrow={width < 200} data-completed={item.status === "completed"} style={{ insetInlineStart: offset, insetBlockStart: 16 + lane * LANE_HEIGHT, inlineSize: width }} aria-label={label} title={label} onClick={() => onOpen(item)}><span className={styles.cardIcon}>{item.status === "completed" ? <Check size={18} /> : item.type === "call" ? <Phone size={18} /> : item.type === "meeting" ? <CalendarDays size={18} /> : <StickyNote size={18} />}</span><span className={styles.cardText}><strong>{String(item.title)}</strong><span className={styles.timeRange}>{time}</span><small>{String(item.partyName ?? item.leadTitle ?? t("Follow-up"))}</small></span><Avatar name={String(item.ownerName ?? t("Unassigned"))} size="sm" /></button>;
          })}
        </div>
      </div>
    </div>
    {loading ? <Skeleton lines={6} shape="rows" /> : !items.length && !result?.error ? <div className={styles.empty}><CalendarDays size={25} /><h3>{t("A little room for your next conversation")}</h3><p>{t("Choose a time above or add a follow-up with your notes.")}</p><Button size="compact" onPress={() => onCreate()}><Plus size={15} />{t("Add follow-up")}</Button></div> : <p className={styles.legend}>{t("Cards span the scheduled time. Overlapping follow-ups appear in separate rows. Open one for notes and actions.")}</p>}
  </section>;
}
