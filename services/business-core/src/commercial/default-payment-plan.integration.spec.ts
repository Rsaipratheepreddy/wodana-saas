import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDefaultPaymentPlan, seedKitPaymentPlan, startingMilestones } from "./default-payment-plan";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("a new quote's payment milestones (Q-34)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorkspace(work: (client: PoolClient, workspaceId: string) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, randomUUID()]);
      await work(client, workspaceId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const kit = { name: "Thirds", milestones: [
    { title: "Advance", percent: 40, trigger: "On signing", requiredForRelease: true },
    { title: "Carpentry", percent: 40, trigger: "Before carpentry" },
    { title: "Handover", percent: 20, trigger: "At handover" },
  ] };

  it("starts a quote from the firm kit's plan with its own milestone ids", async () => {
    await withWorkspace(async (client, workspaceId) => {
      const id = await seedKitPaymentPlan(client, workspaceId, kit);
      const plan = await readDefaultPaymentPlan(client, workspaceId);
      expect(plan).toMatchObject({ id, name: "Thirds", version: 1 });
      const first = startingMilestones(plan), second = startingMilestones(plan);
      expect(first.paymentTerms.map((term) => [term.title, term.percent, term.requiredForRelease])).toEqual([["Advance", 40, true], ["Carpentry", 40, false], ["Handover", 20, false]]);
      expect(first.paymentTemplate).toEqual({ id, version: 1, name: "Thirds" });
      expect(first.paymentTerms[0].id).not.toBe(second.paymentTerms[0].id);
    });
  });

  it("leaves a firm without a default (or with an archived one) on no milestones, and ignores a kit that doesn't add up", async () => {
    await withWorkspace(async (client, workspaceId) => {
      expect(await readDefaultPaymentPlan(client, workspaceId)).toBeNull();
      expect(startingMilestones(null)).toEqual({ paymentTerms: [] });
      expect(await seedKitPaymentPlan(client, workspaceId, { milestones: [{ title: "All", percent: 50, trigger: "x", requiredForRelease: true }] })).toBeNull();
      const id = await seedKitPaymentPlan(client, workspaceId, kit);
      await client.query(`UPDATE commercial_payment_templates SET status = 'archived' WHERE id = $1`, [id]);
      expect(await readDefaultPaymentPlan(client, workspaceId)).toBeNull();
    });
  });
});
