import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
