import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { TenantManagementService } from "./tenant-management.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";

describe("TenantManagementService billing compatibility", () => {
  it("returns tenant-safe account billing truth and an explicit past-due access policy", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspaces WHERE")) return { rowCount: 1, rows: [{ id: workspaceId, name: "Example", status: "active", defaultCurrency: "AED" }] };
      if (sql.includes("JOIN customer_accounts account")) return { rowCount: 1, rows: [{ id: "account-1", displayName: "Example Group" }] };
      if (sql.includes("workspace_seat_capacity")) return { rowCount: 1, rows: [{ seatLimit: 5, activeMembers: 2,
        invitedMembers: 0, pendingInvitations: 1, reservedSeats: 3, availableSeats: 2 }] };
      if (sql.includes("FROM pre_project_cases")) return { rowCount: 1, rows: [{ projects: 4 }] };
      if (sql.includes("FROM effective_account_contracts")) return { rowCount: 1, rows: [{ version: 2,
        status: "contracted", planCode: "pro", planVersion: 1, currency: "AED", billingCycle: "yearly",
        recurringAmount: "12000.00", seatLimit: 10, projectLimit: 50, trialEndsAt: null,
        termStartsAt: new Date("2026-09-01T00:00:00Z"), renewsAt: new Date("2027-09-01T00:00:00Z"),
        endsAt: null, taxValidationState: "unverified", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveUntil: null }] };
      if (sql.includes("FROM effective_organization_billing_allocations")) return { rowCount: 1, rows: [{ version: 2,
        status: "active", allocatedAmount: "6000.00", seatLimit: 5, projectLimit: 25,
        effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveUntil: null }] };
      if (sql.includes("FROM account_collection_state_versions")) return { rowCount: 1, rows: [{ version: 3,
        status: "past_due", overdueAmount: "6000.00", currency: "AED", effectiveAt: new Date("2026-09-18T00:00:00Z"),
        nextReviewAt: new Date("2026-09-20T00:00:00Z"), reason: "private finance reason" }] };
      if (sql.includes("FROM account_usage_snapshots")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM account_billing_documents")) return { rowCount: 1, rows: [{ id: "invoice-1",
        documentType: "invoice", documentNumber: "INV-1", status: "past_due", currency: "AED",
        totalAmount: "6000.00", balanceAmount: "6000.00", issuedAt: new Date(), dueAt: new Date(),
        settledAt: null, taxValidationState: "unverified", createdAt: new Date(), updatedAt: new Date() }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { asMember: vi.fn(async (_actor: unknown, _workspaceId: string,
      work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })) };
    const service = new TenantManagementService({} as never, access as never);

    const result = await service.getWorkspaceBilling({ provider: "local", subject: "member", email: "member@example.test", displayName: "Member" }, workspaceId);

    expect(result.accessPolicy).toMatchObject({ state: "past_due", effect: "unchanged", affectedModules: [] });
    expect(result.usage).toMatchObject({ reservedSeats: 3, projects: 4 });
    expect(result.documents).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private finance reason");
    expect(JSON.stringify(result)).not.toContain("metadata");
    expect(JSON.stringify(result)).not.toContain("externalReference");
  });

  it("rejects legacy per-workspace billing mutations now that the account contract is authoritative", async () => {
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
    })).rejects.toThrow("Billing is account-controlled");
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE workspace_subscriptions SET")
    )).toBe(false);
  });

  it("rejects legacy workspace access changes so lifecycle decisions remain authoritative", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenant_provisioning_requests")) return {
        rowCount: 1, rows: [{ externalTenantId: "tenant-1", workspaceId }],
      };
      if (sql.includes("SELECT status, version FROM workspaces")) return {
        rowCount: 1, rows: [{ status: "active", version: 3 }],
      };
      if (sql.includes("FROM workspace_subscriptions WHERE") && sql.includes("FOR UPDATE")) return {
        rowCount: 1, rows: [{ version: 4, status: "trial" }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const database = {
      query,
      tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string,
        work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })),
    };
    const service = new TenantManagementService(database as never, {} as never);

    await expect(service.updateManagedTenant("tenant-1", {
      expectedWorkspaceVersion: 3, expectedSubscriptionVersion: 4, workspaceStatus: "suspended",
    }, "operator-1")).rejects.toThrow("versioned lifecycle decisions");
    await expect(service.updateManagedTenant("tenant-1", {
      expectedWorkspaceVersion: 3, expectedSubscriptionVersion: 4,
      workspaceStatus: "suspended", reason: "Reviewed customer access pause",
    })).rejects.toThrow("versioned lifecycle decisions");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE workspaces SET status"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO audit_events"))).toBe(false);
  });

  it("reports reserved seats without exposing private billing notes or invitation tokens", async () => {
    const database = { tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string,
      work: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => work({ query: async (sql: string) => ({
        rows: sql.includes("effective_workspace_entitlements") ? [{
          planCode: "starter", planVersion: 2, status: "active", modules: ["workspace", "crm"], version: 3,
          updatedAt: new Date("2026-09-17T10:00:00.000Z"),
        }] : [],
      }) })) };
    const service = new TenantManagementService(database as never, {} as never);
    vi.spyOn(service, "getManagedTenant").mockResolvedValue({
      externalTenantId: "tenant-1",
      account: {
        id: "account-1", displayName: "Example", status: "active", organizationLimit: 2,
        organizationCount: 1, version: 1, isDefaultOrganization: true,
      },
      workspace: {
        id: workspaceId, name: "Example", slug: "example", status: "active",
        defaultCurrency: "AED", defaultLocale: "en-AE", defaultTimezone: "Asia/Dubai",
        version: 3, createdAt: new Date(), updatedAt: new Date(),
      },
      owner: { name: "Owner", email: "owner@example.test" },
      onboarding: { status: "in_progress", currentStep: "team", completedSteps: ["company"] },
      ownerInvitation: { status: "pending", expiresAt: new Date(), acceptedAt: null, invitationToken: "must-not-leak" },
      integrations: [],
      subscription: {
        planCode: "pro", status: "trial", billingCycle: "monthly", amount: "100.00",
        currency: "AED", seatLimit: 5, projectLimit: 25, startedAt: new Date(), renewsAt: null,
        note: "private contract note", version: 4, updatedAt: new Date(),
      },
      usage: { members: 2, pendingInvitations: 1, reservedSeats: 3, projects: 0 },
    } as never);

    const status = await service.getTenantStatus("tenant-1");

    expect(status.seats).toEqual({
      limit: 5, activeMembers: 2, invitedMembers: 0,
      pendingInvitations: 1, reserved: 3, available: 2,
    });
    expect(status.domain).toEqual({ platformSlug: "example", customDomainStatus: "not_configured" });
    expect(status.commercialEntitlements).toMatchObject({
      status: "active", planCode: "starter", planVersion: 2, modules: ["workspace", "crm"], version: 3,
    });
    expect(status.ownerInvitation?.deliveryStatus).toBe("untracked");
    expect(JSON.stringify(status)).not.toContain("private contract note");
    expect(JSON.stringify(status)).not.toContain("must-not-leak");
  });

  it("does not invent a status for an unknown tenant", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const service = new TenantManagementService(database as never, {} as never);

    await expect(service.getTenantStatus("missing-tenant")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("labels missing subscription capacity as unknown rather than zero", async () => {
    const database = { tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string,
      work: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => work({ query: async () => ({ rows: [] }) })) };
    const service = new TenantManagementService(database as never, {} as never);
    vi.spyOn(service, "getManagedTenant").mockResolvedValue({
      account: null,
      workspace: { id: workspaceId, name: "Example", slug: "example", status: "active", version: 1, updatedAt: new Date() },
      owner: null,
      onboarding: { status: "not_started", currentStep: "company", completedSteps: [] },
      ownerInvitation: null,
      subscription: null,
      usage: { members: 0, pendingInvitations: 0, reservedSeats: 0, projects: 0 },
    } as never);

    const status = await service.getTenantStatus("tenant-1");

    expect(status.seats).toEqual({
      limit: null, activeMembers: 0, invitedMembers: 0,
      pendingInvitations: 0, reserved: 0, available: null,
    });
    expect(status.plan).toBeNull();
    expect(status.ownerInvitation).toBeNull();
  });
});
