import { describe, expect, it } from "vitest";
import {
  adoptProjectWorkflow,
  builtInProjectWorkflow,
  completeProjectWorkflow,
  parseProjectWorkflowTemplate,
  transitionProjectWorkflow,
} from "./project-workflow";
import {
  applyExecution,
  emptyProject,
  type ExecutionActor,
} from "./execution.domain";
import type { Task } from "./execution.types";

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
});
