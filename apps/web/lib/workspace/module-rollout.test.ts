import { describe, expect, it } from "vitest";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { moduleForWorkspacePath, scopePeopleNavigation, scopeSupplyNavigation, visibleWorkspaceModules } from "./module-rollout";

describe("effective workspace module navigation", () => {
  it("shows only the selected organization's granted modules", () => {
    expect(visibleWorkspaceModules(workspaceModules, "example", ["workspace", "crm"])
      .map((module) => module.id)).toEqual(["workspace", "crm"]);
    expect(visibleWorkspaceModules(workspaceModules, "example", ["workspace", "hrms"])
      .map((module) => module.id)).toEqual(["workspace", "hrms"]);
  });

  it("maps direct links to the same module grants", () => {
    expect(moduleForWorkspacePath("/workspace/crm/leads")).toBe("crm");
    expect(moduleForWorkspacePath("/workspace/pre-projects/cases/1")).toBe("pre-project");
    expect(moduleForWorkspacePath("/workspace/projects/1")).toBe("projects");
    expect(moduleForWorkspacePath("/workspace/hrms")).toBe("hrms");
    expect(moduleForWorkspacePath("/workspace/settings/security")).toBe("workspace");
  });

  it("shows People only when the signed-in member can read or act on it", () => {
    const items = (permissions: string[]) => scopePeopleNavigation(workspaceModules, permissions, ["role_viewer"])
      .find((module) => module.id === "workspace")?.navigation.flatMap((section) => section.items) ?? [];
    expect(items(["module.roles.read"]).some((item) => item.id === "members")).toBe(false);
    expect(items(["module.members.read"]).some((item) => item.id === "members")).toBe(true);
    expect(items(["module.members.write"]).some((item) => item.id === "members")).toBe(true);
    expect(scopePeopleNavigation(workspaceModules, [], ["owner"])[0].navigation.flatMap((section) => section.items)
      .some((item) => item.id === "members")).toBe(true);
  });
  it('shows purchasing to project viewers and inventory only to buyers or managers', () => {
    const items = (permissions: string[]) => scopeSupplyNavigation(workspaceModules, permissions, ['role_viewer'])
      .find(module => module.id === 'projects')?.navigation.flatMap(section => section.items).map(item => item.id) ?? [];
    expect(items(['projects.view'])).toContain('global-purchasing');
    expect(items(['projects.view'])).not.toContain('global-inventory');
    expect(items(['projects.view','projects.buy'])).toContain('global-inventory');
    expect(items(['projects.buy'])).toContain('global-inventory');
    expect(items(['projects.manage'])).toContain('global-inventory');
    expect(items([])).not.toContain('global-purchasing');
  });
});
