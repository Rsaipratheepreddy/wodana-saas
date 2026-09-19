import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { projectConnectedPlan } from "./project-connected-plan";
import type {
  ProjectBooking,
  ProjectResource,
  ProjectWorkPackage,
  Task,
} from "./execution.types";

const workPackage = (
  id: string,
  title: string,
  overrides: Partial<ProjectWorkPackage> = {},
): ProjectWorkPackage => ({
  id,
  scopeLineIds: [`scope-${id}`],
  title,
  area: "Villa",
  deliveryRoute: "mixed",
  status: "planning",
  ownerId: "manager",
  plannedStart: "2026-09-20",
  plannedEnd: "2026-09-25",
  predecessorPackageIds: [],
  priority: "normal",
  risk: "on_track",
  nextAction: "Confirm the plan",
  nextActionOwnerId: "manager",
  nextActionDate: "2026-09-19",
  recoveryPlan: "",
  blocker: "",
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  ...overrides,
});

const task = (
  id: string,
  packageId: string,
  overrides: Partial<Task> = {},
): Task => ({
  id,
  parentId: "",
  packageId,
  package: packageId,
  title: id,
  description: "",
  area: "Villa",
  location: "site",
  ownerId: "manager",
  assigneeIds: [],
  resourceId: "crew-1",
  start: "2026-09-20",
  end: "2026-09-25",
  baselineStart: "2026-09-20",
  baselineEnd: "2026-09-25",
  predecessors: [],
  quantity: 1,
  unit: "lot",
  weight: 1,
  approved: 0,
  status: "planned",
  priority: "normal",
  inspectionRequired: true,
  scopeIds: [`scope-${packageId}`],
  drawingId: "",
  readiness: { scope: true, access: true, materials: true },
  blocker: "",
  ...overrides,
});

describe("connected project plan", () => {
  it("joins dependencies, supplier commitments and confirmed aggregate capacity without HRMS private data", () => {
    const data = emptyProject();
    data.controls!.promise = "Handover by the agreed date.";
    data.controls!.targetCompletion = "2026-09-30";
    data.controls!.handoverDate = "2026-10-02";
    data.workPackages = [
      workPackage("design", "Design", { status: "completed" }),
      workPackage("install", "Installation"),
    ];
    data.tasks = [
      task("design-task", "design", { status: "completed" }),
      task("install-task", "install", { predecessors: ["design-task"] }),
    ];
    data.orders = [{
      id: "order-1",
      number: "PO-001",
      title: "Installation supply",
      vendor: "Joinery partner",
      vendorContact: "private@example.test",
      kind: "subcontract",
      materialId: "",
      taskId: "install-task",
      quantity: 1,
      unit: "lot",
      unitCost: 100,
      currency: "AED",
      promisedDate: "2026-09-19",
      leadTimeDays: 14,
      status: "acknowledged",
      acknowledgement: "Confirmed",
      receipts: [],
    }];
    const resources: ProjectResource[] = [{
      id: "crew-1",
      name: "Installation crew",
      kind: "crew",
      members: ["employee-private-id"],
      active: true,
    }];
    const bookings: ProjectBooking[] = [{
      id: "booking-1",
      projectId: "project-1",
      projectName: "Villa",
      taskId: "install-task",
      taskTitle: "Install",
      resourceId: "crew-1",
      start: "2026-09-20",
      end: "2026-09-25",
      status: "confirmed",
      acknowledgement: "Approved capacity",
    }];

    const result = projectConnectedPlan(
      data,
      resources,
      bookings,
      "2026-09-18",
    );

    expect(result.promise).toEqual({
      statement: "Handover by the agreed date.",
      targetCompletion: "2026-09-30",
      handoverDate: "2026-10-02",
    });
    expect(result.packages[1]).toMatchObject({
      predecessorPackageIds: ["design"],
      supplierCommitments: [{
        vendor: "Joinery partner",
        promisedDate: "2026-09-19",
        leadTimeDays: 14,
      }],
      capacityCommitments: [{
        resourceName: "Installation crew",
        resourceKind: "crew",
        bookingStatus: "confirmed",
      }],
      issues: [],
    });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("employee-private-id");
    expect(wire).not.toContain("private@example.test");
    expect(wire).not.toMatch(/leave|calendar/i);
  });

  it("makes promise, supplier, capacity and recovery gaps explainable", () => {
    const data = emptyProject();
    data.controls!.targetCompletion = "2026-09-25";
    data.workPackages = [workPackage("install", "Installation", {
      plannedEnd: "2026-09-30",
      risk: "blocked",
      recoveryPlan: "",
      nextActionDate: "2026-09-17",
    })];
    data.tasks = [task("install-task", "install")];
    data.orders = [{
      id: "order-1", number: "PO-001", title: "Joinery", vendor: "Partner",
      vendorContact: "", kind: "factory", materialId: "", taskId: "install-task",
      quantity: 1, unit: "lot", unitCost: 100, currency: "AED",
      promisedDate: "2026-09-23", status: "approved", acknowledgement: "", receipts: [],
    }];

    const [planned] = projectConnectedPlan(data, [], [], "2026-09-18").packages;

    expect(planned.issues.map((issue) => issue.code)).toEqual([
      "supplier",
      "capacity",
      "promise",
      "recovery",
      "next_action",
    ]);
  });
});
