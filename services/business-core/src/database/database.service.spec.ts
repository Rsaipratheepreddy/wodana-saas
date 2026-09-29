import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCommandOrigin } from "./command-origin";
import { DatabaseService } from "./database.service";

const pool = vi.hoisted(() => ({
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function Pool() {
    return pool;
  }),
}));

describe("DatabaseService", () => {
  beforeEach(() => {
    pool.end.mockClear();
    pool.on.mockClear();
    vi.restoreAllMocks();
  });

  it("handles an idle PostgreSQL client error instead of crashing the process", () => {
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    new DatabaseService({
      get: (key: string, fallback?: unknown) => key === "DATABASE_URL" ? "postgresql://local" : fallback,
    } as ConfigService);

    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = pool.on.mock.calls.find(([event]) => event === "error")?.[1] as (error: Error) => void;
    const error = new Error("terminating connection due to administrator command");

    expect(() => handler(error)).not.toThrow();
    expect(log).toHaveBeenCalledWith(`PostgreSQL pool error: ${error.message}`, error.stack);
  });

  it("marks a Woddy-confirmed command's transactions so their audit rows record where it came from", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    (pool as unknown as { connect: () => Promise<typeof client> }).connect = vi.fn(async () => client);
    const database = new DatabaseService({ get: (key: string, fallback?: unknown) => key === "DATABASE_URL" ? "postgresql://local" : fallback } as ConfigService);
    await database.tenantTransaction("w-1", "u-1", async () => null);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("app.command_via"))).toBe(false);
    await runWithCommandOrigin({ via: "woddy", runId: "r-1" }, () => database.tenantTransaction("w-1", "u-1", async () => null));
    expect(client.query).toHaveBeenCalledWith("SELECT set_config('app.command_via', $1, true), set_config('app.ai_run_id', $2, true)", ["woddy", "r-1"]);
  });
});
