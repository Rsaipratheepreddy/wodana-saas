import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitingFor, type ApprovalContext } from "./approval-sources";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("waiting for you, across modules", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (client: PoolClient, ids: { workspaceId: string; buyer: string; approver: string; site: string; projectId: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), buyer = randomUUID(), approver = randomUUID(), site = randomUUID(), projectId = randomUUID(), vendor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'AED',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, approver]);
      await client.query("INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,'V1','Al Noor Timber',$3,$3)", [workspaceId, vendor, buyer]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,reference,quote_id,started_at) VALUES($1,$2,$3,'Villa 12',$4,'P-12',$5,now())",
        [projectId, workspaceId, randomUUID(), approver, randomUUID()]);
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,created_by,submitted_by,status,total)
        VALUES($1,$2,'PO-0042',$3,$4,'AED','on_delivery',$5,$5,'pending_approval',1234.5)`, [randomUUID(), workspaceId, randomUUID(), vendor, buyer]);
      await client.query("INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,submitted_at) VALUES($1,$2,$3,'2026-09-28',$4,'submitted',now())",
        [randomUUID(), workspaceId, projectId, site]);
      await client.query("SET LOCAL session_replication_role = origin");
      await work(client, { workspaceId, buyer, approver, site, projectId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const context = (ids: { workspaceId: string }, userId: string, permissions: string[], managed: string[] = []): ApprovalContext => ({
    workspaceId: ids.workspaceId, userId, displayName: "Someone", membershipId: null, currency: "AED",
    can: async (permission) => permissions.includes(permission), managedProjects: new Set(managed),
  });

  it("reads every source, and lists what each person may decide", async () => {
    await world(async (client, ids) => {
      // Everything readable at once: every query runs.
      const everything = await waitingFor(client, context(ids, ids.approver, [
        "commercial.estimate", "commercial.approve", "commercial.finance.verify", "commercial.deal.approve", "purchasing.approve", "factory.approve",
        "projects.manage", "stock.adjust", "payables.approve", "payables.manage",
      ]));
      expect(everything.rows.map((row) => row.kind).sort()).toEqual(["order", "site_report"]);
      const order = everything.rows.find((row) => row.kind === "order")!;
      expect(order).toMatchObject({ title: "PO-0042", subject: "Al Noor Timber", amount: "1234.5000", currency: "AED", canDecide: true,
        decide: { approve: "approve", other: "return" } });
      expect(order.href).toMatch(/^\/workspace\/purchasing\/orders\?order=/);
      expect(everything.count).toBe(2);
      expect(everything.counts).toMatchObject({ orders: 1, site: 1, quotes: 0 });

      // The buyer who raised the order sees it isn't theirs to approve (if they could approve at all).
      const buyer = await waitingFor(client, context(ids, ids.buyer, ["purchasing.approve"]));
      expect(buyer.rows).toEqual([expect.objectContaining({ kind: "order", canDecide: false, reason: expect.stringMatching(/your own/) })]);
      expect(buyer.count).toBe(0);

      // Without the permission, nothing; a named project manager sees their project's site report.
      expect((await waitingFor(client, context(ids, ids.site, []))).rows).toEqual([]);
      const manager = await waitingFor(client, context(ids, ids.approver, [], [ids.projectId]));
      expect(manager.rows).toEqual([expect.objectContaining({ kind: "site_report", canDecide: true, project: expect.objectContaining({ reference: "P-12" }) })]);
    });
  });

  it("lists a milestone falling due without an invoice as Issue invoice, for those who invoice clients (D-14)", async () => {
    await world(async (client, ids) => {
      const caseId = (await client.query<{ case_id: string }>("SELECT case_id FROM delivery_projects WHERE id = $1", [ids.projectId])).rows[0].case_id;
      const opportunityId = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$3,$3,'Villa 12 fit-out','OP-1')`, [opportunityId, ids.workspaceId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ids.workspaceId, opportunityId, ids.approver]);
      await client.query(`INSERT INTO project_scope_seals(id,workspace_id,project_id,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,accepted_at,accepted_by_name,sealed_by)
        VALUES($1,$2,$3,'q1',1,'R1','h','{}'::jsonb,$4,'AED',9000,now(),'Client',$5)`, [randomUUID(), ids.workspaceId, ids.projectId, "0".repeat(64), ids.approver]);
      await client.query(`INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,due_date,status,source_quote_id) VALUES
        ($1,$2,'due',0,'Advance',3000,'AED',current_date + 2,'pending','q1'),
        ($1,$2,'later',1,'Carpentry',3000,'AED',current_date + 20,'pending','q1'),
        ($1,$2,'invoiced',2,'Tiles',3000,'AED',current_date - 1,'pending','q1')`, [ids.workspaceId, caseId]);
      await client.query(`INSERT INTO client_invoices(id,workspace_id,case_id,payment_id,project_id,legal_entity_id,quote_id,number,issue_date,due_date,currency,net,tax,total,
          prices_include_tax,milestone_title,customer_name,company_name,issued_by,status)
        VALUES($1,$2,$3,'invoiced',$4,$5,'q1','INV-1',current_date,current_date,'AED',3000,0,3000,false,'Tiles','Client','Firm',$6,'issued')`,
        [randomUUID(), ids.workspaceId, caseId, ids.projectId, randomUUID(), ids.approver]);
      await client.query("SET LOCAL session_replication_role = origin");
      const finance = await waitingFor(client, context(ids, ids.approver, ["receivables.manage"]));
      expect(finance.rows).toEqual([expect.objectContaining({ kind: "invoice", group: "payments", id: "due", title: "Advance", canDecide: true, decide: null,
        phrase: { key: "Issue invoice · {milestone}", values: { milestone: "Advance" } }, href: `/workspace/projects/${ids.projectId}/money?view=client`,
        project: expect.objectContaining({ reference: "P-12" }) })]);
      expect((await waitingFor(client, context(ids, ids.approver, []))).rows.some((row) => row.kind === "invoice")).toBe(false);
    });
  });

  it("names the project a reported client payment belongs to", async () => {
    await world(async (client, ids) => {
      const caseId = (await client.query<{ case_id: string }>("SELECT case_id FROM delivery_projects WHERE id = $1", [ids.projectId])).rows[0].case_id;
      const opportunityId = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$3,$3,'Villa 12 fit-out','OP-1')`, [opportunityId, ids.workspaceId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ids.workspaceId, opportunityId, ids.approver]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,content) VALUES($1,$2,'{}'::jsonb)", [ids.workspaceId, caseId]);
      await client.query(`INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,reference)
        VALUES($1,$2,'r1',0,'p1','le','AED',5000,'manual','reported','TT-1')`, [ids.workspaceId, caseId]);
      await client.query("SET LOCAL session_replication_role = origin");
      const finance = await waitingFor(client, context(ids, ids.approver, ["commercial.finance.verify"]));
      expect(finance.rows).toEqual([expect.objectContaining({ kind: "receipt", project: expect.objectContaining({ id: ids.projectId, reference: "P-12", name: "Villa 12" }) })]);
    });
  });
});
