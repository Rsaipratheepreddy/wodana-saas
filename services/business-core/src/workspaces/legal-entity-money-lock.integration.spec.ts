import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyCommercial } from "../commercial/commercial.domain";
import { commercialRepository } from "../commercial/commercial-repository";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("legal entity currency and country lock", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withEntity(work: (client: PoolClient, ids: { workspaceId: string; entityId: string; caseId: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), entityId = randomUUID(), caseId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      for (const table of ["workspaces", "pre_project_cases"]) await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Lock',$2,'AED',$3)", [workspaceId, `lock-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, randomUUID(), actor]);
      for (const table of ["workspaces", "pre_project_cases"]) await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      await client.query(
        `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
         VALUES($1,$2,'MAIN','Main','Main LLC','AE','AED','en-AE','Asia/Dubai')`,
        [entityId, workspaceId],
      );
      await work(client, { workspaceId, entityId, caseId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("allows changing currency and country before any money exists", async () => {
    await withEntity(async (client, { entityId }) => {
      await client.query("UPDATE legal_entities SET base_currency='SAR', country_code='SA' WHERE id=$1", [entityId]);
      const row = await client.query("SELECT base_currency, country_code FROM legal_entities WHERE id=$1", [entityId]);
      expect(row.rows[0]).toEqual({ base_currency: "SAR", country_code: "SA" });
    });
  });

  it("blocks currency and country changes once a payment request exists, but allows other edits", async () => {
    await withEntity(async (client, { workspaceId, entityId, caseId }) => {
      await commercialRepository.save(client, workspaceId, caseId, {
        ...emptyCommercial(), revision: 1,
        payments: [{ id: "p1", title: "Advance", amount: 1000, dueDate: "", requiredForRelease: true, status: "pending", proof: "", reference: "", legalEntityId: entityId, currency: "AED" }],
      });
      await client.query("UPDATE legal_entities SET display_name='Renamed' WHERE id=$1", [entityId]);
      await client.query("SAVEPOINT currency");
      await expect(client.query("UPDATE legal_entities SET base_currency='SAR' WHERE id=$1", [entityId])).rejects.toThrow(/currency and country are fixed/);
      await client.query("ROLLBACK TO SAVEPOINT currency");
      await expect(client.query("UPDATE legal_entities SET country_code='SA' WHERE id=$1", [entityId])).rejects.toThrow(/currency and country are fixed/);
    });
  });
});
