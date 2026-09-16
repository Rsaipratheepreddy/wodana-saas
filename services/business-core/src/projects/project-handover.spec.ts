import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import {
  addHandoverOutstandingItem,
  assertHandoverPacketCurrent,
  createAutomaticHandover,
  decideHandoverFromPortal,
  refreshHandoverPacket,
} from "./project-handover";
import type { ProjectData, Task } from "./execution.types";

const now = "2026-09-16T09:00:00.000Z";

function completedTask(): Task {
  return {
    id: "site-task",
    parentId: "",
    packageId: "package-bedroom",
    package: "Master bedroom",
    title: "Install master-bedroom joinery",
    description: "",
    area: "Master bedroom",
    location: "site",
    ownerId: "site-owner",
    assigneeIds: [],
    resourceId: "",
    start: "2026-09-01",
    end: "2026-09-10",
    baselineStart: "2026-09-01",
    baselineEnd: "2026-09-10",
    predecessors: [],
    quantity: 1,
    unit: "room",
    weight: 1,
    approved: 1,
    status: "completed",
    priority: "normal",
    inspectionRequired: true,
    scopeIds: ["scope-bedroom"],
    drawingId: "as-built-bedroom",
    readiness: { scope: true, access: true, materials: true },
    blocker: "",
  };
}

function project(): ProjectData {
  const data = emptyProject();
  data.phase = "active";
  data.scope = {
    quoteId: "quote",
    quoteNumber: 1,
    currency: "AED",
    value: 100,
    lines: [
      {
        id: "scope-bedroom",
        title: "Master bedroom joinery",
        room: "Master bedroom",
        material: "",
        quantity: 1,
        unit: "room",
      },
    ],
  };
  data.workPackages = [{
    id: "package-bedroom",
    scopeLineIds: ["scope-bedroom"],
    title: "Master bedroom joinery",
    area: "Master bedroom",
    deliveryRoute: "mixed",
    status: "completed",
    ownerId: "site-owner",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-10",
    blocker: "",
    createdAt: now,
    updatedAt: now,
  }];
  data.tasks = [completedTask()];
  data.documents = [{
    id: "as-built-bedroom",
    title: "Master bedroom as-built",
    kind: "as_built",
    revision: "R01",
    url: "https://files.example/as-built-bedroom.pdf",
    note: "",
    status: "approved",
    replaces: "",
    published: true,
    scopeLineIds: ["scope-bedroom"],
  }];
  return data;
}

function prepared(data: ProjectData) {
  const handover = createAutomaticHandover(data, {
    id: "handover-bedroom",
    sourcePackageId: "package-bedroom",
    warrantyUntil: "2027-09-16",
    clientReviewDueDate: "2026-09-18",
  });
  data.handovers.push(handover);
  refreshHandoverPacket(data, handover, "project-manager", now);
  handover.clientApproverId = "client-approver";
  handover.status = "ready";
  handover.published = true;
  return handover;
}

describe("automatic area acceptance packs", () => {
  it("derives the exact package tasks and approved scoped documents without manual IDs", () => {
    const data = project();
    const handover = prepared(data);
    expect(handover.source).toBe("work_package");
    expect(handover.area).toBe("Master bedroom");
    expect(handover.taskIds).toEqual(["site-task"]);
    expect(handover.documentIds).toEqual(["as-built-bedroom"]);
    expect(handover.packet).toMatchObject({
      version: 1,
      sourcePackageId: "package-bedroom",
      scopeLineIds: ["scope-bedroom"],
      tasks: [expect.objectContaining({ id: "site-task" })],
      documents: [expect.objectContaining({ id: "as-built-bedroom", revision: "R01" })],
    });
  });

  it("does not let an unrelated room snag block an area pack, but blocks an affected defect", () => {
    const data = project();
    const handover = prepared(data);
    data.snags.push({
      id: "other-room",
      title: "Guest-room adjustment",
      taskId: "other-task",
      area: "Guest room",
      ownerId: "site-owner",
      severity: "major",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "photo",
      resolution: "",
    });
    expect(() => assertHandoverPacketCurrent(data, handover)).not.toThrow();
    data.snags.push({
      id: "bedroom-defect",
      title: "Door alignment",
      taskId: "site-task",
      area: "Master bedroom",
      ownerId: "site-owner",
      severity: "minor",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "photo",
      resolution: "",
    });
    expect(() => assertHandoverPacketCurrent(data, handover)).toThrow(/affected open defects/);
  });

  it("requires a fresh packet when a frozen closeout document revision changes", () => {
    const data = project();
    const handover = prepared(data);
    data.documents[0].revision = "R02";
    expect(() => assertHandoverPacketCurrent(data, handover)).toThrow(/document changed/);
  });

  it("records a client-verified return or acceptance and never accepts unresolved blocking commitments", () => {
    const data = project();
    const handover = prepared(data);
    addHandoverOutstandingItem(handover, {
      id: "training",
      title: "Client training",
      kind: "training",
      blocking: true,
      ownerId: "site-owner",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "",
      resolution: "",
    });
    expect(() => decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-1",
      now,
    })).toThrow(/blocking handover items/);
    const returned = decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "changes",
      note: "Please correct the door alignment.",
      challengeId: "challenge-2",
      now,
    });
    expect(returned.handover).toMatchObject({
      status: "returned",
      returnedBy: "Katy",
      published: false,
    });
  });

  it("records the assigned portal approver once and rejects a different client identity", () => {
    const data = project();
    const handover = prepared(data);
    expect(() => decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "another-client",
      grantName: "Other client",
      decision: "accept",
      note: "",
      challengeId: "challenge-3",
      now,
    })).toThrow(/not assigned/);
    const accepted = decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-4",
      now,
    });
    expect(accepted.handover).toMatchObject({
      status: "accepted",
      acceptedBy: "Katy",
      decisionSource: "client_portal",
    });
    expect(decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-4",
      now,
    }).replayed).toBe(true);
  });
});
