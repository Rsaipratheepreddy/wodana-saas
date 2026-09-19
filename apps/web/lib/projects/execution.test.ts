import { describe, expect, it } from "vitest";
import { projectActionRoute, type ProjectExecutionAction } from "./execution";

describe("project decision routes", () => {
  it.each([
    ["resolve_design", "documents"],
    ["plan_factory_dispatch", "production"],
    ["review_handover", "handover"],
    ["resolve_warranty_claim", "snagging"],
    ["recover_site_update", "daily-progress"],
    ["resolve_project_hold", "overview"],
    ["prepare_package", "plan-teams"],
  ] as const)("routes %s to %s", (kind, section) => {
    const action: ProjectExecutionAction = {
      id: "action", kind, priority: "high", title: "Next action", detail: "A record needs attention", recordId: "record-1",
    };
    expect(projectActionRoute("project-1", action)).toBe(`/workspace/projects/project-1/${section}?record=record-1`);
  });
});
