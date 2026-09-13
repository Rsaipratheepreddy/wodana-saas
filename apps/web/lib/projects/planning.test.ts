import { describe, expect, it } from "vitest";
import { bookingIssues, decodePlan, newTask, overlaps, readinessIssues, seedTasks, suitableTeams, teamConflicts, validateTask, workDays, type PlanTask } from "./planning";

const fabrication = seedTasks.find(t => t.id === "joinery-task")!;
const copy = (updates: Partial<PlanTask> = {}): PlanTask => ({ ...fabrication, ...updates });

describe("full-day project resource planning", () => {
  it("finds the seeded cross-project clash and suggests a compatible free team", () => {
    expect(teamConflicts(fabrication, seedTasks).map(c => c.project)).toEqual(["Dubai Hills residence"]);
    expect(suitableTeams(fabrication, seedTasks).map(t => t.id)).toEqual(["factory-b"]);
    expect(validateTask(copy({ status: "booked" }), seedTasks)).toContain("Dubai Hills residence: Wardrobe fabrication, 7 Sept–9 Sept.");
    expect(validateTask(copy({ teamId: "factory-b", status: "booked" }), seedTasks)).toEqual([]);
  });
  it("reserves a team independently of readiness, but blocks starting before release", () => {
    const booked = copy({ teamId: "factory-b", status: "booked" });
    expect(validateTask(booked, seedTasks)).toEqual([]);
    expect(validateTask({ ...booked, status: "in-progress" }, seedTasks)).toContain("Materials not ready");
    expect(readinessIssues(seedTasks.find(t => t.id === "ceiling-task")!, seedTasks)).toContain("Waiting for Electrical first fix");
  });
  it("ignores draft proposals when reserving capacity and excludes the edited record itself", () => {
    expect(teamConflicts(copy({ id: "new" }), [fabrication])).toHaveLength(1);
    const booked = copy({ teamId: "factory-b", status: "booked" });
    expect(teamConflicts(booked, [booked])).toEqual([]);
    expect(teamConflicts({ ...booked, id: "new" }, [booked])).toHaveLength(1);
  });
  it("counts inclusive working dates and never books a Sunday-only task", () => {
    expect(workDays("2026-09-12", "2026-09-14")).toEqual(["2026-09-12", "2026-09-14"]);
    expect(overlaps({ start: "2026-09-12", end: "2026-09-13" }, { start: "2026-09-13", end: "2026-09-14" })).toBe(false);
    expect(overlaps({ start: "2026-09-12", end: "2026-09-14" }, { start: "2026-09-14", end: "2026-09-15" })).toBe(true);
    expect(validateTask(copy({ start: "2026-09-13", end: "2026-09-13" }), seedTasks)).toContain("Choose at least one working day. Sunday is off in this demo.");
  });
  it("blocks incompatible crews, unavailable days and dependency loops", () => {
    expect(validateTask(copy({ teamId: "electrical" }), seedTasks)).toContain("Choose a team with the right trade and work location.");
    const unavailable = copy({ teamId: "installation", kind: "site", start: "2026-09-12", end: "2026-09-12", dependencyId: "" });
    expect(teamConflicts(unavailable, seedTasks)[0].project).toBe("Scheduled time off");
    expect(validateTask(copy({ dependencyId: "wardrobe-task" }), seedTasks)).toContain("This dependency creates a loop. Choose a different predecessor.");
  });
  it("flags downstream bookings before extending a predecessor", () => {
    expect(bookingIssues(copy({ teamId: "factory-b", end: "2026-09-18" }), seedTasks)).toContain("Wardrobe installation is booked for 17 Sept. Adjust its booking before extending this task.");
    const survey = seedTasks[0];
    expect(validateTask({ ...survey, status: "draft" }, seedTasks)).toContain("Dependent work has already started. Keep this predecessor complete.");
  });
  it("rejects invalid or reversed dates and malformed saved data", () => {
    expect(validateTask(copy({ start: "2026-02-30" }), seedTasks)).toContain("Choose a valid start and finish date.");
    expect(validateTask(copy({ start: "2026-09-20" }), seedTasks)).toContain("Choose a valid start and finish date.");
    expect(decodePlan("not json")).toBeNull();
    expect(decodePlan(JSON.stringify([{ ...fabrication, progress: "wrong" }]))).toBeNull();
    expect(decodePlan(JSON.stringify([fabrication, fabrication]))).toBeNull();
    expect(decodePlan(JSON.stringify(seedTasks))).toEqual(seedTasks);
    expect(validateTask(newTask("new"), seedTasks)).toContain("Enter a task name.");
  });
});
