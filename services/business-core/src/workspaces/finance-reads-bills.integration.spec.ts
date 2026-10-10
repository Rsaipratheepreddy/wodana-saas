import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "./workspace-access.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const upgrade = readFileSync(join(__dirname, "../../drizzle/0299_finance_reads_bills.sql"), "utf8");
const AI = "ai.suggestions.use";

/** 0299: the Finance role of every workspace can have Woddy read a bill's photo (the permission reading needs). */
integration("Finance reads bills with Woddy (0299)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Roles = Record<"finance" | "approver" | "team" | "viewer", string>;
  /** Two workspaces whose Finance role lost AI suggestions (a role edited to a firm's own list), and other roles without it. */
  async function scenario(work: (client: PoolClient, ids: { workspaces: string[]; layla: string; roles: Roles[] }) => Promise<void>) {
    const client = await pool.connect();
    const layla = randomUUID();
    const workspaces = [randomUUID(), randomUUID()];
    const roles: Roles[] = [];
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Layla Finance')", [layla, `layla-${layla.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const workspaceId of workspaces) {
        const ids: Roles = { finance: randomUUID(), approver: randomUUID(), team: randomUUID(), viewer: randomUUID() };
        roles.push(ids);
        const membership = randomUUID();
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Studio',$2,'AED',$3)", [workspaceId, `fin-${workspaceId.slice(0, 8)}`, layla]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, layla]);
        await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$5,'finance','Finance',false),($2,$5,'finance_approver','Finance approver',false),
          ($3,$5,'team_finance','Finance',false),($4,$5,'viewer','Viewer',true)`, [ids.finance, ids.approver, ids.team, ids.viewer, workspaceId]);
        for (const role of [ids.finance, ids.team]) {
          await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
            [workspaceId, role, ["payables.view", "payables.manage", "receivables.view", "books.view"]]);
        }
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])",
          [workspaceId, ids.approver, ["payables.view", "payables.approve"]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, ids.finance]);
      }
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, { workspaces, layla, roles });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const holds = async (client: PoolClient, roleId: string) =>
    Boolean((await client.query("SELECT 1 FROM role_permissions granted JOIN permissions permission ON permission.id = granted.permission_id WHERE granted.role_id = $1 AND permission.code = $2",
      [roleId, AI])).rowCount);
  /** What the bill capture asks before reading: the person's own right to AI suggestions, as the app role under forced RLS. */
  const canRead = async (client: PoolClient, workspaceId: string, userId: string) => {
    await client.query("SAVEPOINT tenant");
    try {
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, userId]);
      await client.query("SET LOCAL ROLE wodana_app");
      return await new WorkspaceAccessService({} as never, {} as never).hasPermission(client, workspaceId, userId, AI);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT tenant");
      await client.query("RESET ROLE");
    }
  };

  it("gives every workspace's Finance role AI suggestions, and nothing else changes; replaying it changes nothing", async () => {
    await scenario(async (client, { workspaces, layla, roles }) => {
      for (const workspaceId of workspaces) expect(await canRead(client, workspaceId, layla)).toBe(false);
      await client.query(upgrade);
      for (const [index, workspaceId] of workspaces.entries()) {
        expect(await holds(client, roles[index].finance)).toBe(true);
        // A firm's own roles (even one named Finance), the approver and the viewer are left as they are.
        for (const role of [roles[index].approver, roles[index].team, roles[index].viewer]) expect(await holds(client, role)).toBe(false);
        expect(await canRead(client, workspaceId, layla)).toBe(true);
      }
      const count = async () => Number((await client.query<{ n: string }>("SELECT count(*) AS n FROM role_permissions WHERE workspace_id = ANY($1::uuid[])", [workspaces])).rows[0].n);
      const before = await count();
      await client.query(upgrade);
      expect(await count()).toBe(before);
    });
  });
});
