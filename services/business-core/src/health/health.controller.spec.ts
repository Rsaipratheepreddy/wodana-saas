import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
