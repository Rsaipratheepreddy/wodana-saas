import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ALLOW_WHEN_READ_ONLY_KEY, TenantWriteBlockGuard, writeBlockFor } from "./tenant-write-block.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function guardFor(status: string, metadata: Record<string, boolean> = {}) {
  const query = vi.fn(async () => ({ rows: [{ status }] }));
  const database = { tenantTransaction: vi.fn(async (_w: string, _a: string, work: (client: { query: typeof query }) => unknown) => work({ query })) };
  const reflector = { getAllAndOverride: (key: string) => metadata[key] ?? false };
  return { guard: new TenantWriteBlockGuard(reflector as never, database as never), database };
}

const context = (method: string, params: Record<string, string> = { workspaceId }) => ({
  getType: () => "http", getHandler: () => undefined, getClass: () => undefined,
  switchToHttp: () => ({ getRequest: () => ({ method, params }) }),
}) as never;

describe("suspended organizations are read-only", () => {
  it("lets reads through without asking the database", async () => {
    const { guard, database } = guardFor("suspended");
    await expect(guard.canActivate(context("GET"))).resolves.toBe(true);
    expect(database.tenantTransaction).not.toHaveBeenCalled();
  });

  it("refuses a change with 423 and the reason", async () => {
    const { guard } = guardFor("suspended");
    const error = await guard.canActivate(context("PATCH")).catch((reason: unknown) => reason) as HttpException;
    expect(error.getStatus()).toBe(423);
    expect(error.getResponse()).toMatchObject({ code: "organization_read_only" });
  });

  it("keeps exports and previews that use POST available", async () => {
    const { guard } = guardFor("suspended", { [ALLOW_WHEN_READ_ONLY_KEY]: true });
    await expect(guard.canActivate(context("POST"))).resolves.toBe(true);
  });

  it("does not apply to public routes, active organizations or routes without an organization", async () => {
    await expect(guardFor("suspended", { [IS_PUBLIC_KEY]: true }).guard.canActivate(context("POST"))).resolves.toBe(true);
    await expect(guardFor("active").guard.canActivate(context("POST"))).resolves.toBe(true);
    await expect(guardFor("suspended").guard.canActivate(context("POST", {}))).resolves.toBe(true);
    await expect(guardFor("suspended").guard.canActivate(context("POST", { workspaceId: "not-a-uuid" }))).resolves.toBe(true);
  });

  it("names archived organizations separately", () => {
    expect(writeBlockFor("archived")?.getStatus()).toBe(403);
    expect(writeBlockFor("active")).toBeNull();
  });
});
