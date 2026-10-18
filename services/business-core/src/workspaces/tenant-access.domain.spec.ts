import { describe, expect, it } from "vitest";
import { effectiveTenantPermissionCodes, explainTenantMemberAccess, tenantSeatSummary } from "./tenant-access.domain";

describe("tenant access explanation", () => {
  it("combines direct and team roles, then intersects permissions with entitlements", () => {
    const result = explainTenantMemberAccess({
      status: "active",
      directRoles: [{ id: "role-1", code: "sales", name: "Sales" }],
      inheritedRoles: [{
        teamId: "team-1", teamName: "Sales team", roleId: "role-2",
        roleCode: "project-viewer", roleName: "Project viewer",
      }],
      grantedPermissions: ["crm.leads.view", "projects.report", "workspace.settings.view"],
      entitlements: { status: "active", modules: ["workspace", "crm"] },
    });

    expect(result.effectivePermissions).toEqual(["crm.leads.view", "workspace.settings.view"]);
    expect(result.effectiveModules).toEqual(["crm", "workspace"]);
    expect(result.inheritedRoles[0]).toMatchObject({ teamName: "Sales team", roleCode: "project-viewer" });
    expect(result.recordScope.kind).toBe("organization");
  });

  it("removes all effective access from an inactive membership", () => {
    const result = explainTenantMemberAccess({
      status: "suspended", directRoles: [], inheritedRoles: [],
      grantedPermissions: ["crm.leads.view"], entitlements: null,
    });
    expect(result.effectivePermissions).toEqual([]);
    expect(result.reasons[0]).toContain("suspended");
  });

  it("exposes only effective grants for the current signed-in member", () => {
    expect(effectiveTenantPermissionCodes({
      status: "active",
      grantedPermissions: ["module.roles.edit", "module.roles.edit", "projects.buy"],
      entitlements: { status: "active", modules: ["workspace"] },
    })).toEqual(["module.roles.edit"]);
    expect(effectiveTenantPermissionCodes({
      status: "active",
      grantedPermissions: ["module.roles.edit"],
      entitlements: { status: "suspended", modules: ["workspace"] },
    })).toEqual(["module.roles.edit"]);
  });

  it("explains authoritative used, reserved, and available seats", () => {
    expect(tenantSeatSummary({
      seatLimit: 8, activeMembers: 4, invitedMembers: 1,
      pendingInvitations: 2, reservedSeats: 7, availableSeats: 1,
    })).toMatchObject({ limit: 8, used: 5, reserved: 7, available: 1 });
  });
});
