import { describe, expect, it, vi } from "vitest";
import { CrmSlaLifecycleService } from "./crm-sla-lifecycle.service";

const elapsedSnapshot = {
  calculationMode: "elapsed",
  schedule: { version: 1, mode: "elapsed" },
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "sla-1",
  started_at: new Date("2026-09-15T08:00:00.000Z"),
  status: "active",
  warning_at: new Date("2026-09-15T09:00:00.000Z"),
  due_at: new Date("2026-09-15T10:00:00.000Z"),
  paused_at: null,
  paused_from_status: null,
  remaining_warning_minutes: null,
  remaining_breach_minutes: null,
  total_paused_minutes: 0,
  calculation_mode: "elapsed",
  policy_snapshot: elapsedSnapshot,
  cycle: 1,
  ...overrides,
});

describe("CrmSlaLifecycleService", () => {
  it("starts from the customer-received timestamp and writes a policy snapshot and history", async () => {
    const receivedAt = new Date("2026-09-15T08:00:00.000Z");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM crm_sla_instances")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_leads lead")) return { rows: [{ received_at: receivedAt, intake_method: "form" }], rowCount: 1 };
      if (sql.includes("FROM crm_sla_policies")) return { rows: [{
        id: "policy-1", name: "First response", event_type: "first_response",
        warning_after_minutes: 30, breach_after_minutes: 120,
        calculation_mode: "elapsed", schedule_version: 1, schedule: {}, version: 3,
      }], rowCount: 1 };
      if (sql.includes("INSERT INTO crm_sla_instances")) return { rows: [row({
        warning_at: new Date("2026-09-15T08:30:00.000Z"),
        due_at: new Date("2026-09-15T10:00:00.000Z"),
      })], rowCount: 1 };
      if (sql.includes("INSERT INTO crm_sla_history")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new CrmSlaLifecycleService();
    const result = await service.startFirstResponse({ query } as never, "workspace", "lead", {
      actorUserId: "user",
      ownerMembershipId: "owner",
      reason: "Lead ready",
    });
    expect(result).toMatchObject({ cycle: 1, startedAt: receivedAt });
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_sla_instances"));
    expect(insert?.[1]?.[6]).toEqual(receivedAt);
    expect(insert?.[1]?.[7]).toEqual(new Date("2026-09-15T08:30:00.000Z"));
    expect(insert?.[1]?.[8]).toEqual(new Date("2026-09-15T10:00:00.000Z"));
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO crm_sla_history"))).toBe(true);
  });

  it("does not start timers for historical imports or duplicate starts", async () => {
    const importedQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_sla_instances")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_leads lead")) return { rows: [{ received_at: new Date(), intake_method: "import" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmSlaLifecycleService();
    expect(await service.startFirstResponse({ query: importedQuery } as never, "workspace", "lead", {
      actorUserId: null, ownerMembershipId: null, reason: "Imported",
    })).toBeNull();
    expect(importedQuery.mock.calls.some(([sql]) => sql.includes("FROM crm_sla_policies"))).toBe(false);

    const existingQuery = vi.fn(async (sql: string) => sql.includes("FROM crm_sla_instances")
      ? { rows: [row()], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    expect(await service.startFirstResponse({ query: existingQuery } as never, "workspace", "lead", {
      actorUserId: null, ownerMembershipId: null, reason: "Reassigned",
    })).toMatchObject({ id: "sla-1", cycle: 1 });
    expect(existingQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO crm_sla_instances"))).toBe(false);
  });

  it("freezes the exact remaining SLA minutes when paused", async () => {
    const current = row();
    const paused = row({
      status: "paused", paused_at: new Date("2026-09-15T08:30:00.000Z"),
      paused_from_status: "active", remaining_warning_minutes: 30, remaining_breach_minutes: 90,
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_sla_instances")) return { rows: [current], rowCount: 1 };
      if (sql.includes("UPDATE crm_sla_instances SET status='paused'")) return { rows: [paused], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmSlaLifecycleService();
    const result = await service.pauseFirstResponse(
      { query } as never, "workspace", "lead", "user", "Waiting", new Date("2026-09-15T08:30:00.000Z"),
    );
    expect(result?.status).toBe("paused");
    const update = query.mock.calls.find(([sql]) => sql.includes("SET status='paused'"));
    expect(update?.[1]?.slice(4, 6)).toEqual([30, 90]);
  });

  it("records an already elapsed deadline as breached instead of hiding it behind a pause", async () => {
    const current = row({ due_at: new Date("2026-09-15T08:15:00.000Z") });
    const breached = row({ status: "breached", due_at: current.due_at });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_sla_instances")) return { rows: [current], rowCount: 1 };
      if (sql.includes("SET status='breached'")) return { rows: [breached], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmSlaLifecycleService();
    expect(await service.pauseFirstResponse(
      { query } as never, "workspace", "lead", "user", "Waiting", new Date("2026-09-15T08:30:00.000Z"),
    )).toMatchObject({ status: "breached" });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status='paused'"))).toBe(false);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("INSERT INTO crm_sla_history") && params?.[2] === "breached")).toBe(true);
  });

  it("recomputes deadlines from the resume instant instead of shifting wall-clock time", async () => {
    const current = row({
      status: "paused", paused_at: new Date("2026-09-12T08:30:00.000Z"),
      paused_from_status: "warning", remaining_warning_minutes: 0, remaining_breach_minutes: 90,
    });
    const resumed = row({ status: "warning" });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_sla_instances")) return { rows: [current], rowCount: 1 };
      if (sql.includes("UPDATE crm_sla_instances SET status=$3")) return { rows: [resumed], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmSlaLifecycleService();
    await service.resumeFirstResponse(
      { query } as never, "workspace", "lead", "user", "Resumed", new Date("2026-09-15T10:00:00.000Z"),
    );
    const update = query.mock.calls.find(([sql]) => sql.includes("SET status=$3"));
    expect(update?.[1]?.[2]).toBe("warning");
    expect(update?.[1]?.[3]).toEqual(new Date("2026-09-15T10:00:00.000Z"));
    expect(update?.[1]?.[4]).toEqual(new Date("2026-09-15T11:30:00.000Z"));
  });

  it("stops once with immutable evidence and is idempotent when nothing is active", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_sla_instances")) return { rows: [row()], rowCount: 1 };
      if (sql.includes("UPDATE crm_sla_instances SET status='stopped'")) return { rows: [row({ status: "stopped" })], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new CrmSlaLifecycleService();
    const evidence = { type: "lead_status", toStatus: "connected" };
    expect(await service.stopFirstResponse({ query } as never, "workspace", "lead", "user", "connected", evidence))
      .toMatchObject({ status: "stopped" });
    const update = query.mock.calls.find(([sql]) => sql.includes("SET status='stopped'"));
    expect(update?.[1]?.[4]).toEqual(evidence);

    const emptyQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    expect(await service.stopFirstResponse({ query: emptyQuery } as never, "workspace", "lead", null, "connected", evidence))
      .toBeNull();
  });
});
