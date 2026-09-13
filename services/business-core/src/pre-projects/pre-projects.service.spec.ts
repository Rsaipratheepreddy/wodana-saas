import { describe, expect, it, vi } from "vitest";
import { PreProjectsService } from "./pre-projects.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import type { RequestActor } from "../auth/actor";

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
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
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
});
