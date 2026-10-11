import { ripple, workdays, type PlanLink, type WorkCalendar } from "../project-core/work-calendar";

/**
 * A change's time impact on the project's real plan (plan §6.10 scheduling, §6.20): the change says how many working
 * days each affected stage takes longer; the preview says which stages and which work move and the handover date it
 * gives. Pure: the store reads the stages, the work and its links, and the work calendar.
 *
 * - Stages follow each other in their route order (finish to start). A stage's dates are its work's dates: the
 *   earliest start and the latest due date of its work, as the Overview shows them.
 * - An affected stage finishes later by its days: its last open work is lengthened. Every later stage moves by what
 *   the stage before it moved; its open work keeps its length. Work linked to moved work (finish-to-start or
 *   start-to-start, with lags) is pushed by the plan's own ripple.
 * - Nothing is pulled earlier, finished or cancelled work never moves, and a finished or skipped stage can't take days.
 * - The handover moves by as many working days as the plan's finish moved (the firm keeps its buffer). Days on a stage
 *   with no dated work still count towards the handover: they move every later stage and the finish.
 */
export type ScheduleStage = { id: string; position: number; name: string; status: string };
export type ScheduleItem = {
  id: string; number: number; title: string; status: string; stageId: string | null; assigneeId: string | null;
  startDate: string | null; dueDate: string | null;
};
export type StageImpactInput = { stageId: string; days: number };

export type StageMove = {
  id: string; name: string; position: number; status: string;
  /** The days this change adds to the stage itself (0 when it only moves because an earlier stage does). */
  days: number;
  fromStart: string | null; fromEnd: string | null; toStart: string | null; toEnd: string | null;
  /** Working days the stage's finish moves. */
  delay: number;
};
export type ItemMove = {
  id: string; number: number; title: string; stageId: string | null; assigneeId: string | null;
  fromStart: string | null; fromDue: string | null; startDate: string | null; dueDate: string | null;
};
export type SchedulePreview = {
  /** True when the project has dated work: the stages' dates come from it. */
  planned: boolean;
  stages: StageMove[];
  items: ItemMove[];
  /** Working days the plan's finish moves (or, without dated work, the days asked for). */
  finishDelay: number;
  handoverBefore: string | null;
  handoverAfter: string | null;
  /** The days asked for, all stages together. */
  totalDays: number;
};

export class ScheduleRuleError extends Error {}

const MAX_DAYS = 365;

/** The days asked for, checked: whole working days above zero, on stages of this project that aren't finished. */
export function cleanStageImpacts(input: unknown, stages: ScheduleStage[]): StageImpactInput[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 50) throw new ScheduleRuleError("Say the days per stage.");
  const byStage = new Map<string, number>();
  for (const raw of input) {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const stage = stages.find((item) => item.id === row.stageId);
    if (!stage) throw new ScheduleRuleError("Choose a stage of this project.");
    const days = Number(row.days);
    if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new ScheduleRuleError(`${stage.name}: days are a whole number from 0 to ${MAX_DAYS}.`);
    if (!days) continue;
    if (stage.status === "done" || stage.status === "skipped") throw new ScheduleRuleError(`${stage.name} is finished; it can't take more days.`);
    if (byStage.has(stage.id)) throw new ScheduleRuleError(`${stage.name} is listed twice.`);
    byStage.set(stage.id, days);
  }
  return [...byStage].map(([stageId, days]) => ({ stageId, days }));
}

const isOpen = (status: string) => status !== "done" && status !== "cancelled";

