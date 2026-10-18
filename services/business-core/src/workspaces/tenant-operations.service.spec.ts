import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TenantOperationsService } from "./tenant-operations.service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const requester = "00000000-0000-4000-8000-000000000002";
const approver = "00000000-0000-4000-8000-000000000003";
const operationId = "00000000-0000-4000-8000-000000000005";
const accountId = "00000000-0000-4000-8000-000000000007";
const accountEntitlementId = "00000000-0000-4000-8000-000000000008";

function databaseFor(query: ReturnType<typeof vi.fn>) {
  return {
    query: vi.fn(async () => ({ rowCount: 1, rows: [{ externalTenantId: "tenant-test", workspaceId }] })),
    tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })),
  };
}

describe("TenantOperationsService operation approvals", () => {
  it("prevents the requester from approving a configuration clone", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenant_operation_runs") && sql.includes("FOR UPDATE")) return {
        rowCount: 1,
        rows: [{
          id: operationId, operationType: "clone", status: "planned", phase: "dry_run",
          targetWorkspaceId: "00000000-0000-4000-8000-000000000006", requestedBy: requester,
          rollbackOf: null, plan: { executable: true }, version: 1,
        }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new TenantOperationsService(databaseFor(query) as never);

    await expect(service.decideOperation("tenant-test", operationId, {
      expectedVersion: 1,
      decision: "approve",
      reason: "Approve after reviewing the dry run",
    }, requester)).rejects.toThrow("A second operator must approve");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE tenant_operation_runs"))).toBe(false);
  });

  it("does not expose erasure execution before the retention-safe worker exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM tenant_operation_runs") && sql.includes("FOR UPDATE")) return {
        rowCount: 1,
        rows: [{
          id: operationId, operationType: "erasure", status: "planned", phase: "dry_run",
          targetWorkspaceId: null, requestedBy: requester, rollbackOf: null,
          plan: { executable: true }, version: 1,
        }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new TenantOperationsService(databaseFor(query) as never);

    await expect(service.decideOperation("tenant-test", operationId, {
      expectedVersion: 1,
      decision: "approve",
      reason: "Approve after reviewing the dry run",
    }, approver)).rejects.toThrow("retention-safe data-rights worker");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE tenant_operation_runs"))).toBe(false);
  });
});

describe("TenantOperationsService commercial entitlements", () => {
  const input = {
    expectedVersion: 0,
    planCode: "starter",
    planVersion: 1,
    status: "active" as const,
    modules: ["crm"],
    limits: {},
    reason: "Enable the contracted CRM module for local acceptance",
  };

  it("rejects an organization allocation that does not match its account contract", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspaces")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("effective_workspace_entitlements")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM workspace_entitlement_sets")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM organization_entitlement_allocations")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM customer_account_organizations")) return {
        rowCount: 1,
        rows: [{ accountId, contractStatus: "contracted", planCode: "enterprise", planVersion: 2,
          seatLimit: 10, projectLimit: 50, configuration: { modules: ["workspace", "crm"] } }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new TenantOperationsService(databaseFor(query) as never);

    await expect(service.updateEntitlements("tenant-test", input, approver)).rejects.toThrow("does not match");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO account_entitlement_versions"))).toBe(false);
  });

  it("writes immutable account and organization versions before refreshing the compatibility projection", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspaces")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("effective_workspace_entitlements")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM workspace_entitlement_sets")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM organization_entitlement_allocations") && sql.includes("ORDER BY version")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM customer_account_organizations")) return {
        rowCount: 1,
        rows: [{ accountId, contractStatus: "contracted", planCode: "starter", planVersion: 1,
          seatLimit: 10, projectLimit: 50, configuration: { modules: ["workspace", "crm"] } }],
      };
      if (sql.includes("max(version)") && sql.includes("account_entitlement_versions")) return { rowCount: 1, rows: [{ version: 1 }] };
      if (sql.includes("INSERT INTO account_entitlement_versions")) return { rowCount: 1, rows: [{ id: accountEntitlementId }] };
      if (sql.includes("INSERT INTO organization_entitlement_allocations")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO workspace_entitlement_sets")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO audit_events") || sql.includes("INSERT INTO platform_operator_audit")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new TenantOperationsService(databaseFor(query) as never);

    await expect(service.updateEntitlements("tenant-test", input, approver)).resolves.toMatchObject({
      version: 1,
      modules: ["workspace", "crm"],
      soldModules: ["workspace", "crm"],
      customOverride: false,
    });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("INSERT INTO account_entitlement_versions")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("INSERT INTO organization_entitlement_allocations")));
    expect(statements.findIndex((sql) => sql.includes("INSERT INTO organization_entitlement_allocations")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("INSERT INTO workspace_entitlement_sets")));
  });

  it("versions unfinished feature flags independently from customer allocations", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM platform_capability_flags")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO platform_capability_flags")) return {
        rowCount: 1,
        rows: [{ code: "crm.ai_reply", module: "crm", releaseState: "internal_preview", version: 1 }],
      };
      if (sql.includes("INSERT INTO platform_operator_audit")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const database = {
      actorTransaction: vi.fn(async (_actorId: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })),
    };
    const service = new TenantOperationsService(database as never);

    await expect(service.updatePlatformCapability({
      code: "crm.ai_reply", module: "crm", releaseState: "internal_preview", expectedVersion: 0,
      reason: "Keep this unfinished feature limited to internal review",
    }, approver)).resolves.toMatchObject({ code: "crm.ai_reply", version: 1 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("organization_entitlement_allocations"))).toBe(false);
  });
});

describe("TenantOperationsService account security policy", () => {
  const policy = { requireMfaForAdmins: true, requireMfaForAllUsers: false, recoveryCodeCount: 10, enrollmentGraceDays: 7 };
  const queryFor = () => vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM customer_account_organizations linked")) return { rowCount: 1, rows: [{ accountId, version: 3, securityPolicy: policy, organizations: 1 }] };
    if (sql.trim().startsWith("UPDATE customer_accounts")) return { rowCount: 1, rows: [{ accountId, version: 4, securityPolicy: JSON.parse(String(values?.[1])) }] };
    if (sql.includes("INSERT INTO audit_events") || sql.includes("INSERT INTO platform_operator_audit")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const reason = "Test members sign in without an authenticator.";

  it("turns the authenticator off for administrators, version-checked and audited for the platform when no operator is named", async () => {
    const query = queryFor();
    const service = new TenantOperationsService(databaseFor(query) as never);
    await expect(service.updateSecurityPolicy("tenant-test", { expectedVersion: 3, requireMfaForAdmins: false, reason }, null))
      .resolves.toMatchObject({ version: 4, changed: true, securityPolicy: { ...policy, requireMfaForAdmins: false } });
    const audit = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO platform_operator_audit"));
    expect(audit?.[1]).toEqual([null, "tenant.security_policy_updated", "tenant-test", expect.any(String), expect.any(String)]);
  });

  it("changes nothing for the same values and refuses a stale version", async () => {
    const query = queryFor();
    const service = new TenantOperationsService(databaseFor(query) as never);
    await expect(service.updateSecurityPolicy("tenant-test", { expectedVersion: 3, requireMfaForAdmins: true, reason }, null)).resolves.toMatchObject({ changed: false, version: 3 });
    await expect(service.updateSecurityPolicy("tenant-test", { expectedVersion: 2, requireMfaForAdmins: false, reason }, null)).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => String(sql).trim().startsWith("UPDATE customer_accounts"))).toBe(false);
  });
});
