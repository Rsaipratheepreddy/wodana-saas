import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, publicProject, type ExecutionActor } from "./execution.domain";
import type { Task } from "./execution.types";

const manager: ExecutionActor = {
  id: "manager", name: "Manager", manage: true, review: true, report: true, buy: true,
  memberIds: ["manager", "reviewer", "installer"], resourceIds: [], released: true,
  now: "2026-09-18T08:00:00.000Z", today: "2026-09-18",
};
const reviewer = { ...manager, id: "reviewer", name: "Reviewer" };
const installer = { ...manager, id: "installer", name: "Installer", manage: false, review: false, buy: false };

function task(input: Partial<Task>): Task {
  return {
    id: "task", parentId: "", package: "Joinery", title: "Work", description: "",
    area: "Bedroom", location: "factory", ownerId: "manager", assigneeIds: [],
    resourceId: "factory", start: "2026-09-18", end: "2026-09-19",
    baselineStart: "2026-09-18", baselineEnd: "2026-09-19", predecessors: [],
    quantity: 2, unit: "nos", weight: 1, approved: 0, status: "in_progress",
    priority: "normal", inspectionRequired: false, scopeIds: ["scope"], drawingId: "drawing",
    readiness: { scope: true, access: true, materials: true }, blocker: "", ...input,
  };
}

describe("procurement to installed quantity truth", () => {
  it("keeps PO, stock, factory output, delivery receipt and installation variance connected", () => {
    const data = emptyProject();
    data.phase = "active";
    data.scope = { quoteId: "quote", quoteNumber: 1, currency: "AED", value: 1000, lines: [{id:"scope",title:"Wardrobe",room:"Bedroom",material:"Board",quantity:2,unit:"nos"}] };
    data.budget = 1000;
    const factory = task({ id: "factory", title: "Fabricate wardrobe" });
    const site = task({
      id: "site", title: "Install wardrobe", location: "site", ownerId: "installer",
      resourceId: "crew", predecessors: [factory.id], status: "planned",
    });
    data.tasks = [factory, site];
    data.materials = [{
      id: "board", title: "Board", specification: "Approved finish", catalogId: "",
      catalogVersion: 0, unit: "nos", required: 2, supply: "company", taskId: factory.id,
      needBy: "2026-09-18", movements: [],
    }];

    const orderId = applyExecution(data, "order", { order: {
      title: "Wardrobe board", vendor: "Approved supplier", kind: "material",
      materialId: "board", taskId: factory.id, quantity: 2, unit: "nos",
      unitCost: 200, promisedDate: "2026-09-18", leadTimeDays: 7,
    } }, manager)!;
    applyExecution(data, "order_status", { id: orderId, status: "submitted" }, manager);
    applyExecution(data, "order_status", { id: orderId, status: "approved" }, reviewer);
    applyExecution(data, "order_status", {
      id: orderId, status: "acknowledged", note: "Supplier confirmed PO", promisedDate: "2026-09-18",
    }, manager);
    expect(publicProject("p","Villa",data,"2026-09-18").alerts).toEqual([]);
    applyExecution(data,"order_shipment",{id:orderId,status:"dispatched",reference:"TRACK-PRIVATE",carrier:"Private supplier",quantity:2,expectedDate:"2026-09-21",note:"Private negotiation"},manager);
    const delayed=publicProject("p","Villa",data,"2026-09-19");
    expect(delayed.alerts).toEqual([expect.objectContaining({kind:"delivery",title:"Delivery delayed · Wardrobe",expectedDate:"2026-09-21"})]);
    expect(JSON.stringify(delayed)).not.toMatch(/Private supplier|Private negotiation|TRACK-PRIVATE|unitCost/);
    applyExecution(data,"receipt",{id:orderId,accepted:1,rejected:1,note:"Partial delivery"},manager);
    expect(publicProject("p","Villa",data,"2026-09-19").alerts?.[0].message).toContain("Part");
    applyExecution(data,"receipt",{id:orderId,accepted:1,rejected:0,note:"GRN-001 · inspected"},manager);
    expect(publicProject("p","Villa",data,"2026-09-22").alerts).toEqual([]);
    expect(data.materials[0].movements.reduce((n,m)=>n+m.quantity,0)).toBe(2);
    expect(data.budget).toBe(1000);
    expect(data.orders[0]).toMatchObject({ quantity: 2, unitCost: 200, currency: "AED" });

    applyExecution(data, "report_submit", { report: {
      id: "factory-report", date: "2026-09-18", shift: "Day", location: "factory",
      entries: [{ taskId: factory.id, quantity: 2 }], hours: 8, people: 2,
      summary: "Factory output complete", materials: "Board issued", issues: "",
      tomorrow: "Dispatch", evidence: "Factory inspection FQI-001",
    } }, manager);
    applyExecution(data, "approve_report", { id: "factory-report" }, reviewer);
    expect(factory.status).toBe("completed");
    expect(factory.approved).toBe(2);

    applyExecution(data, "dispatch", { record: {
      id: "dispatch", title: "Wardrobe delivery", taskId: factory.id,
      receivingTaskId: site.id, destination: "Villa", quantity: 2, dueDate: "2026-09-18",
    } }, manager);
    applyExecution(data, "dispatch_status", { id: "dispatch", status: "ready" }, reviewer);
    applyExecution(data, "dispatch_status", {
      id: "dispatch", status: "dispatched", carrier: "Truck 1", reference: "DN-001",
    }, manager);
    expect(publicProject("p","Villa",data,"2026-09-19").alerts).toEqual([expect.objectContaining({id:"dispatch:dispatch",kind:"delivery"})]);
    applyExecution(data, "dispatch_status", {
      id: "dispatch", status: "received", accepted: 1, rejected: 1, evidence: "Signed GRN-002",
    }, installer);
    expect(publicProject("p","Villa",data,"2026-09-19").alerts).toEqual([]);
    expect(data.dispatches?.[0]).toMatchObject({ accepted: 1, rejected: 1, receivedBy: "installer" });
    expect(data.snags[0]).toMatchObject({ severity: "major", status: "open" });

    site.status = "in_progress";
    applyExecution(data, "report_submit", { report: {
      id: "site-report", date: "2026-09-18", shift: "Day", location: "site",
      entries: [{ taskId: site.id, quantity: 2 }], hours: 4, people: 1,
      summary: "Installed delivery", materials: "", issues: "", tomorrow: "Continue",
      evidence: "Room photo SITE-001",
    } }, installer);
    expect(() => applyExecution(data, "approve_report", { id: "site-report" }, reviewer))
      .toThrow(/Only 1 nos has been accepted at site/);
    expect(site.approved).toBe(0);
    data.reports.find((report) => report.id === "site-report")!.entries[0].quantity = 1;
    applyExecution(data, "approve_report", { id: "site-report" }, reviewer);
    expect(site.approved).toBe(1);
    expect(site.quantity - site.approved).toBe(1);
    expect(data.orders[0].receipts[1].evidence).toContain("GRN-001");
  });
});
