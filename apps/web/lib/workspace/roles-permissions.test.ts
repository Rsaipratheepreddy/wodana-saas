import { describe, expect, it } from "vitest";
import {
  permissionArea,
  permissionLabel,
  roleMutationCapabilities,
  workspacePermissionFixture,
} from "./roles-permissions";

describe("workspace permissions catalogue", () => {
  it("covers every product area instead of a placeholder module subset", () => {
    expect(workspacePermissionFixture.length).toBeGreaterThan(80);
    expect(new Set(workspacePermissionFixture.map((permission) => permissionArea(permission.code))))
      .toEqual(new Set(["company", "sales", "planning", "commercial", "projects", "supply", "clients", "people", "platform"]));
    expect(workspacePermissionFixture.map((permission) => permission.code)).toEqual(expect.arrayContaining([
      "commercial.estimate",
      "commercial.finance.verify",
      "commercial.deal.approve",
    ]));
  });

  it("uses clear labels for the real permission codes enforced by the services", () => {
    expect(permissionLabel("crm.leads.manage")).toBe("Manage enquiries");
    expect(permissionLabel("commercial.costs.manage")).toBe("Manage internal quotation costs");
    expect(permissionLabel("commercial.estimate")).toBe("Approve QS quotation estimate");
    expect(permissionLabel("commercial.finance.verify")).toBe("Verify payment evidence");
    expect(permissionLabel("commercial.deal.approve")).toBe("Approve Deal File (Owner/Admin for Palm Living)");
    expect(permissionLabel("projects.schedule.override")).toBe("Override project schedule conflicts");
    expect(permissionLabel("hrms.self")).toBe("Use own attendance and leave");
    expect(permissionLabel("ai.suggestions.use")).toBe("Use AI suggestions");
  });

  it("separates pricing, buying and delivery permissions", () => {
    expect(permissionArea("commercial.costs.view")).toBe("commercial");
    expect(permissionArea("projects.buy")).toBe("supply");
    expect(permissionArea("projects.report")).toBe("projects");
    expect(permissionArea("catalog.manage")).toBe("supply");
    expect(permissionArea("portal.manage")).toBe("clients");
  });

  it("does not turn one role-edit grant into create or delete access", () => {
    expect(roleMutationCapabilities(["module.roles.read", "module.roles.edit"], ["studio_lead"]))
      .toEqual({ canCreate: false, canEdit: true, canDelete: false });
    expect(roleMutationCapabilities([], ["owner"]))
      .toEqual({ canCreate: false, canEdit: false, canDelete: false });
    expect(roleMutationCapabilities(["workspace.roles.manage"], ["studio_lead"]))
      .toEqual({ canCreate: true, canEdit: true, canDelete: true });
  });
});
