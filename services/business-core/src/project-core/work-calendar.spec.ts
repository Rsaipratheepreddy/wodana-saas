import { describe, expect, it } from "vitest";
import { criticalPath, ripple, workdays, workingDeadline, type PlanLink, type PlanNode } from "./work-calendar";

const weekdays = { workingDays: [1, 2, 3, 4, 5], holidays: [] };
const gulf = { workingDays: [0, 1, 2, 3, 4], holidays: ["2026-10-06"] };
const node = (id: string, number: number, startDate: string | null, dueDate: string | null, status = "todo"): PlanNode => ({ id, number, title: id, status, startDate, dueDate });

describe("working days", () => {
  it("counts, skips and shifts by the workspace's week and holidays", () => {
    const math = workdays(weekdays);
    expect(math.onOrAfter("2026-10-03")).toBe("2026-10-05"); // Saturday → Monday
    expect(math.shift("2026-10-02", 1)).toBe("2026-10-05"); // Friday + 1
    expect(math.shift("2026-10-05", -1)).toBe("2026-10-02");
    expect(math.span("2026-10-01", "2026-10-07")).toBe(5);
    expect(math.next("2026-10-02")).toBe("2026-10-05");
    const gulfMath = workdays(gulf);
    expect(gulfMath.onOrAfter("2026-10-02")).toBe("2026-10-04"); // Friday → Sunday
    expect(gulfMath.shift("2026-10-05", 1)).toBe("2026-10-07"); // the holiday is skipped
  });
});

describe("working-day deadlines", () => {
  const dubai = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-20"], end: "18:00", timeZone: "Asia/Dubai" };
  it("counts the firm's working days from the day after the action and ends at the close of that working day", () => {
    // Friday 16 Oct 2026, 20:13 in Dubai: 2 working days is Tuesday 20 Oct, a day off, so Wednesday 21 Oct at 18:00.
    expect(workingDeadline(new Date("2026-10-16T16:13:00Z"), 2, dubai).toISOString()).toBe("2026-10-21T14:00:00.000Z");
    // Sunday (a day off): Monday is the first working day after it.
    expect(workingDeadline(new Date("2026-10-18T08:00:00Z"), 1, dubai).toISOString()).toBe("2026-10-19T14:00:00.000Z");
    // Monday morning: 3 working days is Friday (Tuesday, a holiday, is skipped).
    expect(workingDeadline(new Date("2026-10-19T05:00:00Z"), 3, dubai).toISOString()).toBe("2026-10-23T14:00:00.000Z");
    // A Sunday-to-Thursday week: never a Friday or Saturday.
    const riyadh = { workingDays: [0, 1, 2, 3, 4], holidays: [], end: "17:00", timeZone: "Asia/Riyadh" };
    expect(workingDeadline(new Date("2026-10-15T10:00:00Z"), 1, riyadh).toISOString()).toBe("2026-10-18T14:00:00.000Z");
  });

  it("gives the end of today for nought days, or of the next working day once today is over", () => {
    expect(workingDeadline(new Date("2026-10-19T05:00:00Z"), 0, dubai).toISOString()).toBe("2026-10-19T14:00:00.000Z");
    expect(workingDeadline(new Date("2026-10-19T16:00:00Z"), 0, dubai).toISOString()).toBe("2026-10-21T14:00:00.000Z");
  });
});

