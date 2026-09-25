import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

const assignedAt = new Date("2026-09-17T06:00:00.000Z");
const dueLead = {
  id: "lead", party_id: "party", owner_membership_id: "owner", queue_id: "queue",
  status: "new", version: 3, source: "form", channel: "instagram", service_type: null,
  business_unit_id: null, preferred_locale: null, party_owner_membership_id: null,
};

function processor({ responded = false, engaged = false }: { responded?: boolean; engaged?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT lead.id FROM crm_leads lead")) return { rows: [{ id: "lead" }], rowCount: 1 };
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
      reassigned: [{ leadId: "lead", ownerMembershipId: "alternate", queueId: "queue" }], engaged: [],
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
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"] });
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET ownership_due_at=NULL"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.takeover_cancelled.v1" }));
    expect(query.mock.calls.some(([sql]) => sql.includes("SET responded_at"))).toBe(false);
  });

  it("keeps the owner when a verified first response was recorded", async () => {
    const { service, query } = processor({ responded: true });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"] });
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM audit_events event"))).toBe(false);
  });

  it("excludes the previous owner and returns the lead to its queue when no alternate is eligible", async () => {
    const { service } = processor();
    service["selectAssignment"] = vi.fn().mockResolvedValue({
      ownerMembershipId: null, queueId: "queue", ruleId: null,
      explanation: { reason: "no_eligible_alternate" },
    });
    service["applyAssignment"] = vi.fn().mockResolvedValue({ assignment: { ownerMembershipId: null, queueId: "queue" } });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({
      reassigned: [{ leadId: "lead", ownerMembershipId: null, queueId: "queue" }], engaged: [],
    });
    expect(service["applyAssignment"]).toHaveBeenCalledWith(expect.anything(), "workspace", dueLead,
      expect.objectContaining({ ownerMembershipId: null, queueId: "queue" }), null, "automatic", expect.any(String), false);
  });
});
