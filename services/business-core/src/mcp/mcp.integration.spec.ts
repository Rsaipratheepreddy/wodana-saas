import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiTool } from "../ai-tools/ai-tool";
import { AiToolCallsService } from "../ai-tools/ai-tool-calls.service";
import { AiToolRegistry } from "../ai-tools/ai-tools.registry";
import { waitingFor } from "../approvals/approval-sources";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { currentCommandOrigin } from "../database/command-origin";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { OAuthError } from "./mcp-oauth.domain";
import { McpOAuthService } from "./mcp-oauth.service";
import { McpRateLimitService } from "./mcp-rate-limit.service";
import { McpToolsService } from "./mcp-tools.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const TABLES = ["mcp_authorization_codes", "mcp_connections", "mcp_rate_windows", "mcp_tokens"];
const ORIGIN = "https://palm.example";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const actor: RequestActor = { subject: "local:owner", email: "owner@example.com", displayName: "Owner", provider: "local" };

integration("AI apps (MCP) in PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { a: string; b: string; owner: string };
  const tenant = (client: PoolClient, workspaceId: string) => client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
  const failure = async (client: PoolClient, work: () => Promise<unknown>) => {
    await client.query("SAVEPOINT expected_failure");
    try { await work(); return null; } catch (error) { return error as { code?: string; message: string }; }
    finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); }
  };

  async function world(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const ids: Ids = { a: randomUUID(), b: randomUUID(), owner: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [ids.owner, `mcp-${ids.owner.slice(0, 8)}@example.com`]);
      for (const [workspaceId, name] of [[ids.a, "Studio A"], [ids.b, "Studio B"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [workspaceId, name, `mcp-${workspaceId.slice(0, 8)}`, ids.owner]);
      }
      await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, status) VALUES ($1, $2, 'active')", [ids.a, ids.owner]);
      await client.query("INSERT INTO workspace_ai_settings (workspace_id, enabled, mcp_enabled) VALUES ($1, true, true)", [ids.a]);
      await seedDefaultNotificationTemplates(client, ids.a);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SET LOCAL ROLE wodana_app");
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Business Core's database and access layer over the test's one transaction, with the same session settings. */
  function services(client: PoolClient, ids: Ids, tools: AiTool[] = []) {
    const settings = async (workspaceId: string, actorId: string) => {
      const origin = currentCommandOrigin();
      await client.query(
        `SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true),
                set_config('app.command_via', $3, true), set_config('app.ai_run_id', $4, true)`,
        [workspaceId, actorId, origin?.via ?? "", origin?.runId ?? ""]);
    };
    const database = {
      query: (sql: string, values: unknown[] = []) => client.query(sql, values),
      tenantTransaction: async <T>(workspaceId: string, actorId: string, work: (db: PoolClient) => Promise<T>) => { await settings(workspaceId, actorId); return work(client); },
      actorTransaction: async <T>(actorId: string, work: (db: PoolClient) => Promise<T>) => { await settings("", actorId); return work(client); },
    };
    const granted = new Set(["ai.suggestions.use", "crm.leads.view", "crm.leads.manage", "workspace.settings.manage"]);
    const access = {
      asMember: async <T>(_actor: RequestActor, workspaceId: string, work: (db: PoolClient, user: { userId: string }) => Promise<T>) => { await settings(workspaceId, ids.owner); return work(client, { userId: ids.owner }); },
      withPermission: async <T>(who: RequestActor, workspaceId: string, _permission: string, work: (db: PoolClient, user: { userId: string }) => Promise<T>) => access.asMember(who, workspaceId, work),
      hasPermission: async (_db: unknown, _workspace: string, _user: string, code: string) => granted.has(code),
      grantedPermissions: async (_db: unknown, _workspace: string, _user: string, codes: string[]) => new Set(codes.filter((code) => granted.has(code))),
    };
    const identities = { resolveActor: async (who: RequestActor) => ({ ...who, userId: ids.owner }) };
    const limits = new McpRateLimitService(database as never, { hit: async () => null });
    const oauth = new McpOAuthService(database as never, access as never, identities as never, limits);
    const registry = new AiToolRegistry(tools);
    const calls = new AiToolCallsService(access as never, registry);
    return { oauth, calls, tools: new McpToolsService(access as never, registry, calls, limits), limits };
  }

  async function connect(oauth: McpOAuthService, workspaceId: string) {
    const app = await oauth.register({ client_name: "Claude", redirect_uris: [REDIRECT] }, "203.0.113.9");
    const query = new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "read write", state: "s" }).toString();
    const { redirectTo } = await oauth.decide(actor, { query, workspaceId, scopes: ["read", "write"], decision: "allow" }, ORIGIN);
    const code = new URL(redirectTo).searchParams.get("code")!;
    const tokens = await oauth.token({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: app.client_id }, undefined);
    return { app, code, tokens };
  }

  it("keeps connections, codes, tokens and rate windows to their workspace under forced RLS", async () => {
    await world(async (client, ids) => {
      const guarded = await client.query<{ name: string; policies: number }>(
        `SELECT relname AS name, (SELECT count(*)::int FROM pg_policies WHERE tablename = relname AND policyname = 'tenant_isolation') AS policies
           FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`, [TABLES]);
      expect(guarded.rows).toEqual(TABLES.map((name) => ({ name, policies: 1 })));

      const { oauth } = services(client, ids);
      const { app, tokens } = await connect(oauth, ids.a);
      await tenant(client, ids.a);
      await client.query("INSERT INTO mcp_rate_windows (workspace_id, connection_id, window_start, calls) SELECT workspace_id, id, now(), 1 FROM mcp_connections");
      const counts = async () => {
        const found: Record<string, number | null> = {};
        for (const table of TABLES) found[table] = (await client.query(`SELECT 1 FROM ${table}`)).rowCount;
        return found;
      };
      expect(await counts()).toEqual({ mcp_authorization_codes: 1, mcp_connections: 1, mcp_rate_windows: 1, mcp_tokens: 2 });

      await tenant(client, ids.b);
      expect(await counts()).toEqual({ mcp_authorization_codes: 0, mcp_connections: 0, mcp_rate_windows: 0, mcp_tokens: 0 });
      expect((await client.query("UPDATE mcp_connections SET revoked_at = now(), revoke_reason = 'person'")).rowCount).toBe(0);
      expect((await client.query("UPDATE mcp_tokens SET revoked_at = now()")).rowCount).toBe(0);
      // Workspace B can't write a connection or token for A.
      expect(await failure(client, () => client.query(`INSERT INTO mcp_connections (workspace_id, user_id, client_id, client_name, scopes) VALUES ($1, $2, $3, 'x', ARRAY['read'])`,
        [ids.a, ids.owner, app.client_id]))).toMatchObject({ message: expect.stringMatching(/row-level security/) });
      // Workspace B's tenant transaction can't use A's token either: the token names A, and B's session sees nothing.
      expect((await client.query(`SELECT 1 FROM mcp_tokens WHERE token_hash = $1`, [createHash("sha256").update(tokens.access_token).digest("hex")])).rowCount).toBe(0);

      await tenant(client, ids.a);
      // The app keeps its records: connections and tokens change state, they are never deleted.
      expect(await failure(client, () => client.query("DELETE FROM mcp_tokens"))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query("DELETE FROM mcp_connections"))).toMatchObject({ code: "42501" });
      expect(await failure(client, () => client.query("UPDATE mcp_oauth_clients SET client_name = 'x'"))).toMatchObject({ code: "42501" });
      expect((await client.query("DELETE FROM mcp_rate_windows")).rowCount).toBe(1);
      // A grant always includes read, and only read and write exist.
      expect(await failure(client, () => client.query("UPDATE mcp_connections SET scopes = ARRAY['write']"))).toMatchObject({ code: "23514" });
      expect(await failure(client, () => client.query("UPDATE mcp_connections SET scopes = ARRAY['read', 'admin']"))).toMatchObject({ code: "23514" });
      // Only hashes are stored.
      expect((await client.query(`SELECT 1 FROM mcp_tokens WHERE token_hash = $1 OR token_hash = $2`, [tokens.access_token, tokens.refresh_token])).rowCount).toBe(0);
    });
  });

  it("runs the OAuth flow in real SQL: PKCE, one-time codes, rotation, reuse and revocation", async () => {
    await world(async (client, ids) => {
      const { oauth } = services(client, ids);
      const { app, code, tokens } = await connect(oauth, ids.a);
      await tenant(client, ids.a);
      expect((await client.query(`SELECT event_type, channel FROM notifications WHERE event_type = 'ai.app_connected' ORDER BY channel`)).rows)
        .toEqual([{ event_type: "ai.app_connected", channel: "email" }, { event_type: "ai.app_connected", channel: "in_app" }]);

      const principal = await oauth.verifyAccessToken(tokens.access_token, ORIGIN);
      expect(principal).toMatchObject({ workspaceId: ids.a, userId: ids.owner, clientName: "Claude", scopes: ["read", "write"] });
      expect(await oauth.verifyAccessToken(tokens.access_token, "https://other.example")).toBeNull();

      const refreshed = await oauth.token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }, undefined);
      expect(await oauth.verifyAccessToken(refreshed.access_token, ORIGIN)).not.toBeNull();
      const reuse = await oauth.token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }, undefined).catch((error: OAuthError) => error);
      expect(reuse).toMatchObject({ error: "invalid_grant" });
      expect(await oauth.verifyAccessToken(refreshed.access_token, ORIGIN)).toBeNull();
      await tenant(client, ids.a);
      expect((await client.query(`SELECT revoke_reason FROM mcp_connections`)).rows).toEqual([{ revoke_reason: "token_reuse" }]);
      const codeAgain = await oauth.token({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: app.client_id }, undefined).catch((error: OAuthError) => error);
      expect(codeAgain).toMatchObject({ error: "invalid_grant" });

      const second = await connect(oauth, ids.a);
      const overview = await oauth.overview(actor, ids.a);
      expect(overview).toMatchObject({ enabled: true, aiEnabled: true, canManage: true, connections: [{ clientName: "Claude", mine: true, scopes: ["read", "write"], lastUsedAt: null }] });
      await oauth.revokeConnection(actor, ids.a, overview.connections[0].id, { version: overview.connections[0].version });
      expect(await oauth.verifyAccessToken(second.tokens.access_token, ORIGIN)).toBeNull();
      await tenant(client, ids.a);
      expect((await client.query(`SELECT action, after->>'reason' AS reason FROM audit_events WHERE action = 'ai.mcp.app_revoked' ORDER BY occurred_at`)).rows)
        .toEqual([{ action: "ai.mcp.app_revoked", reason: "token_reuse" }, { action: "ai.mcp.app_revoked", reason: "person" }]);

      const switched = await oauth.setEnabled(actor, ids.a, { enabled: false, version: overview.version });
      expect(switched).toMatchObject({ enabled: false, aiEnabled: true, version: overview.version + 1 });
    });
  });

  it("proposes an AI app's write, lists it as waiting for the person, and runs it once with via mcp", async () => {
    await world(async (client, ids) => {
      const lead = randomUUID();
      const write: AiTool = {
        name: "update_enquiry", description: "Change an enquiry", kind: "write", confirmation: "confirm", calls: "", permissions: ["crm.leads.manage"],
        parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
        propose: async (_context, input) => ({ title: { key: "Update {record}", values: { record: "ENQ-1" } }, summary: "Update ENQ-1", target: { type: "enquiry", id: lead, label: "ENQ-1", version: 2 },
          preview: { kind: "fields", fields: [{ label: "Title", after: String(input.title) }] }, command: { title: input.title } }),
        // Stands in for the module command: it writes its audit row in its own tenant transaction.
        execute: async () => {
          const origin = currentCommandOrigin();
          await client.query("SELECT set_config('app.command_via', $1, true), set_config('app.ai_run_id', $2, true)", [origin?.via ?? "", origin?.runId ?? ""]);
          await recordAudit(client, { workspaceId: ids.a, actorUserId: ids.owner, action: "crm.lead.details_updated.v1", entityType: "crm_lead", entityId: lead });
          return { result: { ok: true }, record: null };
        },
      };
      const { oauth, tools, calls } = services(client, ids, [write]);
      const { tokens } = await connect(oauth, ids.a);
      const principal = (await oauth.verifyAccessToken(tokens.access_token, ORIGIN))!;
      const result = await tools.callTool(principal, "update_enquiry", { title: "Pantry" }, { origin: ORIGIN });
      const actionId = String(result.structuredContent?.actionId);
      expect(result.structuredContent).toMatchObject({ status: "waiting_for_confirmation" });

      await tenant(client, ids.a);
      const waiting = await waitingFor(client, { workspaceId: ids.a, userId: ids.owner, displayName: "Owner", membershipId: null, can: async () => false, managedProjects: new Set(), currency: "USD" });
      expect(waiting.rows).toEqual([expect.objectContaining({ kind: "ai_action", group: "ai", id: actionId, title: "Update ENQ-1", subject: "Claude",
        phrase: { key: "Update {record}", values: { record: "ENQ-1" } }, href: `/workspace/ai-actions/${actionId}`, decide: null, canDecide: true })]);
      expect(waiting.counts.ai).toBe(1);

      const card = await calls.get(actor, ids.a, actionId);
      expect(card).toMatchObject({ surface: "mcp", clientName: "Claude", status: "proposed" });
      expect(await calls.confirm(actor, ids.a, actionId, { version: card.version })).toMatchObject({ status: "executed" });
      await tenant(client, ids.a);
      const audit = await client.query<{ action: string; via: string | null; runId: string | null }>(
        `SELECT action, via, ai_run_id AS "runId" FROM audit_events WHERE action IN ('crm.lead.details_updated.v1', 'ai.mcp.tool_called') ORDER BY occurred_at`);
      expect(audit.rows).toEqual([{ action: "ai.mcp.tool_called", via: "mcp", runId: card.runId }, { action: "crm.lead.details_updated.v1", via: "mcp", runId: card.runId }]);
      expect((await client.query(`SELECT surface, status, rounds, input_tokens FROM ai_agent_runs`)).rows).toEqual([{ surface: "mcp", status: "answered", rounds: 0, input_tokens: 0 }]);
      expect((await client.query(`SELECT feature, provider, model, status FROM ai_usage_events`)).rows).toEqual([{ feature: "mcp.tools", provider: "mcp", model: "update_enquiry", status: "ok" }]);
      // Nothing was charged: MCP calls use no model turn.
      expect((await client.query(`SELECT 1 FROM ai_credit_ledger WHERE entry_type = 'usage'`)).rowCount).toBe(0);
      expect((await waitingFor(client, { workspaceId: ids.a, userId: ids.owner, displayName: "Owner", membershipId: null, can: async () => false, managedProjects: new Set(), currency: "USD" })).rows).toEqual([]);

      // The DB fallback counts the connection's calls per minute.
      await expect(new McpRateLimitService({ tenantTransaction: async <T>(_w: string, _a: string, work: (db: PoolClient) => Promise<T>) => { await tenant(client, ids.a); return work(client); } } as never,
        { hit: async () => null }).takeCall(ids.a, principal.connectionId)).resolves.toBe(true);
      await tenant(client, ids.a);
      expect((await client.query(`SELECT calls FROM mcp_rate_windows`)).rows).toEqual([{ calls: 2 }]);
    });
  });

  it("accepts the mcp surface on runs and keeps AI apps off by default", async () => {
    await world(async (client, ids) => {
      await tenant(client, ids.b);
      expect(await failure(client, () => client.query(`INSERT INTO ai_agent_runs (workspace_id, requested_by, surface) VALUES ($1, $2, 'fax')`, [ids.b, ids.owner]))).toMatchObject({ code: "23514" });
      await client.query(`INSERT INTO ai_agent_runs (workspace_id, requested_by, surface) VALUES ($1, $2, 'mcp')`, [ids.b, ids.owner]);
      await client.query(`INSERT INTO workspace_ai_settings (workspace_id, enabled) VALUES ($1, true)`, [ids.b]);
      expect((await client.query(`SELECT mcp_enabled FROM workspace_ai_settings`)).rows).toEqual([{ mcp_enabled: false }]);
    });
  });
});
