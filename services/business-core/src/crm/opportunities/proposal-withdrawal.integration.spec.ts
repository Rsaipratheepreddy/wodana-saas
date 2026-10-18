import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmOpportunitiesService } from "./crm-opportunities.service";
import { OpportunityProposalsService } from "./opportunity-proposals.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

/** §0.3 P0 (guide J): the client withdraws from Proposal 2; whoever approves deals confirms it in review. */
integration("Proposal 2 withdrawal (real Postgres, forced RLS)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  });
  afterAll(() => pool.end());

  type World = { workspaceId: string; opportunityId: string; manager: string; approver: string; owner: string; client: PoolClient };
  async function world(work: (world: World, as: (userId: string) => { proposals: OpportunityProposalsService; opportunities: CrmOpportunitiesService }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), manager = randomUUID(), approver = randomUUID(), owner = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[manager, "Aisha Manager"], [approver, "Omar Approver"], [owner, "Olivia Owner"]])
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Europe/London',$3)", [workspaceId, `wd-${workspaceId.slice(0, 8)}`, owner]);
      const roles: Array<[string, string, string[]]> = [
        [manager, "account_manager", ["crm.opportunities.view", "crm.opportunities.manage", "crm.leads.view_all"]],
        [approver, "operations_approver", ["crm.opportunities.view", "crm.opportunities.manage", "commercial.deal.approve", "crm.leads.view_all"]],
        [owner, "owner_like", ["crm.opportunities.view", "commercial.deal.approve", "crm.leads.view_all"]],
      ];
      for (const [user, code, permissions] of roles) {
        const membership = randomUUID(), role = randomUUID();
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, user]);
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [role, workspaceId, code]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, permissions]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      }
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [partyId, workspaceId]);
      const pipeline = randomUUID(), stage = randomUUID();
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipeline, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'won','Won',1)", [stage, workspaceId, pipeline]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,status) VALUES($1,$2,$3,$4,$5,'Villa','O-7','won')`,
        [opportunityId, workspaceId, partyId, pipeline, stage]);
      await seedDefaultNotificationTemplates(client, workspaceId);
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
        return { proposals: new OpportunityProposalsService(access), opportunities: new CrmOpportunitiesService(access, new CrmEventsService()) };
      };
      await work({ workspaceId, opportunityId, manager, approver, owner, client }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const withdrawal = async (client: PoolClient, opportunityId: string) =>
    (await client.query("SELECT withdrawal_status AS status, withdrawal_reason AS reason, won_at FROM crm_opportunity_proposals WHERE opportunity_id = $1 AND kind = 'main'", [opportunityId])).rows[0] ?? null;

  it("records it with a reason once Proposal 1 is won, asks the approvers, and confirms only in someone else's review", async () => {
    await world(async ({ workspaceId, opportunityId, manager, approver, owner, client }, as) => {
      const manage = as(manager).proposals;
      await expect(manage.requestWithdrawal(actor, workspaceId, opportunityId, { reason: " " })).rejects.toMatchObject({ response: { missing: [{ key: "reason" }] } });
      await expect(manage.requestWithdrawal(actor, workspaceId, opportunityId, { reason: "Using their own contractor" })).rejects.toThrow("once Proposal 1 is won");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,value_status,won_at) VALUES($1,$2,'design','empty',now())", [workspaceId, opportunityId]);
      await client.query("SET LOCAL session_replication_role = origin");

      const asked = await manage.requestWithdrawal(actor, workspaceId, opportunityId, { reason: "Using their own contractor" });
      expect(asked.proposals.find((proposal) => proposal.kind === "main")?.withdrawal).toMatchObject({ status: "requested", reason: "Using their own contractor", requestedBy: "Aisha Manager" });
      // Both people who approve deals are asked; the account manager isn't.
      const notices = await client.query("SELECT recipient_id FROM notifications WHERE workspace_id = $1 AND event_type = 'crm.proposal.withdrawal_requested' ORDER BY recipient_id", [workspaceId]);
      expect(notices.rows.map((row) => row.recipient_id).sort()).toEqual([approver, owner].sort());
      await expect(manage.requestWithdrawal(actor, workspaceId, opportunityId, { reason: "Again" })).rejects.toThrow("waiting to be confirmed");

      // The account manager can't confirm; sending back needs a note; then it is asked again and confirmed.
      await expect(manage.decideWithdrawal(actor, workspaceId, opportunityId, { decision: "confirm" })).rejects.toThrow(/Permissions required/);
      await expect(as(approver).proposals.decideWithdrawal(actor, workspaceId, opportunityId, { decision: "return" })).rejects.toMatchObject({ response: { missing: [{ key: "note" }] } });
      await as(approver).proposals.decideWithdrawal(actor, workspaceId, opportunityId, { decision: "return", note: "Call the client first" });
      expect(await withdrawal(client, opportunityId)).toMatchObject({ status: null, reason: null });
      expect(Number((await client.query("SELECT count(*) FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'crm.proposal.withdrawal_decided'", [workspaceId, manager])).rows[0].count)).toBe(1);

      await manage.requestWithdrawal(actor, workspaceId, opportunityId, { reason: "Using their own contractor" });
      const confirmed = await as(owner).proposals.decideWithdrawal(actor, workspaceId, opportunityId, { decision: "confirm", note: "Checked with the client" });
      expect(confirmed.proposals.find((proposal) => proposal.kind === "main")?.withdrawal).toMatchObject({ status: "confirmed", decidedBy: "Olivia Owner", note: "Checked with the client" });
      // It is listed apart, never Won: the database refuses a win on a withdrawn Proposal 2.
      const listed = await as(owner).opportunities.list(actor, workspaceId, { proposal2: "withdrawn", limit: 25 } as never) as { data: Array<{ id: string }> };
      expect(listed.data.map((row) => row.id)).toEqual([opportunityId]);
      await client.query("SAVEPOINT win");
      await expect(client.query("UPDATE crm_opportunity_proposals SET won_at = now() WHERE opportunity_id = $1 AND kind = 'main'", [opportunityId])).rejects.toThrow(/withdrawal_check/);
      await client.query("ROLLBACK TO SAVEPOINT win");
    });
  });

  it("never lets someone confirm a withdrawal they recorded", async () => {
    await world(async ({ workspaceId, opportunityId, approver, client }, as) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,value_status,won_at) VALUES($1,$2,'design','empty',now())", [workspaceId, opportunityId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await as(approver).proposals.requestWithdrawal(actor, workspaceId, opportunityId, { reason: "Budget" });
      await expect(as(approver).proposals.decideWithdrawal(actor, workspaceId, opportunityId, { decision: "confirm" })).rejects.toThrow("Someone else confirms");
    });
  });
});
