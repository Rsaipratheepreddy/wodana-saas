import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import type { Task } from "./execution.types";
import {
  assertFactoryDispatchReceiver,
  factoryHandoffReadiness,
} from "./project-factory-handoff";
import { projectExecutionPulse } from "./project-execution-pulse";

const actor: ExecutionActor = {
  id: "manager",
  name: "Manager",
  manage: true,
  review: true,
  report: true,
  buy: true,
  memberIds: ["manager"],
  resourceIds: [],
  now: "2026-09-16T10:00:00.000Z",
  released: true,
};

function task(input: Partial<Task>): Task {
  return {
    id: "task",
    parentId: "",
    package: "Joinery",
    title: "Task",
    description: "",
    area: "Living",
    location: "site",
    ownerId: "manager",
    assigneeIds: [],
    resourceId: "",
    start: "2026-09-17",
    end: "2026-09-17",
    baselineStart: "2026-09-17",
    baselineEnd: "2026-09-17",
    predecessors: [],
    quantity: 2,
    unit: "nos",
    weight: 1,
    approved: 0,
    status: "planned",
    priority: "normal",
    inspectionRequired: false,
    scopeIds: ["line-1"],
    drawingId: "drawing-1",
    readiness: { scope: true, access: true, materials: true },
    blocker: "",
    ...input,
  };
}

function setup() {
  const data = emptyProject();
  data.phase = "active";
  const factory = task({
    id: "factory-1",
    title: "Fabricate joinery",
    location: "factory",
    status: "completed",
    approved: 2,
  });
  const site = task({
    id: "site-1",
    title: "Install joinery",
    predecessors: [factory.id],
  });
  data.tasks = [factory, site];
  data.documents = [{
    id: "drawing-1",
    title: "Approved joinery drawing",
    kind: "drawing",
    revision: "R1",
    url: "",
    note: "Approved",
    status: "approved",
    replaces: "",
    published: false,
  }];
  data.reports = [{
    id: "factory-output",
    date: "2026-09-16",
    shift: "Day",
    location: "factory",
    authorId: "manager",
    author: "Manager",
    status: "approved",
    entries: [{ taskId: factory.id, quantity: 2 }],
    hours: 8,
    people: 1,
    materials: "",
    issues: "",
    tomorrow: "",
    evidence: "Factory quality record",
    note: "",
  }];
  return { data, factory, site };
}

