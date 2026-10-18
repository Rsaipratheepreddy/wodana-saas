import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJobJourney } from "./job-journey";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("each step of a job's journey names its owner from the job's team (§0.3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  const PEOPLE = ["account", "lead", "qs", "manager", "factory", "finance"] as const;
  type Ids = { workspaceId: string; jobId: string; members: Record<(typeof PEOPLE)[number], string> };

  async function withJob(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const workspaceId = id(), jobId = id(), opportunityId = id(), caseId = id(), projectId = id(), quoteId = id();
    const users = Object.fromEntries(PEOPLE.map((key) => [key, id()])) as Record<(typeof PEOPLE)[number], string>;
    const members = Object.fromEntries(PEOPLE.map((key) => [key, id()])) as Record<(typeof PEOPLE)[number], string>;
    const names: Record<(typeof PEOPLE)[number], string> = { account: "Avery Account", lead: "Lee Lead", qs: "Quinn Surveyor", manager: "Pat Manager", factory: "Fay Factory", finance: "Fran Finance" };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const key of PEOPLE) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [users[key], `${key}-${users[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'Team',$2,'USD',$3,'UTC')", [workspaceId, `tm-${workspaceId.slice(0, 8)}`, users.account]);
      for (const key of PEOPLE) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [members[key], workspaceId, users[key]]);
      // Finance verifies through a narrow role; the account manager holds the same permission through a broad one.
      const permission = async (code: string) => (await client.query<{ id: string }>("SELECT id FROM permissions WHERE code = $1", [code])).rows[0].id;
      const role = async (code: string, permissions: string[], holder: string) => {
        const roleId = id();
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [roleId, workspaceId, code]);
        for (const code of permissions) await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) VALUES($1,$2,$3)", [workspaceId, roleId, await permission(code)]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, holder, roleId]);
      };
      await role("finance_reviewer", ["commercial.finance.verify"], members.finance);
      await role("manager_all", ["commercial.finance.verify", "commercial.deal.approve", "commercial.approve", "pre_projects.view"], members.account);

      // The job: its opportunity (owned by the account manager), its Planning case with two design stages, its project.
      const party = id();
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Layla','layla')", [party, workspaceId]);
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,owner_membership_id) VALUES($1,$2,$3,$4,$5,'Villa 12','O-1',$6)",
        [opportunityId, workspaceId, party, id(), id(), members.account]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, users.account]);
      await client.query("INSERT INTO design_journey_stages(workspace_id,case_id,stage,position,status) VALUES($1,$2,'kickoff',1,'active'),($1,$2,'renders',2,'locked')", [workspaceId, caseId]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,'Villa 12',$4)", [projectId, workspaceId, caseId, users.account]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000601','enquiry',$3,$4)", [jobId, workspaceId, id(), users.account]);
      for (const [type, recordId] of [["opportunity", opportunityId], ["case", caseId], ["project", projectId]])
        await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,$4,$5,'active',1,now())",
          [id(), workspaceId, jobId, type, recordId]);
      // The allocation: the lead designer on the case (no Visualiser yet); the project manager and the factory lead on the project (no installation lead).
      await client.query("INSERT INTO project_assignments(workspace_id,case_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY['designer']::varchar[])", [workspaceId, caseId, members.lead]);
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,role_keys) VALUES($1,$2,$3,true,ARRAY['project_manager']::varchar[])", [workspaceId, projectId, members.manager]);
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,role_keys) VALUES($1,$2,$3,ARRAY['factory_lead']::varchar[])", [workspaceId, projectId, members.factory]);
      // The main quotation went to the QS for pricing.
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','USD')",
        [workspaceId, caseId, quoteId]);
      await client.query("INSERT INTO quote_qs_reviews(workspace_id,id,case_id,quote_id,assignee_user_id,status,requested_by) VALUES($1,$2,$3,$4,$5,'with_qs',$6)",
        [workspaceId, id(), caseId, quoteId, users.qs, users.account]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("SET LOCAL ROLE wodana_app");
      await work(client, { workspaceId, jobId, members });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("takes design, price and make owners from the allocation, and says when nobody holds a step's role", async () => {
    await withJob(async (client, { workspaceId, jobId, members }) => {
      const sql: string[] = [];
      const counted = { query: (text: string, values?: unknown[]) => { sql.push(text); return client.query(text, values); } } as unknown as PoolClient;
      const journey = await loadJobJourney(counted, workspaceId, { id: jobId, reference: "J-000601" });
      const step = (key: string) => journey.steps.find((item) => item.key === key)!;

      // Design: the lead designer runs the kick-off; the renders wait on a Visualiser nobody holds.
      expect(step("design:kickoff")).toMatchObject({ owner: "Lee Lead", ownerId: members.lead, note: null });
      expect(step("design:renders")).toMatchObject({ owner: null, ownerId: null, note: "No one allocated as Visualiser" });
      expect(step("design:team")).toMatchObject({ owner: "Avery Account", ownerId: members.account });
      // Price: the QS the quotation went to; no Sales Admin, so the account manager prepares it; Finance (the narrowest holder) the upfront payment.
      expect(step("qs_estimate")).toMatchObject({ owner: "Quinn Surveyor", ownerId: members.qs });
      expect(step("quotation")).toMatchObject({ owner: "Avery Account", ownerId: members.account });
      expect(step("upfront")).toMatchObject({ owner: "Fran Finance", ownerId: members.finance });
      // Make, install, care: the project manager, the factory lead; nobody installs yet.
      expect(step("project")).toMatchObject({ owner: "Pat Manager", ownerId: members.manager });
      expect(step("factory")).toMatchObject({ owner: "Fay Factory", ownerId: members.factory });
      expect(step("install")).toMatchObject({ owner: null, note: "No one allocated as Installation lead" });
      expect(step("warranty")).toMatchObject({ owner: "Pat Manager", ownerId: members.manager });
      // The step now (no intro booked yet) carries its owner too: the late-step push matches it by membership.
      expect(journey.now).toMatchObject({ key: "intro_booked", owner: "Avery Account", ownerId: members.account });
      // A step done or not part of the job never says nobody holds it.
      expect(journey.steps.filter((item) => item.state === "done" || item.state === "skipped").some((item) => item.note?.includes("No one allocated"))).toBe(false);

      // The team is read once for the whole journey, never per step.
      expect(sql.filter((text) => /FROM project_assignments/.test(text))).toHaveLength(1);
    });
  });
});
