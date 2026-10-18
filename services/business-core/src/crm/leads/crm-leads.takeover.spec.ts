import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

const assignedAt = new Date("2026-09-17T06:00:00.000Z");
const dueLead = {
  id: "lead", party_id: "party", owner_membership_id: "owner", queue_id: "queue",
  status: "new", version: 3, source: "form", channel: "instagram", service_type: null,
  business_unit_id: null, preferred_locale: null, party_owner_membership_id: null,
};

// The Sales working hours (the first-response policy's calendar): Mon–Sun 09:00–18:00 Dubai time.
const day = [{ start: "09:00", end: "18:00" }];
const SALES_HOURS = { version: 1, mode: "business", timezone: "Asia/Dubai", weeklyHours: { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day }, holidays: [], dateOverrides: {} };

function processor({ responded = false, engaged = false, attempts = 0, cap = 2, queueMinutes = null, salesHours = false, unassign = false, firstAssignedAt = assignedAt }:
  { responded?: boolean; engaged?: boolean; attempts?: number; cap?: number; queueMinutes?: number | null; salesHours?: boolean; unassign?: boolean; firstAssignedAt?: Date } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT lead.id FROM crm_leads lead")) return { rows: [{ id: "lead" }], rowCount: 1 };
    if (sql.includes("FROM workspace_sales_settings")) return { rows: [{ takeoverCap: cap, unownedEscalationMinutes: 15, clientReviewMinutes: 30, duplicateWindowDays: 90, salesAdminMembershipId: null, unassignAfterWorkingDay: unassign, version: 1 }], rowCount: 1 };
    if (sql.includes("max(history.assigned_at) AS at")) return { rows: [{ at: firstAssignedAt }], rowCount: 1 };
    if (sql.includes("SELECT takeover_schedule AS schedule FROM crm_queues")) return { rows: [{ schedule: null }], rowCount: 1 };
    if (sql.includes("role.code = 'owner'")) return { rows: [{ userId: "boss-user", membershipId: "boss", name: "Boss" }], rowCount: 1 };
    if (sql.includes("AND membership.id = $2 AND membership.status = 'active'")) return { rows: [{ userId: "owner-user", membershipId: "owner", name: "Sara" }], rowCount: 1 };
    if (sql.includes("SELECT enquiry.reference, party.display_name AS \"clientName\"")) return { rows: [{ reference: "E-1", clientName: "Layla" }], rowCount: 1 };
    if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "{{reference}} is unassigned", body: "Nobody picked up {{clientName}}" }], rowCount: 1 };
    if (sql.includes("takeover_after_minutes AS minutes")) return { rows: queueMinutes === null ? [] : [{ minutes: queueMinutes, schedule: null }], rowCount: queueMinutes === null ? 0 : 1 };
    if (sql.includes("FROM crm_sla_policies")) return { rows: salesHours ? [{ schedule: SALES_HOURS, mode: "business" }] : [], rowCount: salesHours ? 1 : 0 };
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
      reassigned: [{ leadId: "lead", ownerMembershipId: "alternate", queueId: "queue" }], engaged: [], kept: [], escalated: [], unassigned: [],
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
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"], kept: [], escalated: [], unassigned: [] });
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET ownership_due_at=NULL"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.takeover_cancelled.v1" }));
    expect(query.mock.calls.some(([sql]) => sql.includes("SET responded_at"))).toBe(false);
  });

  it("keeps the owner when a verified first response was recorded", async () => {
    const { service, query } = processor({ responded: true });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: ["lead"], kept: [], escalated: [], unassigned: [] });
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM audit_events event"))).toBe(false);
  });

  it("keeps the owner, turns it urgent and tells the owner and the admin when nobody else can take it (S-1)", async () => {
    const { service, query, events } = processor();
    service["selectAssignment"] = vi.fn().mockResolvedValue({
      ownerMembershipId: null, queueId: "queue", ruleId: null,
      explanation: { reason: "no_eligible_alternate" },
    });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: [], kept: ["lead"], escalated: [], unassigned: [] });
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

  it("counts the next handoff in Sales working minutes when the queue has no hours of its own", async () => {
    vi.useFakeTimers();
    try {
      // 18:05 Dubai time, after the working day: 60 working minutes end at 10:00 the next morning, not 19:05 tonight.
      vi.setSystemTime(new Date("2026-09-26T14:05:00.000Z"));
      const { service, query } = processor({ queueMinutes: 60, salesHours: true });
      service["selectAssignment"] = vi.fn().mockResolvedValue({ ownerMembershipId: null, queueId: "queue", ruleId: null, explanation: { reason: "no_eligible_alternate" } });
      expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: [], kept: ["lead"], escalated: [], unassigned: [] });
      const kept = query.mock.calls.find(([sql]) => sql.includes("SET ownership_due_at=$3, priority='urgent'"));
      expect((kept?.[1]?.[2] as Date).toISOString()).toBe("2026-09-27T06:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to a manager instead of rotating once the attempt cap is reached (S-1)", async () => {
    const { service, query, events } = processor({ attempts: 2, cap: 2 });
    expect(await service.processDueTakeoversInternal("workspace", 10)).toEqual({ reassigned: [], engaged: [], kept: [], escalated: ["lead"], unassigned: [] });
    expect(service["selectAssignment"]).not.toHaveBeenCalled();
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET ownership_due_at=NULL, priority='urgent', escalated_at=now()"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.lead.takeover_escalated.v1", after: expect.objectContaining({ attempts: 2 }),
    }));
  });
});

