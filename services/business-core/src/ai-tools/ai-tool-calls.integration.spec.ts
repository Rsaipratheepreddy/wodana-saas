import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "../audit/record-audit";
import { currentCommandOrigin } from "../database/command-origin";
import type { AiTool } from "./ai-tool";
import { AiToolCallsService, PROPOSAL_TTL_MS } from "./ai-tool-calls.service";
import { AiToolRegistry } from "./ai-tools.registry";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("Woddy's proposed actions in PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { a: string; b: string; owner: string; other: string };
  const tenant = (client: PoolClient, workspaceId: string) => client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
  const failure = async (client: PoolClient, work: () => Promise<unknown>) => {
    await client.query("SAVEPOINT expected_failure");
    try { await work(); return null; } catch (error) { return error as { code?: string; message: string }; }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };

  async function world(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const ids: Ids = { a: randomUUID(), b: randomUUID(), owner: randomUUID(), other: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const [id, name] of [[ids.owner, "Sam Seller"], [ids.other, "Olga Other"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `woddy-${id.slice(0, 8)}@example.com`, name]);
      }
      for (const [workspaceId, name] of [[ids.a, "Studio A"], [ids.b, "Studio B"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [workspaceId, name, `woddy-${workspaceId.slice(0, 8)}`, ids.owner]);
      }
      await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, status) VALUES ($1, $2, 'active')", [ids.a, ids.owner]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SET LOCAL ROLE wodana_app");
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const run = async (client: PoolClient, workspaceId: string, userId: string) =>
    (await client.query<{ id: string }>(`INSERT INTO ai_agent_runs (workspace_id, requested_by, surface) VALUES ($1, $2, 'panel') RETURNING id`, [workspaceId, userId])).rows[0].id;

  it("keeps runs and proposals to their workspace under forced RLS, and never lets the app delete them", async () => {
    await world(async (client, { a, b, owner }) => {
      const guarded = await client.query<{ name: string; policies: number }>(
        `SELECT relname AS name, (SELECT count(*)::int FROM pg_policies WHERE tablename = relname AND policyname = 'tenant_isolation') AS policies
           FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`, [["ai_agent_runs", "ai_tool_calls"]]);
      expect(guarded.rows).toEqual([{ name: "ai_agent_runs", policies: 1 }, { name: "ai_tool_calls", policies: 1 }]);

      await tenant(client, a);
      const runA = await run(client, a, owner);
      await client.query(
        `INSERT INTO ai_tool_calls (workspace_id, run_id, tool, requested_by, summary, preview, command, idempotency_key, expires_at)
         VALUES ($1, $2, 'update_enquiry', $3, 'Update ENQ-1', '{"kind":"fields","fields":[]}', '{}', 'key-a', now() + interval '15 minutes')`, [a, runA, owner]);
      await tenant(client, b);
      expect((await client.query(`SELECT id FROM ai_tool_calls`)).rowCount).toBe(0);
      expect((await client.query(`SELECT id FROM ai_agent_runs`)).rowCount).toBe(0);
      expect((await client.query(`UPDATE ai_tool_calls SET status = 'rejected'`)).rowCount).toBe(0);
      // Workspace B can't write a proposal into A's run, nor a row for A.
      expect(await failure(client, () => client.query(
        `INSERT INTO ai_tool_calls (workspace_id, run_id, tool, requested_by, summary, preview, command, idempotency_key, expires_at)
         VALUES ($1, $2, 'update_enquiry', $3, 'x', '{}', '{}', 'key-b', now() + interval '1 minute')`, [a, runA, owner]))).toMatchObject({ message: expect.stringMatching(/row-level security/) });
      await tenant(client, a);
      expect((await client.query(`SELECT tool FROM ai_tool_calls`)).rows).toEqual([{ tool: "update_enquiry" }]);
      expect(await failure(client, () => client.query(`DELETE FROM ai_tool_calls`))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query(`DELETE FROM ai_agent_runs`))).toMatchObject({ code: "42501" });
      // A proposal can't be marked failed without the module's message, or executed without a time.
      expect(await failure(client, () => client.query(`UPDATE ai_tool_calls SET status = 'failed', decided_by = $1, decided_at = now()`, [owner]))).toMatchObject({ code: "23514" });
    });
  });

  it("stamps audit rows written inside a Woddy-confirmed command with via and the run, and nothing else", async () => {
    await world(async (client, { a, owner }) => {
      await tenant(client, a);
      const runId = await run(client, a, owner);
      await recordAudit(client, { workspaceId: a, actorUserId: owner, action: "crm.lead.details_updated.v1", entityType: "crm_lead", entityId: randomUUID() });
      await client.query("SELECT set_config('app.command_via', 'woddy', true), set_config('app.ai_run_id', $1, true)", [runId]);
      await recordAudit(client, { workspaceId: a, actorUserId: owner, action: "crm.lead.assigned.v1", entityType: "crm_lead", entityId: randomUUID() });
      const rows = await client.query<{ action: string; via: string | null; runId: string | null }>(
        `SELECT action, via, ai_run_id AS "runId" FROM audit_events WHERE workspace_id = $1 ORDER BY occurred_at, action`, [a]);
      expect(rows.rows).toEqual([
        { action: "crm.lead.details_updated.v1", via: null, runId: null },
        { action: "crm.lead.assigned.v1", via: "woddy", runId },
      ]);
    });
  });

  it("moves a proposal through confirm and execute, or to expired, in real SQL", async () => {
    await world(async (client, { a, owner, other }) => {
      await tenant(client, a);
      const runId = await run(client, a, owner);
      let user = owner;
      // The access layer's tenant transaction, as Business Core opens it (including the command origin).
      const inTransaction = async <T>(work: (c: PoolClient, u: { userId: string }) => Promise<T>) => {
        const origin = currentCommandOrigin();
        await client.query("SELECT set_config('app.command_via', $1, true), set_config('app.ai_run_id', $2, true)", [origin?.via ?? "", origin?.runId ?? ""]);
        return work(client, { userId: user });
      };
      const access = {
        withPermission: (_actor: unknown, _workspace: string, _permission: string, work: (c: PoolClient, u: { userId: string }) => Promise<unknown>) => inTransaction(work),
        asMember: (_actor: unknown, _workspace: string, work: (c: PoolClient, u: { userId: string }) => Promise<unknown>) => inTransaction(work),
        grantedPermissions: async () => new Set(["ai.suggestions.use", "crm.leads.manage"]),
      };
      const note: AiTool = {
        name: "log_activity", description: "", kind: "write", confirmation: "confirm", calls: "", permissions: [], parameters: { type: "object", properties: {} },
        propose: async () => ({ title: { key: "Log a call" }, summary: "Log a call", target: null, preview: { kind: "fields", fields: [] }, command: {} }),
        // Stands in for a module command: it writes its audit row in its own tenant transaction.
        execute: async () => inTransaction(async (c) => { await recordAudit(c, { workspaceId: a, actorUserId: owner, action: "crm.activity.created.v1", entityType: "crm_activity", entityId: randomUUID() }); return { result: { ok: true }, record: null }; }),
      };
      const calls = new AiToolCallsService(access as never, new AiToolRegistry([note]));
      const actor = { subject: "s", email: "e", displayName: "d", provider: "local" };
      const proposal = { title: { key: "Log a call" }, summary: "Log a call", target: null, preview: { kind: "fields" as const, fields: [] }, command: {} };

      const card = await calls.propose(actor, a, { runId, tool: "log_activity", proposal });
      expect(card).toMatchObject({ status: "proposed", version: 1 });
      user = other;
      await expect(calls.confirm(actor, a, card.id, { version: 1 })).rejects.toThrow(/Only the person who asked/);
      user = owner;
      const done = await calls.confirm(actor, a, card.id, { version: 1 });
      expect(done).toMatchObject({ status: "executed", version: 3 });
      const audit = await client.query<{ action: string; via: string | null; runId: string | null }>(
        `SELECT action, via, ai_run_id AS "runId" FROM audit_events WHERE workspace_id = $1 AND action LIKE 'crm.activity%'`, [a]);
      expect(audit.rows).toEqual([{ action: "crm.activity.created.v1", via: "woddy", runId }]);

      const late = await calls.propose(actor, a, { runId, tool: "log_activity", proposal });
      await client.query(`UPDATE ai_tool_calls SET created_at = now() - make_interval(secs => $2), expires_at = now() - interval '5 seconds' WHERE id = $1`, [late.id, PROPOSAL_TTL_MS / 1000 + 5]);
      await expect(calls.get(actor, a, late.id)).resolves.toMatchObject({ status: "expired" });
      await expect(calls.confirm(actor, a, late.id, { version: 1 })).rejects.toMatchObject({ status: 410 });
      expect((await client.query(`SELECT status FROM ai_tool_calls WHERE id = $1`, [late.id])).rows[0]).toEqual({ status: "expired" });
    });
  });
});
