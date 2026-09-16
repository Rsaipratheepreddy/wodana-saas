import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { projectExecutionPulse } from "./project-execution-pulse";
import { syncScopeWorkPackages } from "./project-work-packages";

describe("project execution pulse", () => {
  it("keeps a project manager focused on blocked work before less urgent planning", () => {
    const data = emptyProject();
    data.scope = {
      quoteId: "quote-1",
      quoteNumber: 1,
      currency: "AED",
      value: 100,
      lines: [
        { id: "line-1", title: "Joinery", room: "Living", material: "Oak", quantity: 1, unit: "nos" },
        { id: "line-2", title: "Console", room: "Living", material: "Oak", quantity: 1, unit: "nos" },
      ],
    };
    syncScopeWorkPackages(data, "2026-09-16T10:00:00.000Z");
    data.workPackages![0].status = "blocked";
    data.workPackages![0].blocker = "Client approval is pending.";

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse).toMatchObject({
      health: "blocked",
      counts: { packages: 2, blockedPackages: 1 },
    });
    expect(pulse.nextActions[0]).toMatchObject({
      kind: "resolve_package",
      workPackageId: data.workPackages![0].id,
      detail: "Client approval is pending.",
    });
  });

  it("offers a start action only when the package, readiness and booking are all sound", () => {
    const data = emptyProject();
    data.workPackages = [{
      id: "package-1",
      scopeLineIds: ["line-1"],
      title: "Joinery",
      area: "Living",
      deliveryRoute: "site",
      status: "ready",
      ownerId: "manager",
      plannedStart: "",
      plannedEnd: "",
      blocker: "",
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    }];
    data.tasks = [{
      id: "task-1",
      parentId: "",
      packageId: "package-1",
      package: "Joinery",
      title: "Install joinery",
      description: "",
      area: "Living",
      location: "site",
      ownerId: "foreman",
      assigneeIds: [],
      resourceId: "crew-1",
      start: "2026-09-17",
      end: "2026-09-18",
      baselineStart: "2026-09-17",
      baselineEnd: "2026-09-18",
      predecessors: [],
      quantity: 1,
      unit: "nos",
      weight: 1,
      approved: 0,
      status: "planned",
      priority: "normal",
      inspectionRequired: true,
      scopeIds: ["line-1"],
      drawingId: "drawing-1",
      readiness: { scope: true, access: true, materials: true },
      blocker: "",
    }];

    const withoutBooking = projectExecutionPulse(data, "2026-09-16", [{
      id: "crew-1", name: "Joinery team", kind: "crew", members: [], active: true,
    }]);
    expect(withoutBooking.nextActions.some((item) => item.kind === "start_task")).toBe(false);

    const withBooking = projectExecutionPulse(data, "2026-09-16", [{
      id: "crew-1", name: "Joinery team", kind: "crew", members: [], active: true,
    }], [{
      id: "booking-1", projectId: "project-1", projectName: "Villa", taskId: "task-1",
      taskTitle: "Install joinery", resourceId: "crew-1", start: "2026-09-17", end: "2026-09-18",
      status: "confirmed", acknowledgement: "Confirmed",
    }]);
    expect(withBooking.nextActions).toContainEqual(expect.objectContaining({
      kind: "start_task", taskId: "task-1",
    }));
  });
});
