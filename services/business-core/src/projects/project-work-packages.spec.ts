import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import {
  assertUniqueWorkPackageScope,
  blockWorkPackagesForDeduction,
  syncScopeWorkPackages,
} from "./project-work-packages";
import type { ProjectData, ReleasedScopeLine } from "./execution.types";

const manager: ExecutionActor = {
  id: "manager",
  name: "Manager",
  manage: true,
  review: true,
  report: true,
  buy: true,
  memberIds: ["manager", "foreman"],
  resourceIds: [],
  now: "2026-09-16T10:00:00.000Z",
  released: true,
};

const scopeLine = (id: string, title: string, room = "Living room"): ReleasedScopeLine => ({
  id,
  title,
  room,
  material: "Oak veneer",
  quantity: 1,
  unit: "nos",
});

function releasedProject() {
  const data = emptyProject();
  data.phase = "active";
  data.scope = {
    quoteId: "quote-1",
    quoteNumber: 1,
    currency: "AED",
    value: 100,
    lines: [scopeLine("line-1", "Joinery"), scopeLine("line-2", "Console")],
  };
  syncScopeWorkPackages(data, manager.now);
  data.documents.push({
    id: "drawing-1",
    title: "Issued drawing",
    kind: "drawing",
    revision: "R01",
    url: "",
    note: "",
    status: "approved",
    replaces: "",
    published: false,
  });
  return data;
}

function command(data: ProjectData, action: string, body: Record<string, unknown>) {
  const copy = structuredClone(data);
  applyExecution(copy, action, body, manager);
  return copy;
}

function task(scopeIds: string[], location: "site" | "factory" | "office" = "site") {
  return {
    id: "task-1",
    parentId: "",
    package: "Ignored when scope resolves a package",
    title: "Install joinery",
    description: "",
    area: "Living room",
    location,
    ownerId: "foreman",
    assigneeIds: [],
    resourceId: "",
    start: "2026-09-18",
    end: "2026-09-19",
    predecessors: [],
    quantity: 1,
    unit: "nos",
    weight: 1,
    priority: "normal",
    inspectionRequired: false,
    scopeIds,
    drawingId: "drawing-1",
    readiness: { scope: true, access: true, materials: true },
  };
}

describe("released scope work packages", () => {
  it("creates one stable, executable planning package per released scope line", () => {
    const data = releasedProject();

    expect(data.workPackages).toEqual([
      expect.objectContaining({ scopeLineIds: ["line-1"], title: "Joinery", status: "planning" }),
      expect.objectContaining({ scopeLineIds: ["line-2"], title: "Console", status: "planning" }),
    ]);
    const firstIds = data.workPackages!.map((workPackage) => workPackage.id);
    syncScopeWorkPackages(data, "2026-09-16T11:00:00.000Z");
    expect(data.workPackages).toHaveLength(2);
    expect(data.workPackages!.map((workPackage) => workPackage.id)).toEqual(firstIds);
  });

  it("never recreates a cancelled package from the same historical scope line", () => {
    const data = releasedProject();
    data.workPackages![0].status = "cancelled";

    syncScopeWorkPackages(data, "2026-09-16T11:00:00.000Z");

    expect(data.workPackages).toHaveLength(2);
    expect(data.workPackages![0].status).toBe("cancelled");
  });

  it("derives the task link from its released scope and does not trust the free-text label", () => {
    let data = releasedProject();
    data = command(data, "task", { task: task(["line-1"]) });

    expect(data.tasks[0]).toMatchObject({
      packageId: data.workPackages![0].id,
      package: "Joinery",
      scopeIds: ["line-1"],
    });
    expect(() => command(data, "task_status", { id: "task-1", status: "in_progress" }))
      .toThrow(/work package ready/);
  });

  it("requires a named package owner and a valid route before released work starts", () => {
    let data = releasedProject();
    data = command(data, "task", { task: task(["line-1"], "site") });
    const workPackage = data.workPackages![0];

    expect(() => command(data, "work_package", {
      workPackage: { ...workPackage, status: "ready", ownerId: "" },
    })).toThrow(/accountable owner/);
    expect(() => command(data, "work_package", {
      workPackage: {
        ...workPackage,
        status: "ready",
        ownerId: "manager",
        deliveryRoute: "factory",
      },
    })).toThrow(/does not match this package/);
    data = command(data, "work_package", {
      workPackage: { ...workPackage, status: "ready", ownerId: "manager", deliveryRoute: "site" },
    });
    expect(data.workPackages![0].status).toBe("ready");
  });

  it("requires an actual vendor resource for vendor-route work", () => {
    let data = releasedProject();
    const resourceActor = {
      ...manager,
      resourceIds: ["factory-resource"],
      resourceKinds: { "factory-resource": "factory" as const },
    };
    data = structuredClone(data);
    applyExecution(data, "task", {
      task: { ...task(["line-1"], "factory"), resourceId: "factory-resource" },
    }, resourceActor);
    const workPackage = data.workPackages![0];
    data = command(data, "work_package", {
      workPackage: {
        ...workPackage,
        status: "ready",
        ownerId: "manager",
        deliveryRoute: "vendor",
      },
    });
    expect(() => applyExecution(data, "task_status", { id: "task-1", status: "in_progress" }, resourceActor))
      .toThrow(/vendor resource/);
  });

  it("prevents a task from extending a package beyond its approved released scope", () => {
    const data = releasedProject();
    expect(() => command(data, "task", {
      task: { ...task(["line-2"]), packageId: data.workPackages![0].id },
    })).toThrow(/belongs to its work package/);
  });

  it("blocks rather than erases affected packages when an accepted variation deducts scope", () => {
    const data = releasedProject();
    blockWorkPackagesForDeduction(
      data,
      ["line-1"],
      "Accepted deduction V2. Review remaining scope and quantities.",
      manager.now,
    );

    expect(data.workPackages![0]).toMatchObject({
      status: "blocked",
      blocker: "Accepted deduction V2. Review remaining scope and quantities.",
    });
    expect(data.workPackages![1].status).toBe("planning");
  });

  it("detects corrupted duplicate ownership instead of silently choosing a package", () => {
    const data = releasedProject();
    data.workPackages!.push({
      ...structuredClone(data.workPackages![0]),
      id: "duplicate-package",
    });
    expect(() => assertUniqueWorkPackageScope(data)).toThrow(/only one active work package/);
  });
});
