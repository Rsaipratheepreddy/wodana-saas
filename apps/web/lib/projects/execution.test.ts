import { describe, expect, it } from "vitest";
import { projectActionRoute, type ProjectExecutionAction } from "./execution";

describe("project decision routes", () => {
  it.each(["start_task", "resolve_task", "recover_task", "inspect_task", "resolve_booking", "receive_factory_output"] as const)("opens %s in the shared task detail", kind => {
    const action: ProjectExecutionAction = {id:"action",kind,priority:"high",title:"Next action",detail:"Task needs attention",recordId:"task-1",taskId:"task-1"};
    expect(projectActionRoute("project-1",action)).toBe("/workspace/tasks?projectId=project-1&taskId=task-1");
  });
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
  it.each([
    ["source_material", "shortages"],
    ["review_order", "all"],
    ["confirm_order", "all"],
    ["inspect_receipt", "deliveries"],
    ["recover_delivery", "all"],
    ["close_order", "deliveries"],
  ] as const)("opens %s in its source procurement view", (kind, view) => {
    const action: ProjectExecutionAction = { id: "action", kind, priority: "high", title: "Action", detail: "Source record", recordId: "record-1" };
    expect(projectActionRoute("project-1", action)).toBe(`/workspace/projects/project-1/procurement?view=${view}&record=record-1`);
  });
});
