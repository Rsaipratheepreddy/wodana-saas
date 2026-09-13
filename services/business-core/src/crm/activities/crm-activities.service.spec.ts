import { describe, expect, it, vi } from "vitest";
import { CrmActivitiesService } from "./crm-activities.service";

describe("Follow-up client context", () => {
  it("returns client and lead names when a reminder is opened directly from Calendar", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('party.display_name AS "partyName"')) return { rows: [{ partyName: "Maya Nair", leadTitle: "Clinic design", ownerName: "Manager" }] };
      if (sql.includes("FROM crm_appointments")) return { rows: [] };
      return { rows: [{ id: "reminder", title: "Call client", status: "pending", version: 3 }], rowCount: 1 };
    });
    const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query })) };
    const result = await new CrmActivitiesService(access as never, {} as never).get({} as never, "workspace", "reminder");
    expect(result).toMatchObject({ id: "reminder", partyName: "Maya Nair", leadTitle: "Clinic design", ownerName: "Manager", appointment: null });
    const context = query.mock.calls.find(([sql]) => sql.includes('party.display_name AS "partyName"'))![0];
    expect(context).toContain("COALESCE(activity.party_id, lead.party_id, opportunity.party_id)");
    for (const name of ["lead", "opportunity", "party", "enquiry", "member"]) expect(context).toContain(`${name}.workspace_id = activity.workspace_id`);
    expect(context).toContain("activity.workspace_id = $1 AND activity.id = $2");
  });

  it("resolves the client through a lead or opportunity without filtering unscheduled activities", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [{ id: "reminder", dueAt: null, partyName: "Maya Nair" }] }));
    const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query })) };
    const result = await new CrmActivitiesService(access as never, {} as never).list({} as never, "workspace", { limit: 100 } as never);
    expect(result.data).toEqual([{ id: "reminder", dueAt: null, partyName: "Maya Nair" }]);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("COALESCE(activity.party_id, lead.party_id, opportunity.party_id)");
    expect(sql).toContain("party.workspace_id = activity.workspace_id");
    expect(sql).not.toContain("due_at IS NOT NULL");
  });
});