describe("ripple", () => {
  const links: PlanLink[] = [
    { predecessorId: "a", successorId: "b", kind: "fs", lagDays: 0 },
    { predecessorId: "b", successorId: "c", kind: "fs", lagDays: 2 },
    { predecessorId: "a", successorId: "d", kind: "ss", lagDays: 1 },
    { predecessorId: "c", successorId: "e", kind: "fs", lagDays: 0 },
    { predecessorId: "d", successorId: "e", kind: "fs", lagDays: 0 },
  ];
  const nodes = [
    node("a", 1, "2026-10-01", "2026-10-02"), // Thu–Fri
    node("b", 2, "2026-10-05", "2026-10-07"), // Mon–Wed (3 days)
    node("c", 3, "2026-10-12", "2026-10-12"),
    node("d", 4, "2026-10-02", "2026-10-02"),
    node("e", 5, null, "2026-10-13"),
  ];

  it("pushes waiting items later, keeping their length in working days, through the whole chain", () => {
    const moves = ripple(nodes, links, { id: "a", startDate: "2026-10-05", dueDate: "2026-10-09" }, weekdays);
    expect(moves.map(({ id, startDate, dueDate, because }) => [id, startDate, dueDate, because])).toEqual([
      ["b", "2026-10-12", "2026-10-14", 1],
      ["d", "2026-10-06", "2026-10-06", 1],
      ["c", "2026-10-19", "2026-10-19", 2], // next day after the 14th + 2 working days
      ["e", null, "2026-10-20", 3], // only a due date, and it stays that way
    ]);
  });

  it("never pulls earlier and never moves finished work", () => {
    expect(ripple(nodes, links, { id: "a", startDate: "2026-09-28", dueDate: "2026-09-29" }, weekdays)).toEqual([]);
    const done = nodes.map((item) => (item.id === "b" ? { ...item, status: "done" } : item));
    expect(ripple(done, links, { id: "a", startDate: "2026-10-05", dueDate: "2026-10-09" }, weekdays).map((move) => move.id)).toEqual(["d"]);
  });

  it("works on the Gulf week", () => {
    const moves = ripple([node("a", 1, "2026-10-01", "2026-10-01"), node("b", 2, "2026-10-01", "2026-10-04")],
      [{ predecessorId: "a", successorId: "b", kind: "fs", lagDays: 0 }], { id: "a", startDate: "2026-10-01", dueDate: "2026-10-01" }, gulf);
    // Thursday's next working day is Sunday; b keeps 2 working days (Thu + Sun) → Sun–Mon.
    expect(moves.map(({ startDate, dueDate }) => [startDate, dueDate])).toEqual([["2026-10-04", "2026-10-05"]]);
  });
});

describe("critical path", () => {
  const links: PlanLink[] = [
    { predecessorId: "a", successorId: "b", kind: "fs", lagDays: 0 },
    { predecessorId: "b", successorId: "c", kind: "fs", lagDays: 2 },
    { predecessorId: "a", successorId: "d", kind: "ss", lagDays: 1 },
    { predecessorId: "c", successorId: "e", kind: "fs", lagDays: 0 },
    { predecessorId: "d", successorId: "e", kind: "fs", lagDays: 0 },
  ];
  const nodes = [
    node("a", 1, "2026-10-01", "2026-10-02"),
    node("b", 2, "2026-10-05", "2026-10-07"),
    node("c", 3, "2026-10-12", "2026-10-12"),
    node("d", 4, "2026-10-02", "2026-10-02"),
    node("e", 5, null, "2026-10-13"),
  ];

  it("finds the chain with no slack and how far everything else can slip, in working days", () => {
    const { finish, float } = criticalPath(nodes, links, weekdays);
    expect(finish).toBe("2026-10-13");
    expect(Object.fromEntries(float)).toEqual({ a: 0, b: 0, c: 0, d: 6, e: 0 });
  });

  it("shows negative slack when the plan can't hold, and leaves out finished and undated work", () => {
    const squeezed = nodes.map((item) => (item.id === "c" ? { ...item, startDate: "2026-10-08", dueDate: "2026-10-13" } : item));
    const { finish, float } = criticalPath([...squeezed, node("f", 6, null, null), { ...node("g", 7, "2026-10-01", "2026-10-30"), status: "done" }], links, weekdays);
    expect(finish).toBe("2026-10-13");
    // c must finish a working day before e (the 13th) but is due on the 13th; b must then finish by the 2nd, not the 7th.
    expect([float.get("c"), float.get("b"), float.has("f"), float.has("g")]).toEqual([-1, -3, false, false]);
  });

  it("counts the workspace's week and holidays", () => {
    const { float } = criticalPath([node("a", 1, "2026-10-01", "2026-10-01"), node("b", 2, "2026-10-08", "2026-10-08")], [], gulf);
    // Thursday the 1st to Thursday the 8th: the 4th, 5th, 7th and 8th are worked, the 6th is a holiday.
    expect(float.get("a")).toBe(4);
  });
});
