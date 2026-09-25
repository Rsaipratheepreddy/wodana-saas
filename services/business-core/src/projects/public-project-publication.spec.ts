import { describe, expect, it } from "vitest";
import { emptyProject, publicProject } from "./execution.domain";
import type { DailyReport, Task } from "./execution.types";

function fixture() {
  const data = emptyProject();
  data.tasks = [{ id: "task", title: "Wardrobe", area: "Bedroom", location: "site", parentId: "", quantity: 10, unit: "nos", weight: 1, status: "completed", approved: 10, inspectionRequired: true } as Task];
  data.milestones = [{ id: "milestone", title: "Install", dueDate: "2026-10-01", taskIds: ["task"], visibleToClient: true, ownerId: "internal" }];
  data.reports = [{ id: "published", status: "approved", date: "2026-09-20", publishedAt: "2026-09-20T12:00:00Z", entries: [{ taskId: "task", quantity: 3 }] } as DailyReport];
  return data;
}

describe("client published progress", () => {
  it("retains published report and quantities while its approved correction is private", () => {
    const data = fixture();
    data.reports.push({ ...data.reports[0], id: "correction", supersedes: "published", publishedAt: undefined, entries: [{ taskId: "task", quantity: 5 }] });
    const shared = publicProject("project", "Villa", data);
    expect(shared.reports.map(report => report.id)).toEqual(["published"]);
    expect(shared.progress).toBe(30);
    expect(shared.tasks?.[0].reportedQuantity).toBe(3);
    data.reports[1].publishedAt = "2026-09-21T12:00:00Z";
    const revised = publicProject("project", "Villa", data);
    expect(revised.reports.map(report => report.id)).toEqual(["correction"]);
    expect(revised.progress).toBe(50);
  });

  it("does not expose private completion, report quantities or work status", () => {
    const data = fixture();
    data.reports.push({ ...data.reports[0], id: "private", publishedAt: undefined, entries: [{ taskId: "task", quantity: 7 }] });
    const shared = publicProject("project", "Villa", data);
    expect(shared.progress).toBe(30);
    expect(shared.milestones[0].progress).toBe(30);
    expect(shared.tasks?.[0]).toMatchObject({ reportedQuantity: 3, status: "in_progress" });
    expect(shared.reports[0].work[0].status).toBe("in_progress");
    expect(data.tasks[0].status).toBe("completed");
    data.reports[0].publishedAt = undefined;
    expect(publicProject("project", "Villa", data)).toMatchObject({ progress: 0, tasks: [], reports: [] });
  });

  it("requires matching independent QC evidence before calling fully published work complete", () => {
    const data = fixture();
    data.reports[0].entries[0].quantity = 10;
    expect(publicProject("project", "Villa", data).tasks?.[0].status).toBe("awaiting_inspection");
    data.tasks[0].inspections = [{ id: "qc", by: "reviewer", at: "2026-09-21", passed: true, quantity: 10, unit: "nos", evidence: "Checked" }];
    expect(publicProject("project", "Villa", data).tasks?.[0].status).toBe("completed");
    data.tasks[0].inspections[0].passed = false;
    expect(publicProject("project", "Villa", data).tasks?.[0].status).toBe("awaiting_inspection");
  });

  it("keeps lot-based completion awaiting QC until every reported unit is passed", () => {
    const data = fixture();
    data.reports[0].entries[0].quantity = 10;
    data.tasks[0].location = "factory";
    data.tasks[0].inspectionRequired = false;
    data.tasks[0].factoryLots = [{ id: "lot", title: "Measured batch", quantity: 10, unit: "nos", createdBy: "worker", at: "2026-09-20", status: "pending_qc", reviews: [] }];
    expect(publicProject("project", "Villa", data).tasks?.[0].status).toBe("awaiting_inspection");
    data.tasks[0].factoryLots[0].status = "passed";
    expect(publicProject("project", "Villa", data).tasks?.[0].status).toBe("completed");
  });
});
