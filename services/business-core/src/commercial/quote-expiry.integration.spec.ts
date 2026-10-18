import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { commercialRepository } from "./commercial-repository";
import { runReminderSweep } from "../reminders/testing";
import { processQuoteExpiry } from "./quote-expiry";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = { workspaceId: string; caseId: string; ownerUserId: string };

integration("quotes that run out (Q-6)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withQuote(validUntil: string, work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const ids: Ids = { workspaceId: randomUUID(), caseId: randomUUID(), ownerUserId: randomUUID() };
    const membership = randomUUID(), opportunity = randomUUID(), party = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [ids.workspaceId, `firm-${ids.workspaceId.slice(0, 8)}`, ids.ownerUserId]);
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales')", [ids.ownerUserId, `${ids.ownerUserId.slice(0, 8)}@example.com`]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.workspaceId, ids.ownerUserId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Aisha','aisha')", [party, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,amount,currency_code)
        VALUES($1,$2,$3,$4,$5,'Villa','OPP-1',1000,'USD')`, [opportunity, ids.workspaceId, party, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,status,phase,owner_membership_id) VALUES($1,$2,$3,$4,'active','price',$5)",
        [ids.caseId, ids.workspaceId, opportunity, ids.ownerUserId, membership]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,4,$3::jsonb)", [ids.workspaceId, ids.caseId, JSON.stringify({ requests: [], audit: [] })]);
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,valid_until,detail)
        VALUES($1,$2,'q1',1,7,'quotation','issued','Kitchen','USD',$3::date,'{}'::jsonb)`, [ids.workspaceId, ids.caseId, validUntil]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  it("marks a sent quote Expired the day after its validity, audits it and tells Sales by app and email, once", async () => {
    await withQuote(day(-2), async (client, ids) => {
      await expect(processQuoteExpiry(client, ids.workspaceId)).resolves.toEqual({ expired: 1 });
      const stored = await commercialRepository.load(client, ids.workspaceId, ids.caseId);
      expect(stored!.content.quotes!.find((quote) => quote.id === "q1")!.status).toBe("expired");
      expect(stored!.revision).toBe(5);
      expect((await client.query(`SELECT action, after->>'quoteId' AS quote FROM audit_events WHERE workspace_id = $1 AND entity_id = $2`, [ids.workspaceId, ids.caseId])).rows)
        .toEqual([{ action: "commercial.quote_expired.v1", quote: "q1" }]);
      const told = (await client.query(`SELECT channel, subject, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'quotation.expired' ORDER BY channel`, [ids.workspaceId])).rows;
      expect(told).toEqual([
        { channel: "email", subject: "Q-7 · Kitchen expired", link: `/workspace/pre-projects/cases/${ids.caseId}/quotations?quote=q1` },
        { channel: "in_app", subject: "Q-7 · Kitchen expired", link: `/workspace/pre-projects/cases/${ids.caseId}/quotations?quote=q1` },
      ]);
      await expect(processQuoteExpiry(client, ids.workspaceId)).resolves.toEqual({ expired: 0 });
    });
  });

  it("warns the case owner a few days before (the reminder engine's quote.expiring), and leaves the quote open", async () => {
    await withQuote(day(2), async (client, ids) => {
      await expect(processQuoteExpiry(client, ids.workspaceId)).resolves.toEqual({ expired: 0 });
      await runReminderSweep(client, ids.workspaceId, { now: new Date() });
      await runReminderSweep(client, ids.workspaceId, { now: new Date() });
      expect((await client.query(`SELECT status FROM commercial_quotes WHERE workspace_id = $1 AND id = 'q1'`, [ids.workspaceId])).rows[0].status).toBe("issued");
      expect((await client.query(`SELECT recipient_id AS recipient, subject FROM notifications WHERE workspace_id = $1 AND event_type = 'quotation.expiring' AND channel = 'in_app'`, [ids.workspaceId])).rows)
        .toEqual([{ recipient: ids.ownerUserId, subject: expect.stringMatching(/^Q-7 · Kitchen · due (in \d days|tomorrow)$/) }]);
    });
  });
});
