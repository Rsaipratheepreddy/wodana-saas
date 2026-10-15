import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmReportingService } from "./crm-reporting.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). The scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("CRM reports on a real database", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  it("counts a won deal that was later cancelled (its order or its job) apart from Won, in every CRM report", async () => {
    const client = await pool.connect();
    const ws = randomUUID(), owner = randomUUID(), member = randomUUID(), role = randomUUID(), party = randomUUID(), stage = randomUUID(), pipeline = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [owner, `owner-${owner.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Reports',$2,'USD','en','UTC',$3)", [ws, `crm-reports-${ws.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [member, ws, owner]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'owner','Owner',true)", [role, ws]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [ws, role]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ws, member, role]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Amira','amira')", [party, ws]);
      // Four won deals from four enquiries: A (no proposals), D (design fee won) stay Won; B (design fee won, then its
      // order cancelled) and C (its job cancelled) don't.
      const deals: Record<string, string> = {};
      for (const key of ["A", "B", "C", "D"]) {
        const intake = randomUUID(), enquiry = randomUUID(), lead = randomUUID(), opportunity = randomUUID();
        deals[key] = opportunity;
        await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
          VALUES($1,$2,'website','form','form',$3,'h','{}',$1,now())`, [intake, ws, `key-${intake}`]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference)
          VALUES($1,$2,$3,$4,$5,'website','form',now(),$6)`, [enquiry, ws, intake, party, `Enquiry ${key}`, `E-${key}`]);
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status) VALUES($1,$2,$3,$4,'new')", [lead, ws, enquiry, party]);
        await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,lead_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,
            qualification_evidence_hash,converted_at,owner_membership_id,status,amount,currency_code,closed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now(),$9,'won',100,'USD',now())`,
          [opportunity, ws, party, lead, pipeline, stage, `Job ${key}`, `O-${key}`, member]);
      }
      for (const key of ["B", "D"]) {
        await client.query(`INSERT INTO crm_opportunity_proposals(workspace_id,opportunity_id,kind,amount,currency_code,value_status,won_at) VALUES($1,$2,'design',20,'USD','approved',now())`, [ws, deals[key]]);
      }
      await client.query("INSERT INTO pre_project_cases(workspace_id,opportunity_id,status,created_by) VALUES($1,$2,'active',$3)", [ws, deals.A, owner]);
      await client.query("INSERT INTO crm_deal_fulfilment(workspace_id,opportunity_id,cancelled_at,cancelled_by,cancel_reason) VALUES($1,$2,now(),$3,'Client relocated')", [ws, deals.B, owner]);
      await client.query(`INSERT INTO pre_project_cases(workspace_id,opportunity_id,status,created_by,cancelled_at,cancelled_by,cancellation_reason)
        VALUES($1,$2,'cancelled',$3,now(),$3,'Changed their mind')`, [ws, deals.C, owner]);
      await client.query("SET LOCAL session_replication_role = origin");

      const tenant = async <T>(fn: (c: PoolClient) => Promise<T>) => {
        await client.query("SAVEPOINT tenant");
        try {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, owner]);
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
      };
      const database = { tenantTransaction: (_ws: string, _actor: string, fn: (c: PoolClient) => Promise<unknown>) => tenant(fn) };
      const reports = new CrmReportingService(new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId: owner }) } as never));
      const range = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };

      const won = await reports.report(actor, ws, "won", range) as { rows: Array<{ proposal: string; count: number; opportunities: number }> };
      expect(won.rows.map(({ proposal, count, opportunities }) => ({ proposal, count, opportunities }))).toEqual([
        { proposal: "design", count: 1, opportunities: 1 },
        { proposal: "main", count: 1, opportunities: 1 },
      ]);
      const flow = await reports.report(actor, ws, "lead-flow", { ...range, groupBy: "source" }) as { rows: Array<{ won: number; leads: number }> };
      expect(flow.rows.reduce((total, row) => total + row.won, 0)).toBe(2);
      expect(flow.rows.reduce((total, row) => total + row.leads, 0)).toBe(4);
      const sources = await reports.report(actor, ws, "sources", range) as { rows: Array<{ won: number; opportunities: number }> };
      expect(sources.rows).toEqual([expect.objectContaining({ opportunities: 4, won: 2 })]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
