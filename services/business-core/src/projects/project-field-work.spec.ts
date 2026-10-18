import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import {
  projectFieldCommand,
  projectFieldProject,
  type ProjectFieldPermissions,
} from "./project-field-work";
import type { Task } from "./execution.types";

const permissions: ProjectFieldPermissions = {
  manage: false,
  review: false,
  report: true,
  buy: true,
};
const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const task = (id: string, ownerId: string): Task => ({
  id,
  parentId: "",
  package: "Joinery",
  title: "Install wardrobe",
  description: "",
  area: "Bedroom",
  location: "site",
  ownerId,
  assigneeIds: [],
  resourceId: "crew",
  start: "2026-09-18",
  end: "2026-09-19",
  baselineStart: "2026-09-18",
  baselineEnd: "2026-09-19",
  predecessors: [],
  quantity: 4,
  unit: "nos",
  weight: 1,
  approved: 0,
  status: "in_progress",
  priority: "normal",
  inspectionRequired: true,
  scopeIds: ["scope"],
  drawingId: "drawing",
  readiness: { scope: true, access: true, materials: true },
  blocker: "",
});

describe("native project field work", () => {
  it("returns only assigned operational truth without finance, contacts or employee data", () => {
    const data = emptyProject();
    const mine = task(uuid("1"), "member");
    const other = task(uuid("2"), "other");
    data.tasks = [mine, other];
    data.orders = [{
      id: uuid("3"), number: "PO-001", title: "Wardrobe", vendor: "Factory",
      vendorContact: "private@example.test", kind: "material", materialId: "",
      taskId: mine.id, quantity: 4, unit: "nos", unitCost: 999, currency: "AED",
      promisedDate: "2026-09-18", status: "acknowledged", acknowledgement: "Private note",
      receipts: [{ id: uuid("4"), accepted: 1, rejected: 0, evidence: "GRN", at: "2026-09-18T00:00:00Z" }],
    }];
    data.dispatches = [{
      id: uuid("5"), title: "Wardrobe delivery", taskId: uuid("6"),
      receivingTaskId: mine.id, destination: "Villa", quantity: 2, unit: "nos",
      dueDate: "2026-09-18", carrier: "Carrier", reference: "DN-1",
      status: "dispatched", preparedBy: "other", accepted: 0, rejected: 0,
      receiptEvidence: "",
    }];
    data.snags = [{
      id: uuid("9"), title: "Door alignment", taskId: mine.id,
      area: "Bedroom", ownerId: "member", severity: "major",
      dueDate: "2026-09-20", status: "open", evidence: "Photo reference",
      resolution: "",
    }];

    const result = projectFieldProject(
      { id: "project", name: "Villa", customer: "Client", members: [{ id: "member", name: "Field owner" }] },
      data,
      "member",
      permissions,
    );

    expect(result.tasks.map((item) => item.id)).toEqual([mine.id]);
    expect(result.purchaseReceipts[0]).toMatchObject({ accepted: 1, remaining: 3 });
    expect(result.deliveries[0]).toMatchObject({ canReceive: true, receivingTaskId: mine.id });
    expect(result.snags[0]).toMatchObject({ owner: "Field owner", canResolve: true, canVerify: false });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("private@example.test");
    expect(wire).not.toContain("999");
    expect(wire).not.toMatch(/unitCost|currency|acknowledgement|budget|margin|calendar|leave|assigneeIds/);

    data.supplierReturns = [{ id: uuid("10"), orderId: uuid("3"), materialId: "", quantity: 1, status: "credited" }] as NonNullable<typeof data.supplierReturns>;
    const afterReturn = projectFieldProject(
      { id: "project", name: "Villa", customer: "Client", members: [{ id: "member", name: "Field owner" }] },
      data, "member", permissions,
    );
    expect(afterReturn.purchaseReceipts[0]).toMatchObject({ accepted: 0, remaining: 4 });
  });

  it("allows assigned no-work updates without starting blocked work",()=>{
    const data=emptyProject();const mine=task(uuid("1"),"member");mine.status="blocked";data.tasks=[mine];
    const input={revision:0,requestId:uuid("7"),action:"draft_report_task",recordId:uuid("8"),taskId:mine.id,date:"2026-09-18",quantity:0,summary:"No access to room"};
    expect(projectFieldCommand(data,"member",permissions,input)).toMatchObject({action:"report",report:{entries:[{taskId:mine.id,quantity:0}],summary:"No access to room"}});
    expect(()=>projectFieldCommand(data,"member",permissions,{...input,quantity:1})).toThrow(/Start/);
    expect(()=>projectFieldCommand(data,"member",permissions,{...input,summary:""})).toThrow(/Explain/);
    expect(projectFieldProject({id:"p",name:"P",customer:"C"},data,"member",permissions).tasks[0].canReport).toBe(true);
  });

  it("maps assigned progress and receipts to canonical idempotent commands", () => {
    const data = emptyProject();
    const mine = task(uuid("1"), "member");
    data.tasks = [mine];
    data.orders = [{
      id: uuid("3"), number: "PO-001", title: "Wardrobe", vendor: "Factory",
      vendorContact: "", kind: "material", materialId: "", taskId: mine.id,
      quantity: 4, unit: "nos", unitCost: 100, currency: "AED",
      promisedDate: "2026-09-18", status: "acknowledged", acknowledgement: "Confirmed", receipts: [],
    }];
    data.dispatches = [{
      id: uuid("5"), title: "Delivery", taskId: uuid("6"), receivingTaskId: mine.id,
      destination: "Villa", quantity: 2, unit: "nos", dueDate: "2026-09-18",
      carrier: "Carrier", reference: "DN", status: "dispatched", preparedBy: "other",
      accepted: 0, rejected: 0, receiptEvidence: "",
    }];
    const common = { revision: 0, requestId: uuid("7") };

    expect(projectFieldCommand(data, "member", permissions, {
      ...common, action: "report_task", recordId: uuid("8"), taskId: mine.id,
      date: "2026-09-18", quantity: 1, evidence: "Photo and room check",
    })).toMatchObject({ action: "report_submit", report: { entries: [{ taskId: mine.id, quantity: 1 }] } });
    expect(projectFieldCommand(data, "member", permissions, {
      ...common, requestId: uuid("9"), action: "draft_report_task", recordId: uuid("8"),
      taskId: mine.id, date: "2026-09-18", quantity: 1, issues: "Access blocked",
      scheduleImpact: "blocked", impactReason: "No permit", recoveryPlan: "Escalate",
      nextUpdateOwnerId: "member", nextUpdateDate: "2026-09-19", evidence: "",
      shift:"Night",hours:7,people:3,weather:"Dry",materials:"4 panels",tomorrow:"Install handles",safetyStatus:"observation",safety:"Access cleared",
    })).toMatchObject({
      action: "report",
      report: { issues: "Access blocked", scheduleImpact: "blocked", recoveryPlan: "Escalate",shift:"Night",hours:7,people:3,weather:"Dry",materials:"4 panels",tomorrow:"Install handles",safetyStatus:"observation",safety:"Access cleared" },
    });
    expect(projectFieldCommand(data, "member", permissions, {
      ...common, action: "receive_dispatch", recordId: uuid("5"),
      accepted: 1, rejected: 1, evidence: "Signed delivery note",
    })).toMatchObject({ action: "dispatch_status", status: "received" });
    expect(projectFieldCommand(data, "member", permissions, {
      ...common, action: "receive_order", recordId: uuid("3"),
      accepted: 4, rejected: 0, evidence: "Inspected GRN",
    })).toMatchObject({ action: "receipt", note: "Inspected GRN" });
  });

  it("maps snag capture and independent status actions without exposing client notes", () => {
    const data = emptyProject();
    const mine = task(uuid("1"), "member");
    data.tasks = [mine];
    const created = projectFieldCommand(data, "member", permissions, {
      action: "create_snag", revision: 0, requestId: uuid("2"), recordId: uuid("3"),
      taskId: mine.id, title: "Damaged hinge", area: "Bedroom", ownerId: "member",
      severity: "major", dueDate: "2026-09-20", evidence: "Photo 1",
    });
    expect(created).toMatchObject({ action: "snag", snag: { title: "Damaged hinge", ownerId: "member" } });
    data.snags = [{
      id: uuid("3"), title: "Damaged hinge", taskId: mine.id, area: "Bedroom",
      ownerId: "member", severity: "major", dueDate: "2026-09-20", status: "open",
      evidence: "Photo 1", resolution: "", clientNote: "Private portal context",
    }];
    expect(projectFieldCommand(data, "member", permissions, {
      action: "snag_status", revision: 0, requestId: uuid("4"), recordId: uuid("3"),
      status: "ready", evidence: "Hinge replaced",
    })).toMatchObject({ action: "snag_status", id: uuid("3"), status: "ready", note: "Hinge replaced" });
    const projection = projectFieldProject(
      { id: "project", name: "Villa", customer: "Client", members: [{ id: "member", name: "Owner" }] },
      data, "member", permissions,
    );
    expect(JSON.stringify(projection)).not.toContain("Private portal context");
  });

  it("projects the frozen handover pack and maps aftercare actions without client decision data", () => {
    const data = emptyProject();
    const mine = task(uuid("1"), "member");
    data.tasks = [mine];
    data.handovers = [{
      id: uuid("2"), title: "Bedroom handover", area: "Bedroom", status: "accepted",
      documentIds: [uuid("3")], taskIds: [mine.id], evidence: "Private signed acceptance",
      acceptedBy: "Private client name", acceptedAt: "2026-09-18T09:00:00Z",
      warrantyUntil: "2027-09-18", outstanding: "", published: true,
      packet: {
        id: uuid("4"), version: 2, createdAt: "2026-09-18T08:00:00Z", preparedBy: "manager",
        source: "area", scopeLineIds: [], commissioningIds: [], dispatchIds: [],
        tasks: [{ id: mine.id, title: mine.title, area: mine.area, location: "site", quantity: 4, unit: "nos" }],
        documents: [{ id: uuid("3"), title: "Care guide", kind: "manual", revision: "R1", url: "https://files.example/care.pdf" }],
      },
      outstandingItems: [{
        id: uuid("5"), title: "Issue care kit", kind: "delivery", blocking: false,
        ownerId: "member", dueDate: "2026-09-20", status: "open", evidence: "Kit prepared", resolution: "",
      }],
    }];
    const projection = projectFieldProject(
      { id: "project", name: "Villa", customer: "Client", members: [{ id: "member", name: "Owner" }] },
      data, "member", permissions,
    );
    expect(projection.handovers[0]).toMatchObject({
      status: "accepted", packet: { version: 2 },
      outstandingItems: [{ owner: "Owner", canResolve: true, canVerify: false }],
    });
    expect(JSON.stringify(projection)).not.toMatch(/Private signed acceptance|Private client name|acceptedBy/);
    expect(projectFieldCommand(data, "member", permissions, {
      action: "handover_outstanding_status", revision: 0, requestId: uuid("6"),
      handoverId: uuid("2"), recordId: uuid("5"), status: "ready", evidence: "Kit handed over",
    })).toMatchObject({ action: "handover_outstanding_status", itemId: uuid("5"), status: "ready" });
    expect(projectFieldCommand(data, "member", permissions, {
      action: "create_warranty_snag", revision: 0, requestId: uuid("7"), recordId: uuid("8"),
      handoverId: uuid("2"), title: "Hinge adjustment", taskId: mine.id,
      ownerId: "member", severity: "minor", dueDate: "2026-09-21", evidence: "Client service note",
    })).toMatchObject({ action: "warranty_snag", snag: { handoverId: uuid("2"), area: "Bedroom" } });
  });

  it("denies another person's work and self-receipt", () => {
    const data = emptyProject();
    const other = task(uuid("1"), "other");
    data.tasks = [other];
    expect(() => projectFieldCommand(data, "member", permissions, {
      action: "report_task", revision: 0, requestId: uuid("2"), recordId: uuid("3"),
      taskId: other.id, date: "2026-09-18", quantity: 1, evidence: "Evidence",
    })).toThrow(/assigned/);
    data.dispatches = [{
      id: uuid("4"), title: "Delivery", taskId: uuid("5"), receivingTaskId: other.id,
      destination: "Villa", quantity: 1, unit: "nos", dueDate: "2026-09-18",
      carrier: "", reference: "DN", status: "dispatched", preparedBy: "other",
      accepted: 0, rejected: 0, receiptEvidence: "",
    }];
    expect(() => projectFieldCommand(data, "other", permissions, {
      action: "receive_dispatch", revision: 0, requestId: uuid("6"), recordId: uuid("4"),
      accepted: 1, rejected: 0, evidence: "Receipt",
    })).toThrow(/Another team member/);
  });
});