describe("factory-to-site hand-off", () => {
  it("requires a signed accepted dispatch from every direct factory predecessor before site work starts", () => {
    const { data, factory, site } = setup();

    expect(factoryHandoffReadiness(data, site)).toMatchObject({
      ready: false,
      missingFactoryTaskIds: [factory.id],
    });
    expect(projectExecutionPulse(data, "2026-09-16").nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "receive_factory_output", taskId: site.id }),
        expect.objectContaining({ kind: "plan_factory_dispatch", taskId: factory.id }),
      ]),
    );
    expect(() => applyExecution(data, "task_status", { id: site.id, status: "in_progress" }, actor))
      .toThrow(/Receive accepted factory output/);

    data.dispatches = [{
      id: "dispatch-1",
      title: "Joinery delivery",
      taskId: factory.id,
      receivingTaskId: site.id,
      destination: "Villa site",
      quantity: 2,
      unit: "nos",
      dueDate: "2026-09-17",
      carrier: "Carrier",
      reference: "DN-1",
      status: "draft",
      preparedBy: "manager",
      accepted: 0,
      rejected: 0,
      receiptEvidence: "",
    }];
    const draftPulse = projectExecutionPulse(data, "2026-09-16");
    expect(draftPulse.nextActions).toContainEqual(expect.objectContaining({
      kind: "review_factory_dispatch", recordId: "dispatch-1",
    }));
    expect(draftPulse.nextActions).not.toContainEqual(expect.objectContaining({
      kind: "plan_factory_dispatch", taskId: factory.id,
    }));

    data.dispatches[0] = {
      ...data.dispatches[0],
      status: "received",
      accepted: 2,
      receiptEvidence: "Signed GRN",
      receivedBy: "manager",
    };

    expect(factoryHandoffReadiness(data, site).ready).toBe(true);
    expect(factoryHandoffReadiness(data, site).acceptedQuantity).toBe(2);
    applyExecution(data, "task_status", { id: site.id, status: "in_progress" }, actor);
    expect(data.tasks.find((candidate) => candidate.id === site.id)?.status).toBe("in_progress");
    expect(() => applyExecution(data, "task_status", {
      id: site.id, status: "cancelled", note: "No longer required",
    }, actor)).toThrow(/linked dispatches/);
  });

  it("allows a linked dispatch only for a live compatible site successor", () => {
    const { data, factory, site } = setup();

    expect(() => assertFactoryDispatchReceiver(data, factory, site.id)).not.toThrow();
    expect(() => assertFactoryDispatchReceiver(data, factory, "factory-1"))
      .toThrow(/only to a site task/);

    const unrelated = task({ id: "site-2", title: "Install console", predecessors: [] });
    data.tasks.push(unrelated);
    expect(() => assertFactoryDispatchReceiver(data, factory, unrelated.id))
      .toThrow(/predecessor/);

    const wrongUnit = task({ id: "site-3", title: "Install joinery", unit: "lot", predecessors: [factory.id] });
    data.tasks.push(wrongUnit);
    expect(() => assertFactoryDispatchReceiver(data, factory, wrongUnit.id))
      .toThrow(/same unit/);
  });

  it("requires a rejected delivery to be corrected before replacement output is released", () => {
    const { data, factory } = setup();
    data.dispatches = [{
      id: "dispatch-1",
      title: "Joinery delivery",
      taskId: factory.id,
      receivingTaskId: "site-1",
      destination: "Villa site",
      quantity: 2,
      unit: "nos",
      dueDate: "2026-09-17",
      carrier: "Carrier",
      reference: "DN-1",
      status: "received",
      preparedBy: "manager",
      accepted: 0,
      rejected: 2,
      receiptEvidence: "Rejected at site",
      receivedBy: "manager",
      rejectionSnagId: "snag-1",
    }];
    data.snags = [{
      id: "snag-1", title: "Rejected dispatch", taskId: factory.id, area: "Living",
      ownerId: "manager", severity: "major", dueDate: "2026-09-16", status: "open",
      evidence: "Rejected at site", resolution: "",
    }];

    expect(projectExecutionPulse(data, "2026-09-16").nextActions).toContainEqual(
      expect.objectContaining({ kind: "resolve_factory_rejection", taskId: factory.id }),
    );

    data.snags[0].status = "closed";
    expect(projectExecutionPulse(data, "2026-09-16").nextActions).toContainEqual(
      expect.objectContaining({ kind: "plan_factory_dispatch", taskId: factory.id }),
    );
  });

  it("allows phased installation but never approves site output beyond accepted factory delivery", () => {
    const { data, site } = setup();
    const reviewer = { ...actor, id: "reviewer", name: "Reviewer" };
    data.dispatches = [{
      id: "dispatch-1",
      title: "First joinery delivery",
      taskId: "factory-1",
      receivingTaskId: site.id,
      destination: "Villa site",
      quantity: 1,
      unit: "nos",
      dueDate: "2026-09-16",
      carrier: "Carrier",
      reference: "DN-1",
      status: "received",
      preparedBy: "manager",
      accepted: 1,
      rejected: 0,
      receiptEvidence: "GRN-1",
      receivedBy: "reviewer",
    }];

    expect(factoryHandoffReadiness(data, site)).toMatchObject({
      ready: true,
      acceptedQuantity: 1,
    });
    applyExecution(data, "task_status", { id: site.id, status: "in_progress" }, actor);
    applyExecution(data, "report_submit", {
      report: {
        id: "site-output",
        date: "2026-09-16",
        shift: "Day",
        location: "site",
        entries: [{ taskId: site.id, quantity: 2 }],
        hours: 8,
        people: 1,
        materials: "Installed first batch",
        issues: "",
        tomorrow: "Continue after next delivery",
        evidence: "SITE-1",
      },
    }, actor);

    expect(() => applyExecution(data, "approve_report", { id: "site-output" }, reviewer))
      .toThrow(/Only 1 nos has been accepted at site/);
    expect(data.reports.find((report) => report.id === "site-output")?.status)
      .toBe("submitted");

    data.dispatches.push({
      ...data.dispatches[0],
      id: "dispatch-2",
      title: "Second joinery delivery",
      reference: "DN-2",
      receiptEvidence: "GRN-2",
    });
    applyExecution(data, "approve_report", { id: "site-output" }, reviewer);
    expect(data.tasks.find((task) => task.id === site.id)?.approved).toBe(2);
  });
});
