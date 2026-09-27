export type CalendarMode = "day" | "week" | "month";
export function calendarDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarRange(anchor: Date, mode: CalendarMode) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), mode === "month" ? 1 : anchor.getDate());
  if (mode === "week" || mode === "month") start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: mode === "month" ? 42 : mode === "week" ? 7 : 1 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days.length);
  return { start, end, days };
}
export function moveCalendar(anchor: Date, mode: CalendarMode, direction: number) {
  return mode === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction * (mode === "week" ? 7 : 1));
}
export function localDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  return `${calendarDayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type CalendarEvent = { id: string; title: string; start: Date; end?: Date; allDay?: boolean; provider: 'crm' | 'google' | 'project'; kind?: string; status?: string; href?: string; calendarName?: string; ownerId?: string; ownerName?: string; connectionId?: string; description?: string; location?: string; attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }> };
export function eventsForDay(events: CalendarEvent[], day: Date) {
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return events.filter(event => event.start < end && (event.end && event.end > event.start ? event.end > day : event.start >= day));
}
// Wall-clock minutes preserve the displayed local hour across daylight-saving changes.
// Side-by-side lanes stay readable: a cluster wider than `maxColumns` lanes folds its overflow into one "+N" chip.
export function timeEventLayout(events: CalendarEvent[], day: Date, maxColumns = Number.POSITIVE_INFINITY) {
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const minute = (date: Date) => date.getHours() * 60 + date.getMinutes();
  const entries = eventsForDay(events, day).filter(event => !event.allDay).map(event => {
    const start = event.start < day ? 0 : minute(event.start);
    const end = event.end && event.end > event.start ? event.end >= dayEnd ? 1440 : minute(event.end) : Math.min(1440, start + 30);
    return { event, start, end: Math.min(1440, Math.max(start + 30, end)), column: 0, columns: 1, cluster: 0, folded: false };
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
  let group: typeof entries = [], groupEnd = 0, cluster = 0;
  const finish = () => {
    const count = Math.max(1, ...group.map(item => item.column + 1));
    // The "+N" chip takes the last lane, so a folded cluster draws one lane fewer than the limit.
    const visible = count > maxColumns ? Math.max(1, maxColumns - 1) : count;
    for (const item of group) { item.columns = visible; item.cluster = cluster; item.folded = count > maxColumns; }
    cluster++;
  };
  for (const item of entries) {
    if (group.length && item.start >= groupEnd) { finish(); group = []; }
    const occupied = new Set(group.filter(other => other.end > item.start).map(other => other.column));
    while (occupied.has(item.column)) item.column++;
    group.push(item); groupEnd = Math.max(item.end, group.length === 1 ? 0 : groupEnd);
  }
  finish();
  return entries;
}
/** `start`–`end` is where the chip sits (the hidden events); `from`–`to` spans the whole cluster it opens. */
export type TimeEventFold = { start: number; end: number; from: number; to: number; hidden: number; events: CalendarEvent[] };
/** The lanes the grid draws, plus one fold per cluster whose hidden events sit behind a "+N" chip. */
export function timeEventLanes(events: CalendarEvent[], day: Date, maxColumns: number) {
  const entries = timeEventLayout(events, day, maxColumns);
  const folds = new Map<number, TimeEventFold>();
  for (const item of entries) {
    if (item.column < item.columns) continue;
    const cluster = entries.filter(entry => entry.cluster === item.cluster);
    const fold = folds.get(item.cluster) ?? { start: item.start, end: item.end, from: Math.min(...cluster.map(entry => entry.start)), to: Math.max(...cluster.map(entry => entry.end)), hidden: 0, events: cluster.map(entry => entry.event) };
    fold.start = Math.min(fold.start, item.start); fold.end = Math.max(fold.end, item.end); fold.hidden++;
    folds.set(item.cluster, fold);
  }
  return { lanes: entries.filter(item => item.column < item.columns), folds: [...folds.values()] };
}
