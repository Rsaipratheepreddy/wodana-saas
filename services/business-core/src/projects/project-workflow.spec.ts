import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adoptProjectWorkflow,
  builtInProjectWorkflow,
  completeProjectWorkflow,
  parseProjectWorkflowTemplate,
  projectWorkflowGateResults,
  transitionProjectWorkflow,
} from "./project-workflow";
import {
  applyExecution,
  emptyProject,
  type ExecutionActor,
} from "./execution.domain";
import type { Task } from "./execution.types";

const palmWorkflow = () =>
  parseProjectWorkflowTemplate(
    JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../../../../docs/fixtures/palm-project-workflow.json",
        ),
        "utf8",
      ),
    ),
  );

function input() {
  const fallback = builtInProjectWorkflow();
  return {
    version: 0,
    code: "fitout_delivery",
    name: "Fit-out delivery",
    description: "Tenant-owned labels around the shared execution engine.",
    isDefault: true,
    stages: fallback.stages,
  };
}

describe("project workflow templates", () => {
  it("does not advance a project stage before commercial execution release", () => {
    const data = emptyProject();
    const actor: ExecutionActor = {
      id: "member-1",
      name: "Project Manager",
      manage: true,
      review: true,
      report: true,
      buy: true,
      memberIds: ["member-1"],
      resourceIds: [],
      now: "2026-09-24T08:00:00.000Z",
      released: false,
    };
    expect(() => applyExecution(data, "workflow_transition", { toStageKey: "delivery" }, actor)).toThrow(/release checklist/);
  });

  it("keeps each post-release Palm stage distinct within the supported limit", () => {
    const stages = palmWorkflow().stages;
    expect(stages.map((stage) => stage.visibleName)).toEqual([
      "New Project",
      "Concept & moodboard",
      "Space planning",
      "Renders",
      "Awaiting Client Approval",
      "Technical Drawings",
      "Material Selection",
      "Costing / BOQ",
      "Procurement",
      "Ready for Manufacturing",
      "Manufacturing",
      "Site works",
      "Installation",
      "Snagging",
      "Complete / Handover",
    ]);
    expect(stages).toHaveLength(15);
    expect(stages.filter((stage) => stage.releaseStart).map((stage) => stage.key)).toEqual(["procurement"]);
    const maximumStages = [
      stages[0],
      ...Array.from({ length: 16 }, (_, index) => ({
        ...stages[1],
        key: `active_${index}`,
      })),
      stages.at(-1)!,
    ];
    expect(parseProjectWorkflowTemplate({ ...input(), stages: maximumStages }).stages).toHaveLength(18);
    expect(() => parseProjectWorkflowTemplate({
      ...input(),
      stages: Array.from({ length: 19 }, (_, index) => ({
        ...input().stages[0],
        key: `stage_${index}`,
      })),
    })).toThrow("between 2 and 18 workflow stages");
  });

  it("starts a commercially released Palm project at procurement without replaying approved design", () => {
    const template = {
      ...palmWorkflow(),
      id: "workflow-palm-1",
      status: "active" as const,
      source: "workspace" as const,
      updatedAt: null,
    };
    const ordinary = adoptProjectWorkflow(template, "2026-09-24T08:00:00.000Z", "user-1", "Owner");
    expect(ordinary.currentStageKey).toBe("project_setup");
    const released = adoptProjectWorkflow(template, "2026-09-24T08:00:00.000Z", "user-1", "Owner", { commercialRelease: true });
    expect(released.currentStageKey).toBe("procurement");
    expect(released.history).toEqual([
      expect.objectContaining({ action: "adopted", fromStageKey: null, toStageKey: "procurement" }),
    ]);
    const data = emptyProject();
    data.workflow = released;
    expect(() => completeProjectWorkflow(data, "", { id: "user-1", name: "Owner", now: "2026-09-24T09:00:00.000Z" }))
      .toThrow("Move through the remaining project stages");
    const duplicate = palmWorkflow();
    duplicate.stages[0].releaseStart = true;
    expect(() => parseProjectWorkflowTemplate(duplicate)).toThrow("one active stage");
  });

  it("blocks manufacturing readiness until production packages are actually ready", () => {
    const template = {
      ...palmWorkflow(),
      id: "workflow-palm-1",
      status: "active" as const,
      source: "workspace" as const,
      updatedAt: null,
    };
    const data = emptyProject();
    data.phase = "active";
    data.workflow = adoptProjectWorkflow(template, "2026-09-24T08:00:00.000Z", "user-1", "Owner", { commercialRelease: true });
    data.roleAssignments = [{ role: "procurement_production", memberId: "member-1" }];
    data.workPackages = [{
      id: "package-1",
      scopeLineIds: ["line-1"],
      title: "Joinery",
      area: "Living room",
      deliveryRoute: "mixed",
      status: "planning",
      ownerId: "",
      plannedStart: "",
      plannedEnd: "",
      blocker: "",
      createdAt: "2026-09-24T08:00:00.000Z",
      updatedAt: "2026-09-24T08:00:00.000Z",
    }];
    const actor = { id: "user-1", name: "Owner", now: "2026-09-24T09:00:00.000Z" };
    expect(projectWorkflowGateResults(data, template.stages.find((stage) => stage.key === "procurement")!)).toEqual([
      { key: "production_plan_ready", passed: false },
    ]);
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    data.workPackages[0].status = "ready";
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    data.workPackages[0].deliveryRoute = "office";
    data.workPackages[0].status = "completed";
    expect(projectWorkflowGateResults(data, template.stages.find((stage) => stage.key === "procurement")!)).toEqual([
      { key: "production_plan_ready", passed: false },
    ]);
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    data.workPackages[0].deliveryRoute = "mixed";
    data.workPackages[0].status = "completed";
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    const scopeLine = { id: "line-1", title: "Joinery", room: "Living room", material: "Oak", quantity: 1, unit: "nos" };
    data.scope = { quoteId: "quote-1", quoteNumber: 1, currency: "AED", value: 100, lines: [scopeLine] };
    data.workPackages[0].deliveryQuantities = {
      version: 1, status: "confirmed",
      rows: [{ id: "delivery-1", title: "Joinery", quantity: 1, unit: "nos", basis: "",
        sources: [{ scopeLineId: "line-1", quantity: 1 }] }],
      updatedAt: actor.now, updatedBy: actor.id, confirmedAt: actor.now, confirmedBy: actor.id,
      sourceSnapshot: [scopeLine],
    };
    data.workPackages[0].deliveryQuantities.status = "draft";
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    data.workPackages[0].deliveryQuantities.status = "confirmed";
    data.scope.lines[0] = { ...scopeLine, quantity: 2 };
    expect(() => transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor)).toThrow("production_plan_ready");
    data.scope.lines[0] = scopeLine;
    transitionProjectWorkflow(data, "ready_for_manufacturing", "", actor);
    expect(data.workflow.currentStageKey).toBe("ready_for_manufacturing");
  });

  it("returns a fresh neutral default whose delivery work can overlap", () => {
    const first = builtInProjectWorkflow();
    const second = builtInProjectWorkflow();
    expect(first.source).toBe("built_in");
    expect(first.version).toBe(0);
    expect(first.stages.map((stage) => stage.visibleName)).toEqual([
      "Planning",
      "Delivery",
      "Handover",
      "Completed",
    ]);
    first.stages[0].exitGates.push("finance_closed");
    expect(second.stages[0].exitGates).not.toContain("finance_closed");
  });

  it("normalizes a tenant template without inventing executable rules", () => {
    const parsed = parseProjectWorkflowTemplate({
      ...input(),
      name: "  Fit-out delivery  ",
      stages: [
        {
          ...input().stages[0],
          visibleName: "  Mobilisation  ",
        },
        ...input().stages.slice(1),
      ],
    });
    expect(parsed.name).toBe("Fit-out delivery");
    expect(parsed.stages[0].visibleName).toBe("Mobilisation");
    expect(parsed.stages[0].exitGates).toEqual([
      "project_manager_assigned",
      "tasks_planned",
    ]);
  });

  it("rejects duplicate keys and unsupported gates", () => {
    const duplicate = input();
    duplicate.stages = duplicate.stages.map((stage) => ({
      ...stage,
      key: "same",
    }));
    expect(() => parseProjectWorkflowTemplate(duplicate)).toThrow(
      "unique key",
    );

    const unsupported = input();
    unsupported.stages = unsupported.stages.map((stage, index) => ({
      ...stage,
      exitGates: index === 0 ? (["run_custom_code"] as never[]) : stage.exitGates,
    }));
    expect(() => parseProjectWorkflowTemplate(unsupported)).toThrow(
      "gate is invalid",
    );
  });

  it("rejects backward phases and a non-terminal Completed stage", () => {
    const backward = input();
    backward.stages = backward.stages.map((stage) => ({ ...stage }));
    backward.stages[1].phase = "handover";
    backward.stages[2].phase = "active";
    expect(() => parseProjectWorkflowTemplate(backward)).toThrow(
      "must move forward",
    );

    const earlyComplete = input();
    earlyComplete.stages = earlyComplete.stages.map((stage) => ({ ...stage }));
    earlyComplete.stages[1].phase = "completed";
    expect(() => parseProjectWorkflowTemplate(earlyComplete)).toThrow(
      "Only the final",
    );
  });

  it("freezes a template on the project and advances through factual gates", () => {
    const template = builtInProjectWorkflow();
    const data = emptyProject();
    data.phase = "active";
    data.workflow = adoptProjectWorkflow(
      template,
      "2026-09-15T08:00:00.000Z",
      "user-1",
      "Project Manager",
    );
    template.stages[0].visibleName = "Changed after adoption";
    expect(data.workflow.template.stages[0].visibleName).toBe("Planning");
    expect(() =>
      transitionProjectWorkflow(data, "delivery", "", {
        id: "user-1",
        name: "Project Manager",
        now: "2026-09-15T09:00:00.000Z",
      }),
    ).toThrow("Assign the project_manager role");

    data.roleAssignments = [
      { role: "project_manager", memberId: "member-1" },
    ];
    expect(() =>
      transitionProjectWorkflow(data, "delivery", "", {
        id: "user-1",
        name: "Project Manager",
        now: "2026-09-15T09:00:00.000Z",
      }),
    ).toThrow("tasks_planned");
    data.tasks = [
      {
        id: "task-1",
        ownerId: "member-1",
        start: "2026-09-16",
        end: "2026-09-17",
        status: "planned",
      } as Task,
    ];
    transitionProjectWorkflow(data, "delivery", "Plan approved", {
      id: "user-1",
      name: "Project Manager",
      now: "2026-09-15T09:00:00.000Z",
    });
    expect(data.workflow.currentStageKey).toBe("delivery");
    expect(data.workflow.history.at(-1)).toMatchObject({
      action: "advanced",
      fromStageKey: "planning",
      toStageKey: "delivery",
      gateResults: [
        { key: "project_manager_assigned", passed: true },
        { key: "tasks_planned", passed: true },
      ],
    });
  });

  it("blocks stage skipping, operational bypass and forward movement while held", () => {
    const data = emptyProject();
    data.phase = "active";
    data.workflow = adoptProjectWorkflow(
      builtInProjectWorkflow(),
      "2026-09-15T08:00:00.000Z",
      "user-1",
      "Project Manager",
    );
    data.roleAssignments = [
      { role: "project_manager", memberId: "member-1" },
    ];
    data.tasks = [
      {
        id: "task-1",
        ownerId: "member-1",
        start: "2026-09-16",
        end: "2026-09-17",
        status: "planned",
      } as Task,
    ];
    const actor = {
      id: "user-1",
      name: "Project Manager",
      now: "2026-09-15T09:00:00.000Z",
    };
    expect(() =>
      transitionProjectWorkflow(data, "handover", "", actor),
    ).toThrow("one project stage");
    data.controls!.onHold = true;
    data.controls!.holdReason = "Awaiting access";
    expect(() =>
      transitionProjectWorkflow(data, "delivery", "", actor),
    ).toThrow("Release the project hold");
    data.controls!.onHold = false;
    transitionProjectWorkflow(data, "delivery", "", actor);
    data.tasks[0].status = "completed";
    expect(() =>
      transitionProjectWorkflow(data, "handover", "", actor),
    ).toThrow("operational controls");
  });

  it("uses the final configured gates when completing the workflow", () => {
    const data = emptyProject();
    data.phase = "handover";
    data.workflow = adoptProjectWorkflow(
      builtInProjectWorkflow(),
      "2026-09-15T08:00:00.000Z",
      "user-1",
      "Project Manager",
    );
    data.workflow.currentStageKey = "handover";
    data.roleAssignments = [
      { role: "project_manager", memberId: "member-1" },
    ];
    data.handovers = [
      {
        id: "handover-1",
        status: "accepted",
      } as never,
    ];
    data.financeClosed = true;
    completeProjectWorkflow(data, "Closeout approved", {
      id: "user-2",
      name: "Reviewer",
      now: "2026-09-15T10:00:00.000Z",
    });
    expect(data.workflow.currentStageKey).toBe("completed");
    expect(data.workflow.history.at(-1)).toMatchObject({
      action: "completed",
      gateResults: [
        { key: "all_handovers_accepted", passed: true },
        { key: "finance_closed", passed: true },
      ],
    });
  });

  it("keeps project completion and reopening synchronized with stage history", () => {
    const data = emptyProject();
    data.phase = "handover";
    data.workflow = adoptProjectWorkflow(
      builtInProjectWorkflow(),
      "2026-09-15T08:00:00.000Z",
      "user-1",
      "Project Manager",
    );
    data.workflow.currentStageKey = "handover";
    data.roleAssignments = [
      { role: "project_manager", memberId: "member-1" },
    ];
    data.financeClosed = true;
    data.handovers = [{ id: "handover-1", status: "accepted" } as never];
    const reviewer: ExecutionActor = {
      id: "member-2",
      userId: "user-2",
      name: "Reviewer",
      manage: true,
      review: true,
      report: true,
      buy: true,
      memberIds: ["member-2"],
      resourceIds: [],
      now: "2026-09-15T10:00:00.000Z",
      released: true,
    };
    applyExecution(data, "complete_project", { note: "Closeout approved" }, reviewer);
    expect(data.phase).toBe("completed");
    expect(data.workflow.currentStageKey).toBe("completed");
    applyExecution(
      data,
      "reopen_project",
      { note: "Warranty correction needs delivery-team action" },
      { ...reviewer, now: "2026-09-16T10:00:00.000Z" },
    );
    expect(data.phase).toBe("active");
    expect(data.workflow.currentStageKey).toBe("handover");
    expect(data.workflow.history.at(-1)).toMatchObject({
      action: "reopened",
      byId: "user-2",
      note: "Warranty correction needs delivery-team action",
    });
  });

  it("does not make the existing closeout command depend on a new UI transition", () => {
    const data = emptyProject();
    data.phase = "handover";
    data.workflow = adoptProjectWorkflow(
      builtInProjectWorkflow(),
      "2026-09-15T08:00:00.000Z",
      "user-1",
      "Project Manager",
    );
    data.tasks = [{ id: "task-1", status: "completed" } as Task];
    data.handovers = [{ id: "handover-1", status: "accepted" } as never];
    data.financeClosed = true;
    const reviewer: ExecutionActor = {
      id: "member-2",
      userId: "user-2",
      name: "Reviewer",
      manage: true,
      review: true,
      report: true,
      buy: true,
      memberIds: ["member-2"],
      resourceIds: [],
      now: "2026-09-15T10:00:00.000Z",
      released: true,
    };
    applyExecution(data, "complete_project", { note: "Closeout approved" }, reviewer);
    expect(data.workflow.currentStageKey).toBe("completed");
    expect(data.workflow.history.at(-1)).toMatchObject({
      action: "completed",
      fromStageKey: "planning",
      gateResults: expect.arrayContaining([
        { key: "tasks_planned", passed: false },
        { key: "all_tasks_closed", passed: true },
        { key: "all_handovers_accepted", passed: true },
        { key: "finance_closed", passed: true },
      ]),
    });
  });

  it("keeps On Hold outside the Palm stage model and preserves all delivery history", () => {
    const template = {
      ...palmWorkflow(),
      id: "workflow-palm-1",
      status: "active" as const,
      source: "workspace" as const,
      updatedAt: "2026-09-15T08:00:00.000Z",
    };
    const data = emptyProject();
    data.phase = "active";
    data.workflow = adoptProjectWorkflow(
      template,
      "2026-09-15T08:00:00.000Z",
      "manager",
      "Project Manager",
    );
    data.workflow.currentStageKey = "site_works";
    data.workPackages = [{
      id: "package-1",
      scopeLineIds: ["line-1"],
      title: "Wardrobe",
      area: "Primary bedroom",
      deliveryRoute: "site",
      status: "ready",
      ownerId: "manager",
      plannedStart: "2026-09-15",
      plannedEnd: "2026-09-20",
      blocker: "",
      createdAt: "2026-09-15T08:00:00.000Z",
      updatedAt: "2026-09-15T08:00:00.000Z",
    }];
    data.tasks = [{ id: "task-1", status: "planned" } as Task];
    const beforePackages = structuredClone(data.workPackages);
    const beforeTaskIdentity = data.tasks.map(({ id, status }) => ({ id, status }));
    const actor: ExecutionActor = {
      id: "manager",
      name: "Project Manager",
      manage: true,
      review: true,
      report: true,
      buy: true,
      memberIds: ["manager"],
      resourceIds: [],
      now: "2026-09-15T09:00:00.000Z",
      released: true,
    };

    applyExecution(data, "project_controls", {
      controls: {
        ...data.controls,
        reference: "PRJ-PLM-001",
        onHold: true,
        holdReason: "Site access is temporarily unavailable.",
        holdOwnerId: "manager",
      },
    }, actor);

    expect(data.workflow.currentStageKey).toBe("site_works");
    expect(data.workflow.template.stages.some((stage) => stage.key === "on_hold")).toBe(false);
    expect(data.workPackages).toEqual(beforePackages);
    expect(data.tasks.map(({ id, status }) => ({ id, status }))).toEqual(beforeTaskIdentity);
    expect(data.holdHistory).toEqual([
      expect.objectContaining({
        action: "placed",
        reason: "Site access is temporarily unavailable.",
        ownerId: "manager",
      }),
    ]);
    expect(() =>
      transitionProjectWorkflow(data, "installation", "", {
        id: "manager",
        name: "Project Manager",
        now: "2026-09-15T10:00:00.000Z",
      }),
    ).toThrow(/Release the project hold/);
  });
});
