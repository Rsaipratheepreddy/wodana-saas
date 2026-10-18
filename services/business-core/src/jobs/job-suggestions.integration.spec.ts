import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JourneyView } from "./job-journey";
import { decideJobSuggestion, readJobSuggestions } from "./job-suggestions";
import { readThread } from "./job-thread";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("suggestions inside the step now (§0.3 P11)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; otherId: string; jobId: string; owner: string; membershipId: string };
  async function withJob(work: (client: PoolClient, ids: Ids) => Promise<void>, ai = true) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const ids: Ids = { workspaceId: id(), otherId: id(), jobId: id(), owner: id(), membershipId: id() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sam Sales')", [ids.owner, `sam-${ids.owner.slice(0, 8)}@example.com`]);
      for (const workspace of [ids.workspaceId, ids.otherId]) await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Suggest',$2,'USD',$3)", [workspace, `sg-${workspace.slice(0, 8)}`, ids.owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [ids.membershipId, ids.workspaceId, ids.owner]);
      if (ai) await client.query("INSERT INTO workspace_ai_settings(workspace_id,enabled,changed_by) VALUES($1,true,$2)", [ids.workspaceId, ids.owner]);
      const opportunity = id();
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,owner_membership_id) VALUES($1,$2,$3,$4,$5,'Villa','O-1',$6)",
        [opportunity, ids.workspaceId, id(), id(), id(), ids.membershipId]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000401','enquiry',$3,$4)", [ids.jobId, ids.workspaceId, id(), ids.owner]);
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'opportunity',$4,'active',1,now())",
        [id(), ids.workspaceId, ids.jobId, opportunity]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const journey = (jobId: string) => ({ jobId, reference: "J-000401", title: "Villa", client: "Layla", chapters: [], lanes: [], steps: [], next: [], value: null, targetDate: null,
    now: { key: "proposal_1", chapter: "win", lane: "sales", label: "Proposal 1 sent", state: "now", doneAt: null, doneBy: null, dueAt: "2026-10-14T09:00:00Z", href: null, owner: "Sam Sales", doneWhen: "x" } }) as unknown as JourneyView;
  const today = new Date("2026-10-17T09:00:00Z");

  it("stores a late step's nudge once; using it posts one mention in the job chat and keeps the decision", async () => {
    await withJob(async (client, { workspaceId, jobId, owner }) => {
      const [nudge] = await readJobSuggestions(client, workspaceId, journey(jobId), owner, today);
      expect(nudge).toMatchObject({ kind: "nudge_owner", version: 1 });
      expect(await readJobSuggestions(client, workspaceId, journey(jobId), owner, today)).toHaveLength(1);
      const used = await decideJobSuggestion(client, workspaceId, jobId, { userId: owner, name: "Sam Sales" }, nudge.id, { action: "use", version: 1 });
      expect(used.version).toBe(2);
      // Using it again the same way changes nothing; dismissing it now is refused.
      await decideJobSuggestion(client, workspaceId, jobId, { userId: owner, name: "Sam Sales" }, nudge.id, { action: "use", version: 1 });
      await expect(decideJobSuggestion(client, workspaceId, jobId, { userId: owner, name: "Sam Sales" }, nudge.id, { action: "dismiss", version: 2 })).rejects.toThrow("already decided");
      const thread = await readThread(client, workspaceId, jobId, owner);
      expect(thread.messages.filter((message) => message.body.startsWith("@Sam Sales"))).toHaveLength(1);
      expect(await readJobSuggestions(client, workspaceId, journey(jobId), owner, today)).toEqual([]);
      expect((await client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='ai.suggestion.accepted.v1'", [workspaceId])).rows[0].n).toBe(1);
    });
  });

  it("has nothing with AI off, refuses a stale version, and keeps another firm out", async () => {
    await withJob(async (client, { workspaceId, jobId, owner }) => {
      expect(await readJobSuggestions(client, workspaceId, journey(jobId), owner, today)).toEqual([]);
    }, false);
    await withJob(async (client, { workspaceId, otherId, jobId, owner }) => {
      const [nudge] = await readJobSuggestions(client, workspaceId, journey(jobId), owner, today);
      await expect(decideJobSuggestion(client, workspaceId, jobId, { userId: owner, name: "Sam Sales" }, nudge.id, { action: "dismiss", version: 7 })).rejects.toThrow("changed");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      expect((await client.query("SELECT count(*)::int AS n FROM ai_suggestions WHERE entity_id = $1", [jobId])).rows[0].n).toBe(0);
    });
  });
});
