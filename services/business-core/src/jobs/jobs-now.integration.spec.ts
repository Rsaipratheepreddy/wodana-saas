import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobsService } from "./jobs.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("where each listed record's job is now (§0.3 P10)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; otherId: string; user: string; leadId: string; projectId: string; otherLeadId: string };
  async function withRecords(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const ids: Ids = { workspaceId: id(), otherId: id(), user: id(), leadId: id(), projectId: id(), otherLeadId: id() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Account manager')", [ids.user, `am-${ids.user.slice(0, 8)}@example.com`]);
      for (const workspace of [ids.workspaceId, ids.otherId]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'Now',$2,'USD',$3,'UTC')", [workspace, `now-${workspace.slice(0, 8)}`, ids.user]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id(), workspace, ids.user]);
      }
      const lead = async (workspace: string, leadId: string, reference: string) => {
        const party = id(), enquiry = id(), job = id();
        await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Client','client')", [party, workspace]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,details)
          VALUES($1,$2,$3,$4,'Villa','website','form',now(),$5,'{}')`, [enquiry, workspace, id(), party, `E-${reference}`]);
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,status,created_at) VALUES($1,$2,$3,$4,'new',now())", [leadId, workspace, enquiry, party]);
        await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,$3,'enquiry',$4,$5)", [job, workspace, reference, enquiry, ids.user]);
        await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'lead',$4,'active',1,now())", [id(), workspace, job, leadId]);
        return job;
      };
      const job = await lead(ids.workspaceId, ids.leadId, "J-000301");
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'project',$4,'active',1,now())",
        [id(), ids.workspaceId, job, ids.projectId]);
      await lead(ids.otherId, ids.otherLeadId, "J-000302");
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  /** The service as one person sees it on this transaction. */
  function asPerson(client: PoolClient, userId: string, granted: string[]) {
    const access = {
      withAnyPermission: (_actor: unknown, _workspace: string, permissions: string[], work: (client: PoolClient, user: { userId: string }) => unknown) => {
        if (!permissions.some((code) => granted.includes(code))) throw new Error("Forbidden");
        return work(client, { userId });
      },
      hasPermission: async (_client: unknown, _workspace: string, _user: string, code: string) => granted.includes(code),
    };
    return new JobsService(access as never);
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("answers with each visible record's job and the step now, the same for every record of one job", async () => {
    await withRecords(async (client, { workspaceId, user, leadId, projectId }) => {
      const jobs = asPerson(client, user, ["crm.leads.view", "projects.manage"]);
      const { items } = await jobs.nowByRecords(actor, workspaceId, `lead:${leadId},project:${projectId}`);
      expect(items.map((item) => [item.type, item.reference])).toEqual(expect.arrayContaining([["lead", "J-000301"], ["project", "J-000301"]]));
      expect(new Set(items.map((item) => item.now?.label)).size).toBe(1);
      expect(items[0].now?.label).toBeTruthy();
    });
  });

  it("Team chat lists the threads of the jobs the person sees, newest first, with what they haven't read", async () => {
    await withRecords(async (client, { workspaceId, otherId, user, leadId, otherLeadId }) => {
      const jobOf = async (workspace: string, record: string) => (await client.query<{ id: string }>(
        "SELECT job_id::text AS id FROM job_identity_links WHERE workspace_id=$1 AND record_id=$2", [workspace, record])).rows[0].id;
      const job = await jobOf(workspaceId, leadId);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO job_messages(workspace_id,id,job_id,kind,body,event_code,event_ref,created_at) VALUES($1,$2,$3,'event','Quotation sent by email','document_sent','q1',now())", [workspaceId, randomUUID(), job]);
      await client.query("INSERT INTO job_messages(workspace_id,id,job_id,kind,author_user_id,body,created_at) VALUES($1,$2,$3,'message',$4,'Measured the living room',now() + interval '1 second')", [workspaceId, randomUUID(), job, user]);
      await client.query("INSERT INTO job_messages(workspace_id,id,job_id,kind,body,event_code,event_ref,created_at) VALUES($1,$2,$3,'event','Elsewhere','document_sent','q2',now())", [otherId, randomUUID(), await jobOf(otherId, otherLeadId)]);
      await client.query("SET LOCAL session_replication_role = origin");
      const { items, unread } = await asPerson(client, user, ["crm.leads.view"]).threads(actor, workspaceId);
      expect(items).toEqual([expect.objectContaining({ jobId: job, reference: "J-000301", body: "Measured the living room", kind: "message", author: "Account manager", unread: 1 })]);
      expect(unread).toBe(1);
      expect((await asPerson(client, user, ["projects.view"]).threads(actor, workspaceId)).items).toEqual([]);
    });
  });

  it("leaves out records the person can't see and another firm's records, and refuses malformed input", async () => {
    await withRecords(async (client, { workspaceId, user, leadId, projectId, otherLeadId }) => {
      const salesOnly = asPerson(client, user, ["crm.leads.view"]);
      const { items } = await salesOnly.nowByRecords(actor, workspaceId, `lead:${leadId},project:${projectId},lead:${otherLeadId}`);
      expect(items.map((item) => item.type)).toEqual(["lead"]);
      expect(() => salesOnly.nowByRecords(actor, workspaceId, "invoice:123")).toThrow("Name each record as type:id.");
      expect(() => salesOnly.nowByRecords(actor, workspaceId, Array.from({ length: 201 }, () => `lead:${randomUUID()}`).join(","))).toThrow("at most 200");
      expect(await salesOnly.nowByRecords(actor, workspaceId, "")).toEqual({ items: [] });
    });
  });
});
