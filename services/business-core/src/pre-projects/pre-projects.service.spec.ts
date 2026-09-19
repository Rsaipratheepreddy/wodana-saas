import { describe, expect, it, vi } from "vitest";
import { PreProjectsService } from "./pre-projects.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import type { RequestActor } from "../auth/actor";
import { ensureJobForSource } from "../jobs/job-identity.store";

vi.mock("../jobs/job-identity.store", () => ({
  ensureJobForSource: vi.fn().mockResolvedValue({ id: "job-1", reference: "J-000001", workspaceId: "workspace-1" }),
}));

const actor = { subject: "test", email: "test@example.com", displayName: "Test", provider: "development" } as RequestActor;
function setup(status = "open", existing = false) {
  const record = { id: "case-1", title: "A case", opportunityId: "opportunity-1" };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FOR UPDATE")) return { rowCount: status === "missing" ? 0 : 1, rows: [{ status }] };
    if (sql.startsWith("SELECT id FROM pre_project_cases")) return { rowCount: existing ? 1 : 0, rows: existing ? [{ id: "case-1" }] : [] };
    if (sql.startsWith("INSERT")) return { rowCount: 1, rows: [{ id: "case-1" }] };
    return { rowCount: 1, rows: [record] };
  });
  const withPermissions = vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" }));
  const events = { record: vi.fn() };
  const service = new PreProjectsService({ withPermissions } as unknown as WorkspaceAccessService, events as unknown as CrmEventsService, {} as CrmOpportunitiesService);
  return { service, query, events, withPermissions, record };
}
describe("pre-project case boundary", () => {
  it.each(["open", "won"])("starts from %s opportunity without changing its CRM status", async (status) => {
    const { service, query, events, withPermissions, record } = setup(status);
    await expect(service.start(actor, "workspace-1", "opportunity-1")).resolves.toEqual(record);
    expect(withPermissions).toHaveBeenCalledWith(actor, "workspace-1", ["pre_projects.view", "pre_projects.create", "crm.opportunities.view"], expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["workspace-1", "opportunity-1"]);
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO pre_project_cases"))?.[0]).toContain("COALESCE(CASE WHEN active_owner_account.id IS NOT NULL THEN active_owner.id END, actor_membership.id)");
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(ensureJobForSource).toHaveBeenCalledWith(
      expect.anything(), "workspace-1", { type: "case", id: "case-1" }, "user-1",
    );
    expect(events.record).toHaveBeenCalledOnce();
  });
  it.each(["lost", "paused", "cancelled"])("does not start a new case for %s opportunity", async (status) => {
    const { service, events, query } = setup(status);
    await expect(service.start(actor, "workspace-1", "opportunity-1")).rejects.toThrow("Reopen the opportunity");
    expect(events.record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("opens an existing case even if the source is subsequently paused", async () => {
    const { service, events, query } = setup("paused", true);
    await expect(service.start(actor, "workspace-1", "opportunity-1")).resolves.toMatchObject({ id: "case-1" });
    expect(events.record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("rejects an unknown or other-workspace source", async () => {
    const { service, events } = setup("missing");
    await expect(service.start(actor, "workspace-1", "opportunity-1")).rejects.toThrow("Opportunity not found");
    expect(events.record).not.toHaveBeenCalled();
  });

  it("copies frozen qualification evidence when a qualified lead starts pre-execution", async () => {
    const evidence = { version: 1, leadId: "lead-1", selection: "global" };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{
        id: "lead-1", status: "qualified", version: 4, party_id: "party-1",
        title: "Design enquiry", summary: "Two rooms",
        qualification_evidence: evidence, qualification_evidence_hash: "a".repeat(64),
      }], rowCount: 1 };
      if (sql.includes("SELECT id, status FROM crm_opportunities")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT pipeline.id")) return { rows: [{ id: "pipeline-1" }], rowCount: 1 };
      if (sql.includes("INSERT INTO pre_project_cases")) return { rows: [{ id: "case-1" }], rowCount: 1 };
      if (sql.includes("FROM pre_project_cases c")) return { rows: [{ id: "case-1", opportunityId: "opportunity-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const withPermissions = vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" }));
    const opportunities = { createQualifiedHandoff: vi.fn().mockResolvedValue({ id: "opportunity-1" }) };
    const service = new PreProjectsService({ withPermissions } as never, { record: vi.fn() } as never, opportunities as never);
    await expect(service.startFromLead(actor, "workspace-1", {
      leadId: "lead-1", version: 4, ownerMembershipId: "owner-1", nextActionAt: "2026-09-20T09:00:00.000Z",
    })).resolves.toMatchObject({ id: "case-1" });
    expect(opportunities.createQualifiedHandoff).toHaveBeenCalledWith(
      expect.anything(), "workspace-1", expect.objectContaining({ leadId: "lead-1", pipelineId: "pipeline-1" }), "user-1",
      expect.objectContaining({
        origin: "pre_project_start", qualificationEvidence: evidence, qualificationEvidenceHash: "a".repeat(64),
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("refuses to create a linked opportunity when frozen qualification evidence is missing", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{
        id: "lead-1", status: "qualified", version: 4, party_id: "party-1", title: "Design enquiry",
      }], rowCount: 1 };
      if (sql.includes("SELECT id, status FROM crm_opportunities")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const withPermissions = vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" }));
    const opportunities = { createQualifiedHandoff: vi.fn() };
    const service = new PreProjectsService({ withPermissions } as never, { record: vi.fn() } as never, opportunities as never);
    await expect(service.startFromLead(actor, "workspace-1", {
      leadId: "lead-1", version: 4, ownerMembershipId: "owner-1", nextActionAt: "2026-09-20T09:00:00.000Z",
    })).rejects.toThrow("Qualification evidence is missing");
    expect(opportunities.createQualifiedHandoff).not.toHaveBeenCalled();
  });

  it("returns the existing case when a qualified-lead handoff is retried", async () => {
    const record = { id: "case-1", opportunityId: "opportunity-1", leadId: "lead-1" };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{ id: "lead-1", status: "qualified", version: 5, party_id: "party-1" }], rowCount: 1 };
      if (sql.includes("SELECT id, status FROM crm_opportunities")) return { rows: [{ id: "opportunity-1", status: "open" }], rowCount: 1 };
      if (sql.startsWith("SELECT id FROM pre_project_cases")) return { rows: [{ id: "case-1" }], rowCount: 1 };
      if (sql.includes("FROM pre_project_cases c")) return { rows: [record], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const withPermissions = vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" }));
    const opportunities = { createQualifiedHandoff: vi.fn() };
    const service = new PreProjectsService({ withPermissions } as never, { record: vi.fn() } as never, opportunities as never);
    await expect(service.startFromLead(actor, "workspace-1", {
      leadId: "lead-1", version: 4, ownerMembershipId: "owner-2", nextActionAt: "2026-09-20T09:00:00.000Z",
    })).resolves.toEqual(record);
    expect(opportunities.createQualifiedHandoff).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO pre_project_cases"))).toBe(false);
  });

  it("requires a lost linked opportunity to be reopened before discovery starts", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{ id: "lead-1", status: "qualified", version: 4, party_id: "party-1" }], rowCount: 1 };
      if (sql.includes("SELECT id, status FROM crm_opportunities")) return { rows: [{ id: "opportunity-1", status: "lost" }], rowCount: 1 };
      if (sql.startsWith("SELECT id FROM pre_project_cases")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const withPermissions = vi.fn(async (_actor, _workspace, _permissions, callback) => callback({ query }, { userId: "user-1" }));
    const opportunities = { createQualifiedHandoff: vi.fn() };
    const service = new PreProjectsService({ withPermissions } as never, { record: vi.fn() } as never, opportunities as never);
    await expect(service.startFromLead(actor, "workspace-1", {
      leadId: "lead-1", version: 4, ownerMembershipId: "owner-2", nextActionAt: "2026-09-20T09:00:00.000Z",
    })).rejects.toThrow("Reopen the linked opportunity");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO pre_project_cases"))).toBe(false);
  });
});
