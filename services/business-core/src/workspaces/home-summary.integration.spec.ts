import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMyDay } from "../reminders/my-day/my-day";
import { builtinReminderSources, runReminderSweep } from "../reminders/testing";
import { readHomeSummary, type HomeSummaryAccess } from "./home-summary";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

// 08:00 on Monday 28 September 2026 in Dubai.
const now = new Date("2026-09-28T04:00:00.000Z");
const everything: HomeSummaryAccess = {
  followUps: true, replies: true, leads: true, assignLeads: true, planning: true, projects: true, manageProjects: false,
  receivables: true, purchasing: true, factory: true,
  approvals: { designs: true, reviewDesigns: true, recordClientDesigns: true, reviewQuotes: true, verifyPayments: true, approveOrders: true, manageLeave: true, projects: true, manageProjects: false },
};

integration("Home summary with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; me: string; userId: string; project: string; otherProject: string; lead: string };
  async function scenario(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherWorkspaceId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
    const me = randomUUID(), colleague = randomUUID(), party = randomUUID(), lead = randomUUID(), project = randomUUID(), otherProject = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Khalid PM'),($3,$4,'Rami Factory')",
        [userId, `home-${userId.slice(0, 8)}@example.com`, otherUserId, `home-${otherUserId.slice(0, 8)}@example.com`]);
      await client.query(`INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone,week_starts_on)
        VALUES($1,'Home summary',$2,'AED',$3,'Asia/Dubai',1)`, [workspaceId, `home-${workspaceId.slice(0, 8)}`, userId]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')",
        [me, workspaceId, userId, colleague, otherUserId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Amira Client','amira client')", [party, workspaceId]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status) VALUES($1,$2,$3,$4,$5,'connected')",
        [lead, workspaceId, randomUUID(), party, me]);

      // Follow-ups: mine overdue and due later today, a colleague's, and one in another tenant that points at my membership.
      const activity = (workspace: string, owner: string, title: string, due: string) => client.query(
        `INSERT INTO crm_activities(workspace_id,party_id,lead_id,type,status,title,owner_membership_id,due_at) VALUES($1,$2,$3,'call','pending',$4,$5,$6)`,
        [workspace, party, lead, title, owner, due]);
      await activity(workspaceId, me, "Call Amira back", "2026-09-27T06:00:00Z");
      await activity(workspaceId, me, "Send the brochure", "2026-09-28T12:00:00Z");
      await activity(workspaceId, me, "Check in next week", "2026-10-01T06:00:00Z");
      await activity(workspaceId, colleague, "Colleague's call", "2026-09-27T06:00:00Z");
      await activity(otherWorkspaceId, me, "Another tenant's call", "2026-09-27T06:00:00Z");

      // Projects: I manage one (assigned as its manager); another I'm not on.
      await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,status,created_by,started_at,quote_id,reference)
        VALUES($1,$3,$4,'Villa 12','active',$5,now(),'q1','PRJ-1'),($2,$3,$6,'Hidden villa','active',$5,now(),'q2','PRJ-2')`,
        [project, otherProject, workspaceId, randomUUID(), userId, randomUUID()]);
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active) VALUES($1,$2,$3,true,true)", [workspaceId, project, me]);
      const item = (projectId: string, number: number, title: string, assignee: string | null, due: string) => client.query(
        `INSERT INTO work_items(id,workspace_id,project_id,number,type,title,status,assignee_membership_id,due_date,created_by) VALUES($1,$2,$3,$4,'task',$5,'todo',$6,$7,$8)`,
        [randomUUID(), workspaceId, projectId, number, title, assignee, due, userId]);
      await item(project, 1, "Rami's late fitting", colleague, "2026-09-25");
      await item(project, 2, "Rami's fitting next week", colleague, "2026-10-02");
      await item(otherProject, 1, "Not my project", me, "2026-09-25");

      await client.query(`INSERT INTO audit_events(workspace_id,actor_user_id,source,action,entity_type,entity_id,correlation_id,occurred_at)
        VALUES($1,$2,'api','crm.lead.updated','crm_lead',$3,$4,'2026-09-27T09:00:00Z')`, [workspaceId, userId, lead, randomUUID()]);
      await work(client, { workspaceId, me, userId, project, otherProject, lead });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("reads every source in one pass, only this workspace's and only what belongs to the person", async () => {
    await scenario(async (client, ids) => {
      const summary = await readHomeSummary(client, { workspaceId: ids.workspaceId, membershipId: ids.me, userId: ids.userId }, everything, now);
      expect(summary.today).toBe("2026-09-28");
      // Focus holds only what waits for the person's decision; what is due is My day's (the reminder engine's subjects).
      expect(summary.focus.items).toEqual([]);
      await runReminderSweep(client, ids.workspaceId, { now });
      const myDay = await readMyDay(client, { workspaceId: ids.workspaceId, membershipId: ids.me, userId: ids.userId, permissions: new Set(["projects.view", "crm.activities.view"]),
        timeZone: "Asia/Dubai" }, builtinReminderSources(), { scope: "me" }, now);
      const items = myDay.groups.flatMap((group) => group.items);
      // Their follow-ups (overdue and today), the team's late work on the project they manage, and work assigned to them;
      // not a colleague's call, nor another tenant's.
      expect(items.map((item) => [item.title, item.urgency]).sort()).toEqual([
        ["#1 Not my project", "overdue"], ["#1 Rami's late fitting", "overdue"], ["Call Amira back", "overdue"], ["Send the brochure", "today"]].sort());
      expect(items.find((item) => item.title === "#1 Rami's late fitting")).toMatchObject({ kind: "work.due", context: "PRJ-1 · Villa 12", owner: { membershipId: expect.any(String) } });
      expect(myDay.counts).toMatchObject({ overdue: 3, today: 1 });
      expect(summary.upcoming.map((item) => item.title)).toEqual(["Check in next week", "Rami's fitting next week"]);
      expect(summary.funnel.find((stage) => stage.id === "enquiries")).toMatchObject({ count: 1 });
      expect(summary.funnel.find((stage) => stage.id === "projects")).toMatchObject({ count: 1, stuck: 0 });
      expect(summary.recent[0]).toMatchObject({ kind: "enquiry", id: ids.lead, title: "Amira Client" });
      expect(summary.projects).toEqual([{ id: ids.project, name: "Villa 12" }]);
    });
  });

  it("leaves out every source the person may not see", async () => {
    await scenario(async (client, ids) => {
      const summary = await readHomeSummary(client, { workspaceId: ids.workspaceId, membershipId: ids.me, userId: ids.userId },
        { ...everything, followUps: false, leads: false, projects: false, approvals: { ...everything.approvals, projects: false } }, now);
      expect(summary.focus.items).toEqual([]);
      expect(summary.funnel.map((stage) => stage.id)).toEqual(["planning", "quotes"]);
      expect(summary.recent).toEqual([]);
      expect(summary.projects).toEqual([]);
    });
  });
});
