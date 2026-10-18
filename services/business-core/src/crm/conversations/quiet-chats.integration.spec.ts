import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveQuietChats } from "./inbox/quiet-chats";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("quiet chats resolve themselves (AU-2)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withChats(work: (client: PoolClient, workspaceId: string, chat: (name: string, fields: { lastMessage: string; lastInbound?: string | null; party?: string }) => Promise<string>) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Firm',$2,'USD',$3)", [workspaceId, `firm-${workspaceId.slice(0, 8)}`, randomUUID()]);
      const chat = async (subject: string, fields: { lastMessage: string; lastInbound?: string | null; party?: string }) => {
        const id = randomUUID();
        await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,status,last_message_at,last_inbound_at)
          VALUES($1,$2,$3,'whatsapp',$4,'open',now() - $5::interval,now() - $6::interval)`,
          [id, workspaceId, fields.party ?? randomUUID(), subject, fields.lastMessage, fields.lastInbound ?? null]);
        return id;
      };
      await work(client, workspaceId, chat);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("resolves a chat quiet since our last message, with a note, and leaves the rest open", async () => {
    await withChats(async (client, workspaceId, chat) => {
      const quiet = await chat("Thanks", { lastMessage: "8 days", lastInbound: "9 days" });
      const theirs = await chat("Their word last", { lastMessage: "8 days", lastInbound: "8 days" });
      const recent = await chat("Recent", { lastMessage: "2 days", lastInbound: "3 days" });
      const party = randomUUID();
      const pending = await chat("Follow-up pending", { lastMessage: "10 days", lastInbound: "11 days", party });
      await client.query(`INSERT INTO crm_activities(id,workspace_id,party_id,type,title,status) VALUES($1,$2,$3,'call','Call back','pending')`, [randomUUID(), workspaceId, party]);
      await expect(resolveQuietChats(client, workspaceId)).resolves.toEqual({ resolved: 1 });
      const statuses = (await client.query(`SELECT id, status FROM crm_conversations WHERE workspace_id = $1`, [workspaceId])).rows;
      expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({ [quiet]: "closed", [theirs]: "open", [recent]: "open", [pending]: "open" });
      expect((await client.query(`SELECT kind, method, reason FROM crm_conversation_events WHERE conversation_id = $1`, [quiet])).rows)
        .toEqual([{ kind: "resolved", method: "quiet", reason: "No reply in 7 days" }]);
    });
  });

  it("follows the workspace's days, and never with 0", async () => {
    await withChats(async (client, workspaceId, chat) => {
      await chat("Quiet 4 days", { lastMessage: "4 days" });
      await client.query(`INSERT INTO crm_inbox_settings(workspace_id,auto_resolve_days) VALUES($1,0)`, [workspaceId]);
      await expect(resolveQuietChats(client, workspaceId)).resolves.toEqual({ resolved: 0 });
      await client.query(`UPDATE crm_inbox_settings SET auto_resolve_days = 3 WHERE workspace_id = $1`, [workspaceId]);
      await expect(resolveQuietChats(client, workspaceId)).resolves.toEqual({ resolved: 1 });
    });
  });
});
