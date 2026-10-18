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

describe("CRM activity response evidence", () => {
  const setup = (overrides: Record<string, unknown> = {}) => {
    const completedAt = new Date("2026-09-15T08:00:00.000Z");
    const before = {
      id: "activity",
      workspace_id: "workspace",
      lead_id: "lead",
      opportunity_id: null,
      sla_instance_id: null,
      type: "call",
      interaction_direction: "outbound",
      status: "pending",
      title: "Call client",
      is_next_action: false,
      version: 2,
      ...overrides,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM crm_activities")) return { rows: [before], rowCount: 1 };
      if (sql.includes("UPDATE crm_activities SET status = 'completed'")) {
        return { rows: [{ ...before, status: "completed", completed_at: completedAt, version: 3 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })) };
    const events = { record: vi.fn().mockResolvedValue(undefined) };
    const slas = { recordFirstResponse: vi.fn().mockResolvedValue({ instanceId: "sla", recorded: true, respondedAt: completedAt }) };
    const service = new CrmActivitiesService(access as never, events as never, slas as never);
    return { service, query, slas, completedAt };
  };

  it("records a completed outbound human interaction as verified response evidence", async () => {
    const { service, slas, completedAt } = setup();
    const result = await service.complete({} as never, "workspace", "activity", { version: 2, outcome: "Spoke to client" });
    expect(slas.recordFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", {
      sourceType: "activity",
      sourceId: "activity",
      actorUserId: "user",
      respondedAt: completedAt,
      details: {
        activityType: "call",
        interactionDirection: "outbound",
        outcome: "Spoke to client",
        attestation: "completed_outbound_interaction",
      },
    });
    expect(result.firstResponseEvidence).toMatchObject({ instanceId: "sla", recorded: true, respondedAt: completedAt });
  });

  it("accepts completion of the SLA-generated response task as an explicit human attestation", async () => {
    const { service, slas } = setup({ type: "task", interaction_direction: null, sla_instance_id: "sla" });
    await service.complete({} as never, "workspace", "activity", { version: 2 });
    expect(slas.recordFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", expect.objectContaining({
      details: expect.objectContaining({ attestation: "completed_response_task" }),
    }));
  });

  it.each([
    ["call", "inbound"],
    ["email", "internal"],
    ["meeting", null],
    ["task", null],
  ])("does not treat a %s/%s completion as an outbound response", async (type, interactionDirection) => {
    const { service, slas } = setup({ type, interaction_direction: interactionDirection });
    await service.complete({} as never, "workspace", "activity", { version: 2 });
    expect(slas.recordFirstResponse).not.toHaveBeenCalled();
  });

  it("rejects interaction directions on non-communication activity types", async () => {
    const { service } = setup();
    await expect(service.create({} as never, "workspace", {
      partyId: "party",
      type: "task",
      interactionDirection: "outbound",
      title: "Follow up",
    })).rejects.toThrow("Interaction direction is only valid");
  });
});

describe("Follow-up time ranges", () => {
  it.each(["call", "meeting", "task"])("creates a persisted duration for a %s", async type => {
    const query = vi.fn(async () => ({ rows: [{ id: "new", type, version: 1 }], rowCount: 1 }));
    const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })) };
    const service = new CrmActivitiesService(access as never, { record: vi.fn() } as never);
    vi.spyOn(service as unknown as { assertTargets: () => Promise<void> }, "assertTargets").mockResolvedValue();
    vi.spyOn(service as unknown as { touchLead: () => Promise<void> }, "touchLead").mockResolvedValue();
    const save = vi.spyOn(service as unknown as { saveAppointment: (...args: unknown[]) => Promise<unknown> }, "saveAppointment").mockResolvedValue({ startsAt: "2026-09-22T12:30:00.000Z", endsAt: "2026-09-22T13:00:00.000Z" });
    const result = await service.create({} as never, "workspace", { type, partyId: "party", title: "Evening call", dueAt: "2026-09-22T18:00:00+05:30", durationMinutes: 30 });
    expect(save).toHaveBeenCalledWith(expect.anything(), "workspace", "new", { startsAt: "2026-09-22T12:30:00.000Z", endsAt: "2026-09-22T13:00:00.000Z", timezone: "UTC" });
    expect(result.appointment).toBeDefined();
  });
});
