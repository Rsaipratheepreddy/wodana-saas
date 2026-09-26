import { describe, expect, it } from "vitest";
import { ripple, workdays, type PlanLink, type PlanNode } from "./work-calendar";

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
