import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

const warningAt = new Date("2026-09-15T09:00:00.000Z");
const dueAt = new Date("2026-09-15T10:00:00.000Z");

function processor(rows: Record<string, unknown>[], kind: "warning" | "breach") {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH due AS") && sql.includes("status IN ('active', 'warning')")) {
      return { rows: kind === "breach" ? rows : [], rowCount: kind === "breach" ? rows.length : 0 };
    }
    if (sql.includes("WITH due AS") && sql.includes("status = 'active'")) {
      return { rows: kind === "warning" ? rows : [], rowCount: kind === "warning" ? rows.length : 0 };
    }
    if (sql.includes("UPDATE crm_activities SET owner_membership_id")) {
      return { rows: [{ id: "response-task" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const database = {
    tenantTransaction: vi.fn(async (_workspaceId, _actorId, work) => work({ query })),
  };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const slas = {
    recordTransition: vi.fn().mockResolvedValue(undefined),
  };
  const service = new CrmLeadsService(database as never, {} as never, events as never, slas as never);
  return { service, query, events, slas };
}

describe("CRM SLA accountability and escalation", () => {
  it("promotes the existing response task at the warning threshold", async () => {
    const row = {
      id: "sla", fromStatus: "active", leadId: "lead", targetType: "lead", targetId: "lead", eventType: "first_response",
      warningAt, dueAt, ownerMembershipId: "owner", queueId: "queue", status: "warning", version: 2,
    };
    const { service, query, events, slas } = processor([row], "warning");
    expect(await service.processDueSlasInternal("workspace", 1)).toMatchObject({ warnings: [row], breaches: [] });

    const promotion = query.mock.calls.find(([sql]) => sql.includes("UPDATE crm_activities SET owner_membership_id"));
    expect(promotion?.[1]).toEqual(["workspace", "sla", "owner", "high", warningAt]);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("SET is_next_action=true") && params?.[1] === "response-task")).toBe(true);
    expect(slas.recordTransition).toHaveBeenCalledWith(
      expect.anything(), "workspace", "sla", "warning", "active", "warning",
      "SLA warning threshold elapsed", expect.objectContaining({ escalation: expect.objectContaining({ taskId: "response-task" }) }),
      null, warningAt,
    );
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.sla.warning.v1",
      after: expect.objectContaining({ escalation: expect.objectContaining({ level: "warning" }) }),
    }));
  });

  it("preserves missed warning history and promotes the response task when a delayed worker finds a breach", async () => {
    const row = {
      id: "sla", fromStatus: "active", leadId: "lead", targetType: "lead", targetId: "lead", eventType: "first_response",
      warningAt, dueAt, ownerMembershipId: null, queueId: "queue", status: "breached", version: 2,
    };
    const { service, query, events, slas } = processor([row], "breach");
    expect(await service.processDueSlasInternal("workspace", 1)).toMatchObject({ warnings: [], breaches: [row] });

    const breachUpdate = query.mock.calls.find(([sql]) => sql.includes("WITH due AS") && sql.includes("status IN ('active', 'warning')"));
    expect(breachUpdate?.[0]).toContain("warned_at = COALESCE(instance.warned_at, instance.warning_at)");
    expect(breachUpdate?.[0]).toContain("breached_at = COALESCE(instance.breached_at, instance.due_at)");
    const promotion = query.mock.calls.find(([sql]) => sql.includes("UPDATE crm_activities SET owner_membership_id"));
    expect(promotion?.[1]).toEqual(["workspace", "sla", null, "urgent", dueAt]);
    expect(slas.recordTransition.mock.calls.map((call) => call[3])).toEqual(["warning", "breached"]);
    expect(slas.recordTransition.mock.calls[0][9]).toEqual(warningAt);
    expect(slas.recordTransition.mock.calls[1][9]).toEqual(dueAt);
    expect(slas.recordTransition.mock.calls[1][4]).toBe("warning");
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.sla.breached.v1" }));
  });

  it("creates one SLA-linked task without displacing an earlier customer commitment", async () => {
    const slas = { startFirstResponse: vi.fn().mockResolvedValue({
      id: "sla", warningAt, dueAt, ownerMembershipId: "owner", queueId: "queue",
    }) };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("sla_instance_id=$2") && sql.includes("LIMIT 1 FOR UPDATE")) return { rows: [], rowCount: 0 };
      if (sql.includes("is_next_action") && sql.includes("LIMIT 1 FOR UPDATE")) {
        return { rows: [{ id: "earlier-task", due_at: new Date("2026-09-15T08:30:00.000Z") }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO crm_activities")) return { rows: [{ id: "response-task" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmLeadsService({} as never, {} as never, {} as never, slas as never);
    await service["startFirstResponseSla"]({ query } as never, "workspace", "lead", "stale-owner", "user");

    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_activities"));
    expect(insert?.[1]).toEqual(["workspace", "lead", "owner", warningAt, "user", "sla", false]);
    expect(query.mock.calls.some(([sql]) => sql.includes("SET is_next_action=false"))).toBe(false);
  });

  it("makes the SLA task the next action when its warning is the earliest commitment", async () => {
    const slas = { startFirstResponse: vi.fn().mockResolvedValue({
      id: "sla", warningAt, dueAt, ownerMembershipId: "owner", queueId: "queue",
    }) };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("sla_instance_id=$2") && sql.includes("LIMIT 1 FOR UPDATE")) return { rows: [], rowCount: 0 };
      if (sql.includes("is_next_action") && sql.includes("LIMIT 1 FOR UPDATE")) {
        return { rows: [{ id: "later-task", due_at: new Date("2026-09-15T11:00:00.000Z") }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO crm_activities")) return { rows: [{ id: "response-task" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmLeadsService({} as never, {} as never, {} as never, slas as never);
    await service["startFirstResponseSla"]({ query } as never, "workspace", "lead", "owner", "user");

    expect(query.mock.calls.some(([sql, params]) => sql.includes("SET is_next_action=false") && params?.[1] === "later-task")).toBe(true);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_activities"));
    expect(insert?.[1]?.[6]).toBe(true);
  });

  it("recovers a prematurely closed response task while the SLA is still live", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE crm_activities SET owner_membership_id")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO crm_activities")) return { rows: [], rowCount: 0 };
      if (sql.includes("completed_at=NULL") && sql.includes("sla_instance_id=$2")) {
        return { rows: [{ id: "recovered-task" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmLeadsService({} as never, {} as never, {} as never, {} as never);
    const result = await service["escalateFirstResponseTask"]({ query } as never, "workspace", {
      instanceId: "sla", leadId: "lead", ownerMembershipId: "owner", queueId: "queue",
      dueAt, level: "breach",
    });

    expect(result).toMatchObject({ level: "breach", taskId: "recovered-task" });
    expect(query.mock.calls.some(([sql, params]) => sql.includes("SET is_next_action=true") && params?.[1] === "recovered-task")).toBe(true);
  });

  it("does not apply first-response task behavior to other future SLA event types", async () => {
    const row = {
      id: "sla", fromStatus: "active", leadId: "lead", targetType: "lead", targetId: "lead",
      eventType: "proposal_follow_up", warningAt, dueAt, ownerMembershipId: "owner", queueId: "queue",
      status: "warning", version: 2,
    };
    const { service, query, slas } = processor([row], "warning");
    await service.processDueSlasInternal("workspace", 1);

    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_activities SET owner_membership_id"))).toBe(false);
    expect(slas.recordTransition).toHaveBeenCalledWith(
      expect.anything(), "workspace", "sla", "warning", "active", "warning",
      expect.any(String), expect.objectContaining({ escalation: null }), null, warningAt,
    );
  });
});
