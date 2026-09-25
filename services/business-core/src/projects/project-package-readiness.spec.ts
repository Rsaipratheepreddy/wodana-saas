import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { workPackageReadiness } from "./project-package-readiness";

function fixture() {
  const data = emptyProject();
  const workPackage = {
    id: "package-1",
    scopeLineIds: ["line-1"],
    title: "Wardrobe",
    area: "Bedroom",
    deliveryRoute: "office" as const,
    status: "planning" as const,
    ownerId: "manager",
    plannedStart: "2026-09-20",
    plannedEnd: "2026-09-21",
    nextAction: "Confirm design coordination",
    nextActionOwnerId: "manager",
    nextActionDate: "2026-09-19",
    blocker: "",
    createdAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-09-16T10:00:00.000Z",
  };
  data.workPackages = [workPackage];
  data.tasks = [{
    id: "task-1", parentId: "", packageId: "package-1", package: "Wardrobe",
    title: "Coordinate design", description: "", area: "Bedroom", location: "office" as const,
    ownerId: "designer", assigneeIds: [], resourceId: "", start: "2026-09-20", end: "2026-09-21",
    baselineStart: "2026-09-20", baselineEnd: "2026-09-21", predecessors: [], quantity: 1,
    unit: "item", weight: 1, approved: 0, status: "planned" as const, priority: "normal" as const,
    inspectionRequired: false, scopeIds: ["line-1"], drawingId: "",
    readiness: { scope: true, access: true, materials: true }, blocker: "",
  }];
  return { data, workPackage };
}

describe("work-package readiness", () => {
  it("does not confuse planned scope with executable work", () => {
    const data = emptyProject();
    const workPackage = {
      id: "package-1", scopeLineIds: ["line-1"], title: "Wardrobe", area: "Bedroom",
      deliveryRoute: "mixed" as const, status: "planning" as const, ownerId: "manager",
      plannedStart: "", plannedEnd: "", blocker: "", createdAt: "now", updatedAt: "now",
    };
    data.workPackages = [workPackage];

    expect(workPackageReadiness(data, workPackage)).toContainEqual(
      expect.objectContaining({ code: "tasks" }),
    );
  });

  it("requires actual company stock and an acknowledged vendor commitment", () => {
    const { data, workPackage } = fixture();
    data.materials = [{
      id: "board", title: "Oak board", specification: "", catalogId: "", catalogVersion: 0,
      unit: "sheet", required: 2, supply: "company", taskId: "task-1", needBy: "2026-09-19", movements: [],
    }, {
      id: "installation", title: "Installation", specification: "", catalogId: "", catalogVersion: 0,
      unit: "lot", required: 1, supply: "vendor", taskId: "task-1", needBy: "2026-09-19", movements: [],
    }];

    expect(workPackageReadiness(data, workPackage).map((issue) => issue.code)).toEqual([
      "company_supply",
      "vendor_supply",
    ]);
    data.materials[0].movements.push({ id: "receipt", kind: "receive", quantity: 2, reference: "GRN", at: "now" });
    data.orders.push({
      id: "order-1", number: "PO-001", title: "Installation", vendor: "Vendor", vendorContact: "",
      kind: "subcontract", materialId: "", taskId: "task-1", quantity: 1, unit: "lot", unitCost: 100,
      currency: "AED", promisedDate: "2026-09-19", status: "acknowledged", acknowledgement: "Confirmed", receipts: [],
    });
    expect(workPackageReadiness(data, workPackage)).toEqual([]);
    data.materials[0].reservations=[{taskId:'other-task',quantity:1}];
    expect(workPackageReadiness(data, workPackage).map(i=>i.code)).toContain('company_supply');
    data.materials[0].reservations=[];
    data.materials[0].movements.push({id:'issue',kind:'issue',quantity:2,taskId:'task-1',reference:'Issue to assigned team',at:'now'});
    expect(workPackageReadiness(data, workPackage)).toEqual([]);
    data.materials[0].movements[1].taskId='other-task';
    expect(workPackageReadiness(data, workPackage).map(i=>i.code)).toContain('company_supply');
  });
});
