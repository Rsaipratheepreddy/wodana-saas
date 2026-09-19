import { describe, expect, it } from "vitest";
import {
  permissionArea,
  permissionLabel,
  workspacePermissionFixture,
} from "./roles-permissions";

describe("workspace permissions catalogue", () => {
  it("covers every product area instead of a placeholder module subset", () => {
    expect(workspacePermissionFixture.length).toBeGreaterThan(80);
    expect(new Set(workspacePermissionFixture.map((permission) => permissionArea(permission.code))))
      .toEqual(new Set(["workspace", "crm", "pre-execution", "projects", "hrms", "platform"]));
  });

  it("uses clear labels for the real permission codes enforced by the services", () => {
    expect(permissionLabel("crm.leads.manage")).toBe("Manage enquiries");
    expect(permissionLabel("commercial.costs.manage")).toBe("Manage internal quotation costs");
    expect(permissionLabel("projects.schedule.override")).toBe("Override project schedule conflicts");
    expect(permissionLabel("hrms.self")).toBe("Use own attendance and leave");
    expect(permissionLabel("ai.suggestions.use")).toBe("Use AI suggestions");
  });
});
