import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaxNumberingService } from "./tax-numbering.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("tax and document numbering", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withEntity(country: string, work: (client: PoolClient, ids: { workspaceId: string; entityId: string; service: TaxNumberingService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), entityId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Tester')", [actor, `t-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // skip provisioning triggers for this insert only, no table lock
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Tax',$2,'AED',$3)", [workspaceId, `tax-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'MAIN','Main','Main LLC',$3,'AED','en-AE','Asia/Dubai')`, [entityId, workspaceId, country]);
      const access = { withPermission: (_a: unknown, _w: string, _p: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor }),
        withAnyPermission: (_a: unknown, _w: string, _p: string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: actor }) };
      await work(client, { workspaceId, entityId, service: new TaxNumberingService(access as never) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("allocates numbers forward, continues from a set number and resets yearly with the year in the prefix", async () => {
    await withEntity("AE", async (client, { workspaceId, entityId, service }) => {
      await service.saveNumbering(actor, workspaceId, entityId, "QUOTATION", { prefix: "Q-{YYYY}-", padding: 4, resetPolicy: "annual", nextNumber: 250 });
      const allocate = async (at: string) => (await client.query<{ n: string }>("SELECT allocate_document_number($1,$2,'QUOTATION',$3::timestamptz) AS n", [workspaceId, entityId, at])).rows[0].n;
      expect(await allocate("2026-09-25T10:00:00Z")).toBe("Q-2026-0250");
      expect(await allocate("2026-09-25T10:00:01Z")).toBe("Q-2026-0251");
      // 31 Dec 21:00 UTC is already 1 January in Dubai: the entity's time zone decides the year.
      expect(await allocate("2026-12-31T21:00:00Z")).toBe("Q-2027-0001");
      await client.query("SAVEPOINT back");
      await expect(client.query("UPDATE document_sequences SET next_number = 1 WHERE legal_entity_id=$1 AND document_type='QUOTATION'", [entityId])).rejects.toThrow(/only move forward/);
      await client.query("ROLLBACK TO SAVEPOINT back");
      await expect(service.saveNumbering(actor, workspaceId, entityId, "QUOTATION", { version: 99, prefix: "Q-", padding: 4, resetPolicy: "never" })).rejects.toThrow(/changed/);
    });
  });

  it("keeps old tax rates on record when rates change, and reports an unconfigured tax as null", async () => {
    await withEntity("AE", async (client, { workspaceId, entityId, service }) => {
      const empty = await service.get(actor, workspaceId, entityId);
      expect(empty.tax).toBeNull();
      expect(empty.taxModel).toMatchObject({ model: "vat", label: "VAT", registrationLabel: "TRN" });
      const first = await service.saveTax(actor, workspaceId, entityId, { pricesIncludeTax: false, rates: [{ code: "standard", label: "Standard", rate: "5", isDefault: true }] });
      expect(first.tax?.rates).toEqual([{ code: "standard", label: "Standard", rate: "5.0000", isDefault: true }]);
      const second = await service.saveTax(actor, workspaceId, entityId, { version: first.tax!.version, pricesIncludeTax: false, rates: [{ code: "standard", label: "Standard", rate: "7.5", isDefault: true }] });
      expect(second.tax?.rates[0].rate).toBe("7.5000");
      const history = await client.query("SELECT rate::text, effective_to IS NULL AS current FROM tax_rates WHERE workspace_id=$1 ORDER BY created_at, effective_to NULLS LAST", [workspaceId]);
      expect(history.rows).toEqual([{ rate: "5.0000", current: false }, { rate: "7.5000", current: true }]);
    });
  });

  it("refuses rates in a country without sales tax", async () => {
    await withEntity("QA", async (_client, { workspaceId, entityId, service }) => {
      await expect(service.saveTax(actor, workspaceId, entityId, { pricesIncludeTax: false, rates: [{ code: "x", label: "X", rate: "5", isDefault: true }] })).rejects.toThrow(/no sales tax/);
    });
  });
});
