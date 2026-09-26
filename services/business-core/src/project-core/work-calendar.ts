import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** Which days are worked (0 = Sunday … 6 = Saturday) and the days off, as YYYY-MM-DD. */
export type WorkCalendar = { workingDays: number[]; holidays: string[] };

const DAY = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * The workspace's working week: its own work calendar (with holidays) when it has one, otherwise its
 * country's region pack, otherwise Monday to Friday.
 */
export async function readCalendar(db: Db, workspaceId: string): Promise<WorkCalendar> {
  const own = (await db.query<{ workingDays: number[]; holidays: string[] }>(
    `SELECT working_days AS "workingDays", holidays::text[] AS holidays FROM hrms_calendars WHERE workspace_id = $1 ORDER BY created_at, id LIMIT 1`, [workspaceId])).rows[0];
  if (own?.workingDays?.length) return { workingDays: own.workingDays, holidays: own.holidays ?? [] };
  const pack = (await db.query<{ workingDays: unknown }>(
    `SELECT profile.configuration->'calendarPolicy'->'workingDays' AS "workingDays"
       FROM workspaces workspace JOIN tenant_setup_profiles profile ON profile.kind = 'region' AND profile.code = upper(split_part(workspace.default_locale, '-', 2))
      WHERE workspace.id = $1 ORDER BY profile.version DESC LIMIT 1`, [workspaceId])).rows[0]?.workingDays;
  const days = Array.isArray(pack) ? pack.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  return { workingDays: days.length ? days : [1, 2, 3, 4, 5], holidays: [] };
}

/** Working-day arithmetic on calendar dates. */
export function workdays(calendar: WorkCalendar) {
  const days = new Set(calendar.workingDays.length ? calendar.workingDays : [1, 2, 3, 4, 5]);
  const off = new Set(calendar.holidays);
  const isWorking = (date: string) => days.has(new Date(at(date)).getUTCDay()) && !off.has(date);
  const step = (date: string, direction: 1 | -1) => iso(at(date) + direction * DAY);
  /** The date itself when worked, otherwise the next working day. */
  const onOrAfter = (date: string) => { let day = date; for (let guard = 0; !isWorking(day) && guard < 400; guard++) day = step(day, 1); return day; };
  /** Moves `count` working days from a working day (backwards when negative). */
  const shift = (date: string, count: number) => {
    let day = onOrAfter(date);
    const direction = count < 0 ? -1 : 1;
    for (let left = Math.abs(count); left > 0;) { day = step(day, direction); if (isWorking(day)) left--; }
    return day;
  };
  /** Working days from start to due, both included; at least one. */
  const span = (start: string, due: string) => {
    if (due < start) return 1;
    let count = 0;
    for (let day = start; day <= due; day = step(day, 1)) if (isWorking(day)) count++;
    return Math.max(1, count);
  };
  return { isWorking, onOrAfter, shift, span, next: (date: string) => onOrAfter(step(date, 1)) };
}

export type PlanNode = { id: string; number: number; title: string; status: string; startDate: string | null; dueDate: string | null };
export type PlanLink = { predecessorId: string; successorId: string; kind: "fs" | "ss"; lagDays: number };
export type PlanMove = { id: string; number: number; title: string; fromStart: string | null; fromDue: string | null; startDate: string | null; dueDate: string | null; because: number };

/**
 * What else moves when an item's dates change: every open item that waits on it (directly or through
 * others) and would now start too early is pushed later, keeping its length in working days. Nothing
 * is ever pulled earlier, and finished items don't move.
 */
export function ripple(nodes: PlanNode[], links: PlanLink[], changed: { id: string; startDate: string | null; dueDate: string | null }, calendar: WorkCalendar): PlanMove[] {
  const math = workdays(calendar);
  const byId = new Map(nodes.map((node) => [node.id, { ...node }]));
  const root = byId.get(changed.id);
  if (!root) return [];
  root.startDate = changed.startDate;
  root.dueDate = changed.dueDate;
  const after = new Map<string, PlanLink[]>();
  const before = new Map<string, PlanLink[]>();
  for (const link of links) {
    after.set(link.predecessorId, [...(after.get(link.predecessorId) ?? []), link]);
    before.set(link.successorId, [...(before.get(link.successorId) ?? []), link]);
  }
  // Everything downstream, in an order where each item comes after all its predecessors.
  const reach = new Set<string>();
  const walk = [changed.id];
  while (walk.length) for (const link of after.get(walk.pop()!) ?? []) if (!reach.has(link.successorId)) { reach.add(link.successorId); walk.push(link.successorId); }
  reach.delete(changed.id);
  const order: string[] = [];
  const pending = new Map([...reach].map((id) => [id, (before.get(id) ?? []).filter((link) => reach.has(link.predecessorId)).length]));
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const link of after.get(id) ?? []) if (pending.has(link.successorId)) {
      const left = pending.get(link.successorId)! - 1;
      pending.set(link.successorId, left);
      if (left === 0) ready.push(link.successorId);
    }
  }
  const moves: PlanMove[] = [];
  const open = (node: PlanNode) => node.status !== "done" && node.status !== "cancelled";
  for (const id of order) {
    const node = byId.get(id)!;
    if (!open(node) || (!node.startDate && !node.dueDate)) continue;
    const start = node.startDate ?? node.dueDate!;
    const due = node.dueDate ?? node.startDate!;
    let earliest: string | null = null;
    let cause = 0;
    for (const link of before.get(id) ?? []) {
      const previous = byId.get(link.predecessorId);
      if (!previous || !open(previous)) continue;
      const from = link.kind === "ss" ? previous.startDate ?? previous.dueDate : previous.dueDate ?? previous.startDate;
      if (!from) continue;
      const candidate = link.kind === "ss" ? math.shift(from, link.lagDays) : math.shift(math.next(from), link.lagDays);
      if (!earliest || candidate > earliest) { earliest = candidate; cause = previous.number; }
    }
    if (!earliest || start >= earliest) continue;
    const length = math.span(start, due);
    // Keep the shape: an item with only a due date keeps only a due date.
    const moved = { startDate: node.startDate ? earliest : null, dueDate: node.dueDate ? math.shift(earliest, length - 1) : null };
    moves.push({ id, number: node.number, title: node.title, fromStart: node.startDate, fromDue: node.dueDate, because: cause, ...moved });
    node.startDate = moved.startDate;
    node.dueDate = moved.dueDate;
  }
  return moves;
}
