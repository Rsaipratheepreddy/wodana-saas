import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { OpportunityDiscoveryService } from "./discovery.service";
import { IntroMeetingService } from "./intro-meeting.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type Ids = { workspaceId: string; opportunityId: string; sales: string; dana: string; omar: string; cleo: string; danaMember: string; omarMember: string; cleoMember: string; salesMember: string };

/**
 * Sales books a design enquiry's intro meeting: the Designer list comes from the opportunity, for whoever may book it,
 * without the member directory (module.members.read), and lists only the people who do design work (or, where the
 * design package asks for a role, the people holding it), by name. Real permission checks, as the app role.
 */
integration("the designers an intro meeting can be booked with", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => IntroMeetingService) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID();
    const sales = randomUUID(), dana = randomUUID(), omar = randomUUID(), cleo = randomUUID(), mo = randomUUID();
    const salesMember = randomUUID(), danaMember = randomUUID(), omarMember = randomUUID(), cleoMember = randomUUID(), moMember = randomUUID();
    const salesRole = randomUUID(), designRole = randomUUID(), directorRole = randomUUID(), teamId = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[sales, "Sara Sales"], [dana, "Dana Designer"], [omar, "Omar Designer"], [cleo, "Cleo Director"], [mo, "Mo Member"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `designers-${workspaceId.slice(0, 8)}`, sales]);
      for (const [membership, user] of [[salesMember, sales], [danaMember, dana], [omarMember, omar], [cleoMember, cleo], [moMember, mo]])
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, user]);
      const grant = (role: string, codes: string[]) => client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, role, codes]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'team_sales','Account managers',false),($2,$4,'team_interior_design','Interior designers',false),($3,$4,'team_creative_director','Creative director',false)",
        [salesRole, designRole, directorRole, workspaceId]);
      // Sales books meetings and edits planning cases, but holds no member directory and does no design work.
      await grant(salesRole, ["crm.opportunities.view", "crm.opportunities.manage", "crm.activities.view", "crm.activities.manage", "pre_projects.view", "pre_projects.edit"]);
      await grant(designRole, ["pre_projects.view", "pre_projects.edit", "pre_projects.record_client_design_decisions", "crm.activities.manage"]);
      await grant(directorRole, ["pre_projects.view", "pre_projects.review_designs"]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$7)", [workspaceId, salesMember, salesRole, danaMember, designRole, cleoMember, directorRole]);
      // Omar is a designer through his team, as Palm's teams grant their roles.
      await client.query("INSERT INTO workspace_teams(id,workspace_id,business_unit_id,code,name) VALUES($1,$2,$3,'INTERIOR_DESIGN','Interior Designers')", [teamId, workspaceId, randomUUID()]);
      await client.query("INSERT INTO workspace_team_roles(workspace_id,team_id,role_id) VALUES($1,$2,$3)", [workspaceId, teamId, designRole]);
      await client.query("INSERT INTO workspace_team_members(workspace_id,team_id,membership_id) VALUES($1,$2,$3)", [workspaceId, teamId, omarMember]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, partyId, randomUUID(), randomUUID(), salesMember]);
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
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        return new IntroMeetingService(access, { record: async () => randomUUID() } as never, new OpportunityDiscoveryService(access));
      };
      await work(client, { workspaceId, opportunityId, sales, dana, omar, cleo, danaMember, omarMember, cleoMember, salesMember }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("Sales gets the designers by name (by role or by team), not the rest of the firm", async () => {
    await scenario(async (_client, ids, as) => {
      const { items } = await as(ids.sales).designers(actor, ids.workspaceId, ids.opportunityId);
      expect(items).toEqual([{ id: ids.danaMember, displayName: "Dana Designer" }, { id: ids.omarMember, displayName: "Omar Designer" }]);
    });
  });

  it("a design package that asks for a role lists the people holding it, and the chosen designer stays listed", async () => {
    await scenario(async (client, ids, as) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const packageId = randomUUID();
      await client.query("INSERT INTO design_packages(id,workspace_id,code,name,pricing_method,rate,currency,required_role_code) VALUES($1,$2,'signature','Signature','fixed',0,'AED','team_creative_director')", [packageId, ids.workspaceId]);
      await client.query("INSERT INTO crm_opportunity_discovery(workspace_id,opportunity_id,design_package_id) VALUES($1,$2,$3)", [ids.workspaceId, ids.opportunityId, packageId]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [ids.workspaceId, ids.opportunityId, ids.danaMember]);
      await client.query("SET LOCAL session_replication_role = origin");
      const { items } = await as(ids.sales).designers(actor, ids.workspaceId, ids.opportunityId);
      expect(items.map((item) => item.displayName)).toEqual(["Cleo Director", "Dana Designer"]);
    });
  });

  it("is only for people who may book the meeting", async () => {
    await scenario(async (_client, ids, as) => {
      await expect(as(ids.cleo).designers(actor, ids.workspaceId, ids.opportunityId)).rejects.toThrow(/crm.opportunities.manage/);
    });
  });
});
