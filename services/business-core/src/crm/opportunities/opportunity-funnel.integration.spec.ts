import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { opportunityFunnel } from "./opportunity-funnel";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("opportunity funnel", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("follows the real records from enquiry to Deal File", async () => {
    const client: PoolClient = await pool.connect();
    const ws = randomUUID(), user = randomUUID(), party = randomUUID(), enquiry = randomUUID(), lead = randomUUID(), opportunity = randomUUID(), caseId = randomUUID(), intro = randomUUID(), membership = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ws]);
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Dana Designer')", [user, `d-${user.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [membership, ws, user]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','company','website',now(),'E-7','fit_out','{}')`, [enquiry, ws, randomUUID(), party]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id) VALUES($1,$2,$3,$4)", [lead, ws, enquiry, party]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-7','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, ws, party, lead, randomUUID(), randomUUID()]);
      const steps = async (missing = 0) => Object.fromEntries((await opportunityFunnel(client, ws, opportunity, missing)).map((step) => [step.key, `${step.state}:${step.detail ?? ""}`]));

      expect(await steps(2)).toMatchObject({ enquiry: "done:E-7", discovery: "current:2 to fill", intro: "upcoming:", design: "upcoming:" });
      await client.query("UPDATE crm_opportunities SET lead_id=NULL WHERE id=$1", [opportunity]);
      expect(await steps(2)).toMatchObject({ enquiry: "done:Direct", discovery: "current:2 to fill" });
      await client.query("UPDATE crm_opportunities SET lead_id=$2 WHERE id=$1", [opportunity, lead]);
      await client.query("INSERT INTO crm_activities(id,workspace_id,type,title,status,due_at,opportunity_id) VALUES($1,$2,'meeting','Intro','pending',now(),$3)", [intro, ws, opportunity]);
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id,intro_activity_id) VALUES($1,$2,$3,$4)", [ws, opportunity, membership, intro]);
      expect(await steps()).toMatchObject({ discovery: "done:Complete", intro: "current:Scheduled · Dana Designer" });
      await client.query("UPDATE crm_activities SET status='completed', completed_at=now() WHERE id=$1", [intro]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ws, opportunity, user]);
      await client.query("INSERT INTO design_journey_stages(workspace_id,case_id,stage,position,status,completed_at) VALUES($1,$2,'inspiration',1,'done',now()),($1,$2,'site_visit',2,'active',null)", [ws, caseId]);
      expect(await steps()).toMatchObject({ intro: "done:Dana Designer", design: "current:Site visit" });
      expect(await steps(3)).toMatchObject({ discovery: "current:3 to fill", intro: "done:Dana Designer", design: "active:Site visit" });
      await client.query("UPDATE design_journey_stages SET status='done', completed_at=now() WHERE case_id=$1", [caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,'q1',1,1,'quotation','main','issued','Main','AED')", [ws, caseId]);
      expect(await steps()).toMatchObject({ design: "done:Approved", quote: "current:Sent to the client", deal: "upcoming:" });
      await client.query("UPDATE commercial_quotes SET status='accepted' WHERE case_id=$1", [caseId]);
      await client.query("INSERT INTO commercial_deal_files(workspace_id,case_id,id,reference,revision,quote_id,quote_hash,value,cost,margin,status) VALUES($1,$2,'d1','DEAL-2026-0001',1,'q1','h',1,0,1,'approved')", [ws, caseId]);
      expect(await steps()).toMatchObject({ quote: "done:Accepted", deal: "done:DEAL-2026-0001" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
