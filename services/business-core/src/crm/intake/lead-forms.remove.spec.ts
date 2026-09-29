import { describe, expect, it, vi } from "vitest";
import { LeadFormsService } from "./lead-forms.service";

const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

function serviceWith(row: { status: string; published: unknown; version: number } | undefined) {
  const query = vi.fn(async (sql: string) => sql.startsWith("SELECT status") ? { rowCount: row ? 1 : 0, rows: row ? [row] : [] } : { rowCount: 1, rows: [] });
  const access = { withPermission: vi.fn(async (_actor: unknown, _workspace: string, _permission: string, work: (client: unknown, user: { userId: string }) => unknown) => work({ query }, { userId: "user-1" })) };
  const events = { record: vi.fn() };
  return { service: new LeadFormsService({} as never, access as never, events as never, {} as never), query, events };
}

describe("deleting a lead form", () => {
  it("removes a draft that was never published, and says so in the audit", async () => {
    const { service, query, events } = serviceWith({ status: "draft", published: null, version: 3 });
    await expect(service.remove(actor, "ws", "form-1", 3)).resolves.toEqual({ id: "form-1", deleted: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM crm_lead_forms"), ["ws", "form-1"]);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead_form.deleted.v1" }));
  });

  it("keeps published or once-published forms, and refuses a stale version", async () => {
    await expect(serviceWith({ status: "paused", published: { title: "x" }, version: 2 }).service.remove(actor, "ws", "form-1", 2)).rejects.toThrow("never published");
    await expect(serviceWith({ status: "draft", published: { title: "x" }, version: 2 }).service.remove(actor, "ws", "form-1", 2)).rejects.toThrow("never published");
    await expect(serviceWith({ status: "draft", published: null, version: 2 }).service.remove(actor, "ws", "form-1", 1)).rejects.toThrow("changed");
  });
});
