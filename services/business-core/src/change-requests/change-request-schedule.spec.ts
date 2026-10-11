import { describe, expect, it } from "vitest";
import { cleanStageImpacts, scheduleImpact, ScheduleRuleError, type ScheduleItem, type ScheduleStage } from "./change-request-schedule";

// Monday to Friday; Thursday 1 Oct 2026 is a working day.
const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] as string[] };
const stages: ScheduleStage[] = [
  { id: "design", position: 0, name: "Design", status: "done" },
  { id: "joinery", position: 1, name: "Joinery", status: "current" },
  { id: "install", position: 2, name: "Installation", status: "upcoming" },
  { id: "handover", position: 3, name: "Handover", status: "upcoming" },
];
const item = (id: string, number: number, stageId: string | null, startDate: string | null, dueDate: string | null, status = "todo", assigneeId: string | null = `m-${id}`): ScheduleItem =>
  ({ id, number, title: id, status, stageId, assigneeId, startDate, dueDate });

describe("a change's schedule impact (§6.10, §6.20)", () => {
  const items = [
    item("drawings", 1, "design", "2026-09-21", "2026-09-25", "done"),
    item("carcass", 2, "joinery", "2026-10-05", "2026-10-09"),
    item("doors", 3, "joinery", "2026-10-12", "2026-10-16"),
    item("fit", 4, "install", "2026-10-19", "2026-10-23"),
    item("snag", 5, "handover", "2026-10-26", "2026-10-27"),
    item("note", 6, null, "2026-10-01", "2026-10-02"),
  ];

  it("lengthens the affected stage, moves every later stage by as much, and the handover by the plan's finish", () => {
    const preview = scheduleImpact({ stages, items, links: [], calendar, promiseDate: "2026-10-30", impacts: [{ stageId: "joinery", days: 3 }] });
    // Joinery's last work (doors) ends three working days later: Fri 16 → Wed 21 Oct.
    expect(preview.items.map((move) => [move.id, move.startDate, move.dueDate])).toEqual([
      ["doors", "2026-10-12", "2026-10-21"], ["fit", "2026-10-22", "2026-10-28"], ["snag", "2026-10-29", "2026-10-30"],
    ]);
    expect(preview.stages.map((stage) => [stage.id, stage.days, stage.delay, stage.toEnd])).toEqual([
      ["joinery", 3, 3, "2026-10-21"], ["install", 0, 3, "2026-10-28"], ["handover", 0, 3, "2026-10-30"],
    ]);
    // Handover Fri 30 Oct → Wed 4 Nov: the buffer after the plan stays.
    expect(preview).toMatchObject({ planned: true, finishDelay: 3, handoverBefore: "2026-10-30", handoverAfter: "2026-11-04", totalDays: 3 });
    // Finished work and work outside the stages don't move.
    expect(preview.items.find((move) => move.id === "drawings" || move.id === "note")).toBeUndefined();
  });

  it("adds the days of two stages and follows the plan's links (finish-to-start with a lag)", () => {
    const linked = [...items, item("delivery", 7, null, "2026-10-22", "2026-10-22")];
    const preview = scheduleImpact({ stages, items: linked, calendar, promiseDate: "2026-10-30",
      links: [{ predecessorId: "doors", successorId: "delivery", kind: "fs", lagDays: 1 }],
      impacts: [{ stageId: "joinery", days: 2 }, { stageId: "install", days: 1 }] });
    // Doors end Tue 20 Oct; delivery waits a day after it: Thu 22 Oct (unchanged, it was already there).
    expect(preview.items.find((move) => move.id === "delivery")).toBeUndefined();
    // Installation starts two days later and takes one more: 21 Oct → 28 Oct.
    expect(preview.stages.find((stage) => stage.id === "install")).toMatchObject({ fromEnd: "2026-10-23", toStart: "2026-10-21", toEnd: "2026-10-28", delay: 3, days: 1 });
    expect(preview.finishDelay).toBe(3);
    const longer = scheduleImpact({ stages, items: linked, calendar, promiseDate: "2026-10-30",
      links: [{ predecessorId: "doors", successorId: "delivery", kind: "fs", lagDays: 1 }], impacts: [{ stageId: "joinery", days: 5 }] });
    // Doors end Fri 23 Oct; delivery moves to Tue 27 Oct (the next working day plus one).
    expect(longer.items.find((move) => move.id === "delivery")).toMatchObject({ fromStart: "2026-10-22", startDate: "2026-10-27", dueDate: "2026-10-27" });
  });

  it("without dated work the days still move the handover, on the work calendar (no invented dates)", () => {
    const preview = scheduleImpact({ stages, items: [], links: [], calendar: { workingDays: [0, 1, 2, 3, 4], holidays: ["2026-11-01"] }, promiseDate: "2026-10-29",
      impacts: [{ stageId: "install", days: 2 }] });
    // A Sunday-to-Thursday week with Sunday 1 Nov off: Thu 29 Oct → Mon 2 Nov → Tue 3 Nov.
    expect(preview).toMatchObject({ planned: false, items: [], finishDelay: 2, handoverAfter: "2026-11-03" });
    expect(preview.stages).toEqual([expect.objectContaining({ id: "install", days: 2, fromEnd: null, toEnd: null })]);
    // No impact: nothing moves.
    expect(scheduleImpact({ stages, items, links: [], calendar, promiseDate: "2026-10-30", impacts: [] })).toMatchObject({ items: [], stages: [], finishDelay: 0, handoverAfter: "2026-10-30" });
  });

  it("checks the days: whole, on a stage of this project that isn't finished", () => {
    expect(cleanStageImpacts([{ stageId: "joinery", days: 2 }, { stageId: "install", days: 0 }], stages)).toEqual([{ stageId: "joinery", days: 2 }]);
    expect(() => cleanStageImpacts([{ stageId: "design", days: 1 }], stages)).toThrow(/finished/);
    expect(() => cleanStageImpacts([{ stageId: "nope", days: 1 }], stages)).toThrow(ScheduleRuleError);
    expect(() => cleanStageImpacts([{ stageId: "joinery", days: 1.5 }], stages)).toThrow(/whole number/);
    expect(() => cleanStageImpacts([{ stageId: "joinery", days: 1 }, { stageId: "joinery", days: 2 }], stages)).toThrow(/twice/);
    expect(cleanStageImpacts(undefined, stages)).toEqual([]);
  });
});
