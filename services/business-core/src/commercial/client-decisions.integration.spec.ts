import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { processClientDecisions } from "./client-decision-reminders";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type CaseIds = { workspaceId: string; caseId: string; opportunityId: string; partyId: string; ownerUserId: string; ownerMembershipId: string };

/** A workspace with one active case owned by one member, inside a rolled-back transaction. */
async function withOwnedCase(pool: Pool, work: (client: PoolClient, ids: CaseIds) => Promise<void>) {
  const client = await pool.connect();
  const ids: CaseIds = { workspaceId: randomUUID(), caseId: randomUUID(), opportunityId: randomUUID(), partyId: randomUUID(), ownerUserId: randomUUID(), ownerMembershipId: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'AED',$3)", [ids.workspaceId, `firm-${ids.workspaceId.slice(0, 8)}`, ids.ownerUserId]);
    await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales')", [ids.ownerUserId, `${ids.ownerUserId.slice(0, 8)}@example.com`]);
    await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [ids.ownerMembershipId, ids.workspaceId, ids.ownerUserId]);
    await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Aisha','aisha')", [ids.partyId, ids.workspaceId]);
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,amount,currency_code)
      VALUES($1,$2,$3,$4,$5,'Villa','OPP-1',1000,'AED')`, [ids.opportunityId, ids.workspaceId, ids.partyId, randomUUID(), randomUUID()]);
    await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,status,phase,owner_membership_id) VALUES($1,$2,$3,$4,'active','price',$5)",
      [ids.caseId, ids.workspaceId, ids.opportunityId, ids.ownerUserId, ids.ownerMembershipId]);
    await seedDefaultNotificationTemplates(client, ids.workspaceId);
    await work(client, ids);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

integration("decisions waiting on the client (Q-8)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("reminds the case owner of an issued quote on the second and fifth day, once each", async () => {
    await withOwnedCase(pool, async (client, ids) => {
      const issuedAt = new Date(Date.now() - 5 * 86_400_000 - 3_600_000).toISOString();
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,valid_until,detail)
        VALUES($1,$2,'q1',1,1,'quotation','issued','Kitchen','AED',current_date + 20,$3::jsonb)`, [ids.workspaceId, ids.caseId, JSON.stringify({ issuedAt })]);
      const first = await processClientDecisions(client, ids.workspaceId);
      expect(first.sent).toBe(1);
      const again = await processClientDecisions(client, ids.workspaceId);
      expect(again.sent).toBe(0);
      const told = (await client.query(`SELECT recipient_id AS recipient, subject, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'commercial.decision_waiting'`, [ids.workspaceId])).rows;
      expect(told).toEqual([{ recipient: ids.ownerUserId, subject: "Waiting on the client · Kitchen", link: `/workspace/pre-projects/cases/${ids.caseId}/quotations?quote=q1` }]);
    });
  });

  it("leaves a quote alone before the first reminder day, and an expired one", async () => {
    await withOwnedCase(pool, async (client, ids) => {
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,valid_until,detail) VALUES
        ($1,$2,'fresh',1,1,'quotation','issued','Fresh','AED',current_date + 20,$3::jsonb),
        ($1,$2,'old',2,2,'quotation','issued','Old','AED',
          (SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date - 1 FROM workspaces WHERE id = $1),$4::jsonb)`,
        [ids.workspaceId, ids.caseId, JSON.stringify({ issuedAt: new Date().toISOString() }), JSON.stringify({ issuedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() })]);
      expect((await processClientDecisions(client, ids.workspaceId)).sent).toBe(0);
    });
  });
});
