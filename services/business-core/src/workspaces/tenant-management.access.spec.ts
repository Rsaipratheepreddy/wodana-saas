import { describe, expect, it, vi } from "vitest";
import { TenantManagementService } from "./tenant-management.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";

describe("TenantManagementService access explanation", () => {
  it("reports direct and team-inherited access, module limits, and seat reservations without secrets", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenant_provisioning_requests")) {
        return { rowCount: 1, rows: [{ externalTenantId: "palm", workspaceId }] };
      }
      if (sql.includes("SELECT id,name,slug FROM workspaces")) {
        return { rowCount: 1, rows: [{ id: workspaceId, name: "Palm Living", slug: "plm" }] };
      }
      if (sql.includes("FROM effective_workspace_entitlements")) {
        return { rowCount: 1, rows: [{
          status: "active", modules: ["workspace", "crm"],
          planCode: "uat", planVersion: 1, version: 2,
        }] };
      }
      if (sql.includes("FROM workspace_seat_capacity")) {
        return { rowCount: 1, rows: [{
          seatLimit: 8, activeMembers: 2, invitedMembers: 0,
          pendingInvitations: 1, reservedSeats: 3, availableSeats: 5,
        }] };
      }
      if (sql.includes("FROM workspace_memberships membership")) {
        return { rowCount: 1, rows: [{
          id: "membership-1", userId: "user-1", email: "operations@palmlivingae.com",
          displayName: "Operations", status: "active", joinedAt: new Date("2026-09-17T08:00:00Z"),
          directRoles: [{ id: "role-1", code: "operations", name: "Operations" }],
          inheritedRoles: [{
            teamId: "team-1", teamName: "Sales", roleId: "role-2",
            roleCode: "sales-manager", roleName: "Sales manager",
          }],
          grantedPermissions: ["crm.leads.view", "projects.report"],
        }] };
      }
      if (sql.includes("FROM workspace_invitations invitation")) {
        return { rowCount: 1, rows: [{
          id: "invite-1", email: "cece@palmlivingae.com", status: "pending",
          expiresAt: new Date("2026-09-25T08:00:00Z"), createdAt: new Date("2026-09-18T08:00:00Z"),
          reservesSeat: true, directRoles: [], teams: [{ id: "team-1", name: "Sales", roleCodes: ["sales-manager"] }],
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const database = {
      query,
      tenantTransaction: vi.fn(async (
        _workspace: string, _actor: string,
        work: (client: { query: typeof query }) => Promise<unknown>,
      ) => work({ query })),
    };
    const service = new TenantManagementService(database as never, {} as never);

    const result = await service.getTenantAccess("palm");

    expect(result.seats).toMatchObject({ limit: 8, used: 2, reserved: 3, available: 5 });
    expect(result.members[0].access).toMatchObject({
      effectivePermissions: ["crm.leads.view"],
      effectiveModules: ["crm"],
      recordScope: { kind: "organization" },
    });
    expect(result.members[0].access.inheritedRoles[0]).toMatchObject({ teamName: "Sales" });
    expect(result.invitations[0]).toMatchObject({ reservesSeat: true, teams: [{ name: "Sales" }] });
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
