import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobsService } from "./jobs.service";
import { readJobsMyDay } from "./my-day";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = {
  workspaceId: string; otherId: string; designer: string; salesAdmin: string; colleague: string;
  ownedJob: string; unownedJob: string; colleagueJob: string; caseJob: string; otherJob: string; names: Record<"designer" | "salesAdmin" | "colleague", string>;
};

integration("My day on the job journey (§0.3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withJobs(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const tag = id().slice(0, 6);
    const ids: Ids = {
      workspaceId: id(), otherId: id(), designer: id(), salesAdmin: id(), colleague: id(),
      ownedJob: id(), unownedJob: id(), colleagueJob: id(), caseJob: id(), otherJob: id(),
      names: { designer: `Designer ${tag}`, salesAdmin: `Sales admin ${tag}`, colleague: `Account manager ${tag}` },
    };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const key of ["designer", "salesAdmin", "colleague"] as const)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [ids[key], `${key}-${ids[key].slice(0, 8)}@example.com`, ids.names[key]]);
      const membership: Record<string, string> = {};
      for (const workspace of [ids.workspaceId, ids.otherId]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'My day',$2,'USD',$3,'UTC')",
          [workspace, `md-${workspace.slice(0, 8)}`, ids.designer]);
        for (const key of ["designer", "salesAdmin", "colleague"] as const) {
          membership[`${workspace}:${key}`] = id();
          await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership[`${workspace}:${key}`], workspace, ids[key]]);
        }
      }
      // Seats: the designer is a designer in the workspace; the sales admin gives out enquiries.
      for (const [key, code] of [["designer", "designer"], ["salesAdmin", "sales_admin"]] as const) {
        const role = id();
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [role, ids.workspaceId, code]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.workspaceId, membership[`${ids.workspaceId}:${key}`], role]);
      }
      const lead = async (workspace: string, job: string, reference: string, owner: string | null) => {
        const party = id(), enquiry = id(), leadId = id();
        await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Client','client')", [party, workspace]);
        await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,details)
          VALUES($1,$2,$3,$4,$5,'website','form',now(),$6,'{}')`, [enquiry, workspace, id(), party, `Villa ${reference}`, `E-${reference}`]);
        await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status,created_at) VALUES($1,$2,$3,$4,$5,'new',now())",
          [leadId, workspace, enquiry, party, owner]);
        await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,$3,'enquiry',$4,$5)", [job, workspace, reference, enquiry, ids.designer]);
        await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'lead',$4,'active',1,now())",
          [id(), workspace, job, leadId]);
      };
      // Owned by the designer (step now: first contact, theirs by name); not given out yet (no owner, the sales lane);
      // a colleague's enquiry; and another firm's enquiry owned by the designer's membership there.
      await lead(ids.workspaceId, ids.ownedJob, "J-000101", membership[`${ids.workspaceId}:designer`]);
      await lead(ids.workspaceId, ids.unownedJob, "J-000102", null);
      await lead(ids.workspaceId, ids.colleagueJob, "J-000103", membership[`${ids.workspaceId}:colleague`]);
      await lead(ids.otherId, ids.otherJob, "J-000201", membership[`${ids.otherId}:designer`]);
      // A job known so far by its planning case only (step now: the enquiry, no owner, the sales lane); the designer is
      // on its case as its account manager.
      const caseId = id();
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000104','enquiry',$3,$4)", [ids.caseJob, ids.workspaceId, caseId, ids.designer]);
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'case',$4,'active',1,now())",
        [id(), ids.workspaceId, ids.caseJob, caseId]);
      await client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,false,true,ARRAY['account_manager']::varchar[])",
        [ids.workspaceId, caseId, membership[`${ids.workspaceId}:designer`]]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The services as the person sees them: the Jobs list's reading on this transaction, with the jobs list's permissions. */
  function asPerson(client: PoolClient, userId: string, granted = ["crm.leads.view", "pre_projects.view"]) {
    const run = (_actor: unknown, _workspace: string, permissions: unknown, work?: (client: PoolClient, user: { userId: string }) => unknown) =>
      (typeof permissions === "function" ? permissions : work!)(client, { userId });
    const access = {
      withAnyPermission: (actor: unknown, workspace: string, permissions: string[], work: (client: PoolClient, user: { userId: string }) => unknown) => {
        if (!permissions.some((code) => granted.includes(code))) throw new Error("Forbidden");
        return run(actor, workspace, permissions, work);
      },
      asMember: (actor: unknown, workspace: string, work: (client: PoolClient, user: { userId: string }) => unknown) => run(actor, workspace, work),
      hasPermission: async (_client: unknown, _workspace: string, _user: string, code: string) => granted.includes(code),
    };
    const jobs = new JobsService(access as never);
    return { jobs, access: access as never, now: () => new Date("2026-10-17T08:00:00Z") };
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("lists my steps: mine by name, and unowned ones through my seats (shared by workspace seat, otherwise on the job)", async () => {
    await withJobs(async (client, ids) => {
      const designer = await readJobsMyDay(asPerson(client, ids.designer), actor, ids.workspaceId);
      // Their own enquiry by name, and the case they are account manager on; not the one nobody owns (no sales seat), not a colleague's.
      expect(designer.items.map((item) => [item.reference, item.step.label, item.why]).sort()).toEqual([
        ["J-000101", "First contact", "owner"], ["J-000104", "Enquiry received", "seat"],
      ]);
      expect(designer.items.find((item) => item.reference === "J-000101")).toMatchObject({ chapter: "win", step: { lane: "sales", owner: ids.names.designer, doneWhen: "A call, message or meeting is logged" } });
      expect(designer.timeZone).toBe("UTC");

      const salesAdmin = await readJobsMyDay(asPerson(client, ids.salesAdmin), actor, ids.workspaceId);
      // The sales seat works the unowned sales steps on every job they see; never a step named for someone else.
      expect(salesAdmin.items.map((item) => [item.reference, item.why]).sort()).toEqual([["J-000102", "seat"], ["J-000104", "seat"]]);

      const colleague = await readJobsMyDay(asPerson(client, ids.colleague), actor, ids.workspaceId);
      expect(colleague.items.map((item) => item.reference)).toEqual(["J-000103"]);
    });
  });

  it("is scoped like the Jobs list: without its permissions it is refused, and what a person can't see is never theirs", async () => {
    await withJobs(async (client, ids) => {
      await expect(readJobsMyDay(asPerson(client, ids.designer, []), actor, ids.workspaceId)).rejects.toThrow("Forbidden");
      // Without the planning permission the case-only job is out of sight, so out of My day too.
      const leadsOnly = await readJobsMyDay(asPerson(client, ids.designer, ["crm.leads.view"]), actor, ids.workspaceId);
      expect(leadsOnly.items.map((item) => item.reference)).toEqual(["J-000101"]);
    });
  });

  it("keeps a firm's jobs to itself: another firm's job never shows, and forced RLS hides this firm's from another tenant", async () => {
    await withJobs(async (client, ids) => {
      const mine = await readJobsMyDay(asPerson(client, ids.designer), actor, ids.workspaceId);
      expect(mine.items.map((item) => item.jobId)).not.toContain(ids.otherJob);
      // In the other firm (its own tenant context) the designer sees only that firm's job.
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.otherId]);
      const there = await readJobsMyDay(asPerson(client, ids.designer), actor, ids.otherId);
      expect(there.items.map((item) => item.reference)).toEqual(["J-000201"]);
      // Asking for the first firm from inside the other's tenant context reads nothing of it.
      await expect(readJobsMyDay(asPerson(client, ids.designer), actor, ids.workspaceId)).rejects.toThrow(/not found/i);
      expect((await client.query("SELECT count(*)::int AS n FROM job_identities WHERE workspace_id = $1", [ids.workspaceId])).rows[0].n).toBe(0);
    });
  });
});
