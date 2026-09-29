import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

const assignedAt = new Date("2026-09-17T06:00:00.000Z");
const dueLead = {
  id: "lead", party_id: "party", owner_membership_id: "owner", queue_id: "queue",
  status: "new", version: 3, source: "form", channel: "instagram", service_type: null,
  business_unit_id: null, preferred_locale: null, party_owner_membership_id: null,
};

function processor({ responded = false, engaged = false, attempts = 0, cap = 2 }: { responded?: boolean; engaged?: boolean; attempts?: number; cap?: number } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT lead.id FROM crm_leads lead")) return { rows: [{ id: "lead" }], rowCount: 1 };
    if (sql.includes("FROM workspace_sales_settings")) return { rows: [{ takeoverCap: cap, unownedEscalationMinutes: 15, clientReviewMinutes: 30, duplicateWindowDays: 90, salesAdminMembershipId: null, version: 1 }], rowCount: 1 };
    if (sql.includes("AS attempts FROM crm_assignment_history")) return { rows: [{ attempts }], rowCount: 1 };
    if (sql.includes("FROM crm_assignment_history history") && sql.includes('AS "assignedAt"')) {
      return { rows: [{ assignedAt, userId: "owner-user" }], rowCount: 1 };
    }
    if (sql.includes("FROM crm_sla_instances") && sql.includes("responded_at >=")) {
      return { rows: responded ? [{ present: 1 }] : [], rowCount: responded ? 1 : 0 };
    }
    if (sql.includes("FROM audit_events event")) {
      return { rows: engaged ? [{ present: 1 }] : [], rowCount: engaged ? 1 : 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  const database = { tenantTransaction: vi.fn(async (_workspace: string, _actor: string, work: (client: unknown) => Promise<unknown>) => work({ query })) };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CrmLeadsService(database as never, {} as never, events as never);
  service["requireLead"] = vi.fn().mockResolvedValue(dueLead);
  service["selectAssignment"] = vi.fn().mockResolvedValue({
    ownerMembershipId: "alternate", queueId: "queue", ruleId: null,
    explanation: { reason: "unanswered_takeover" },
  });
  service["applyAssignment"] = vi.fn().mockResolvedValue({
    assignment: { ownerMembershipId: "alternate", queueId: "queue" },
  });
  return { service, query, events };
}

describe("unanswered lead ownership handoff", () => {
  it("reassigns only after checking the current owner's evidence since this assignment", async () => {
    const { service, query } = processor();
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({
      reassigned: [{ leadId: "lead", ownerMembershipId: "alternate", queueId: "queue" }], engaged: [], kept: [], escalated: [],
    });
    expect(service["selectAssignment"]).toHaveBeenCalledWith(expect.anything(), "workspace", dueLead, true,
      { queueId: "queue", excludedOwnerId: "owner" });
    expect(service["applyAssignment"]).toHaveBeenCalledWith(expect.anything(), "workspace", dueLead,
      expect.objectContaining({ ownerMembershipId: "alternate" }), null, "automatic", expect.stringContaining("No call or note"), true);
    const evidence = query.mock.calls.find(([sql]) => sql.includes("FROM audit_events event"));
    expect(evidence?.[1]).toEqual(["workspace", "owner-user", assignedAt, "lead"]);
    expect(evidence?.[0]).toContain("crm.activity.completed.v1");
    expect(evidence?.[0]).toContain("crm.lead.requirement_note_saved.v1");
  });

  it("keeps the owner when their note was logged after assignment without claiming an SLA response", async () => {
    const { service, query, events } = processor({ engaged: true });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"], kept: [], escalated: [] });
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET ownership_due_at=NULL"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.takeover_cancelled.v1" }));
    expect(query.mock.calls.some(([sql]) => sql.includes("SET responded_at"))).toBe(false);
  });

  it("keeps the owner when a verified first response was recorded", async () => {
    const { service, query } = processor({ responded: true });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"], kept: [], escalated: [] });
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM audit_events event"))).toBe(false);
  });

  it("keeps the owner, turns it urgent and tells the owner and the admin when nobody else can take it (S-1)", async () => {
    const { service, query, events } = processor();
    service["selectAssignment"] = vi.fn().mockResolvedValue({
      ownerMembershipId: null, queueId: "queue", ruleId: null,
      explanation: { reason: "no_eligible_alternate" },
    });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: [], kept: ["lead"], escalated: [] });
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    const kept = query.mock.calls.find(([sql]) => sql.includes("SET ownership_due_at=$3, priority='urgent'"));
    expect(kept?.[1]?.slice(0, 2)).toEqual(["workspace", "lead"]);
    // First of two allowed attempts: not yet escalated.
    expect(kept?.[1]?.[3]).toBe(false);
    const history = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_assignment_history"));
    expect(history?.[1]?.[2]).toBe("owner");
    expect(history?.[1]?.[3]).toBe("queue");
    expect(history?.[1]?.[4]).toMatchObject({ reason: "no_eligible_alternate", kept: true });
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.takeover_kept.v1" }));
    // The owner is never stripped.
    expect(query.mock.calls.some(([sql]) => /owner_membership_id\s*=\s*NULL/i.test(sql))).toBe(false);
  });

  it("escalates to a manager instead of rotating once the attempt cap is reached (S-1)", async () => {
    const { service, query, events } = processor({ attempts: 2, cap: 2 });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: [], kept: [], escalated: ["lead"] });
    expect(service["selectAssignment"]).not.toHaveBeenCalled();
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET ownership_due_at=NULL, priority='urgent', escalated_at=now()"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.lead.takeover_escalated.v1", after: expect.objectContaining({ attempts: 2 }),
    }));
  });
});
