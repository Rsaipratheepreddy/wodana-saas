import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyProject } from "../projects/execution.domain";
import type { ProjectData } from "../projects/execution.types";
import { projectRepository } from "../projects/project-repository";
import { readHomeMetrics, type HomeMetricsAccess } from "./home-metrics";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

// Monday 2026-09-14 22:30 in Los Angeles (already the 15th in UTC). The workspace week starts on Saturday.
const now = new Date("2026-09-15T05:30:00.000Z");
const weekStarts = ["2026-07-25", "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12"];
const all: HomeMetricsAccess = { enquiries: true, quotes: true, payments: true, projects: true, manageProjects: false, activity: true, storage: true, followUps: true, orders: true };

const files = (items: Array<{ id: string; bytes: number }>): ProjectData => ({ ...emptyProject(), revision: 1, files: items } as ProjectData);

integration("Home metrics with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; membershipId: string; lead: string; caseId: string; late: string };
  async function scenario(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherWorkspaceId = randomUUID(), userId = randomUUID(), membershipId = randomUUID();
    const caseId = randomUUID(), otherCaseId = randomUUID(), entity = randomUUID();
    const [lateProject, offTrackProject, riskProject, riskLateProject, calmProject, doneProject, draftProject, hiddenProject] = Array.from({ length: 8 }, () => randomUUID());
    const leads = Array.from({ length: 6 }, () => randomUUID());
    const party = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Admin')", [userId, `home-${userId.slice(0, 8)}@example.com`]);
      await client.query(
        `INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone,week_starts_on)
         VALUES($1,'Home metrics',$2,'USD',$3,'America/Los_Angeles',6)`, [workspaceId, `home-${workspaceId.slice(0, 8)}`, userId]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membershipId, workspaceId, userId]);

      // Enquiries: two this month (one on the Saturday week boundary), one in August's matching span, one that is
      // already September in UTC but still August 31 locally, one in the future, one before the eight weeks.
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Amira Client','amira client')", [party, workspaceId]);
      for (const [index, created] of ["2026-09-14T06:00:00Z", "2026-09-12T06:59:00Z", "2026-09-01T06:30:00Z", "2026-08-10T12:00:00Z", "2026-09-15T06:00:00Z", "2026-07-20T00:00:00Z"].entries())
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,created_at) VALUES($1,$2,$3,$4,$5)", [leads[index], workspaceId, randomUUID(), party, created]);
      // Another tenant's lead in the same week is never counted.
      await client.query("INSERT INTO crm_leads(workspace_id,enquiry_id,party_id,created_at) VALUES($1,$2,$3,'2026-09-14T06:00:00Z')", [otherWorkspaceId, randomUUID(), randomUUID()]);

      // Quotations.
      const quote = async (number: number, values: { kind?: string; status: string; currency?: string; total: string; detail?: Record<string, unknown> }) =>
        client.query(
          `INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,total,detail)
           VALUES($1,$2,$3,$4,$4,$5,$6,'Quote',$7,$8,$9::jsonb)`,
          [workspaceId, caseId, `q${number}`, number, values.kind ?? "quotation", values.status, values.currency ?? "USD", values.total, JSON.stringify(values.detail ?? {})]);
      await quote(1, { status: "issued", total: "1000.50", detail: { issuedAt: "2026-09-14T06:00:00.000Z" } });
      await quote(2, { status: "accepted", total: "2000.25", detail: { issuedAt: "2026-09-03T20:00:00.000Z", decidedAt: "2026-09-10T10:00:00.000Z" } });
      await quote(3, { status: "issued", currency: "EUR", total: "999", detail: { issuedAt: "2026-09-05T10:00:00.000Z" } });
      await quote(4, { status: "superseded", total: "500", detail: { issuedAt: "2026-09-02T10:00:00.000Z" } });
      await quote(5, { status: "accepted", total: "300", detail: { issuedAt: "2026-08-05T10:00:00.000Z", decidedAt: "2026-08-12T10:00:00.000Z" } });
      await quote(6, { status: "draft", total: "10000" });
      await quote(7, { kind: "variation", status: "issued", total: "700", detail: { issuedAt: "2026-09-10T10:00:00.000Z" } });
      // An issued quotation on a cancelled case no longer awaits the client.
      const cancelledCaseId = randomUUID();
      await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by,cancelled_at,cancelled_by,cancellation_reason)
         VALUES($1,$2,$3,'cancelled',$4,now(),$4,'Client withdrew')`, [cancelledCaseId, workspaceId, randomUUID(), userId]);
      await client.query(
        `INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,total) VALUES($1,$2,'q1',1,1,'quotation','issued','Quote','USD','100')`,
        [workspaceId, cancelledCaseId]);

      // Follow-ups: open reminders (with or without a due time), not notes, done or cancelled ones, nor another tenant's.
      const followUp = (type: string, status: string, due: string | null, workspace = workspaceId) => client.query(
        "INSERT INTO crm_activities(workspace_id,party_id,type,status,title,due_at) VALUES($1,$2,$3,$4,'Call back',$5)", [workspace, party, type, status, due]);
      await followUp("call", "pending", "2026-09-15T05:00:00Z");
      await followUp("task", "pending", "2026-09-16T05:00:00Z");
      await followUp("task", "pending", null);
      await followUp("note", "pending", "2026-09-01T05:00:00Z");
      await followUp("task", "completed", "2026-09-01T05:00:00Z");
      await followUp("task", "cancelled", "2026-09-01T05:00:00Z");
      await followUp("task", "pending", "2026-09-01T05:00:00Z", otherWorkspaceId);

      // Purchase orders placed with a supplier and not fully received yet.
      for (const [index, status] of ["sent", "confirmed", "partly_received", "draft", "approved", "received", "closed", "cancelled"].entries())
        await client.query(
          `INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,status,payment_terms,created_by,approved_at,sent_at,confirmed_at,cancelled_at)
           VALUES($1,$2,$3,$4,$5,'USD',$6,'on_delivery',$7,now(),now(),now(),$8)`,
          [randomUUID(), workspaceId, `PO-${index + 1}`, entity, randomUUID(), status, userId, status === "cancelled" ? "2026-09-10T00:00:00Z" : null]);

      // Payments: cases, milestones, receipts, allocations and invoices.
      await client.query(
        `INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by) VALUES($1,$2,$3,'active',$4),($5,$2,$6,'active',$4)`,
        [caseId, workspaceId, randomUUID(), userId, otherCaseId, randomUUID()]);
      const milestone = (id: string, amount: string, due: string, status = "pending", onCase = caseId) => client.query(
        `INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,due_date,status,source_quote_id)
         VALUES($1,$2,$3,0,'Milestone',$4,$5,$6,'q2')`, [workspaceId, onCase, id, amount, due, status]);
      await milestone("p1", "1000", "2026-09-18", "proof_submitted");
      await milestone("p2", "300", "2026-09-25");
      await milestone("p3", "400", "2026-10-02");
      await milestone("p4", "150", "2026-09-05", "verified", otherCaseId);
      const receipt = (id: string, amount: string, status: string, detail: Record<string, unknown>, currency = "USD") => client.query(
        `INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,detail)
         VALUES($1,$2,$3,0,'p1','entity',$4,$5,'manual',$6,$7::jsonb)`, [workspaceId, caseId, id, currency, amount, status, JSON.stringify(detail)]);
      await receipt("r1", "400.10", "finance_verified", { verifiedAt: "2026-09-14T06:30:00.000Z", reportedAt: "2026-09-13T06:30:00.000Z" });
      await receipt("r2", "99.90", "finance_verified", { reportedAt: "2026-09-02T12:00:00.000Z" });
      await receipt("r3", "5000", "reported", { reportedAt: "2026-09-10T12:00:00.000Z" });
      await receipt("r4", "250", "finance_verified", { verifiedAt: "2026-08-14T12:00:00.000Z" });
      await receipt("r5", "777", "finance_verified", { verifiedAt: "2026-09-10T12:00:00.000Z" }, "EUR");
      await client.query(
        `INSERT INTO commercial_allocations(workspace_id,case_id,id,sort_order,receipt_id,payment_id,legal_entity_id,currency,amount)
         VALUES($1,$2,'a1',0,'r1','p1','entity','USD','400.10'),($1,$2,'a2',1,'r3','p1','entity','USD','5000')`, [workspaceId, caseId]);
      const invoice = (paymentId: string, due: string, status: string) => client.query(
        `INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,
           net,tax,total,prices_include_tax,milestone_title,customer_name,company_name,issued_by,status)
         VALUES($1,$2,$3,$4,$5,$6,'q2',$7,'2026-09-01',$8,'USD','1000','0','1000',false,'Milestone','Amira','Studio',$9,$10)`,
        [randomUUID(), workspaceId, randomUUID(), lateProject, caseId, paymentId, `INV-${paymentId}-${status}`, due, userId, status]);
      await invoice("p1", "2026-09-20", "issued");
      await invoice("p9", "2026-09-10", "credited");

      // Projects (project-core): started projects with their health and promised date; the member is on all but one.
      const projects: Array<[string, { name?: string; status?: string; health?: string; promise?: string | null; started: string | null }]> = [
        [lateProject, { name: "Villa Marina", promise: "2026-09-10", started: "2026-09-14T06:00:00Z" }],
        [offTrackProject, { health: "off_track", promise: "2026-12-01", started: "2026-08-20T10:00:00Z" }],
        [riskProject, { health: "at_risk", promise: "2026-12-01", started: "2026-09-02T10:00:00Z" }],
        [riskLateProject, { health: "at_risk", promise: "2026-09-13", started: "2026-07-01T10:00:00Z" }],
        [calmProject, { started: "2026-07-01T10:00:00Z" }],
        [doneProject, { status: "completed", started: "2026-09-05T10:00:00Z" }],
        [draftProject, { health: "off_track", started: null }],
        [hiddenProject, { promise: "2026-12-01", started: "2026-08-10T10:00:00Z" }],
      ];
      for (const [index, [id, values]] of projects.entries()) {
        await client.query(
          `INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,created_at,status,completed_at,health,promise_date,started_at,quote_id,reference)
           VALUES($1,$2,$3,$4,$5,'2026-06-01T00:00:00Z',$6,$7,$8,$9,$10,$11,$12)`,
          [id, workspaceId, randomUUID(), values.name ?? "Project", userId, values.status ?? "active", values.status === "completed" ? values.started : null,
            values.health ?? "on_track", values.promise ?? null, values.started, values.started ? "q1" : null, values.started ? `PRJ-${index + 1}` : null]);
        if (id !== hiddenProject)
          await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,active) VALUES($1,$2,$3,true)", [workspaceId, id, membershipId]);
      }
      // Work: only open tasks (and subtasks) due before local today on active projects are overdue.
      const workItems: Array<[string, string, string, string | null, string?]> = [
        [lateProject, "task", "todo", "2026-09-13"],
        [lateProject, "task", "done", "2026-09-01"],
        [lateProject, "task", "in_progress", "2026-09-14"],
        [lateProject, "blocker", "todo", "2026-09-01"],
        [lateProject, "task", "cancelled", "2026-09-01"],
        [lateProject, "task", "todo", null],
        [riskProject, "task", "todo", "2026-09-20", "parent"],
        [riskProject, "task", "in_review", "2026-09-12", "child"],
        [doneProject, "task", "todo", "2026-09-01"],
        [draftProject, "task", "todo", "2026-09-01"],
        [hiddenProject, "task", "todo", "2026-09-02"],
      ];
      const parentId = randomUUID();
      for (const [index, [projectId, type, status, due, role]] of workItems.entries())
        await client.query(
          `INSERT INTO work_items(id,workspace_id,project_id,number,type,parent_id,title,status,due_date,completed_at,created_by)
           VALUES($1,$2,$3,$4,$5,$6,'Work',$7,$8,$9,$10)`,
          [role === "parent" ? parentId : randomUUID(), workspaceId, projectId, index + 1, type, role === "child" ? parentId : null, status, due,
            status === "done" ? "2026-09-02T00:00:00Z" : null, userId]);
      await client.query("SET LOCAL session_replication_role = origin");
      // Legacy project attachments kept on the execution record still count towards storage.
      await projectRepository.save(client, workspaceId, lateProject, files([{ id: "pf1", bytes: 2500 }]));

      // Activity: security and MFA events are never shown; only the newest six others are.
      await client.query("SET LOCAL session_replication_role = replica");
      const audit = (action: string, entityType: string, entityId: string | null, occurredAt: string, after: Record<string, unknown> = {}) => client.query(
        `INSERT INTO audit_events(workspace_id,actor_user_id,source,action,entity_type,entity_id,after,correlation_id,occurred_at)
         VALUES($1,$2,'user',$3,$4,$5,$6::jsonb,$7,$8)`, [workspaceId, userId, action, entityType, entityId, JSON.stringify(after), randomUUID(), occurredAt]);
      await audit("security.session_revoked", "auth_session", entity, "2026-09-15T05:20:00Z");
      await audit("mfa.login_verified", "auth_mfa", entity, "2026-09-15T05:19:00Z");
      await audit("crm.lead.created.v1", "crm_lead", leads[0], "2026-09-15T05:10:00Z");
      await audit("project.started", "project", lateProject, "2026-09-15T05:00:00Z");
      await audit("quotation.lines_changed.v1", "commercial_case", caseId, "2026-09-15T04:50:00Z", { title: "Kitchen quote" });
      await audit("client_invoice.issued", "client_invoice", entity, "2026-09-15T04:40:00Z", { number: "INV-7" });
      await audit("workspace.member_invited", "workspace_invitation", entity, "2026-09-15T04:30:00Z");
      await audit("workspace.appearance_updated", "workspace_branding", entity, "2026-09-15T04:20:00Z");
      await audit("role.created", "role", entity, "2026-09-15T04:10:00Z");

      // Storage: the same sources the upload allowance counts.
      const stored = (key: string, bytes: number, status = "active", extra = "") => client.query(
        `INSERT INTO workspace_stored_objects(workspace_id,object_key,byte_size,content_type,status,reservation_expires_at,removed_at)
         VALUES($1,$2,$3,'application/octet-stream',$4,${extra === "pending" ? "now()+interval '10 minutes'" : extra === "expired" ? "now()-interval '10 minutes'" : "NULL"},
           ${extra === "removed" ? "now()" : "NULL"})`, [workspaceId, key, bytes, status]);
      await stored(`projects/${workspaceId}/${lateProject}/f1`, 1000);
      await stored(`site/reports/${workspaceId}/r1/original`, 200);
      await stored(`pre-projects/${workspaceId}/${caseId}/a1/original`, 300);
      await stored(`catalog/${workspaceId}/record/asset`, 400);
      await stored(`member-photos/${workspaceId}/${userId}/x.webp`, 50);
      await stored(`gallery/${workspaceId}/img/original`, 70, "pending", "pending");
      await stored(`gallery/${workspaceId}/img2/original`, 9999, "pending", "expired");
      await stored(`hrms/${workspaceId}/documents/old`, 5, "removed", "removed");
      const brief = (key: string, bytes: number) => client.query(
        `INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,sha256,created_by)
         VALUES($1,$2,$3,'brief.png','image/png',$4,$5,$6,$7)`, [randomUUID(), workspaceId, caseId, bytes, key, "0".repeat(64), userId]);
      await brief(`pre-projects/${workspaceId}/${caseId}/legacy`, 600);
      await brief(`pre-projects/${workspaceId}/${caseId}/a1/original`, 300);
      await client.query("SET LOCAL session_replication_role = origin");

      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await work(client, { workspaceId, membershipId, lead: leads[0], caseId, late: lateProject });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("buckets into eight local weeks and sums the month to date as strings", async () => {
    await scenario(async (client, { workspaceId, membershipId }) => {
      const metrics = await readHomeMetrics(client, workspaceId, membershipId, all, now);
      expect(metrics).toMatchObject({ generatedAt: now.toISOString(), timeZone: "America/Los_Angeles", weekStartsOn: 6, currency: "USD" });

      expect(metrics.enquiries).toEqual({
        current: 2, previous: 1,
        weekly: weekStarts.map((start, index) => ({ start, value: String([0, 0, 1, 0, 0, 1, 1, 1][index]), count: [0, 0, 1, 0, 0, 1, 1, 1][index] })),
      });

      expect(metrics.quotes).toEqual({
        issuedValue: "3000.75", previousIssuedValue: "300.00", issuedCount: 3, accepted: 1, previousAccepted: 1, awaiting: 2,
        weekly: weekStarts.map((start, index) => ({
          start,
          value: ["0.00", "300.00", "0.00", "0.00", "0.00", "2000.25", "0.00", "1000.50"][index],
          count: [0, 1, 0, 0, 0, 1, 1, 1][index],
        })),
      });

      expect(metrics.payments).toEqual({
        received: "500.00", previousReceived: "250.00",
        // Invoice for p1: 1000 less the verified 400.10 (the unverified allocation doesn't count) + milestone p2 not invoiced.
        due: "899.90",
        weekly: weekStarts.map((start, index) => ({
          start,
          value: ["0.00", "0.00", "250.00", "0.00", "0.00", "99.90", "0.00", "400.10"][index],
          count: [0, 0, 1, 0, 0, 1, 0, 1][index],
        })),
      });

      expect(metrics.projects).toEqual({
        active: 5, overdueTasks: 2, late: 3, atRisk: 1, onTrack: 1,
        weekly: weekStarts.map((start, index) => ({ start, value: String([0, 0, 0, 1, 0, 1, 1, 1][index]), count: [0, 0, 0, 1, 0, 1, 1, 1][index] })),
      });

      expect(metrics.followUps).toEqual({ open: 3, overdue: 1 });
      expect(metrics.orders).toEqual({ toReceive: 3 });
    });
  });

  it("widens projects to every project with projects.manage", async () => {
    await scenario(async (client, { workspaceId, membershipId }) => {
      const metrics = await readHomeMetrics(client, workspaceId, membershipId, { ...all, manageProjects: true }, now);
      expect(metrics.projects).toMatchObject({ active: 6, overdueTasks: 3, late: 3, atRisk: 1, onTrack: 2 });
      expect(metrics.projects!.weekly.map((week) => week.count)).toEqual([0, 0, 1, 1, 0, 1, 1, 1]);
    });
  });

  it("lists the newest safe audit events with links", async () => {
    await scenario(async (client, { workspaceId, membershipId, lead, caseId, late }) => {
      const { activity } = await readHomeMetrics(client, workspaceId, membershipId, { ...all, enquiries: false, quotes: false, payments: false, projects: false, storage: false }, now);
      expect(activity).toEqual([
        expect.objectContaining({ area: "sales", action: "crm.lead.created.v1", subject: "Amira Client", actorName: "Sara Admin", href: `/workspace/crm/leads?record=${lead}`, at: "2026-09-15T05:10:00.000Z" }),
        expect.objectContaining({ area: "projects", action: "project.started", subject: "Villa Marina", href: `/workspace/projects/${late}/overview` }),
        expect.objectContaining({ area: "planning", subject: "Kitchen quote", href: `/workspace/pre-projects/cases/${caseId}/overview` }),
        expect.objectContaining({ area: "finance", subject: "INV-7", href: null }),
        expect.objectContaining({ area: "people", action: "workspace.member_invited", subject: "" }),
        expect.objectContaining({ area: "settings", action: "workspace.appearance_updated" }),
      ]);
    });
  });

  it("reports storage by area against the quota", async () => {
    await scenario(async (client, { workspaceId, membershipId }) => {
      const only = { ...all, enquiries: false, quotes: false, payments: false, projects: false, activity: false };
      expect((await readHomeMetrics(client, workspaceId, membershipId, only, now)).storage).toEqual({
        usedBytes: "5120", quotaBytes: null, areas: { projects: "3700", planning: "900", catalog: "400", other: "120" },
      });
      await client.query("RESET ROLE");
      await client.query("INSERT INTO workspace_data_policies(workspace_id,storage_quota_bytes,retention_days) VALUES($1,1073741824,30)", [workspaceId]);
      await client.query("SET LOCAL ROLE wodana_app");
      expect((await readHomeMetrics(client, workspaceId, membershipId, only, now)).storage?.quotaBytes).toBe("1073741824");
    });
  });

  it("leaves out every section the caller may not see", async () => {
    await scenario(async (client, { workspaceId, membershipId }) => {
      const none = { enquiries: false, quotes: false, payments: false, projects: false, manageProjects: true, activity: false, storage: false, followUps: false, orders: false };
      const metrics = await readHomeMetrics(client, workspaceId, membershipId, none, now);
      expect(Object.keys(metrics).sort()).toEqual(["currency", "generatedAt", "timeZone", "weekStartsOn"]);
      const some = await readHomeMetrics(client, workspaceId, membershipId, { ...none, payments: true, storage: true }, now);
      expect(Object.keys(some).sort()).toEqual(["currency", "generatedAt", "payments", "storage", "timeZone", "weekStartsOn"]);
    });
  });
});
