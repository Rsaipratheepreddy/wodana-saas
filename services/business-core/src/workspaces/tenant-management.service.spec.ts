import { describe, expect, it, vi } from "vitest";
import { TenantManagementService } from "./tenant-management.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";

describe("TenantManagementService seat limits", () => {
  it("does not reduce capacity below active members and live invitations", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenant_provisioning_requests")) {
        return {
          rowCount: 1,
          rows: [{ externalTenantId: "tenant-1", workspaceId }],
        };
      }
      if (sql.includes("SELECT status, version FROM workspaces")) {
        return { rowCount: 1, rows: [{ status: "active", version: 3 }] };
      }
      if (sql.includes("FROM workspace_subscriptions WHERE") && sql.includes("FOR UPDATE")) {
        return {
          rowCount: 1,
          rows: [{
            planCode: "pro",
            status: "active",
            billingCycle: "yearly",
            amount: "1000.00",
            currency: "AED",
            seatLimit: 8,
            projectLimit: 50,
            startedAt: new Date(),
            renewsAt: new Date(),
            note: null,
            version: 4,
            updatedAt: new Date(),
          }],
        };
      }
      if (sql.includes('AS "usedSeats"')) {
        return {
          rowCount: 1,
          rows: [{ activeMembers: 4, pendingInvitations: 2, usedSeats: 6 }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const database = {
      query,
      tenantTransaction: vi.fn(async (
        _workspaceId: string,
        _actorId: string,
        work: (client: { query: typeof query }) => Promise<unknown>,
      ) => work({ query })),
    };
    const service = new TenantManagementService(database as never, {} as never);

    await expect(service.updateManagedTenant("tenant-1", {
      expectedWorkspaceVersion: 3,
      expectedSubscriptionVersion: 4,
      seatLimit: 5,
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        message: "Seat limit cannot be lower than current members and pending invitations",
        activeMembers: 4,
        pendingInvitations: 2,
        usedSeats: 6,
      }),
    });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE workspace_subscriptions SET")
    )).toBe(false);
  });
});
