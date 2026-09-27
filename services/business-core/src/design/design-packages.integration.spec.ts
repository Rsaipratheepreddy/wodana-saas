import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesignPackagesService } from "./design-packages.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("design packages (PLM-041)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, ids: { workspaceId: string; service: DesignPackagesService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [actor, `d-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Design',$2,'AED',$3)", [workspaceId, `d-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor });
      await work(client, { workspaceId, service: new DesignPackagesService({ withPermission: run, withAnyPermission: run } as never) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("keeps a price list, quotes a fee from area or spaces and stops quoting archived packages", async () => {
    await withWorkspace(async (client, { workspaceId, service }) => {
      const bespoke = await service.savePackage(actor, workspaceId, { code: "bespoke", name: "Bespoke interior design", pricingMethod: "per_area", rate: "40", currency: "AED", areaUnit: "sqft", includesRenders: true, includesSpacePlanning: true });
      const concept = await service.savePackage(actor, workspaceId, { code: "concept", name: "Concept package", pricingMethod: "per_space", rate: "10000", currency: "AED" });
      await expect(service.savePackage(actor, workspaceId, { code: "concept", name: "Again", pricingMethod: "fixed", rate: "1", currency: "AED" })).rejects.toThrow(/already exists/);
      expect(await service.quote(actor, workspaceId, bespoke.id, { area: "1500" })).toMatchObject({ fee: "60000.00", currency: "AED", areaUnit: "sqft" });
      expect(await service.quote(actor, workspaceId, concept.id, { spaces: 3 })).toMatchObject({ fee: "30000.00" });
      await expect(service.savePackage(actor, workspaceId, { ...bespoke, id: bespoke.id, version: 99, rate: "45" })).rejects.toThrow(/another window/);
      const updated = await service.savePackage(actor, workspaceId, { ...bespoke, id: bespoke.id, version: bespoke.version, rate: "45" });
      expect(updated).toMatchObject({ rate: "45.00", version: 2 });
      await service.setStatus(actor, workspaceId, concept.id, { status: "archived", version: concept.version });
      await expect(service.quote(actor, workspaceId, concept.id, { spaces: 1 })).rejects.toThrow(/no longer offered/);
      const audit = await client.query("SELECT action FROM audit_events WHERE workspace_id=$1 ORDER BY occurred_at", [workspaceId]);
      expect(audit.rows.map((row) => row.action)).toEqual(["design.package_created", "design.package_created", "design.package_updated", "design.package_archived"]);
    });
  });

  it("stores the minimum design deposit and hands it to new cases", async () => {
    await withWorkspace(async (client, { workspaceId, service }) => {
      expect(await DesignPackagesService.minimumDeposit(client, workspaceId)).toBeNull();
      const saved = await service.saveMinimumDeposit(actor, workspaceId, { minimumDeposit: { amount: "15000.00", currency: "AED" } });
      expect(saved.minimumDeposit).toEqual({ amount: "15000.00", currency: "AED" });
      await expect(service.saveMinimumDeposit(actor, workspaceId, { minimumDeposit: null, version: 0 })).rejects.toThrow(/another window/);
      expect(await DesignPackagesService.minimumDeposit(client, workspaceId)).toEqual({ amount: "15000.00", currency: "AED" });
    });
  });

  it("keeps a new company's minimum deposit empty: timings alone or a zero amount never read as 0", async () => {
    await withWorkspace(async (client, { workspaceId, service }) => {
      const timingsOnly = await service.saveMinimumDeposit(actor, workspaceId, { timings: { inspirationDays: 5, siteVisitHours: 48 } });
      expect(timingsOnly.minimumDeposit).toBeNull();
      expect(timingsOnly.timings).toEqual({ inspirationDays: 5, siteVisitHours: 48 });
      const zero = await service.saveMinimumDeposit(actor, workspaceId, { minimumDeposit: { amount: "0", currency: "AED" }, version: timingsOnly.version });
      expect(zero.minimumDeposit).toBeNull();
      expect(await DesignPackagesService.minimumDeposit(client, workspaceId)).toBeNull();
      const stored = await client.query("SELECT minimum_design_deposit, currency FROM workspace_design_settings WHERE workspace_id=$1", [workspaceId]);
      expect(stored.rows[0]).toEqual({ minimum_design_deposit: null, currency: null });
    });
  });
});
