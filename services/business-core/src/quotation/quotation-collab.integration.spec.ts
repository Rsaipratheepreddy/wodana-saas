import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationCollabService } from "./quotation-collab.service";

const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("quote comments and presence", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl }); });
  afterAll(() => pool.end());

  it("pins a thread to a cell, mentions a teammate, replies, resolves, and shows who else is here", async () => {
    const client = await pool.connect();
    const ws = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), sam = randomUUID(), dana = randomUUID(), opportunity = randomUUID(), party = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[sam, "Sam Estimator"], [dana, "Dana Designer"]]) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ws]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ws, `qc-${ws.slice(0, 8)}`, sam]);
      for (const user of [sam, dana]) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), ws, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya','maya')", [party, ws]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, ws, party, randomUUID(), randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ws, opportunity, sam]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','draft','Main','AED')", [ws, caseId, quoteId]);
      await client.query("INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit,rate) VALUES($1,$2,$3,'l1',0,'Wardrobe',2,'nos',3000)", [ws, caseId, quoteId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,3,'{}')", [ws, caseId]);
      await seedDefaultNotificationTemplates(client, ws);
      await client.query("SET LOCAL session_replication_role = origin");
      const as = (userId: string) => { const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }); return new QuotationCollabService({ withPermission: run } as never); };

      const thread = randomUUID();
      const first = await as(sam).comment(actor, ws, caseId, quoteId, { id: thread, anchorKind: "line", anchorKey: "l1", anchorField: "rate", body: "@Dana is this the hinged one?", mentions: [dana] });
      // The same request again adds nothing.
      await as(sam).comment(actor, ws, caseId, quoteId, { id: thread, anchorKind: "line", anchorKey: "l1", anchorField: "rate", body: "@Dana is this the hinged one?", mentions: [dana] });
      expect(first.threads).toHaveLength(1);
      expect(first.threads[0]).toMatchObject({ anchorKind: "line", anchorKey: "l1", anchorField: "rate", status: "open", createdByName: "Sam Estimator" });
      const notified = (await client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND recipient_id = $2", [ws, dana])).rows[0].n;
      expect(notified).toBe(1);
      await expect(as(sam).comment(actor, ws, caseId, quoteId, { id: randomUUID(), anchorKind: "line", anchorKey: "gone", body: "x" })).rejects.toThrow(/no longer exists/);
      await expect(as(sam).comment(actor, ws, caseId, quoteId, { id: randomUUID(), anchorKind: "total", body: "x", mentions: [randomUUID()] })).rejects.toThrow(/Mention people/);

      const replied = await as(dana).reply(actor, ws, caseId, quoteId, thread, { id: randomUUID(), body: "Yes, hinged." });
      expect(replied.threads[0].messages.map((message) => message.createdByName)).toEqual(["Sam Estimator", "Dana Designer"]);
      const resolved = await as(dana).setStatus(actor, ws, caseId, quoteId, thread, { version: replied.threads[0].version, status: "resolved" });
      expect(resolved.threads[0]).toMatchObject({ status: "resolved", resolvedByName: "Dana Designer" });
      await expect(as(sam).reply(actor, ws, caseId, quoteId, thread, { id: randomUUID(), body: "One more" })).rejects.toThrow(/Reopen/);

      await as(dana).pulse(actor, ws, caseId, quoteId, { lineId: "l1", field: "quantity" });
      const seen = await as(sam).pulse(actor, ws, caseId, quoteId, {});
      expect(seen.people).toEqual([{ userId: dana, name: "Dana Designer", lineId: "l1", field: "quantity" }]);
      expect(seen.revision).toBe(3);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
