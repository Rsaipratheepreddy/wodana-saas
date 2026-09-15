import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

const statuses = ["new", "attempting_contact", "connected", "nurturing", "qualified", "paused", "disqualified"];

function setup(status: string, options: { converted?: boolean; unassigned?: boolean; noAction?: boolean } = {}) {
  const before = { id: "lead", party_id: "party", owner_membership_id: options.unassigned ? null : "owner", queue_id: null, status, version: 5, next_action_at: options.noAction ? null : "2026-09-20T09:30:00Z" };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT lead.*")) return { rows: [before], rowCount: 1 };
    if (sql.includes("SELECT 1 FROM crm_opportunities")) return { rows: options.converted ? [{}] : [], rowCount: options.converted ? 1 : 0 };
    if (sql.includes("UPDATE crm_leads")) return { rows: [{ ...before, status: params[0], next_action_at: params[2], version: 6 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })) };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const slas = {
    pauseFirstResponse: vi.fn().mockResolvedValue(null),
    resumeFirstResponse: vi.fn().mockResolvedValue(null),
    stopFirstResponse: vi.fn().mockResolvedValue(null),
    startFirstResponse: vi.fn().mockResolvedValue(null),
    recordFirstResponse: vi.fn().mockResolvedValue(null),
    transferFirstResponseResponsibility: vi.fn().mockResolvedValue(null),
  };
  const service = new CrmLeadsService({} as never, access as never, events as never, slas as never);
  return { service, query, events, access, slas };
}

describe("CRM lead status moves", () => {
  it.each(statuses.flatMap((from) => statuses.filter((to) => to !== from).map((to) => [from, to])))
  ("allows %s → %s, including previous stages", async (from, to) => {
    const { service, query, events, access } = setup(from);
    const result = await service.transition({} as never, "workspace", "lead", { version: 5, status: to, reason: "Client requested a change" });
    expect(result).toMatchObject({ status: to, version: 6 });
    expect(access.withPermission).toHaveBeenCalledWith({}, "workspace", "crm.leads.manage", expect.any(Function));
    const update = query.mock.calls.find(([sql]) => sql.includes("UPDATE crm_leads"));
    expect(update?.[1]?.slice(3)).toEqual(["lead", "workspace", 5]);
    expect(update?.[0]).toContain("qualified_at = CASE WHEN $1 = 'qualified' THEN now() ELSE NULL END");
    expect(events.record).toHaveBeenCalledOnce();
    if (["qualified", "disqualified"].includes(from) && !["qualified", "disqualified"].includes(to)) {
      expect(query.mock.calls.some(([sql, params]) => sql.includes("SET status = 'open', closed_at = NULL") && params?.[0] === "workspace" && params?.[1] === "lead")).toBe(true);
    }
  });

  it.each(["paused", "disqualified"])("requires a reason for %s", async (status) => {
    const { service, events } = setup("connected");
    await expect(service.transition({} as never, "workspace", "lead", { version: 5, status })).rejects.toThrow("A reason is required");
    expect(events.record).not.toHaveBeenCalled();
  });

  it("prevents moving converted leads even if their status is inconsistent", async () => {
    const { service, events } = setup("connected", { converted: true });
    await expect(service.transition({} as never, "workspace", "lead", { version: 5, status: "new" })).rejects.toThrow("This lead has been converted");
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects stale versions without writing", async () => {
    const { service, query } = setup("connected");
    await expect(service.transition({} as never, "workspace", "lead", { version: 4, status: "new" })).rejects.toThrow("Lead changed");
    expect(query.mock.calls.some(([sql]) => /^\s*UPDATE\b/.test(sql))).toBe(false);
  });

  it("treats the same status as a no-op", async () => {
    const { service, events } = setup("connected");
    expect(await service.transition({} as never, "workspace", "lead", { version: 5, status: "connected" })).toMatchObject({ status: "connected", version: 5 });
    expect(events.record).not.toHaveBeenCalled();
  });

  it("requires and accepts a next action for an unassigned reopened lead", async () => {
    const { service } = setup("disqualified", { unassigned: true, noAction: true });
    await expect(service.transition({} as never, "workspace", "lead", { version: 5, status: "connected" })).rejects.toThrow("requires a next action or assignment");
    expect(await service.transition({} as never, "workspace", "lead", { version: 5, status: "connected", nextActionAt: "2026-09-20T09:30:00Z" })).toMatchObject({ status: "connected", nextActionAt: new Date("2026-09-20T09:30:00Z") });
  });

  it("pauses and resumes the existing first-response clock", async () => {
    const paused = setup("new");
    await paused.service.transition({} as never, "workspace", "lead", { version: 5, status: "paused", reason: "Waiting for client" });
    expect(paused.slas.pauseFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", "user", "Waiting for client");

    const resumed = setup("paused");
    await resumed.service.transition({} as never, "workspace", "lead", { version: 5, status: "attempting_contact" });
    expect(resumed.slas.resumeFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", "user", "Lead reopened from pause");
  });

  it("records verified status evidence and creates a new cycle only after reopening a closed lead", async () => {
    const connected = setup("new");
    await connected.service.transition({} as never, "workspace", "lead", { version: 5, status: "connected" });
    expect(connected.slas.recordFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", expect.objectContaining({
      sourceType: "lead_status",
      sourceId: "lead",
      actorUserId: "user",
      details: { fromStatus: "new", toStatus: "connected" },
    }));

    const reopened = setup("disqualified");
    await reopened.service.transition({} as never, "workspace", "lead", { version: 5, status: "new" });
    expect(reopened.slas.startFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", expect.objectContaining({ newCycle: true }));
  });

  it("keeps the generated response task consistent across pause, resume, and non-response stop", async () => {
    const paused = setup("new");
    paused.slas.pauseFirstResponse.mockResolvedValue({ id: "sla" });
    await paused.service.transition({} as never, "workspace", "lead", { version: 5, status: "paused", reason: "Waiting" });
    expect(paused.query.mock.calls.some(([sql, params]) => sql.includes("sla_instance_id=$2") && sql.includes("due_at=NULL") && params?.[1] === "sla")).toBe(true);

    const resumed = setup("paused");
    resumed.slas.resumeFirstResponse.mockResolvedValue({ id: "sla", warning_at: new Date("2026-09-21T09:00:00Z") });
    await resumed.service.transition({} as never, "workspace", "lead", { version: 5, status: "new" });
    expect(resumed.query.mock.calls.some(([sql, params]) => sql.includes("sla_instance_id=$2") && sql.includes("is_next_action=$4") && params?.[1] === "sla" && params?.[3] === true)).toBe(true);

    const stopped = setup("new");
    stopped.slas.stopFirstResponse.mockResolvedValue({ id: "sla" });
    await stopped.service.transition({} as never, "workspace", "lead", { version: 5, status: "disqualified", reason: "Not a fit" });
    expect(stopped.query.mock.calls.some(([sql, params]) => sql.includes("sla_instance_id=$2") && sql.includes("completion_outcome") && params?.[2] === "cancelled")).toBe(true);
  });
});
