import { describe, expect, it } from "vitest";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { moduleForWorkspacePath, visibleWorkspaceModules } from "./module-rollout";

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
});
