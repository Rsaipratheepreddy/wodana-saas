import { describe, expect, it } from "vitest";
import {
  builtInProjectWorkflow,
  parseProjectWorkflowTemplate,
} from "./project-workflow";

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
});
