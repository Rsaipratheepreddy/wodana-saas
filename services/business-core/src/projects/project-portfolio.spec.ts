import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { projectPortfolioSummary } from "./project-portfolio";
import type { Task } from "./execution.types";

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, parentId: "", package: "Design", title: id, description: "", area: "Living room",
  location: "office", ownerId: "owner", assigneeIds: [], resourceId: "", start: "2026-09-01",
  end: "2026-09-10", baselineStart: "2026-08-30", baselineEnd: "2026-09-08",
  predecessors: [], quantity: 10, unit: "nos", weight: 1, approved: 0, status: "planned",
  priority: "normal", inspectionRequired: false, scopeIds: [], drawingId: "",
  readiness: { scope: true, access: true, materials: true }, blocker: "", ...overrides,
});

describe("project portfolio summaries", () => {
  it("reports approved progress, leaf task health and schedule movement", () => {
    const data = emptyProject();
    data.tasks = [
      task("parent"),
      task("done", { parentId: "parent", status: "completed", end: "2026-09-05" }),
      task("late", { parentId: "parent", status: "blocked", start: "2026-09-06", end: "2026-09-11", baselineEnd: "2026-09-09" }),
    ];
    data.reports = [{ id: "report", date: "2026-09-10", shift: "Day", location: "site", authorId: "owner", author: "Owner", status: "approved", entries: [{ taskId: "done", quantity: 10 }], hours: 1, people: 1, materials: "", issues: "", tomorrow: "", evidence: "", note: "" }];

    const result = projectPortfolioSummary(data, "2026-09-13");

    expect(result.progress).toBe(50);
    expect(result.taskSummary).toMatchObject({ total: 2, completed: 1, blocked: 1, overdue: 1 });
    expect(result.schedule).toEqual({ baselineStart: "2026-08-30", baselineEnd: "2026-09-09", currentStart: "2026-09-01", currentEnd: "2026-09-11" });
    expect(result.workflow).toMatchObject({
      templateCode: "standard_delivery",
      currentStageKey: "planning",
      currentStageName: "Planning",
      nextStage: { key: "delivery", name: "Delivery" },
    });
  });

  it("returns the next incomplete milestone with its own progress", () => {
    const data = emptyProject();
    data.tasks = [task("design")];
    data.milestones = [
      { id: "accepted", title: "Brief", dueDate: "2026-09-01", baselineDate: "2026-09-01", ownerId: "owner", taskIds: [], visibleToClient: true, acceptedAt: "2026-09-01T10:00:00Z", evidence: "" },
      { id: "next", title: "Design complete", dueDate: "2026-09-20", baselineDate: "2026-09-18", ownerId: "owner", taskIds: ["design"], visibleToClient: true, evidence: "" },
    ];

    expect(projectPortfolioSummary(data, "2026-09-13").milestoneSummary).toEqual({
      total: 2,
      accepted: 1,
      next: { id: "next", title: "Design complete", dueDate: "2026-09-20", progress: 0 },
    });
  });

  it("does not let incomplete legacy JSON break the portfolio list", () => {
    const legacy = { ...emptyProject(), tasks: undefined, reports: undefined } as unknown as ReturnType<typeof emptyProject>;

    expect(projectPortfolioSummary(legacy, "2026-09-13")).toMatchObject({
      progress: 0,
      taskSummary: { total: 0, overdue: 0 },
    });
  });
});
