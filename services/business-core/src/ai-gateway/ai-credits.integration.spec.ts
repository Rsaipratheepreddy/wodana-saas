import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { applyCreditEntry, chargeUsage, checkCredits } from "./ai-credits";
import { readCreditOverview } from "./ai-credits.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("AI credits", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { a: string; b: string; owner: string; operator: string };
  const tenant = (client: PoolClient, workspaceId: string) => client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
  const failure = async (client: PoolClient, work: () => Promise<unknown>) => {
    await client.query("SAVEPOINT expected_failure");
    try { await work(); return null; } catch (error) { return error as { code?: string; message: string }; }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };

  async function world(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const ids: Ids = { a: randomUUID(), b: randomUUID(), owner: randomUUID(), operator: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const [id, name] of [[ids.owner, "Olivia Owner"], [ids.operator, "Omar Operator"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `ai-${id.slice(0, 8)}@example.com`, name]);
      }
      for (const [workspaceId, name] of [[ids.a, "Studio A"], [ids.b, "Studio B"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [workspaceId, name, `ai-${workspaceId.slice(0, 8)}`, ids.owner]);
      }
      const membership = randomUUID(), role = randomUUID();
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.a, ids.owner]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'owner','Owner',true)", [role, ids.a]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.a, membership, role]);
      await client.query("INSERT INTO platform_administrators(user_id, role) VALUES($1,'account_billing_operator')", [ids.operator]);
      await seedDefaultNotificationTemplates(client, ids.a);
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("keeps each workspace's balance and ledger to itself; the ledger is append-only and rates read-only", async () => {
    await world(async (client, { a, b }) => {
      await tenant(client, a);
      await applyCreditEntry(client, { workspaceId: a, entryType: "top_up", credits: "50", idempotencyKey: "operator:a-1", reference: "INV-1" });
      await tenant(client, b);
      await applyCreditEntry(client, { workspaceId: b, entryType: "top_up", credits: "10", idempotencyKey: "operator:b-1", reference: "INV-2" });

      const guarded = await client.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        [["ai_credit_accounts", "ai_credit_ledger"]]);
      expect(guarded.rows.map((row) => row.name)).toEqual(["ai_credit_accounts", "ai_credit_ledger"]);

      await client.query("SET LOCAL ROLE wodana_app");
      await tenant(client, a);
      const accounts = await client.query<{ workspaceId: string; balance: string }>(`SELECT workspace_id AS "workspaceId", balance::text AS balance FROM ai_credit_accounts`);
      expect(accounts.rows).toEqual([{ workspaceId: a, balance: "1050.0000" }]);
      const ledger = await client.query<{ workspaceId: string; entryType: string }>(`SELECT workspace_id AS "workspaceId", entry_type AS "entryType" FROM ai_credit_ledger ORDER BY created_at, entry_type`);
      expect(ledger.rows.map((row) => row.workspaceId)).toEqual([a, a]);
      expect(ledger.rows.map((row) => row.entryType).sort()).toEqual(["grant", "top_up"]);

      // Another workspace's rows can be neither written nor changed from here.
      expect(await failure(client, () => client.query(
        `INSERT INTO ai_credit_ledger (workspace_id, entry_type, credits, balance_after, idempotency_key) VALUES ($1, 'top_up', 5, 5, 'sneak')`, [b])))
        .toMatchObject({ message: expect.stringMatching(/row-level security/) });
      expect((await client.query(`UPDATE ai_credit_accounts SET balance = 1 WHERE workspace_id = $1`, [b])).rowCount).toBe(0);
      expect(await failure(client, () => client.query(`UPDATE ai_credit_ledger SET credits = 1`))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query(`DELETE FROM ai_credit_ledger`))).toMatchObject({ code: "42501" });

      // Rates: readable, changed only through the operator function.
      expect((await client.query(`SELECT model FROM ai_model_rates WHERE active`)).rowCount).toBeGreaterThanOrEqual(8);
      expect(await failure(client, () => client.query(`UPDATE ai_model_rates SET margin = 1`))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query(`SELECT * FROM control_plane_ai_credits()`))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query(`SELECT * FROM control_plane_set_ai_model_rate('apac.amazon.nova-lite-v1:0', 1, 1, 1, 1, true, true)`))).toMatchObject({ code: "42501" });
      // The platform total is one number across workspaces.
      expect((await client.query<{ used: string }>(`SELECT ai_platform_usage_today()::text AS used`)).rows[0].used).toMatch(/^\d+\.\d{4}$/);
    });
  });

  it("meters calls as the app role: welcome grant, Nova Lite price, one charge per call, daily caps, notices once per crossing", async () => {
    await world(async (client, { a, owner }) => {
      await client.query("SET LOCAL ROLE wodana_app");
      await tenant(client, a);
      const limits = { welcome: "1000.0000", workspaceDaily: "1000.0000", platformDaily: "1000000.0000" };
      await expect(checkCredits(client, a, limits)).resolves.toBeNull();

      const callId = randomUUID();
      const usage = { workspaceId: a, callId, model: "apac.amazon.nova-lite-v1:0", feature: "crm.chat", usage: { input_tokens: 2000, output_tokens: 300 }, userId: owner };
      await chargeUsage(client, usage);
      await chargeUsage(client, usage);
      let overview = await readCreditOverview(client, a);
      expect(overview).toMatchObject({ balance: "999.7120", state: "ok", threshold: "200.0000", usedThisMonth: "0.2880", usedToday: "0.2880",
        byFeature: [{ feature: "crm.chat", credits: "0.2880", calls: 1 }] });
      expect(overview.ledger.map((entry) => [entry.entryType, entry.credits])).toEqual([["usage", "-0.2880"], ["grant", "1000.0000"]]);

      await expect(checkCredits(client, a, { ...limits, workspaceDaily: "0.2" })).resolves.toBe("workspace_daily");
      await expect(checkCredits(client, a, { ...limits, platformDaily: "0.1" })).resolves.toBe("platform_daily");

      const notices = async () => (await client.query<{ code: string; channel: string }>(
        `SELECT template.code, notification.channel FROM notifications notification JOIN notification_templates template ON template.id = notification.template_id
          WHERE notification.workspace_id = $1 AND notification.recipient_id = $2 AND template.code LIKE 'ai.%' ORDER BY notification.created_at, notification.channel`, [a, owner])).rows;
      // Below the line (20% of the 1,000 welcome credits): owners hear once, in the app and by email.
      await applyCreditEntry(client, { workspaceId: a, entryType: "adjustment", credits: "-999.5", idempotencyKey: "operator:fix-1", reference: "Correction" });
      await chargeUsage(client, { ...usage, callId: randomUUID(), usage: { input_tokens: 10, output_tokens: 10 } });
      expect(await notices()).toEqual([{ code: "ai.credits_low", channel: "email" }, { code: "ai.credits_low", channel: "in_app" }]);

      // The last call may go slightly negative; the next is refused and owners hear that it ran out, once.
      await chargeUsage(client, { ...usage, callId: randomUUID(), usage: { input_tokens: 5000, output_tokens: 1000 } });
      overview = await readCreditOverview(client, a);
      expect(overview.state).toBe("exhausted");
      expect(overview.balance.startsWith("-")).toBe(true);
      await expect(checkCredits(client, a, limits)).resolves.toBe("exhausted");
      expect((await notices()).filter((notice) => notice.code === "ai.credits_exhausted")).toHaveLength(2);

      // A top-up re-arms both notices.
      await applyCreditEntry(client, { workspaceId: a, entryType: "top_up", credits: "500", idempotencyKey: "operator:top-2", reference: "INV-3", createdBy: owner });
      const flags = await client.query(`SELECT low_balance_notified_at, exhausted_notified_at, last_top_up_credits::text AS credits FROM ai_credit_accounts WHERE workspace_id = $1`, [a]);
      expect(flags.rows[0]).toEqual({ low_balance_notified_at: null, exhausted_notified_at: null, credits: "500.0000" });
      await expect(checkCredits(client, a, limits)).resolves.toBeNull();
    });
  });

  it("lets an active operator list every organization's credits and change a rate, version-checked", async () => {
    await world(async (client, { a, b, operator }) => {
      await client.query("SET LOCAL ROLE wodana_app");
      await tenant(client, a);
      await chargeUsage(client, { workspaceId: a, callId: randomUUID(), model: "apac.amazon.nova-lite-v1:0", feature: "commercial.assist", usage: { input_tokens: 1_000_000, output_tokens: 0 }, userId: null });
      await client.query("SELECT set_config('app.current_workspace_id','',true), set_config('app.current_actor_id',$1,true)", [operator]);
      const rows = await client.query<{ workspaceId: string; hasAccount: boolean; balance: string | null; used: string }>(
        `SELECT workspace_id AS "workspaceId", has_account AS "hasAccount", balance::text AS balance, used_this_month::numeric(14,4)::text AS used
           FROM control_plane_ai_credits() WHERE workspace_id = ANY($1::uuid[]) ORDER BY organization_name`, [[a, b]]);
      expect(rows.rows).toEqual([
        { workspaceId: a, hasAccount: true, balance: "910.0000", used: "90.0000" },
        { workspaceId: b, hasAccount: false, balance: null, used: "0.0000" },
      ]);
      const version = (await client.query<{ version: number }>(`SELECT version FROM ai_model_rates WHERE model = 'apac.amazon.nova-lite-v1:0'`)).rows[0].version;
      const changed = await client.query<{ input: string; output: string; version: number }>(
        `SELECT input_credits_per_million::text AS input, output_credits_per_million::text AS output, version
           FROM control_plane_set_ai_model_rate('apac.amazon.nova-lite-v1:0', $1, 0.06, 0.24, 2, true, true)`, [version]);
      expect(changed.rows).toEqual([{ input: "120.0000", output: "480.0000", version: version + 1 }]);
      expect((await client.query(`SELECT * FROM control_plane_set_ai_model_rate('apac.amazon.nova-lite-v1:0', $1, 0.06, 0.24, 2, true, true)`, [version])).rowCount).toBe(0);
    });
  });
});
