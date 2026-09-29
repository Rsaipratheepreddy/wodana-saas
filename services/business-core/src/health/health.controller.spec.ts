import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({ heartbeat: null as string | null }));
vi.mock("redis", () => ({
  createClient: () => ({
    on: () => undefined,
    connect: async () => undefined,
    ping: async () => "PONG",
    get: async () => redis.heartbeat,
    quit: async () => undefined,
    isOpen: false,
    destroy: () => undefined,
  }),
}));

import { HealthController, WORKER_HEARTBEAT_KEY, workerHeartbeat } from "./health.controller";
import { readWorkerBeat } from "./worker-heartbeat";

const now = Date.parse("2026-09-27T12:00:00.000Z");
const beat = (secondsAgo: number) => JSON.stringify({ at: new Date(now - secondsAgo * 1000).toISOString(), consumer: "worker-1" });

describe("worker heartbeat", () => {
  it("reads the key the Python worker writes", () => {
    expect(WORKER_HEARTBEAT_KEY).toBe("wodana:worker:heartbeat");
  });

  it("is ok while the worker beats, stale after two minutes, and not reporting without a beat", () => {
    expect(workerHeartbeat(beat(5), now)).toBe("ok");
    expect(workerHeartbeat(beat(120), now)).toBe("ok");
    expect(workerHeartbeat(beat(600), now)).toBe("stale (600s)");
    expect(workerHeartbeat(null, now)).toBe("not-reporting");
    expect(workerHeartbeat("{not json", now)).toBe("stale (unreadable)");
  });
});

describe("readiness with the worker", () => {
  const database = { query: vi.fn(async () => ({ rows: [{ pending: "0", oldestSeconds: null }] })) };
  const controller = (env: Record<string, string>) => new HealthController(database as never, new ConfigService(env));
  beforeEach(() => { redis.heartbeat = null; });

  it("stays ready and reports a stale worker as degraded", async () => {
    redis.heartbeat = JSON.stringify({ at: new Date(Date.now() - 900_000).toISOString() });
    const ready = await controller({ REDIS_URL: "redis://localhost:6379/0" }).ready();
    expect(ready).toMatchObject({ status: "ready", degraded: ["worker"] });
    expect(ready.checks.worker).toMatch(/^stale/);
  });

  it("doesn't fail or degrade locally when no worker runs", async () => {
    const ready = await controller({ REDIS_URL: "redis://localhost:6379/0" }).ready();
    expect(ready.status).toBe("ready");
    expect(ready.checks.worker).toBe("not-reporting");
    expect("degraded" in ready).toBe(false);
    const noRedis = await controller({}).ready();
    expect(noRedis.checks.worker).toBe("not-configured");
  });

  it("is ok with a fresh beat", async () => {
    redis.heartbeat = JSON.stringify({ at: new Date().toISOString() });
    const ready = await controller({ REDIS_URL: "redis://localhost:6379/0" }).ready();
    expect(ready.checks.worker).toBe("ok");
    expect("degraded" in ready).toBe(false);
  });
});

describe("readiness in production", () => {
  const database = { query: vi.fn(async () => ({ rows: [{ pending: "0", oldestSeconds: null }] })) };
  const production = { NODE_ENV: "production", REDIS_URL: "redis://localhost:6379/0", INTELLIGENCE_API_URL: "http://127.0.0.1:18001/api/v1", WODANA_RELEASE_ID: "20260928-web" };
  const controller = (uptime: number) => {
    const instance = new HealthController(database as never, new ConfigService(production));
    instance.uptimeSeconds = () => uptime;
    return instance;
  };
  const failure = async (promise: Promise<unknown>) => {
    try { await promise; } catch (error) { return (error as { getResponse(): Record<string, unknown> }).getResponse(); }
    throw new Error("expected not ready");
  };
  beforeEach(() => {
    redis.heartbeat = null;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is not ready when the worker is stale or silent, so a release without a live worker fails", async () => {
    redis.heartbeat = JSON.stringify({ at: new Date(Date.now() - 600_000).toISOString(), release: "old" });
    expect(await failure(controller(3_600).ready())).toMatchObject({ status: "not-ready", criticalFailures: ["worker"], checks: { worker: "stale (600s)", workerRelease: "old" } });
    redis.heartbeat = null;
    expect(await failure(controller(3_600).ready())).toMatchObject({ criticalFailures: ["worker"], checks: { worker: "not-reporting" } });
  });

  it("gives a freshly started core a grace period for its worker to report", async () => {
    const ready = await controller(20).ready();
    expect(ready).toMatchObject({ status: "ready", degraded: ["worker"] });
  });

  it("names the release and delivery mode of a live worker, and refuses one that doesn't deliver live", async () => {
    redis.heartbeat = JSON.stringify({ at: new Date().toISOString(), release: "20260928-web", adapter: "live" });
    const ready = await controller(3_600).ready();
    expect(ready).toMatchObject({ status: "ready", checks: { worker: "ok", workerRelease: "20260928-web", workerDelivery: "live" } });
    expect("degraded" in ready).toBe(false);
    redis.heartbeat = JSON.stringify({ at: new Date().toISOString(), adapter: "unconfigured" });
    expect(await failure(controller(3_600).ready())).toMatchObject({ criticalFailures: ["workerDelivery"] });
  });
});

describe("worker beat", () => {
  it("reads the release and delivery mode", () => {
    const beat = readWorkerBeat(JSON.stringify({ at: new Date(now - 10_000).toISOString(), release: "r1", adapter: "live" }), now);
    expect(beat).toMatchObject({ status: "ok", ageSeconds: 10, release: "r1", adapter: "live" });
    expect(readWorkerBeat(null, now)).toMatchObject({ status: "not-reporting", at: null });
  });
});