/** The preview: what the change does to the plan and the handover, without changing anything. */
export function scheduleImpact(input: {
  stages: ScheduleStage[]; items: ScheduleItem[]; links: PlanLink[]; calendar: WorkCalendar; promiseDate: string | null; impacts: StageImpactInput[];
}): SchedulePreview {
  const math = workdays(input.calendar);
  const own = new Map(input.impacts.map((impact) => [impact.stageId, impact.days]));
  const totalDays = input.impacts.reduce((sum, impact) => sum + impact.days, 0);
  const nodes = new Map(input.items.map((item) => [item.id, { ...item }]));
  const original = new Map(input.items.map((item) => [item.id, { startDate: item.startDate, dueDate: item.dueDate }]));
  const startOf = (item: { startDate: string | null; dueDate: string | null }) => item.startDate ?? item.dueDate;
  const endOf = (item: { startDate: string | null; dueDate: string | null }) => item.dueDate ?? item.startDate;
  /** Working days from one date to a later one (0 when it isn't later). */
  const between = (from: string, to: string) => (to > from ? math.span(from, to) - 1 : 0);
  const window = (stageId: string, source: "now" | "before") => {
    let start: string | null = null, end: string | null = null;
    for (const item of input.items) {
      if (item.stageId !== stageId || item.status === "cancelled") continue;
      const dates = source === "before" ? original.get(item.id)! : nodes.get(item.id)!;
      const s = startOf(dates), e = endOf(dates);
      if (s && (!start || s < start)) start = s;
      if (e && (!end || e > end)) end = e;
    }
    return { start, end };
  };
  const shiftItem = (id: string, days: number) => {
    const node = nodes.get(id)!;
    if (!days || !isOpen(node.status) || (!node.startDate && !node.dueDate)) return;
    node.startDate = node.startDate ? math.shift(node.startDate, days) : null;
    node.dueDate = node.dueDate ? math.shift(node.dueDate, days) : null;
  };

  const ordered = [...input.stages].sort((a, b) => a.position - b.position);
  let carry = 0;
  const stageDelay = new Map<string, number>();
  for (const stage of ordered) {
    const days = own.get(stage.id) ?? 0;
    const items = input.items.filter((item) => item.stageId === stage.id && isOpen(item.status) && (item.startDate || item.dueDate));
    if (!items.length) {
      // No dated work on this stage: its days still push everything after it.
      carry += days;
      stageDelay.set(stage.id, days ? carry : 0);
      continue;
    }
    const before = window(stage.id, "before");
    for (const item of items) shiftItem(item.id, carry);
    if (days) {
      // The stage takes longer: its last open work is lengthened by the days.
      const end = items.map((item) => endOf(nodes.get(item.id)!)!).sort().at(-1)!;
      for (const item of items) {
        const node = nodes.get(item.id)!;
        if (endOf(node) !== end) continue;
        if (node.dueDate) node.dueDate = math.shift(node.dueDate, days);
        else node.startDate = math.shift(node.startDate!, days);
      }
    }
    const after = window(stage.id, "now");
    const delay = before.end && after.end ? between(before.end, after.end) : carry + days;
    stageDelay.set(stage.id, delay);
    carry = Math.max(carry, delay);
  }

  // Work linked to what moved follows it (the plan's own ripple: lags, finish-to-start and start-to-start).
  const moved = () => [...nodes.values()].filter((node) => {
    const was = original.get(node.id)!;
    return was.startDate !== node.startDate || was.dueDate !== node.dueDate;
  });
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const root of moved()) {
      const pushed = ripple([...nodes.values()], input.links, { id: root.id, startDate: root.startDate, dueDate: root.dueDate }, input.calendar);
      for (const move of pushed) {
        const node = nodes.get(move.id)!;
        if (node.startDate === move.startDate && node.dueDate === move.dueDate) continue;
        node.startDate = move.startDate;
        node.dueDate = move.dueDate;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const items: ItemMove[] = moved().map((node) => {
    const was = original.get(node.id)!;
    return { id: node.id, number: node.number, title: node.title, stageId: node.stageId, assigneeId: node.assigneeId,
      fromStart: was.startDate, fromDue: was.dueDate, startDate: node.startDate, dueDate: node.dueDate };
  }).sort((a, b) => a.number - b.number);

  const stages: StageMove[] = [];
  for (const stage of ordered) {
    const before = window(stage.id, "before");
    const after = window(stage.id, "now");
    const days = own.get(stage.id) ?? 0;
    const delay = before.end && after.end ? between(before.end, after.end) : (stageDelay.get(stage.id) ?? 0);
    const startMoved = Boolean(before.start && after.start && before.start !== after.start);
    if (!days && !delay && !startMoved) continue;
    stages.push({ id: stage.id, name: stage.name, position: stage.position, status: stage.status, days,
      fromStart: before.start, fromEnd: before.end, toStart: after.start, toEnd: after.end, delay });
  }

  const finishOf = (source: "now" | "before") => [...nodes.values()].filter((node) => isOpen(node.status))
    .map((node) => endOf(source === "before" ? original.get(node.id)! : node)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const finishBefore = finishOf("before"), finishAfter = finishOf("now");
  const planned = Boolean(finishBefore);
  const finishDelay = Math.max(carry, finishBefore && finishAfter ? between(finishBefore, finishAfter) : 0);
  const handoverAfter = input.promiseDate && finishDelay > 0 ? math.shift(input.promiseDate, finishDelay) : input.promiseDate;
  return { planned, stages, items, finishDelay, handoverBefore: input.promiseDate, handoverAfter, totalDays };
}
