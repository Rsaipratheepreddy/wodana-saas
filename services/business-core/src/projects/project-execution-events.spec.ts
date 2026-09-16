import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { projectExecutionEvents } from "./project-execution-events";

describe("project execution events", () => {
  it("emits a concise report event plus independent risk and safety triggers", () => {
    const data = emptyProject();
    data.revision = 8;
    data.controls!.reference = "PRJ-2026-008";
    data.reports = [{
      id: "report-1", date: "2026-09-16", shift: "Day", location: "site",
      authorId: "foreman", author: "Foreman", status: "submitted", entries: [],
      hours: 0, people: 0, materials: "", issues: "Access stopped", tomorrow: "",
      evidence: "SITE-1", note: "", safetyStatus: "incident", safety: "Minor incident",
      scheduleImpact: "blocked", impactReason: "Access is closed.",
      recoveryPlan: "Confirm access.", nextUpdateOwnerId: "manager", nextUpdateDate: "2026-09-17",
    }];

    const events = projectExecutionEvents("project-1", "Villa project", data, "report_submit", "report-1");

    expect(events.map((event) => event.action)).toEqual([
      "project.daily_report.submitted.v1",
      "project.daily_report.schedule_risk.v1",
      "project.daily_report.safety_incident.v1",
    ]);
    expect(events[0].data).toMatchObject({
      projectId: "project-1",
      projectReference: "PRJ-2026-008",
      executionRevision: 8,
      report: { id: "report-1", scheduleImpact: "blocked", safetyStatus: "incident" },
    });
    expect(JSON.stringify(events)).not.toContain("Confirm access.");
  });

  it("uses one stable schedule event instead of exposing a full task payload", () => {
    const data = emptyProject();
    data.tasks = [{
      id: "task-1", parentId: "", package: "", title: "Install joinery", description: "Private notes",
      area: "Bedroom", location: "site", ownerId: "foreman", assigneeIds: [], resourceId: "crew-1",
      start: "2026-09-17", end: "2026-09-18", baselineStart: "2026-09-17", baselineEnd: "2026-09-18",
      predecessors: [], quantity: 1, unit: "lot", weight: 1, approved: 0, status: "planned",
      priority: "normal", inspectionRequired: true, scopeIds: [], drawingId: "", readiness: { scope: true, access: true, materials: true }, blocker: "",
    }];

    const [event] = projectExecutionEvents("project-1", "Villa project", data, "reschedule", "task-1");

    expect(event).toMatchObject({ action: "project.schedule.updated.v1", data: { task: { id: "task-1", start: "2026-09-17", end: "2026-09-18" } } });
    expect(JSON.stringify(event)).not.toContain("Private notes");
  });

  it("provides dedicated delivery and commissioning triggers without test readings", () => {
    const data = emptyProject();
    data.dispatches = [{
      id: "dispatch-1", title: "Bedroom wardrobes", taskId: "factory-1", receivingTaskId: "site-1",
      destination: "Villa", quantity: 2, unit: "nos", dueDate: "2026-09-18", carrier: "", reference: "",
      status: "dispatched", preparedBy: "foreman", accepted: 0, rejected: 0, receiptEvidence: "",
    }];
    data.commissioning = [{
      id: "commissioning-1", title: "Lighting test", taskId: "site-1", area: "Bedroom", system: "Lighting",
      ownerId: "electrician", dueDate: "2026-09-19", readings: [{ name: "Load", value: 1, unit: "A", min: 0, max: 2 }],
      status: "passed", evidence: "TEST-1", note: "Verified", authorId: "electrician", reviewedBy: "reviewer",
    }];

    const [dispatch] = projectExecutionEvents("project-1", "Villa project", data, "dispatch_status", "dispatch-1");
    const [commissioning] = projectExecutionEvents("project-1", "Villa project", data, "commissioning_status", "commissioning-1");

    expect(dispatch).toMatchObject({ action: "project.dispatch.dispatched.v1", data: { dispatch: { id: "dispatch-1", dueDate: "2026-09-18" } } });
    expect(commissioning).toMatchObject({ action: "project.commissioning.passed.v1", data: { commissioning: { id: "commissioning-1", status: "passed" } } });
    expect(JSON.stringify(commissioning)).not.toContain("TEST-1");
  });

  it("emits a concise handover event without leaking private acceptance evidence", () => {
    const data = emptyProject();
    data.handovers = [{
      id: "handover-1", area: "Master bedroom", title: "Joinery acceptance",
      status: "ready", source: "work_package", sourcePackageId: "package-1",
      taskIds: ["task-1"], documentIds: ["doc-1"], evidence: "", acceptedBy: "",
      acceptedAt: "", warrantyUntil: "2027-09-16", outstanding: "", published: true,
      clientReviewDueDate: "2026-09-18", packet: {
        id: "packet-1", version: 2, createdAt: "2026-09-16T10:00:00.000Z", preparedBy: "manager",
        source: "work_package", sourcePackageId: "package-1", scopeLineIds: ["line-1"],
        tasks: [], documents: [], commissioningIds: [], dispatchIds: [],
      },
      outstandingItems: [{
        id: "commitment-1", title: "Client training", kind: "training", blocking: false,
        ownerId: "manager", dueDate: "2026-09-19", status: "open", evidence: "Private training notes", resolution: "",
      }],
    }];

    const [event] = projectExecutionEvents("project-1", "Villa project", data, "handover_status", "handover-1");

    expect(event).toMatchObject({
      action: "project.handover.ready.v1",
      data: { handover: { id: "handover-1", packetVersion: 2, outstandingCount: 1 } },
    });
    expect(JSON.stringify(event)).not.toContain("Private training notes");
  });
});
