import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SALES_PIPELINE, seedDefaultSalesPipeline } from "./default-sales-pipeline";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("default sales pipeline (seeded per workspace)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, workspaceId: string) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [actor, `p-${actor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Pipeline',$2,'AED',$3)", [workspaceId, `p-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, workspaceId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const pipelines = (client: PoolClient, workspaceId: string) => client.query<{ code: string; status: string; isDefault: boolean; stages: number }>(
    `SELECT pipeline.code, pipeline.status, pipeline.is_default AS "isDefault",
            (SELECT count(*)::int FROM crm_pipeline_stages stage WHERE stage.pipeline_id = pipeline.id AND stage.status = 'active') AS stages
       FROM crm_pipelines pipeline WHERE pipeline.workspace_id = $1 ORDER BY pipeline.code`, [workspaceId]);

  it("gives a new workspace one default Sales pipeline with active stages, once", async () => {
    await withWorkspace(async (client, workspaceId) => {
      const first = await seedDefaultSalesPipeline(client, workspaceId);
      expect(first.created).toBe(true);
      const again = await seedDefaultSalesPipeline(client, workspaceId);
      expect(again).toEqual({ pipelineId: first.pipelineId, created: false });
      expect((await pipelines(client, workspaceId)).rows).toEqual([{ code: "sales", status: "active", isDefault: true, stages: DEFAULT_SALES_PIPELINE.stages.length }]);
      const stages = await client.query<{ code: string; position: number; probability: string }>(
        `SELECT code, position, probability::text AS probability FROM crm_pipeline_stages WHERE workspace_id = $1 ORDER BY position`, [workspaceId]);
      expect(stages.rows.map((stage) => stage.code)).toEqual(["qualified", "intro_booked", "qualification", "proposal", "negotiation", "won", "lost"]);
      expect(stages.rows.map((stage) => Number(stage.probability))).toEqual([20, 25, 35, 50, 75, 100, 0]);
    });
  });

  it("brings an archived Sales pipeline back rather than duplicating its code, and demotes no usable default", async () => {
    await withWorkspace(async (client, workspaceId) => {
      await client.query(`INSERT INTO crm_pipelines (workspace_id, code, name, is_default, status) VALUES ($1, 'sales', 'Old sales', false, 'archived')`, [workspaceId]);
      const seeded = await seedDefaultSalesPipeline(client, workspaceId);
      expect(seeded.created).toBe(true);
      expect((await pipelines(client, workspaceId)).rows).toEqual([{ code: "sales", status: "active", isDefault: true, stages: 7 }]);
    });
    await withWorkspace(async (client, workspaceId) => {
      const own = await client.query<{ id: string }>(`INSERT INTO crm_pipelines (workspace_id, code, name, is_default) VALUES ($1, 'design_sales', 'Design sales', true) RETURNING id`, [workspaceId]);
      await client.query(`INSERT INTO crm_pipeline_stages (workspace_id, pipeline_id, code, name, position) VALUES ($1, $2, 'discovery', 'Discovery', 1)`, [workspaceId, own.rows[0].id]);
      await expect(seedDefaultSalesPipeline(client, workspaceId)).resolves.toEqual({ pipelineId: own.rows[0].id, created: false });
      expect((await pipelines(client, workspaceId)).rows).toEqual([{ code: "design_sales", status: "active", isDefault: true, stages: 1 }]);
    });
  });
});
