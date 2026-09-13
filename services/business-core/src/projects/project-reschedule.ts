import type { Task, ProjectResource } from "./execution.types";
export type ScheduleChange = {
  id: string;
  title: string;
  fromStart: string;
  fromEnd: string;
  start: string;
  end: string;
};
const plus = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export function previewReschedule(
  tasks: Task[],
  resources: ProjectResource[],
  taskId: string,
  newStart: string,
): ScheduleChange[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(newStart) ||
    !Number.isFinite(Date.parse(newStart)) ||
    new Date(newStart).toISOString().slice(0, 10) !== newStart
  )
    throw new Error("Choose a valid forecast start.");
  const root = tasks.find((t) => t.id === taskId);
  if (!root || ["completed", "cancelled"].includes(root.status))
    throw new Error("Choose unfinished work to reschedule.");
  const values = tasks.map((t) => ({ ...t })),
    affected = new Set([taskId]);
  const working = (t: Task, date: string) => {
    const c = resources.find((r) => r.id === t.resourceId)?.calendar;
    return (
      !c ||
      (c.weekdays.includes(new Date(date).getUTCDay()) &&
        !c.holidays.some((h) => h.date === date))
    );
  };
  const next = (t: Task, date: string) => {
    for (let n = 0; n < 740; n++, date = plus(date, 1))
      if (working(t, date)) return date;
    throw new Error("The calendar has no available working date.");
  };
  const move = (t: Task, date: string) => {
    const original = tasks.find((v) => v.id === t.id)!;
    let duration = 0;
    for (
      let current = original.start, n = 0;
      current <= original.end;
      n++, current = plus(current, 1)
    ) {
      if (n > 730)
        throw new Error("Limit schedule changes to two years of work.");
      if (working(t, current)) duration++;
    }
    t.start = next(t, date);
    t.end = t.start;
    for (let count = 1; count < Math.max(duration, 1); count++)
      t.end = next(t, plus(t.end, 1));
  };
  move(values.find((t) => t.id === taskId)!, newStart);
  for (let pass = 0; pass <= values.length; pass++) {
    let changed = false;
    for (const task of values) {
      if (["completed", "cancelled"].includes(task.status)) continue;
      const predecessors = task.predecessors
        .map((id) => values.find((t) => t.id === id)!)
        .filter(Boolean);
      const parent = task.parentId
        ? values.find((t) => t.id === task.parentId)
        : undefined;
      if (parent && affected.has(parent.id) && !affected.has(task.id)) {
        const days = Math.round(
          (Date.parse(parent.start) -
            Date.parse(tasks.find((t) => t.id === parent.id)!.start)) /
            86400000,
        );
        move(task, plus(task.start, days));
        affected.add(task.id);
        changed = true;
      }
      if (
        predecessors.some((p) => affected.has(p.id)) ||
        affected.has(task.id)
      ) {
        const end = predecessors
          .filter((p) => p.status !== "completed")
          .map((p) => p.end)
          .sort()
          .at(-1);
        if (end && task.start <= end) {
          move(task, plus(end, 1));
          affected.add(task.id);
          changed = true;
        }
      }
    }
    if (!changed) break;
    if (pass === values.length)
      throw new Error("Resolve circular dependencies before rescheduling.");
  }
  return values
    .filter((t) => affected.has(t.id))
    .map((t) => {
      const old = tasks.find((v) => v.id === t.id)!;
      return {
        id: t.id,
        title: t.title,
        fromStart: old.start,
        fromEnd: old.end,
        start: t.start,
        end: t.end,
      };
    })
    .filter((t) => t.start !== t.fromStart || t.end !== t.fromEnd);
}
