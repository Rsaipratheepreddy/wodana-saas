import { describe, expect, it, vi } from "vitest";
import { CrmTodayService } from "./crm-today.service";

describe("CRM priority queue context", () => {
  it.each([true, false])("keeps tenant-scoped client context and profile access=%s", async (canViewParty) => {
    let queueSql = "";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspace_memberships")) return { rows: [{ id: "membership" }] };
      if (sql.includes("SELECT default_timezone")) return { rows: [{ default_timezone: "Asia/Dubai" }] };
      if (sql.includes("WITH months AS")) return { rows: [{ monthKey: "2026-09", monthLabel: "Sep", source: "referral", count: 2 }] };
      if (sql.includes("LIMIT 80")) return { rows: [{ id: "lead", status: "new", partyName: "Client name" }] };
      if (sql.includes("WITH items AS")) {
        queueSql = sql;
        return { rows: [{ kind: "overdue_activity", recordId: "activity", partyName: "Client name", resolvedPartyId: "party", queueTotal: 201 }] };
      }
      return { rows: [{ activeLeads: 2, pendingFollowUps: 3, wonThisMonth: 1 }] };
    });
    const access = {
      withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })),
      hasPermission: vi.fn(async (_client, _workspace, _user, permission) => permission === "crm.parties.view" ? canViewParty : true),
    };
    const result = await new CrmTodayService(access as never).get({} as never, "workspace");
    expect(access.withPermission).toHaveBeenCalledWith({}, "workspace", "crm.leads.view", expect.any(Function));
    expect(queueSql).toContain('COALESCE(queue."partyId", lead.party_id, opportunity.party_id)');
    expect(queueSql).toContain("lead.workspace_id = $1");
    expect(queueSql).toContain("opportunity.workspace_id = $1");
    expect(queueSql).toContain("party.workspace_id = $1");
    expect(queueSql).toContain("LIMIT 200");
    expect(queueSql).toContain("'upcoming_activity'");
    expect(queueSql).toContain("activity.owner_membership_id IS NULL");
    expect(result.total).toBe(201);
    expect(result.items[0]).toMatchObject({ partyName: "Client name", canViewParty });
    expect(result.counts).toEqual({ overdue_activity: 1 });
    expect(result.monthlyLeadSources).toEqual([{ monthKey: "2026-09", monthLabel: "Sep", source: "referral", count: 2 }]);
    expect(result.leadPipeline).toEqual([{ id: "lead", status: "new", partyName: "Client name" }]);
  });
});
