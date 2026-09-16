import { describe, expect, it } from "vitest";
import {
  applyExecution,
  emptyProject,
  type ExecutionActor,
} from "./execution.domain";
import type { ProjectData, Task } from "./execution.types";

const manager: ExecutionActor = {
  id: "manager",
  name: "Project manager",
  manage: true,
  review: true,
  report: true,
  buy: true,
  memberIds: ["manager", "designer", "finance"],
  resourceIds: [],
  siteIds: ["site-1"],
  now: "2026-09-16T10:00:00.000Z",
  released: true,
};

function releasedProject() {
  const data = emptyProject();
  data.phase = "active";
  data.scope = {
    quoteId: "quote-1",
    quoteHash: "quote-hash",
    quoteNumber: 24,
    currency: "AED",
    value: 125000,
    lines: [],
  };
  data.initiation = {
    status: "not_started",
    commercial: {
      quoteId: "quote-1",
      quoteHash: "quote-hash",
      quoteNumber: 24,
      dealFileId: "deal-1",
      dealFileReference: "DF-2026-024",
      agreementReference: "AGR-2026-024",
      currency: "AED",
      value: 125000,
      paymentMilestones: [
        {
          id: "payment-1",
          title: "Advance",
          amount: 62500,
          dueDate: "2026-09-20",
          trigger: "On agreement",
          requiredForRelease: true,
        },
      ],
    },
    baseline: null,
    confirmedAt: "",
    confirmedById: "",
    confirmedByName: "",
    revisions: [],
  };
  return data;
}

function initiation(overrides: Record<string, unknown> = {}) {
  return {
    projectOwnerId: "manager",
    teamMemberIds: ["manager", "designer"],
    roleAssignments: [
      { role: "project_manager", memberId: "manager" },
      { role: "senior_designer", memberId: "designer" },
    ],
    siteReadiness: "confirmed",
    siteIds: ["site-1"],
    objective: "Deliver the approved home fit-out without losing design intent.",
    clientPromise: "A coordinated handover by the agreed date.",
    clientContactName: "Katy",
    clientContactPhone: "+971500000000",
    clientContactEmail: "katy@example.com",
    accessNotes: "Site access is confirmed with building management.",
    operationalStart: "2026-09-21",
    targetCompletion: "2026-10-20",
    handoverDate: "2026-10-22",
    ...overrides,
  };
}

function command(
  data: ProjectData,
  action: string,
  body: Record<string, unknown>,
  actor = manager,
) {
  const copy = structuredClone(data);
  applyExecution(copy, action, body, actor);
  return copy;
}

describe("project initiation", () => {
  it("confirms an operational charter without altering frozen commercial facts", () => {
    const data = command(releasedProject(), "project_initiation", {
      initiation: initiation(),
    });

    expect(data.initiation).toMatchObject({
      status: "confirmed",
      baseline: {
        projectOwnerId: "manager",
        teamMemberIds: ["manager", "designer"],
        siteIds: ["site-1"],
        targetCompletion: "2026-10-20",
      },
      commercial: {
        quoteId: "quote-1",
        quoteHash: "quote-hash",
        paymentMilestones: [{ id: "payment-1", amount: 62500 }],
      },
    });
    expect(data.controls).toMatchObject({
      promise: "A coordinated handover by the agreed date.",
      targetCompletion: "2026-10-20",
      handoverDate: "2026-10-22",
    });
    expect(data.roleAssignments).toEqual([
      { role: "project_manager", memberId: "manager" },
      { role: "senior_designer", memberId: "designer" },
    ]);
  });

  it("rejects unsafe ownership, dates and site references", () => {
    const data = releasedProject();
    expect(() =>
      command(data, "project_initiation", {
        initiation: initiation({ projectOwnerId: "designer" }),
      }),
    ).toThrow(/project manager/);
    expect(() =>
      command(data, "project_initiation", {
        initiation: initiation({ targetCompletion: "2026-09-20" }),
      }),
    ).toThrow(/on or after/);
    expect(() =>
      command(data, "project_initiation", {
        initiation: initiation({ siteIds: ["other-site"] }),
      }),
    ).toThrow(/active sites/);
    expect(() =>
      command(data, "project_initiation", {
        initiation: initiation({ siteReadiness: "confirmed", siteIds: [] }),
      }),
    ).toThrow(/at least one active project site/);
  });

  it("keeps the original charter in history when a pre-planning rebaseline is justified", () => {
    let data = command(releasedProject(), "project_initiation", {
      initiation: initiation(),
    });
    data = command(data, "revise_project_initiation", {
      note: "Client agreed a revised handover window before detailed planning.",
      initiation: initiation({
        clientPromise: "A revised, coordinated handover.",
        targetCompletion: "2026-10-24",
        handoverDate: "2026-10-27",
      }),
    });

    expect(data.initiation?.revisions).toEqual([
      expect.objectContaining({
        reason: "Client agreed a revised handover window before detailed planning.",
        baseline: expect.objectContaining({ targetCompletion: "2026-10-20" }),
      }),
    ]);
    expect(data.initiation?.baseline?.targetCompletion).toBe("2026-10-24");
    expect(data.controls?.targetCompletion).toBe("2026-10-24");
  });

  it("requires a controlled change before delivery planning has started", () => {
    let data = command(releasedProject(), "project_initiation", {
      initiation: initiation(),
    });
    expect(() =>
      command(data, "project_initiation", { initiation: initiation() }),
    ).toThrow(/controlled rebaseline/);
    data.tasks.push({ id: "planned-task" } as Task);
    expect(() =>
      command(data, "revise_project_initiation", {
        note: "Too late",
        initiation: initiation(),
      }),
    ).toThrow(/Detailed delivery planning has started/);
  });

  it("does not let a later role edit silently replace the confirmed project owner", () => {
    const data = command(releasedProject(), "project_initiation", {
      initiation: initiation(),
    });
    expect(() =>
      command(data, "project_roles", {
        assignments: [
          { role: "project_manager", memberId: "designer" },
        ],
      }),
    ).toThrow(/controlled initiation rebaseline/);
  });
});
