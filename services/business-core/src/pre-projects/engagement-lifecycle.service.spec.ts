import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import { canonicalHash } from "../crm/shared/crm-types";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { PreProjectsService } from "./pre-projects.service";

const actor = { subject: "test", email: "test@example.com", displayName: "Test", provider: "development" } as RequestActor;
const requestId = "123e4567-e89b-42d3-a456-426614174000";

function serviceWith(query: ReturnType<typeof vi.fn>, managesCases = true) {
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" })),
    hasPermission: vi.fn(async () => managesCases),
  };
  const events = { record: vi.fn() };
  const service = new PreProjectsService(access as unknown as WorkspaceAccessService, events as unknown as CrmEventsService, {} as CrmOpportunitiesService);
  return { service, access, events };
}

const active = {
  id: "case-1", status: "active", phase: "design", version: 4,
  activatedAt: "2026-09-14T10:00:00.000Z", holdReason: null, heldAt: null, heldBy: null,
  cancellationReason: null, cancelledAt: null, cancelledBy: null, opportunityStatus: "open",
};

describe("engagement lifecycle service", () => {
  it("records a retry-safe hold transition with optimistic concurrency", async () => {
    const response = { ...active, status: "on_hold", version: 5, isOnHold: true };
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT engagement.id")) return { rowCount: 1, rows: [active] };
      if (sql.startsWith("INSERT INTO pre_project_lifecycle_commands")) return { rowCount: 1, rows: [{ request_id: requestId }] };
      if (sql.startsWith("UPDATE pre_project_cases")) return { rowCount: 1, rows: [{ id: "case-1" }] };
      if (sql.startsWith("SELECT c.id")) return { rowCount: 1, rows: [response] };
      if (sql.startsWith("UPDATE pre_project_lifecycle_commands")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { service, access, events } = serviceWith(query);
    await expect(service.transition(actor, "workspace-1", "case-1", { requestId, version: 4, action: "hold", reason: "Waiting for the client" })).resolves.toEqual(response);
    expect(access.withPermissions).toHaveBeenCalledWith(actor, "workspace-1", ["pre_projects.view", "pre_projects.manage_lifecycle"], expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = $3, phase = $4"), expect.arrayContaining(["workspace-1", "case-1", "on_hold", "design"]));
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "pre_project.engagement_held.v1", correlationId: requestId }));
  });

  it("returns the stored response when the same command is retried", async () => {
    const response = { id: "case-1", status: "on_hold", version: 5 };
    const input = { requestId, version: 4, action: "hold" as const, reason: "Waiting for the client" };
    const requestHash = canonicalHash({ caseId: "case-1", ...input });
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 1, rows: [{ caseId: "case-1", action: "hold", requestHash, responseBody: response }] };
      throw new Error(`A replay must not execute more SQL: ${sql}`);
    });
    const { service, events } = serviceWith(query);
    await expect(service.transition(actor, "workspace-1", "case-1", input)).resolves.toEqual(response);
    expect(query).toHaveBeenCalledOnce();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("does not let a request ID be reused with different intent", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 1, rows: [{ caseId: "case-1", action: "hold", requestHash: "a".repeat(64), responseBody: { id: "case-1" } }] };
      throw new Error(`A conflicting replay must not execute more SQL: ${sql}`);
    });
    const { service, events } = serviceWith(query);
    await expect(service.transition(actor, "workspace-1", "case-1", { requestId, version: 4, action: "hold", reason: "A different reason" })).rejects.toThrow("request ID was already used");
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects stale profile updates before changing the case", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT engagement.id")) return { rowCount: 1, rows: [active] };
      if (sql.startsWith("INSERT INTO pre_project_lifecycle_commands")) return { rowCount: 1, rows: [{ request_id: requestId }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { service, events } = serviceWith(query);
    await expect(service.updateProfile(actor, "workspace-1", "case-1", { requestId, version: 3, riskLevel: "high" })).rejects.toThrow("changed");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE pre_project_cases"))).toBe(false);
    expect(events.record).not.toHaveBeenCalled();
  });

  it("requires the CRM opportunity to be viable before reopening", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT engagement.id")) return { rowCount: 1, rows: [{ ...active, status: "cancelled", cancellationReason: "Stopped", cancelledAt: "2026-09-14T12:00:00.000Z", cancelledBy: "user-2", opportunityStatus: "lost" }] };
      if (sql.startsWith("INSERT INTO pre_project_lifecycle_commands")) return { rowCount: 1, rows: [{ request_id: requestId }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { service, events } = serviceWith(query);
    await expect(service.transition(actor, "workspace-1", "case-1", { requestId, version: 4, action: "reopen", reason: "Client returned" })).rejects.toThrow("Reopen the linked CRM opportunity");
    expect(events.record).not.toHaveBeenCalled();
  });

  it("lets the case's own owner change its details, and nobody else without the case permission", async () => {
    const stale = (owner: boolean) => vi.fn(async (sql: string) => {
      if (sql.includes("JOIN workspace_memberships membership ON membership.workspace_id = engagement.workspace_id")) return { rowCount: owner ? 1 : 0, rows: owner ? [{}] : [] };
      if (sql.startsWith("SELECT case_id")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT engagement.id")) return { rowCount: 1, rows: [active] };
      if (sql.startsWith("INSERT INTO pre_project_lifecycle_commands")) return { rowCount: 1, rows: [{ request_id: requestId }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    // The owner gets as far as the version check; someone else is refused before anything is read.
    await expect(serviceWith(stale(true), false).service.updateProfile(actor, "workspace-1", "case-1", { requestId, version: 3, riskLevel: "high" })).rejects.toThrow("changed");
    const outsider = stale(false);
    await expect(serviceWith(outsider, false).service.updateProfile(actor, "workspace-1", "case-1", { requestId, version: 4, riskLevel: "high" })).rejects.toThrow("case owner");
    expect(outsider.mock.calls.some(([sql]) => String(sql).startsWith("SELECT engagement.id"))).toBe(false);
  });

  it("rejects an owner from outside the active organisation membership", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT case_id")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT engagement.id")) return { rowCount: 1, rows: [active] };
      if (sql.startsWith("INSERT INTO pre_project_lifecycle_commands")) return { rowCount: 1, rows: [{ request_id: requestId }] };
      if (sql.startsWith("SELECT 1 FROM workspace_memberships")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { service, events } = serviceWith(query);
    await expect(service.updateProfile(actor, "workspace-1", "case-1", { requestId, version: 4, ownerMembershipId: "223e4567-e89b-42d3-a456-426614174000" })).rejects.toThrow("active member from this organisation");
    expect(events.record).not.toHaveBeenCalled();
  });
});
