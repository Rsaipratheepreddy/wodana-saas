import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommercialService } from "./commercial.service";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("the legal entity behind a planning case's agreement", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withCase(entities: number, work: (client: PoolClient, workspaceId: string, caseId: string) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'AED',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, actor]);
      for (let index = 0; index < entities; index++)
        await client.query(`INSERT INTO legal_entities(workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
          VALUES($1,$2,$3,$3,'AE','AED','en-AE','Asia/Dubai')`, [workspaceId, `E${index}`, `Entity ${index}`]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Client','client')", [partyId, workspaceId]);
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$4,$5,'Villa','O-1')", [opportunityId, workspaceId, partyId, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, actor]);
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, workspaceId, caseId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const service = new CommercialService({} as never, {} as never, {} as never, {} as never);

  it("uses the firm's only legal entity when the opportunity names none", async () => {
    await withCase(1, async (client, workspaceId, caseId) => {
      const record = await service.caseRecord(client, workspaceId, caseId, true);
      expect(record).toMatchObject({ legalEntityCode: "E0", legalEntityRegisteredName: "Entity 0", legalEntityBaseCurrency: "AED" });
    });
  });

  it("doesn't guess between several legal entities", async () => {
    await withCase(2, async (client, workspaceId, caseId) => {
      const record = await service.caseRecord(client, workspaceId, caseId, true);
      expect(record.legalEntityId).toBeNull();
    });
  });
});
