import { describe, expect, it } from "vitest";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { demoProjectNavigation, demoProjectSection } from "./demo";

describe("demo project navigation", () => {
  it("keeps every project section in the selected demo project", () => {
    const projectModule = workspaceModules.find((item) => item.id === "projects")!;
    const navigation = demoProjectNavigation(projectModule.navigation).flatMap((group) => group.items);
    expect(navigation).toHaveLength(8);
    expect(navigation.map(item => item.label)).toEqual(["Dashboard", "Scope & Design", "BOQ", "Procurement", "Schedules", "Execution", "Handover", "Budget"]);
    expect(navigation.every((item) => demoProjectSection(item.href))).toBe(true);
    expect(navigation.some((item) => item.id === "portfolio" || item.id === "active-projects")).toBe(false);
    expect(projectModule.navigation[0].items[0].href).toBe("/workspace/projects");
  });
  it("rejects unknown and nested sections", () => {
    expect(demoProjectSection("/workspace/projects/demo/procurement")).toBe("procurement");
    expect(demoProjectSection("/workspace/projects/demo/unknown")).toBeNull();
    expect(demoProjectSection("/workspace/projects/demo/overview/other")).toBeNull();
    expect(demoProjectSection("/workspace/projects")).toBeNull();
  });
  it("resolves planning and the renamed site section, including old installation bookmarks", () => {
    expect(demoProjectSection("/workspace/projects/demo/plan-teams")).toBe("plan-teams");
    expect(demoProjectSection("/workspace/projects/demo/site-work")).toBe("site-work");
    expect(demoProjectSection("/workspace/projects/demo/installation")).toBe("site-work");
  });
});
