import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markRead, postJobEvent, postMessage, readThread } from "./job-thread";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("the job's team thread (§0.3)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withJob(work: (client: PoolClient, ids: { workspaceId: string; otherId: string; jobId: string; recordId: string; ana: string; ben: string }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), otherId = randomUUID(), jobId = randomUUID(), recordId = randomUUID(), ana = randomUUID(), ben = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[ana, "Ana"], [ben, "Ben"]]) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${name}-${id.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      for (const id of [workspaceId, otherId]) await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Thread',$2,'AED',$3)", [id, `t-${id.slice(0, 8)}`, ana]);
      await client.query("INSERT INTO job_identities(id,workspace_id,reference,root_type,root_id,created_by) VALUES($1,$2,'J-000001','enquiry',$3,$4)", [jobId, workspaceId, randomUUID(), ana]);
      await client.query("INSERT INTO job_identity_links(id,workspace_id,job_id,record_type,record_id,status,version,attached_at) VALUES($1,$2,$3,'project',$4,'active',1,now())",
        [randomUUID(), workspaceId, jobId, recordId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await work(client, { workspaceId, otherId, jobId, recordId, ana, ben });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("adds each of the job's events once, keeps posts idempotent and counts what's unread per person", async () => {
    await withJob(async (client, { workspaceId, jobId, recordId, ana, ben }) => {
      const event = { record: { type: "project", id: recordId }, code: "document_sent", ref: "quotation:q1:email:sent", body: "Quotation sent by email" };
      expect(await postJobEvent(client, workspaceId, event)).toBe(jobId);
      await postJobEvent(client, workspaceId, event);
      expect(await postJobEvent(client, workspaceId, { ...event, record: { type: "project", id: randomUUID() } })).toBeNull();
      const id = randomUUID();
      await expect(postMessage(client, workspaceId, jobId, { userId: ana, name: "Ana" }, { id, body: "   " })).rejects.toThrow("Write a message.");
      expect(await postMessage(client, workspaceId, jobId, { userId: ana, name: "Ana" }, { id, body: "Client asked for oak" })).toMatchObject({ replayed: false });
      expect(await postMessage(client, workspaceId, jobId, { userId: ana, name: "Ana" }, { id, body: "Client asked for oak" })).toMatchObject({ replayed: true });
      await expect(postMessage(client, workspaceId, jobId, { userId: ana, name: "Ana" }, { id: randomUUID(), body: "Hi", mentions: [randomUUID()] })).rejects.toThrow("Mention people on this job.");
      const forAna = await readThread(client, workspaceId, jobId, ana);
      expect(forAna.messages.map((message) => [message.kind, message.body, message.mine])).toEqual([["event", "Quotation sent by email", false], ["message", "Client asked for oak", true]]);
      // Posting moved Ana's marker past her own message; the event before it was read with it.
      expect(forAna.unread).toBe(0);
      const forBen = await readThread(client, workspaceId, jobId, ben);
      expect(forBen.unread).toBe(2);
      await markRead(client, workspaceId, jobId, ben);
      expect((await readThread(client, workspaceId, jobId, ben)).unread).toBe(0);
    });
  });

  it("keeps a firm's threads to itself (forced RLS)", async () => {
    await withJob(async (client, { workspaceId, otherId, jobId, ana }) => {
      await postMessage(client, workspaceId, jobId, { userId: ana, name: "Ana" }, { id: randomUUID(), body: "Internal note" });
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherId]);
      expect((await client.query("SELECT count(*)::int AS n FROM job_messages WHERE workspace_id = $1", [workspaceId])).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO job_messages (workspace_id, id, job_id, kind, author_user_id, body) VALUES ($1, $2, $3, 'message', $4, 'x')", [workspaceId, randomUUID(), jobId, ana]))
        .rejects.toThrow(/row-level security/);
    });
  });
});
