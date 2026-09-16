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

  it("puts the owned project hold and client commitments ahead of execution work", () => {
    const data = emptyProject();
    data.phase = "active";
    data.controls = {
      ...data.controls!,
      onHold: true,
      holdReason: "Client access is not confirmed.",
      holdOwnerId: "manager",
      risk: "high_risk",
      targetCompletion: "2026-09-15",
      handoverDate: "2026-09-18",
      nextAction: "Confirm access window",
      nextActionOwnerId: "coordinator",
      nextActionDate: "2026-09-15",
      nextClientMeeting: "2026-09-16",
      nextClientMeetingOwnerId: "designer",
    };
    data.tasks = [{
      id: "office-task", parentId: "", package: "", title: "Prepare client pack", description: "",
      area: "", location: "office", ownerId: "manager", assigneeIds: [], resourceId: "",
      start: "2026-09-16", end: "2026-09-16", baselineStart: "2026-09-16", baselineEnd: "2026-09-16",
      predecessors: [], quantity: 1, unit: "item", weight: 1, approved: 0, status: "planned",
      priority: "normal", inspectionRequired: false, scopeIds: [], drawingId: "",
      readiness: { scope: true, access: true, materials: true }, blocker: "",
    }];

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse.health).toBe("blocked");
    expect(pulse.nextActions[0]).toMatchObject({
      kind: "resolve_project_hold", ownerId: "manager", detail: "Client access is not confirmed.",
    });
    expect(pulse.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "resolve_project_risk" }),
      expect.objectContaining({ kind: "recover_project_promise" }),
      expect.objectContaining({ kind: "complete_client_action", ownerId: "coordinator" }),
      expect.objectContaining({ kind: "prepare_client_meeting", ownerId: "designer" }),
    ]));
    expect(pulse.nextActions).not.toContainEqual(expect.objectContaining({
      kind: "start_task", taskId: "office-task",
    }));
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
    expect(withoutBooking.nextActions).toContainEqual(expect.objectContaining({
      kind: "resolve_booking", taskId: "task-1",
    }));

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

  it("does not treat an old, wrong-resource or partial booking as authority to start work", () => {
    const data = emptyProject();
    data.workPackages = [{
      id: "package-1", scopeLineIds: ["line-1"], title: "Joinery", area: "Living",
      deliveryRoute: "site", status: "ready", ownerId: "manager", plannedStart: "",
      plannedEnd: "", blocker: "", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z",
    }];
    data.tasks = [{
      id: "task-1", parentId: "", packageId: "package-1", package: "Joinery",
      title: "Install joinery", description: "", area: "Living", location: "site",
      ownerId: "foreman", assigneeIds: [], resourceId: "crew-1", start: "2026-09-17",
      end: "2026-09-18", baselineStart: "2026-09-17", baselineEnd: "2026-09-18",
      predecessors: [], quantity: 1, unit: "nos", weight: 1, approved: 0,
      status: "planned", priority: "normal", inspectionRequired: true, scopeIds: ["line-1"],
      drawingId: "drawing-1", readiness: { scope: true, access: true, materials: true }, blocker: "",
    }];
    const resources = [{ id: "crew-1", name: "Joinery team", kind: "crew" as const, members: [], active: true }];
    const bookings = [
      {
        id: "old-booking", projectId: "project-1", projectName: "Villa", taskId: "task-1",
        taskTitle: "Install joinery", resourceId: "crew-1", start: "2026-09-10", end: "2026-09-11",
        status: "confirmed" as const, acknowledgement: "Confirmed",
      },
      {
        id: "wrong-resource", projectId: "project-1", projectName: "Villa", taskId: "task-1",
        taskTitle: "Install joinery", resourceId: "crew-2", start: "2026-09-17", end: "2026-09-18",
        status: "confirmed" as const, acknowledgement: "Confirmed",
      },
      {
        id: "partial-booking", projectId: "project-1", projectName: "Villa", taskId: "task-1",
        taskTitle: "Install joinery", resourceId: "crew-1", start: "2026-09-17", end: "2026-09-17",
        status: "confirmed" as const, acknowledgement: "Confirmed",
      },
    ];

    const pulse = projectExecutionPulse(data, "2026-09-16", resources, bookings);

    expect(pulse.nextActions).toContainEqual(expect.objectContaining({
      kind: "resolve_booking", taskId: "task-1",
    }));
    expect(pulse.nextActions).not.toContainEqual(expect.objectContaining({
      kind: "start_task", taskId: "task-1",
    }));
  });

  it("surfaces a missing released design before it offers delivery work to start", () => {
    const data = emptyProject();
    data.workPackages = [{
      id: "package-1", scopeLineIds: ["line-1"], title: "Joinery", area: "Living",
      deliveryRoute: "site", status: "ready", ownerId: "manager", plannedStart: "",
      plannedEnd: "", blocker: "", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z",
    }];
    data.designBaseline = {
      capturedAt: "2026-09-16T10:00:00.000Z",
      links: [{
        scopeLineId: "line-1", sourceScopeId: "source-1", sourceScopeVersion: 1,
        sourceSpecificationVersion: 1, designVersionId: "design-1", designId: "design",
        title: "Joinery drawing", documentType: "drawing", revision: 1,
        approvedAt: "2026-09-16T09:00:00.000Z",
      }],
    };
    data.tasks = [{
      id: "task-1", parentId: "", packageId: "package-1", package: "Joinery",
      title: "Install joinery", description: "", area: "Living", location: "site",
      ownerId: "foreman", assigneeIds: [], resourceId: "", start: "2026-09-17",
      end: "2026-09-18", baselineStart: "2026-09-17", baselineEnd: "2026-09-18",
      predecessors: [], quantity: 1, unit: "nos", weight: 1, approved: 0,
      status: "planned", priority: "normal", inspectionRequired: true, scopeIds: ["line-1"],
      drawingId: "", readiness: { scope: true, access: true, materials: true }, blocker: "",
    }];

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse.nextActions).toContainEqual(expect.objectContaining({
      kind: "resolve_design", taskId: "task-1",
    }));
    expect(pulse.nextActions).not.toContainEqual(expect.objectContaining({
      kind: "start_task", taskId: "task-1",
    }));
  });

  it("keeps returned reports, schedule risks and safety incidents in the operational queue", () => {
    const data = emptyProject();
    data.reports = [
      {
        id: "returned", date: "2026-09-15", shift: "Day", location: "site",
        authorId: "foreman", author: "Foreman", status: "returned", entries: [],
        hours: 0, people: 0, materials: "", issues: "", tomorrow: "", evidence: "SITE-1",
        note: "Add the missing measurement photo.",
      },
      {
        id: "incident", date: "2026-09-16", shift: "Day", location: "site",
        authorId: "foreman", author: "Foreman", status: "submitted", entries: [],
        hours: 0, people: 0, materials: "", issues: "Access stopped", tomorrow: "", evidence: "SITE-2",
        note: "", safetyStatus: "incident", safety: "A minor incident stopped work.",
        scheduleImpact: "blocked", impactReason: "Site access is closed.",
        recoveryPlan: "Confirm safe access before the next shift.", nextUpdateOwnerId: "manager",
        nextUpdateDate: "2026-09-17",
      },
    ];

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse.health).toBe("blocked");
    expect(pulse.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "correct_report", ownerId: "foreman", recordId: "returned" }),
      expect.objectContaining({ kind: "recover_site_update", priority: "critical", ownerId: "manager", recordId: "incident" }),
      expect.objectContaining({ kind: "review_site_incident", priority: "critical", recordId: "incident" }),
      expect.objectContaining({ kind: "review_report", recordId: "incident" }),
    ]));
  });

  it("does not lose commissioning work after installation is independently approved", () => {
    const data = emptyProject();
    data.commissioning = [
      {
        id: "due", title: "Kitchen lighting test", taskId: "install", area: "Kitchen", system: "Lighting",
        ownerId: "electrician", dueDate: "2026-09-15", readings: [], status: "draft", evidence: "", note: "", authorId: "electrician",
      },
      {
        id: "returned", title: "Wardrobe alignment", taskId: "install", area: "Bedroom", system: "Joinery",
        ownerId: "foreman", dueDate: "2026-09-16", readings: [], status: "returned", evidence: "", note: "Add a calibrated reading.", authorId: "foreman",
      },
      {
        id: "submitted", title: "Water pressure test", taskId: "install", area: "Bathroom", system: "Plumbing",
        ownerId: "plumber", dueDate: "2026-09-16", readings: [], status: "submitted", evidence: "TEST-1", note: "", authorId: "plumber",
      },
    ];

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commission_site", priority: "critical", ownerId: "electrician", recordId: "due" }),
      expect.objectContaining({ kind: "correct_commissioning", ownerId: "foreman", recordId: "returned" }),
      expect.objectContaining({ kind: "review_commissioning", ownerId: "plumber", recordId: "submitted" }),
    ]));
  });

  it("surfaces returned client packs and dated handover commitments with their owners", () => {
    const data = emptyProject();
    data.handovers = [
      {
        id: "returned", area: "Bedroom", title: "Bedroom handover", status: "returned",
        documentIds: [], taskIds: [], evidence: "", acceptedBy: "", acceptedAt: "",
        warrantyUntil: "", outstanding: "", published: false,
        returnedNote: "Please correct the cabinet alignment.",
      },
      {
        id: "accepted", area: "Kitchen", title: "Kitchen handover", status: "accepted",
        documentIds: [], taskIds: [], evidence: "", acceptedBy: "Client", acceptedAt: "2026-09-15",
        warrantyUntil: "2027-09-15", outstanding: "", published: true,
        outstandingItems: [{
          id: "training", title: "Appliance training", kind: "training", blocking: false,
          ownerId: "trainer", dueDate: "2026-09-15", status: "open", evidence: "Meeting agreed", resolution: "",
        }],
      },
    ];

    const pulse = projectExecutionPulse(data, "2026-09-16");

    expect(pulse.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "correct_handover", recordId: "returned" }),
      expect.objectContaining({ kind: "recover_handover_commitment", recordId: "accepted", ownerId: "trainer" }),
    ]));
  });
});
