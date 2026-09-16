import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import {
  addClientWarrantyClaim,
  assertWarrantyCoverage,
  warrantyOwnerId,
} from "./project-warranty";

function project() {
  const data = emptyProject();
  data.roleAssignments = [{ role: "project_manager", memberId: "manager" }];
  data.tasks.push({
    id: "install", parentId: "", package: "Bedroom", title: "Install wardrobe",
    description: "", area: "Bedroom", location: "site", ownerId: "manager",
    assigneeIds: [], resourceId: "", start: "2026-09-01", end: "2026-09-02",
    baselineStart: "2026-09-01", baselineEnd: "2026-09-02", predecessors: [],
    quantity: 1, unit: "nos", weight: 1, approved: 1, status: "completed",
    priority: "normal", inspectionRequired: true, scopeIds: [], drawingId: "",
    readiness: { scope: true, access: true, materials: true }, blocker: "",
  });
  data.handovers.push({
    id: "bedroom", area: "Bedroom", title: "Bedroom acceptance", status: "accepted",
    source: "area", documentIds: [], taskIds: ["install"], evidence: "Signed",
    acceptedBy: "Client", acceptedAt: "2026-09-10T10:00:00.000Z",
    warrantyUntil: "2027-09-10", outstanding: "", published: true,
    packet: {
      id: "packet", version: 1, createdAt: "2026-09-10T10:00:00.000Z",
      preparedBy: "manager", source: "area", scopeLineIds: [],
      tasks: [{ id: "install", title: "Install wardrobe", area: "Bedroom", location: "site", quantity: 1, unit: "nos" }],
      documents: [], commissioningIds: [], dispatchIds: [],
    },
  });
  return data;
}

describe("project warranty coverage", () => {
  it("only accepts claims for the exact accepted handover scope while coverage is active", () => {
    const data = project();
    expect(assertWarrantyCoverage(data, {
      handoverId: "bedroom", area: "Bedroom", taskId: "install", onDate: "2027-09-10",
    }).id).toBe("bedroom");
    expect(() => assertWarrantyCoverage(data, {
      handoverId: "bedroom", area: "Kitchen", onDate: "2026-09-16",
    })).toThrow(/accepted handover area/);
    expect(() => assertWarrantyCoverage(data, {
      handoverId: "bedroom", area: "Bedroom", taskId: "missing", onDate: "2026-09-16",
    })).toThrow(/work item/);
    expect(() => assertWarrantyCoverage(data, {
      handoverId: "bedroom", area: "Bedroom", onDate: "2027-09-11",
    })).toThrow(/coverage has ended/);
  });

  it("creates an auditable client claim once per verified challenge and assigns the project owner", () => {
    const data = project();
    expect(warrantyOwnerId(data)).toBe("manager");
    const first = addClientWarrantyClaim(data, {
      id: "claim", challengeId: "otp", handoverId: "bedroom", title: "Door alignment",
      detail: "The right door catches near the handle.", severity: "minor",
      reportedBy: "Katy", reportedAt: "2026-09-16T10:00:00.000Z", ownerId: "manager",
    });
    const replay = addClientWarrantyClaim(data, {
      id: "another", challengeId: "otp", handoverId: "bedroom", title: "Changed title",
      detail: "Ignored", severity: "critical", reportedBy: "Katy",
      reportedAt: "2026-09-16T10:01:00.000Z", ownerId: "manager",
    });
    expect(first.claim).toMatchObject({
      id: "claim", handoverId: "bedroom", ownerId: "manager",
      reportedVia: "client_portal", warrantyClaimChallengeId: "otp",
    });
    expect(replay).toMatchObject({ replayed: true, claim: { id: "claim" } });
    expect(data.snags).toHaveLength(1);
  });
});
