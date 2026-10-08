import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmPartiesService } from "../parties/crm-parties.service";
import { CrmOpportunitiesService } from "./crm-opportunities.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const migration = readFileSync(join(__dirname, "../../../drizzle/0245_sales_edit_opportunities.sql"), "utf8");

/**
 * Palm, 2 Oct: Sales edits an opportunity's details (value, dates, follow-up) but not the client's name or phone.
 * A Sales role copied before the value rule managed opportunities without seeing their value, so saving an
 * opportunity was refused. These run the real permission checks as the app role (forced RLS).
 */
integration("Sales edits opportunities; the client's identity stays with Sales admins", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; sales: string; admin: string; partyId: string; phoneId: string; opportunityId: string };
  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => { opportunities: CrmOpportunitiesService; parties: CrmPartiesService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), sales = randomUUID(), admin = randomUUID(), partyId = randomUUID(), phoneId = randomUUID(), opportunityId = randomUUID();
    const salesRole = randomUUID(), adminRole = randomUUID(), salesMember = randomUUID(), adminMember = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sales'),($3,$4,'Admin')", [sales, `sales-${sales.slice(0, 8)}@example.com`, admin, `admin-${admin.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Sales edit',$2,'AED',$3)", [workspaceId, `sales-edit-${workspaceId.slice(0, 8)}`, admin]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [salesMember, workspaceId, sales, adminMember, admin]);
      // A team's Sales role, copied before the value rule: manages opportunities, never granted their value.
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$3,'team_sales','Account managers',false),($2,$3,'administrator','Administrator',true)", [salesRole, adminRole, workspaceId]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`,
        [workspaceId, salesRole, ["crm.leads.view", "crm.leads.manage", "crm.parties.view", "crm.parties.manage", "crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.transition", "crm.activities.view", "crm.activities.manage"]]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, adminRole]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5)", [workspaceId, salesMember, salesRole, adminMember, adminRole]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Haddad','maya haddad')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_contact_points(id,workspace_id,party_id,type,label,raw_value,normalized_value,is_primary)
        VALUES($1,$2,$3,'phone','mobile','+971 50 123 4567','+971501234567',true)`, [phoneId, workspaceId, partyId]);
      const pipelineId = randomUUID(), stageId = randomUUID();
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'new','New',1)", [stageId, workspaceId, pipelineId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,amount,currency_code,next_action_at,owner_membership_id)
        VALUES($1,$2,$3,$4,$5,'Villa fit-out','O-1',250000,'AED',now() + interval '2 days',$6)`, [opportunityId, workspaceId, partyId, pipelineId, stageId, salesMember]);
      await client.query("SET LOCAL session_replication_role = origin");
      // Every command runs as the app role inside its own savepoint, like a tenant transaction.
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
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        return { opportunities: new CrmOpportunitiesService(access, new CrmEventsService()), parties: new CrmPartiesService(access, new CrmEventsService()) };
      };
      await work(client, { workspaceId, sales, admin, partyId, phoneId, opportunityId }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const version = async (client: PoolClient, table: string, id: string) => Number((await client.query(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0].version);

  it("refused a Sales role without the value permission; the upgrade lets it save the value and dates", async () => {
    await scenario(async (client, { workspaceId, sales, opportunityId }, as) => {
      const edit = async () => as(sales).opportunities.update(actor, workspaceId, opportunityId, {
        version: await version(client, "crm_opportunities", opportunityId), amount: 275000, currencyCode: "AED", expectedCloseAt: "2026-11-30T12:00:00.000Z",
      } as never);
      // The opportunity screen hides the value, says so, and the edit dialog used to send it anyway.
      const seen = await as(sales).opportunities.get(actor, workspaceId, opportunityId);
      expect(seen).toMatchObject({ amount: null, valueHidden: true });
      await expect(edit()).rejects.toThrow("Permissions required: crm.opportunities.manage, crm.opportunities.sensitive_values");

      await client.query(migration);
      const saved = await edit();
      expect(saved).toMatchObject({ currencyCode: "AED" });
      expect(String(saved.amount)).toMatch(/^275000(\.0+)?$/);
      expect(saved).not.toHaveProperty("valueHidden");
      // Replaying the upgrade changes nothing.
      const before = (await client.query("SELECT count(*)::int AS n FROM role_permissions WHERE workspace_id = $1", [workspaceId])).rows[0].n;
      await client.query(migration);
      expect((await client.query("SELECT count(*)::int AS n FROM role_permissions WHERE workspace_id = $1", [workspaceId])).rows[0].n).toBe(before);
    });
  });

  it("keeps the client's name and phone for Sales admins, and lets Sales change everything else", async () => {
    await scenario(async (client, { workspaceId, sales, admin, partyId, phoneId }, as) => {
      await client.query(migration);
      const party = () => version(client, "crm_parties", partyId);
      await expect(as(sales).parties.update(actor, workspaceId, partyId, { version: await party(), displayName: "Maya H." } as never))
        .rejects.toThrow("Only Sales admins can change the client's name or phone");
      await expect(as(sales).parties.updateContact(actor, workspaceId, partyId, phoneId, { version: await version(client, "crm_contact_points", phoneId), value: "+971 55 000 0000" } as never))
        .rejects.toThrow("Only Sales admins can change the client's name or phone");
      // The same name written differently, and other details, are Sales' to change.
      await expect(as(sales).parties.update(actor, workspaceId, partyId, { version: await party(), displayName: " maya  haddad ", lifecycle: "customer" } as never)).resolves.toMatchObject({ lifecycle: "customer" });
      await expect(as(admin).parties.update(actor, workspaceId, partyId, { version: await party(), displayName: "Maya Al Haddad" } as never)).resolves.toMatchObject({ displayName: "Maya Al Haddad" });
      await expect(as(admin).parties.updateContact(actor, workspaceId, partyId, phoneId, { version: await version(client, "crm_contact_points", phoneId), value: "+971 55 000 0000" } as never))
        .resolves.toMatchObject({ normalizedValue: "+971550000000" });
    });
  });

  it("renames an opportunity whose value is not set; a currency without an amount is still refused", async () => {
    await scenario(async (client, { workspaceId, admin, opportunityId }, as) => {
      const current = () => version(client, "crm_opportunities", opportunityId);
      await as(admin).opportunities.update(actor, workspaceId, opportunityId, { version: await current(), amount: null, currencyCode: null } as never);
      // What the edit dialog sends for a title change on an opportunity with Value "Not set": neither amount nor currency.
      await expect(as(admin).opportunities.update(actor, workspaceId, opportunityId, { version: await current(), title: "Villa fit-out (phase 2)" } as never))
        .resolves.toMatchObject({ title: "Villa fit-out (phase 2)", amount: null, currencyCode: null });
      await expect(as(admin).opportunities.update(actor, workspaceId, opportunityId, { version: await current(), amount: null, currencyCode: "AED" } as never))
        .rejects.toThrow("Amount and currency must be supplied or cleared together");
    });
  });
});
