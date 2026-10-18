import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitingFor, type ApprovalContext } from "./approval-sources";
import { ApprovalsService } from "./approvals.service";
import { BriefService } from "../pre-projects/brief.service";
import { DesignService } from "../pre-projects/design.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";

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
      // The proof the team attached when recording it.
      await client.query(`INSERT INTO decision_evidence_files(workspace_id,kind,subject_id,storage_key,file_name,mime_type,byte_size,sha256,has_preview,uploaded_by)
        VALUES($1,'receipt','r1','k','transfer.pdf','application/pdf',10,$2,false,$3)`, [ids.workspaceId, "a".repeat(64), ids.approver]);
      await client.query("SET LOCAL session_replication_role = origin");
      const finance = await waitingFor(client, context(ids, ids.approver, ["commercial.finance.verify"]));
      expect(finance.rows).toEqual([expect.objectContaining({ kind: "receipt", project: expect.objectContaining({ id: ids.projectId, reference: "P-12", name: "Villa 12" }),
        // A receipt the team recorded is verified or returned with a reason, in the review, with its proof beside it.
        decide: { approve: "verify_payment", other: "return", approveNeedsNote: false },
        files: [expect.objectContaining({ store: "evidence", owner: caseId, name: "transfer.pdf", preview: false })] })]);
    });
  });

  it("names factory output the way the Factory does: WO-0003 and 1 nos", async () => {
    await world(async (client, ids) => {
      const order = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO work_orders(id,workspace_id,number,project_id,boq_line_id,title,quantity,unit,created_by) VALUES($1,$2,3,$3,$4,'Wardrobe',1,'nos',$5)", [order, ids.workspaceId, ids.projectId, randomUUID(), ids.approver]);
      await client.query("INSERT INTO work_order_reports(id,workspace_id,work_order_id,good,reported_by) VALUES($1,$2,$3,1,$4)", [randomUUID(), ids.workspaceId, order, ids.site]);
      await client.query("SET LOCAL session_replication_role = origin");
      const factory = await waitingFor(client, context(ids, ids.approver, ["factory.approve"]));
      expect(factory.rows.find((row) => row.kind === "output")).toMatchObject({ title: "WO-0003 · Wardrobe", subject: "1 nos" });
    });
  });

  it("lists a design sent for internal review to its reviewer, and an unassigned one to anyone who reviews designs", async () => {
    await world(async (client, ids) => {
      const caseId = randomUUID(), opportunityId = randomUUID(), partyId = randomUUID(), other = randomUUID(), designer = randomUUID(), asset = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Mariam Al Suwaidi','mariam al suwaidi')", [partyId, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$4,$4,'Majlis design','D-0012')`, [opportunityId, ids.workspaceId, partyId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ids.workspaceId, opportunityId, ids.approver]);
      const design = async (title: string, status: string, reviewer: string | null, archived = false) => {
        const id = randomUUID();
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,stage,created_by,archived_at) VALUES($1,$2,$3,$4,'concept','concepts',$5,$6)",
          [id, ids.workspaceId, caseId, title, designer, archived ? new Date() : null]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,reviewer_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
          [randomUUID(), ids.workspaceId, caseId, id, asset, designer, status, reviewer]);
        return id;
      };
      const sent = await design("Majlis concept", "internal_review", ids.approver);
      await design("For someone else", "internal_review", other);
      await design("Unassigned", "internal_review", null);
      await design("Still a draft", "draft", ids.approver);
      await design("Archived", "internal_review", ids.approver, true);
      await client.query("SET LOCAL session_replication_role = origin");
      const reviewer = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs"];
      const mine = await waitingFor(client, context(ids, ids.approver, reviewer));
      expect(mine.rows.map((row) => row.title).sort()).toEqual(["Majlis concept · V1", "Unassigned · V1"]);
      expect(mine.rows.find((row) => row.id === sent)).toMatchObject({ kind: "design_review", group: "designs", parentId: caseId, subject: "Mariam Al Suwaidi",
        project: { id: caseId, reference: "D-0012", name: "Majlis design" }, canDecide: true, href: `/workspace/pre-projects/cases/${caseId}/designs?file=${sent}`,
        decide: { approve: "internal_approved", other: "return", approveNeedsNote: false } });
      expect(mine.counts.designs).toBe(2);
      // Another reviewer has the one sent to them and the unassigned one; someone who doesn't review designs has none.
      expect((await waitingFor(client, context(ids, other, reviewer))).rows.map((row) => row.title).sort()).toEqual(["For someone else · V1", "Unassigned · V1"]);
      expect((await waitingFor(client, context(ids, ids.approver, ["pre_projects.view", "pre_projects.edit"]))).rows).toEqual([]);
    });
  });

  it("approves a design review from Approvals or sends it back, recorded on the design as the design page records it", async () => {
    await world(async (client, ids) => {
      const caseId = randomUUID(), opportunityId = randomUUID(), designer = randomUUID(), asset = randomUUID();
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Noor Reviewer'),($3,$4,'Dana Designer')",
        [ids.approver, `${ids.approver.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$3,$3,'Majlis design','D-0012')`, [opportunityId, ids.workspaceId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ids.workspaceId, opportunityId, ids.approver]);
      await client.query("INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by) VALUES($1,$2,$3,'majlis.pdf','application/pdf',1,'k',repeat('a',64),$4)",
        [asset, ids.workspaceId, caseId, designer]);
      const design = async (title: string) => {
        const id = randomUUID();
        await client.query("INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,created_by) VALUES($1,$2,$3,$4,'concept',$5)", [id, ids.workspaceId, caseId, title, designer]);
        await client.query("INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,created_by,status,reviewer_id) VALUES($1,$2,$3,$4,1,$5,$6,'internal_review',$7)",
          [randomUUID(), ids.workspaceId, caseId, id, asset, designer, ids.approver]);
        return id;
      };
      const approved = await design("Majlis concept"), returned = await design("Dining layout");
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const permissions = ["pre_projects.view", "pre_projects.edit", "pre_projects.review_designs"];
      const run = (_a: unknown, _w: string, _p: unknown, work: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => work(client, { userId: ids.approver, displayName: "Noor Reviewer" });
      const access = { asMember: (_a: unknown, _w: string, work: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => work(client, { userId: ids.approver, displayName: "Noor Reviewer" }),
        withPermission: run, withPermissions: run, hasPermission: async (_c: unknown, _w: string, _u: string, permission: string) => permissions.includes(permission) };
      const events = new CrmEventsService();
      const designs = new DesignService(access as never, new BriefService(access as never, events, {} as never), events);
      const approvals = new ApprovalsService(access as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, designs);
      const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "Noor Reviewer" } as never;
      expect((await approvals.mine(actor, ids.workspaceId)).rows.filter((row) => row.kind === "design_review").map((row) => row.id).sort()).toEqual([approved, returned].sort());
      // The review shows the file under review.
      expect((await approvals.mine(actor, ids.workspaceId)).rows.find((row) => row.id === approved)?.files).toEqual([expect.objectContaining({ store: "case_asset", owner: caseId })]);

      await expect(approvals.decide(actor, ids.workspaceId, { kind: "design_review", id: returned, decision: "return", note: "" })).rejects.toThrow(/Describe the changes/);
      await approvals.decide(actor, ids.workspaceId, { kind: "design_review", id: approved, decision: "approve" });
      const after = await approvals.decide(actor, ids.workspaceId, { kind: "design_review", id: returned, decision: "return", note: "Seat twelve, not ten" });
      expect(after.rows.filter((row) => row.kind === "design_review")).toEqual([]);
      const recorded = (await client.query<{ design: string; status: string; action: string; note: string }>(
        `SELECT design.title AS design, version.status, activity.action, activity.note FROM pre_project_design_activity activity
           JOIN pre_project_design_versions version ON version.workspace_id = activity.workspace_id AND version.id = activity.version_id
           JOIN pre_project_designs design ON design.workspace_id = activity.workspace_id AND design.id = activity.design_id
          WHERE activity.workspace_id = $1 ORDER BY design.title`, [ids.workspaceId])).rows;
      expect(recorded).toEqual([
        { design: "Dining layout", status: "changes_requested", action: "changes_requested", note: "Seat twelve, not ten" },
        { design: "Majlis concept", status: "internal_approved", action: "internal_approved", note: "" },
      ]);
      // The designer hears each answer, as from the design page.
      expect((await client.query(`SELECT event_type FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND channel = 'in_app' ORDER BY event_type`, [ids.workspaceId, designer])).rows.map((row) => row.event_type))
        .toEqual(["design.review_approved", "design.sent_back"]);
    });
  });

  it("names the case a payment belongs to while the deal is still in Planning", async () => {
    await world(async (client, ids) => {
      const caseId = randomUUID(), opportunityId = randomUUID();
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$3,$3,'Sofia kitchen','D-0008')`, [opportunityId, ids.workspaceId, randomUUID()]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, ids.workspaceId, opportunityId, ids.approver]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,content) VALUES($1,$2,'{}'::jsonb)", [ids.workspaceId, caseId]);
      await client.query(`INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,reference)
        VALUES($1,$2,'r1',0,'p1','le','AED',5000,'manual','reported','TT-1')`, [ids.workspaceId, caseId]);
      await client.query("SET LOCAL session_replication_role = origin");
      const finance = await waitingFor(client, context(ids, ids.approver, ["commercial.finance.verify"]));
      expect(finance.rows).toEqual([expect.objectContaining({ kind: "receipt", project: { id: caseId, reference: "D-0008", name: "Sofia kitchen" } })]);
    });
  });
});
