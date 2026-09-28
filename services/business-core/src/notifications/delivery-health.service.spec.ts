import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { readWorkerBeat } from "../health/worker-heartbeat";
import { DeliveryHealthService } from "./delivery-health.service";
import { staffEmailAction } from "./staff-email-actions";

const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";
const userId = "0f7e3f3c-3d9e-4c1b-9d0f-3c1b2d4e5f60";
type Rows = Record<string, unknown>[];

function fakeClient(answers: { stats?: Rows; attempts?: Rows; suppressed?: Rows; connections?: Rows; devices?: number; recentTest?: boolean; replay?: Rows }) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.includes("GROUP BY channel")) return { rows: answers.stats ?? [] };
    if (sql.includes("FROM notification_delivery_attempts attempt")) return { rows: answers.attempts ?? [] };
    if (sql.includes("DISTINCT ON (channel)")) return { rows: answers.suppressed ?? [] };
    if (sql.includes("FROM integration_connections")) return { rows: answers.connections ?? [] };
    if (sql.includes("count(*)::int AS count FROM device_endpoints")) return { rows: [{ count: answers.devices ?? 0 }] };
    if (sql.includes("idempotency_key LIKE")) return { rows: answers.replay ?? [], rowCount: answers.replay?.length ?? 0 };
    if (sql.includes("interval '1 minute'")) return { rows: [], rowCount: answers.recentTest ? 1 : 0 };
    if (sql.includes("FROM workspaces")) return { rows: [{ name: "Studio North" }] };
    if (sql.includes("FROM device_endpoints")) return { rows: [], rowCount: answers.devices ? 1 : 0 };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: `n-${calls.length}`, correlationId: "c" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query }, calls };
}

function service(env: Record<string, string>, mailerConfigured: boolean) {
  const access = { withAnyPermission: vi.fn(async (_actor: unknown, _ws: string, _codes: string[], work: (client: unknown, user: { userId: string }) => unknown) => work(current.client, { userId })) };
  const current = { client: {} as unknown };
  const instance = new DeliveryHealthService(access as never, new ConfigService(env), { configured: () => mailerConfigured } as never);
  return { instance, access, current };
}

const beat = (secondsAgo: number) => readWorkerBeat(JSON.stringify({ at: new Date(Date.now() - secondsAgo * 1000).toISOString(), adapter: "live" }));

describe("delivery health (FD-2)", () => {
  it("shows per channel whether it is set up, when it last worked, why it last failed and what waits", async () => {
    const { instance } = service({}, true);
    const failedAt = new Date(Date.now() - 3_600_000).toISOString();
    const { client } = fakeClient({
      stats: [{ channel: "email", queued24h: 2, failed24h: 1, waiting: 3, oldestWaitingAt: new Date(Date.now() - 600_000), lastSuccessAt: new Date(Date.now() - 7_200_000) }],
      attempts: [{ channel: "email", at: failedAt, code: "MAILGUN_HTTP_401", message: null }],
      suppressed: [{ channel: "push", at: failedAt, code: "destination_missing" }],
      connections: [{ provider: "whatsapp", status: "degraded", configuration: {} }],
      devices: 0,
    });
    const health = await instance.read(client, workspaceId, beat(10));
    const [email, whatsapp, push] = health.channels;
    expect(email).toMatchObject({ channel: "email", configured: true, teamEmail: true, clientEmail: false, queued24h: 2, failed24h: 1, waiting: 3, lastFailure: { code: "MAILGUN_HTTP_401" } });
    expect(email.lastSuccessAt).toBeTruthy();
    expect(whatsapp).toMatchObject({ configured: false, connection: "degraded", lastFailure: null });
    expect(push).toMatchObject({ configured: false, devices: 0, lastFailure: { code: "destination_missing" } });
    expect(health.worker).toMatchObject({ status: "ok", delivery: "live" });
    expect(health.attention).toEqual({ reason: null, since: null });
  });

  it("asks for attention when the worker is silent for two minutes or more than 20 notices wait", async () => {
    const { instance } = service({}, false);
    const silent = await instance.read(fakeClient({}).client, workspaceId, beat(300));
    expect(silent.attention.reason).toBe("worker");
    expect(silent.channels[0]).toMatchObject({ configured: false, teamEmail: false });
    const backlog = await instance.read(fakeClient({ stats: [{ channel: "whatsapp", waiting: 21, oldestWaitingAt: new Date() }] }).client, workspaceId, beat(5));
    expect(backlog.attention.reason).toBe("backlog");
    const unknown = await instance.read(fakeClient({}).client, workspaceId, null);
    expect(unknown).toMatchObject({ worker: { status: "unknown" }, attention: { reason: null } });
  });

  it("says when a delivery allowlist limits who receives anything", async () => {
    const { instance } = service({ DELIVERY_ALLOWLIST: "*@example.com" }, true);
    expect((await instance.read(fakeClient({}).client, workspaceId, beat(1))).allowlist).toBe(true);
  });

  it("sends the owner a test email, and a push to a registered phone, through the normal queue", async () => {
    const { instance, current } = service({}, true);
    const fake = fakeClient({ devices: 1 });
    current.client = fake.client;
    expect(await instance.sendTest({} as never, workspaceId, { requestId: "11111111-1111-4111-8111-111111111111" })).toEqual({ email: "queued", push: "queued" });
    const inserts = fake.calls.filter((call) => call.sql.includes("INSERT INTO notifications"));
    expect(inserts.map((call) => call.values[2])).toEqual(["email", "push"]);
    expect(inserts[0].values[3]).toBe("Test message from Studio North");
    expect(fake.calls.filter((call) => call.sql.includes("notification.delivery_requested.v1"))).toHaveLength(2);
    expect(fake.calls.some((call) => call.sql.includes("INSERT INTO audit_events"))).toBe(true);
  });

  it("allows one test a minute and replays a repeated request", async () => {
    const { instance, current } = service({}, true);
    current.client = fakeClient({ recentTest: true }).client;
    await expect(instance.sendTest({} as never, workspaceId, { requestId: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow("a moment ago");
    current.client = fakeClient({ replay: [{ channel: "email" }] }).client;
    expect(await instance.sendTest({} as never, workspaceId, { requestId: "22222222-2222-4222-8222-222222222222" })).toMatchObject({ email: "queued", push: "no_device", idempotentReplay: true });
  });
});

describe("staff email actions (FD-8)", () => {
  it("names one action per event, then per module", () => {
    expect(staffEmailAction("quotation.review_requested")).toBe("Review quote");
    expect(staffEmailAction("purchasing.approval_needed")).toBe("Approve order");
    expect(staffEmailAction("site.incident")).toBe("Open report");
    expect(staffEmailAction("crm.lead.assigned")).toBe("Open enquiry");
    expect(staffEmailAction("project.started")).toBe("Open project");
    expect(staffEmailAction("something.else")).toBe("Open in workspace");
    expect(staffEmailAction("work.assigned", "portal_contact")).toBe("Open your project");
  });
});
