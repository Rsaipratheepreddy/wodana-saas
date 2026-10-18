import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releasePhaseOnDealApproval, winOpportunityOnAcceptance } from "./quote-acceptance";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("the client's acceptance with a payment proof is the sale", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withCase(phase: string, paid: boolean, work: (client: PoolClient, ids: { workspaceId: string; caseId: string; opportunityId: string; partyId: string; wonStageId: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID(), pipelineId = randomUUID(),
      openStageId = randomUUID(), wonStageId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'AED',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipelineId, workspaceId]);
      await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES
        ($1,$3,$4,'proposal','Proposal',1,50), ($2,$3,$4,'won','Won',9,100)`, [openStageId, wonStageId, workspaceId, pipelineId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Aisha','aisha')", [partyId, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,amount,currency_code)
        VALUES($1,$2,$3,$4,$5,'Villa','OPP-1',1000,'AED')`, [opportunityId, workspaceId, partyId, pipelineId, openStageId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,status,phase) VALUES($1,$2,$3,$4,'active',$5)", [caseId, workspaceId, opportunityId, actor, phase]);
      if (paid) await client.query(`INSERT INTO crm_opportunity_payment_proofs(workspace_id,opportunity_id,kind,storage_key,file_name,mime_type,byte_size,digest,recorded_by)
        VALUES($1,$2,'receipt','k','receipt.pdf','application/pdf',10,repeat('a',64),$3)`, [workspaceId, opportunityId, actor]);
      await work(client, { workspaceId, caseId, opportunityId, partyId, wonStageId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("marks the opportunity Won on its Won stage, makes the client a customer and moves the case to Agree, once", async () => {
    await withCase("price", true, async (client, ids) => {
      const first = await winOpportunityOnAcceptance(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteNumber: 12, round: "main", actorUserId: null, source: "client_portal" });
      expect(first).toEqual({ won: true, phase: "agree" });
      const opportunity = (await client.query(`SELECT status::text, stage_id AS "stageId", probability::text, outcome_reason AS reason, closed_at IS NOT NULL AS closed FROM crm_opportunities WHERE id = $1`, [ids.opportunityId])).rows[0];
      expect(opportunity).toMatchObject({ status: "won", stageId: ids.wonStageId, reason: "Client accepted Q-12", closed: true });
      expect(Number(opportunity.probability)).toBe(100);
      expect((await client.query(`SELECT lifecycle FROM crm_parties WHERE id = $1`, [ids.partyId])).rows[0].lifecycle).toBe("customer");
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_stage_history WHERE opportunity_id = $1 AND to_status = 'won'`, [ids.opportunityId])).rows[0].n).toBe(1);
      // Idempotent: a second acceptance (another round, a retry) changes nothing.
      expect(await winOpportunityOnAcceptance(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteNumber: 12, round: "main", actorUserId: null, source: "client_portal" }))
        .toEqual({ won: false, phase: null });
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_stage_history WHERE opportunity_id = $1`, [ids.opportunityId])).rows[0].n).toBe(1);
      // An approved deal releases the case.
      expect(await releasePhaseOnDealApproval(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, actorUserId: randomUUID() })).toBe(true);
      expect((await client.query(`SELECT phase FROM pre_project_cases WHERE id = $1`, [ids.caseId])).rows[0].phase).toBe("release");
    });
  });

  it("leaves the opportunity open without a payment proof (PLM-122) and still moves the case to Agree", async () => {
    await withCase("price", false, async (client, ids) => {
      expect(await winOpportunityOnAcceptance(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteNumber: 12, round: "main", actorUserId: null, source: "client_portal" }))
        .toEqual({ won: false, phase: "agree" });
      expect((await client.query(`SELECT status::text FROM crm_opportunities WHERE id = $1`, [ids.opportunityId])).rows[0].status).toBe("open");
    });
  });

  it("tells the Owner in the app that the deal is won, with why (S-23)", async () => {
    await withCase("price", true, async (client, ids) => {
      const owner = randomUUID(), membership = randomUUID(), role = randomUUID();
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olivia Owner')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.workspaceId, owner]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'owner','Owner',true)", [role, ids.workspaceId]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.workspaceId, membership, role]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await winOpportunityOnAcceptance(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteNumber: 12, round: "main", actorUserId: null, source: "client_portal" });
      const told = (await client.query(`SELECT recipient_id AS recipient, subject, body, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'crm.deal_won' AND channel = 'in_app'`,
        [ids.workspaceId])).rows;
      expect(told).toEqual([{ recipient: owner, subject: "Won: Villa", body: expect.stringMatching(/^Aisha AED\s1,000\.00 · Client accepted Q-12$/), link: `/workspace/crm/opportunities?record=${ids.opportunityId}` }]);
    });
  });

  it("keeps a design-fee round in its phase: design comes next", async () => {
    await withCase("design", true, async (client, ids) => {
      expect(await winOpportunityOnAcceptance(client, { workspaceId: ids.workspaceId, caseId: ids.caseId, quoteNumber: 3, round: "design", actorUserId: null, source: "user" }))
        .toEqual({ won: true, phase: null });
      expect((await client.query(`SELECT phase FROM pre_project_cases WHERE id = $1`, [ids.caseId])).rows[0].phase).toBe("design");
    });
  });
});
