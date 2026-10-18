import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJobJourney } from "../jobs/job-journey";
import { watchJourneys } from "../jobs/journey-watch";
import { queueClientPush, queueTeamPush, readPushTemplates, savePushTemplates } from "./push-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("push like a delivery app on the database (§0.3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type Ids = { workspaceId: string; otherId: string; user: string; membershipId: string; jobId: string; grantId: string; caseId: string };
  async function withWorkspace(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const id = () => randomUUID();
    const ids: Ids = { workspaceId: id(), otherId: id(), user: id(), membershipId: id(), jobId: id(), grantId: id(), caseId: id() };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sam Sales')", [ids.user, `sam-${ids.user.slice(0, 8)}@example.com`]);
      for (const workspace of [ids.workspaceId, ids.otherId]) await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'Push',$2,'USD',$3,'UTC')", [workspace, `pu-${workspace.slice(0, 8)}`, ids.user]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [ids.membershipId, ids.workspaceId, ids.user]);
      // The member's phone, registered for push.
      await client.query(`INSERT INTO device_endpoints(workspace_id,user_id,platform,token_hash,encrypted_token_reference,locale,timezone,installation_id,last_request_id)
        VALUES($1,$2,'ios',$3,$4,'en','UTC',$5,$6)`, [ids.workspaceId, ids.user, "a".repeat(64), `redis:push:${ids.workspaceId}:${ids.user}:${id()}`, id(), id()]);
      await client.query("INSERT INTO notification_preferences(workspace_id,recipient_type,recipient_id,event_type,channel,enabled) VALUES($1,'user',$2,'*','push',true)", [ids.workspaceId, ids.user]);
      // A job known by its opportunity, owned by the member (the step now: the intro), and its client's portal access with a registered phone.
      const opportunity = id(), party = id();
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Layla','layla')", [party, ids.workspaceId]);
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,owner_membership_id) VALUES($1,$2,$3,$4,$5,'Villa 12','O-1',$6)",
        [opportunity, ids.workspaceId, party, id(), id(), ids.membershipId]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000501','enquiry',$3,$4)", [ids.jobId, ids.workspaceId, id(), ids.user]);
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'opportunity',$4,'active',1,now())",
        [id(), ids.workspaceId, ids.jobId, opportunity]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,active) VALUES($1,$2,$3,'Layla','+15550001111','approver',true)", [ids.grantId, ids.workspaceId, ids.caseId]);
      await client.query(`INSERT INTO client_portal_devices(id,workspace_id,phone,session_id,installation_id,platform,token_hash,encrypted_token_reference,locale,timezone,consented_at,last_request_id)
        VALUES($1,$2,'+15550001111',$3,$4,'ios',$5,$6,'en','UTC',now(),$7)`, [id(), ids.workspaceId, id(), id(), "b".repeat(64), `redis:push:${ids.workspaceId}:portal:${id()}`, id()]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await work(client, ids);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const pushes = async (client: PoolClient, workspaceId: string) => (await client.query<{ type: string; recipient: string; event: string; subject: string; body: string; link: string }>(
    `SELECT recipient_type AS type, recipient_id::text AS recipient, event_type AS event, subject, body, deep_link AS link FROM notifications WHERE workspace_id=$1 AND channel='push' ORDER BY created_at`, [workspaceId])).rows;

  it("words a team push from the firm's template, follows its switch, and keeps a client push to the phone the client registered", async () => {
    await withWorkspace(async (client, { workspaceId, user, grantId }) => {
      const sent = await queueTeamPush(client, { workspaceId, userId: user, key: "mention", values: { author: "Dana", job: "J-000501", text: "Oak finish confirmed" }, deepLink: "/workspace/team-chat", idempotencyKey: "m1" });
      expect(sent).toEqual({ queued: true });
      await queueTeamPush(client, { workspaceId, userId: user, key: "mention", values: { author: "Dana", job: "J-000501", text: "Oak finish confirmed" }, deepLink: "/workspace/team-chat", idempotencyKey: "m1" });
      expect(await pushes(client, workspaceId)).toEqual([expect.objectContaining({ type: "user", event: "job.mentioned", subject: "Dana mentioned you", body: "J-000501: Oak finish confirmed" })]);

      // The firm rewords one moment and switches another off: the next pushes follow.
      const { version } = await readPushTemplates(client, workspaceId);
      await savePushTemplates(client, workspaceId, user, { version, templates: [
        { key: "client_waiting", title: "Your turn, {step}", body: "Tap to open your portal.", action: "pay" }, { key: "mention", title: "x", body: "y", action: "reply", enabled: false }] });
      await expect(savePushTemplates(client, workspaceId, user, { version, templates: [] })).rejects.toThrow("another window");
      expect((await queueTeamPush(client, { workspaceId, userId: user, key: "mention", values: {}, deepLink: "/x", idempotencyKey: "m2" })).reason).toBe("push_off_for_firm");
      expect((await queueClientPush(client, { workspaceId, grantId, key: "client_waiting", values: { step: "Your quotation" }, deepLink: "/portal/x", idempotencyKey: "c1" })).queued).toBe(true);
      expect((await pushes(client, workspaceId)).at(-1)).toMatchObject({ type: "portal_contact", recipient: grantId, event: "portal.waiting", subject: "Your turn, Your quotation" });

      // The client turned push off on their phone: nothing goes.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("UPDATE client_portal_devices SET opted_out_at = now(), token_hash = NULL, encrypted_token_reference = NULL WHERE workspace_id = $1", [workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      expect((await queueClientPush(client, { workspaceId, grantId, key: "client_step", values: {}, deepLink: "/portal/x", idempotencyKey: "c2" })).reason).toBe("no_device");
    });
  });

  it("sends one progress push when a job's step changes (the first look only records it), and keeps it to the firm", async () => {
    await withWorkspace(async (client, { workspaceId, otherId, user, membershipId, jobId }) => {
      // The step now names its owner by membership too (matched by it, never by name).
      expect((await loadJobJourney(client, workspaceId, { id: jobId, reference: "J-000501" })).now).toMatchObject({ owner: "Sam Sales", ownerId: membershipId });
      const first = await watchJourneys(client, workspaceId, { now: new Date("2026-10-17T09:00:00Z") });
      expect(first).toMatchObject({ looked: 1, changed: 0, team: 0 });
      expect(await pushes(client, workspaceId)).toEqual([]);
      // The job was last seen on an earlier step: this look is a change, told once to the people on the job.
      await client.query("UPDATE job_journey_marks SET step_key = 'earlier_step' WHERE workspace_id = $1 AND job_id = $2", [workspaceId, jobId]);
      expect(await watchJourneys(client, workspaceId, { now: new Date("2026-10-17T09:05:00Z") })).toMatchObject({ changed: 1, team: 1 });
      await client.query("UPDATE job_journey_marks SET step_key = 'earlier_step' WHERE workspace_id = $1 AND job_id = $2", [workspaceId, jobId]);
      expect(await watchJourneys(client, workspaceId, { now: new Date("2026-10-17T09:10:00Z") })).toMatchObject({ changed: 1, team: 0 });
      const [push] = await pushes(client, workspaceId);
      expect(push).toMatchObject({ type: "user", recipient: user, event: "project.job_step", subject: "Villa 12 · J-000501", link: `/workspace/jobs/${jobId}` });
      expect(push.body).toMatch(/^Now: .+ · Win \(\d+ of \d+\)$/);

      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      expect((await client.query("SELECT count(*)::int AS n FROM job_journey_marks WHERE job_id = $1", [jobId])).rows[0].n).toBe(0);
      expect((await client.query("SELECT count(*)::int AS n FROM setup_push_templates WHERE workspace_id = $1", [workspaceId])).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO setup_push_templates(workspace_id,event_key,title,body,action) VALUES($1,'mention','x','y','reply')", [workspaceId])).rejects.toThrow(/row-level security/);
    });
  });
});
