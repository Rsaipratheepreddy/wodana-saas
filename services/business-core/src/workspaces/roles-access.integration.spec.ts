import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_MODULES, modulePermissions } from "./access-levels";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesService } from "./workspaces.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const identityUpgrade = readFileSync(join(__dirname, "../../drizzle/0245_sales_edit_opportunities.sql"), "utf8");

/** Roles & permissions by module, through the real role commands as the app role (forced RLS). */
integration("roles & permissions by module", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; salesRole: string; leadRole: string; lead: string };
  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => WorkspacesService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), lead = randomUUID();
    const ownerRole = randomUUID(), salesRole = randomUUID(), leadRole = randomUUID(), ownerMember = randomUUID(), leadMember = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(identityUpgrade);
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner'),($3,$4,'Lead')", [owner, `owner-${owner.slice(0, 8)}@example.com`, lead, `lead-${lead.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Roles',$2,'AED',$3)", [workspaceId, `roles-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [ownerMember, workspaceId, owner, leadMember, lead]);
      await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'owner','Owner',true),($2,$4,'sales','Sales',false),($3,$4,'studio_lead','Studio lead',false)`, [ownerRole, salesRole, leadRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, ownerRole]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, salesRole, ["crm.leads.view", "crm.parties.view"]]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, leadRole, ["module.roles.read", "module.roles.edit", "crm.leads.view"]]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, ownerMember, ownerRole, leadMember, leadRole]);
      await client.query("SET LOCAL session_replication_role = origin");
      const database = {
        tenantTransaction: async (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => {
          await client.query("SAVEPOINT tenant");
          try {
            await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, actorUserId]);
            await client.query("SET LOCAL ROLE wodana_app");
            const result = await fn(client);
            await client.query("RESET ROLE");
            await client.query("RELEASE SAVEPOINT tenant");
            return result;
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT tenant");
            await client.query("RESET ROLE");
            throw error;
          }
        },
      };
      const as = (userId: string) => {
        const identities = { resolveActor: async () => ({ userId }) };
        return new WorkspacesService(database as never, identities as never, new WorkspaceAccessService(database as never, identities as never), {} as never, {} as never);
      };
      await work(client, { workspaceId, salesRole, leadRole, lead }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const roleVersion = async (client: PoolClient, id: string) => Number((await client.query("SELECT version FROM roles WHERE id = $1", [id])).rows[0].version);
  const ownerOf = async (client: PoolClient, workspaceId: string) => String((await client.query("SELECT user_id FROM workspace_memberships m JOIN member_roles r ON r.membership_id = m.id JOIN roles role ON role.id = r.role_id WHERE m.workspace_id = $1 AND role.code = 'owner'", [workspaceId])).rows[0].user_id);

  it("maps every permission in the database to one module", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(identityUpgrade);
      const codes = (await client.query<{ code: string }>("SELECT code FROM permissions")).rows.map((row) => row.code);
      const mapped = new Set(ACCESS_MODULES.flatMap(modulePermissions));
      expect(codes.filter((code) => !mapped.has(code))).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("saves levels and extras as permissions, version-checked and audited, and resets a template role", async () => {
    await scenario(async (client, { workspaceId, salesRole }, as) => {
      const owner = as(await ownerOf(client, workspaceId));
      const saved = await owner.setRoleAccess(actor, workspaceId, salesRole, { version: await roleVersion(client, salesRole), levels: { sales: "edit", inbox: "view" }, extras: ["crm.parties.export"] });
      expect(saved.permissions).toEqual(expect.arrayContaining(["crm.opportunities.manage", "crm.opportunities.sensitive_values", "crm.communications.view", "crm.parties.export"]));
      expect(saved.permissions).not.toContain("crm.parties.identity");
      expect(saved).toMatchObject({ templateCode: "sales" });
      const audit = await client.query("SELECT action, after FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY occurred_at DESC LIMIT 1", [workspaceId, salesRole]);
      expect(audit.rows[0]).toMatchObject({ action: "role.access_updated", after: { access: { levels: { sales: "edit", inbox: "view" }, extras: ["crm.parties.export"] } } });
      await expect(owner.setRoleAccess(actor, workspaceId, salesRole, { version: 1, levels: { sales: "view" }, extras: [] })).rejects.toThrow("Role changed; reload and try again");
      await expect(owner.setRoleAccess(actor, workspaceId, salesRole, { version: await roleVersion(client, salesRole), levels: { sales: "owner" }, extras: [] })).rejects.toThrow("sales has no owner level");

      const reset = await owner.resetRoleToTemplate(actor, workspaceId, salesRole, await roleVersion(client, salesRole));
      expect(reset.permissions).toEqual(expect.arrayContaining(["crm.leads.assign", "commercial.record_decision", "ai.suggestions.use"]));
      expect(reset.permissions).not.toContain("crm.parties.export");
      const roles = await owner.listRoles(actor, workspaceId) as Array<{ code: string; templateCode: string | null }>;
      expect(roles.find((role) => role.code === "studio_lead")?.templateCode).toBeNull();
    });
  });

  it("refuses to remove the editor's own access to roles and permissions", async () => {
    await scenario(async (client, { workspaceId, leadRole, lead }, as) => {
      await expect(as(lead).setRoleAccess(actor, workspaceId, leadRole, { version: await roleVersion(client, leadRole), levels: {}, extras: ["module.roles.read", "crm.leads.view"] }))
        .rejects.toThrow("You can't remove your own access to roles and permissions");
      const owner = as(await ownerOf(client, workspaceId));
      await expect(owner.resetRoleToTemplate(actor, workspaceId, leadRole, await roleVersion(client, leadRole))).rejects.toThrow("This role was not built from a template");
    });
  });
});
