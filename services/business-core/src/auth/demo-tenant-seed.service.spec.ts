import { describe, expect, it, vi } from "vitest";
import { DemoTenantSeedService } from "./demo-tenant-seed.service";

describe("DemoTenantSeedService", () => {
  it("keeps the customer owner out of platform administration", async () => {
    const config = { get: vi.fn().mockReturnValue("true") };
    const workspaces = {
      provisionTenant: vi.fn().mockResolvedValue({ workspace: { id: "00000000-0000-4000-8000-000000000002" } }),
    };
    const auth = { ensureDemoAccount: vi.fn().mockResolvedValue(undefined) };
    const database = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const service = new DemoTenantSeedService(
      config as never,
      workspaces as never,
      auth as never,
      database as never,
    );

    await service.onApplicationBootstrap();

    expect(database.query.mock.calls.map(([sql]) => sql).join("\n")).not.toContain("platform_administrators");
  });
});