describe("unassign after a working day (PLM-180)", () => {
  // Given out Monday 10:00 Dubai time; Sales works 09:00–18:00, so a working day is up at 10:00 on Tuesday.
  const givenOut = new Date("2026-09-14T06:00:00.000Z");
  const dayUp = "2026-09-15T06:00:00.000Z";
  const at = async <T>(now: string, run: () => Promise<T>) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    try { return await run(); } finally { vi.useRealTimers(); }
  };

  it("moves an enquiry nobody picked up to Unassigned once a full working day has passed, and tells the Owners in the app and by email", async () => {
    const { service, query, events } = processor({ unassign: true, salesHours: true, firstAssignedAt: givenOut });
    expect(await at("2026-09-15T06:01:00.000Z", () => service.processDueTakeoversInternal("workspace", 10)))
      .toEqual({ reassigned: [], engaged: [], kept: [], escalated: [], unassigned: ["lead"] });
    expect(service["selectAssignment"]).not.toHaveBeenCalled();
    expect(service["applyAssignment"]).toHaveBeenCalledWith(expect.anything(), "workspace", dueLead,
      expect.objectContaining({ ownerMembershipId: null, queueId: "queue", explanation: expect.objectContaining({ reason: "unassigned_after_working_day", previousOwnerMembershipId: "owner", deadline: dayUp }) }),
      null, "automatic", "Nobody picked it up within a working day", true);
    // Urgent, and the no-owner escalation won't tell the Owners a second time.
    expect(query.mock.calls.some(([sql]) => sql.includes("SET escalation_due_at=NULL, escalated_at=now(), priority='urgent'"))).toBe(true);
    const notices = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"))
      .map(([sql, values]) => ({ channel: /'email'/.test(sql) ? "email" : "in_app", recipient: (values as unknown[])[2], key: (values as unknown[])[7] }));
    expect(notices).toEqual(expect.arrayContaining([
      { channel: "in_app", recipient: "boss-user", key: `crm:unassigned:lead:${dayUp}:boss-user` },
      { channel: "email", recipient: "boss-user", key: `crm:unassigned:lead:${dayUp}:boss-user:email` },
    ]));
    // The notice names the enquiry and leads to it, where it can be reassigned or moved to Lost.
    const owner = query.mock.calls.find(([sql, values]) => sql.includes("INSERT INTO notifications") && (values as unknown[])[2] === "boss-user")!;
    expect(owner[1]).toEqual(expect.arrayContaining(["E-1 is unassigned", "/workspace/crm/leads?lead=lead"]));
    expect(query.mock.calls.some(([sql, values]) => sql.includes("FROM notification_templates") && (values as unknown[])[1] === "crm.lead_unassigned")).toBe(true);
    // The person who had it hears it moved.
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ channel: "in_app", recipient: "owner-user" })]));
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.lead.unassigned_after_working_day.v1", after: expect.objectContaining({ previousOwnerMembershipId: "owner", deadline: dayUp, ownersTold: ["boss"] }),
    }));
  });

  it("keeps handing off past the cap before the working day is up, with no manager escalation", async () => {
    const { service, events } = processor({ unassign: true, salesHours: true, firstAssignedAt: givenOut, attempts: 5, cap: 2 });
    expect(await at("2026-09-14T13:00:00.000Z", () => service.processDueTakeoversInternal("workspace", 10)))
      .toEqual({ reassigned: [{ leadId: "lead", ownerMembershipId: "alternate", queueId: "queue" }], engaged: [], kept: [], escalated: [], unassigned: [] });
    expect(events.record).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.takeover_escalated.v1" }));
  });

  it("with nobody else to take it, the owner keeps it but the next check is no later than the end of the working day", async () => {
    const { service, query } = processor({ unassign: true, salesHours: true, firstAssignedAt: givenOut, attempts: 4, cap: 2, queueMinutes: 600 });
    service["selectAssignment"] = vi.fn().mockResolvedValue({ ownerMembershipId: null, queueId: "queue", ruleId: null, explanation: { reason: "no_eligible_alternate" } });
    expect(await at("2026-09-14T13:00:00.000Z", () => service.processDueTakeoversInternal("workspace", 10)))
      .toEqual({ reassigned: [], engaged: [], kept: ["lead"], escalated: [], unassigned: [] });
    const kept = query.mock.calls.find(([sql]) => sql.includes("SET ownership_due_at=$3, priority='urgent'"));
    expect(kept?.[1]?.[3]).toBe(false);
    const held = query.mock.calls.find(([sql]) => sql.includes("LEAST(COALESCE(ownership_due_at"));
    expect((held?.[1]?.[2] as Date).toISOString()).toBe(dayUp);
  });

  it("never unassigns an enquiry its owner picked up (a call, note or verified response)", async () => {
    const { service } = processor({ unassign: true, salesHours: true, firstAssignedAt: givenOut, responded: true });
    expect(await at("2026-09-16T06:00:00.000Z", () => service.processDueTakeoversInternal("workspace", 10)))
      .toEqual({ reassigned: [], engaged: ["lead"], kept: [], escalated: [], unassigned: [] });
    expect(service["applyAssignment"]).not.toHaveBeenCalled();
  });

  it("stays off unless the firm turns it on: the cap still escalates to a manager", async () => {
    const { service } = processor({ salesHours: true, firstAssignedAt: givenOut, attempts: 2, cap: 2 });
    expect(await at("2026-09-16T06:00:00.000Z", () => service.processDueTakeoversInternal("workspace", 10)))
      .toEqual({ reassigned: [], engaged: [], kept: [], escalated: ["lead"], unassigned: [] });
  });
});
