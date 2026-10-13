import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type World = {
  workspaceId: string; other: string; admin: string; noura: string; stranger: string; nouraChat: string; strangerChat: string; connectionId: string;
  conversations: CrmConversationsService; inbox: CrmInboxService;
};

const settings = (change: Record<string, unknown> = {}) => ({
  version: 0, greetingEnabled: true, greetingText: "Hi {{contact.first_name}}, thanks for contacting {{business.name}}.", greetingSilenceDays: 14,
  awayEnabled: false, awayText: "We are closed now and will reply when we open.", awayWindowHours: 12, ...change,
});

integration("inbox auto replies", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function withWorld(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const [workspaceId, other, admin, adminMember, noura, stranger, nouraChat, strangerChat, connectionId] = Array.from({ length: 9 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Maya Admin')", [admin, `${admin.slice(0, 8)}@example.com`]);
      for (const [id, name] of [[workspaceId, "Studio One"], [other, "Other Studio"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,$2,$3,'USD','UTC',$4)", [id, name, `auto-${id.slice(0, 8)}`, admin]);
      }
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [adminMember, workspaceId, admin]);
      await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES
        ($1,$3,'person','Noura Haddad','noura haddad'),($2,$3,'person','WhatsApp +15550001111','whatsapp +15550001111')`, [noura, stranger, workspaceId]);
      await client.query(`INSERT INTO crm_consents(workspace_id,party_id,purpose,channel,status) VALUES
        ($1,$2,'service','whatsapp','granted'),($1,$3,'service','whatsapp','granted')`, [workspaceId, noura, stranger]);
      await client.query(`INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES
        ($1,$2,'phone','+15550002222','+15550002222',true),($1,$3,'phone','+15550001111','+15550001111',true)`, [workspaceId, noura, stranger]);
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject) VALUES
        ($1,$3,$4,'whatsapp','Noura'),($2,$3,$5,'whatsapp','Stranger')`, [nouraChat, strangerChat, workspaceId, noura, stranger]);
      await client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
        VALUES($1,$2,'whatsapp','WhatsApp','connected',$3,'waba-1','{"phoneNumberId":"pn-1","displayPhoneNumber":"+1 555 0100","isDefault":true}')`, [connectionId, workspaceId, admin]);
      await client.query("SET LOCAL session_replication_role = origin");
      const database = { tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) };
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: admin });
      const access = { withPermission: run, withAnyPermission: run, hasPermission: async () => true };
      const events = { record: async () => randomUUID() };
      const conversations = new CrmConversationsService(database as never, access as never, events as never, {} as never, new CrmMessageReceiptService());
      const inbox = new CrmInboxService(database as never, access as never, events as never);
      await work(client, { workspaceId, other, admin, noura, stranger, nouraChat, strangerChat, connectionId, conversations, inbox });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const autoReplies = (client: PoolClient, conversationId: string) => client.query<{ kind: string; body: string; status: string; notification: string | null }>(
    `SELECT reply.kind, message.body_text AS body, message.status::text AS status,
            (SELECT notification.status::text FROM notifications notification WHERE notification.workspace_id = message.workspace_id AND notification.idempotency_key = 'message:' || message.id) AS notification
       FROM crm_auto_replies reply JOIN crm_messages message ON message.id = reply.reply_message_id
      WHERE reply.conversation_id = $1 ORDER BY reply.created_at, reply.id`, [conversationId]).then((result) => result.rows);
  const inbound = (conversations: CrmConversationsService, workspaceId: string, chat: string, text: string, metadata: Record<string, unknown> = {}) =>
    conversations.addInboundInternal(workspaceId, chat, { direction: "inbound", bodyText: text, providerMessageId: `wamid.${randomUUID()}`, metadata } as never);

  it("keeps auto reply settings and sent replies inside their workspace (forced RLS)", async () => {
    await withWorld(async (client, { workspaceId, other, nouraChat, conversations, inbox }) => {
      const guarded = await client.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        [["crm_auto_replies", "crm_auto_reply_settings"]]);
      expect(guarded.rows.map((row) => row.name)).toEqual(["crm_auto_replies", "crm_auto_reply_settings"]);
      const policies = await client.query<{ table: string }>(`SELECT tablename AS table FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = ANY($1::text[]) ORDER BY tablename`, [["crm_auto_replies", "crm_auto_reply_settings"]]);
      expect(policies.rows.map((row) => row.table)).toEqual(["crm_auto_replies", "crm_auto_reply_settings"]);

      await inbox.updateAutoReplies(actor, workspaceId, settings() as never);
      await inbound(conversations, workspaceId, nouraChat, "Hello");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [other]);
      await client.query(`INSERT INTO crm_auto_reply_settings(workspace_id,greeting_text,away_text) VALUES($1,'Hi','Away')`, [other]);

      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      expect((await client.query(`SELECT workspace_id AS "workspaceId" FROM crm_auto_reply_settings`)).rows).toEqual([{ workspaceId }]);
      expect((await client.query(`SELECT workspace_id AS "workspaceId" FROM crm_auto_replies`)).rows).toEqual([{ workspaceId }]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [other]);
      expect((await client.query(`SELECT workspace_id AS "workspaceId" FROM crm_auto_reply_settings`)).rows).toEqual([{ workspaceId: other }]);
      expect((await client.query(`SELECT 1 FROM crm_auto_replies`)).rowCount).toBe(0);
      await client.query("SAVEPOINT cross_tenant");
      await expect(client.query(`INSERT INTO crm_auto_reply_settings(workspace_id,connection_id,greeting_text,away_text) VALUES($1,NULL,'Hi','Away')`, [workspaceId])).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
    });
  });

  it("greets a client's first message once, marked as an auto reply and queued for delivery", async () => {
    await withWorld(async (client, { workspaceId, nouraChat, conversations, inbox }) => {
      const saved = await inbox.updateAutoReplies(actor, workspaceId, settings() as never);
      expect(saved.workspace).toMatchObject({ greeting: { enabled: true, silenceDays: 14 }, away: { enabled: false }, version: 1 });
      // The same save again is a no-op; a stale version is refused.
      expect((await inbox.updateAutoReplies(actor, workspaceId, settings() as never)).workspace.version).toBe(1);
      await expect(inbox.updateAutoReplies(actor, workspaceId, settings({ greetingSilenceDays: 7 }) as never)).rejects.toThrow(/changed/);
      await expect(inbox.updateAutoReplies(actor, workspaceId, settings({ version: 1, greetingText: "Hi {{invoice.total}}" }) as never)).rejects.toThrow(/can't fill/);

      const first = await inbound(conversations, workspaceId, nouraChat, "Hello, is the showroom open?");
      expect(await autoReplies(client, nouraChat)).toEqual([{ kind: "greeting", body: "Hi Noura, thanks for contacting Studio One.", status: "queued", notification: "pending" }]);
      const message = (await client.query(`SELECT authorship, sender_type AS "senderType", metadata FROM crm_messages WHERE conversation_id = $1 AND direction = 'outbound'`, [nouraChat])).rows[0];
      expect(message).toMatchObject({ authorship: "automation", senderType: "system", metadata: { automatic: "auto_reply", autoReply: "greeting", inReplyTo: first.id } });
      // The thread reads the client's message first, then the reply (both were written in one transaction).
      const order = await client.query(`SELECT direction FROM crm_messages WHERE conversation_id = $1 ORDER BY created_at, id`, [nouraChat]);
      expect(order.rows.map((row) => row.direction)).toEqual(["inbound", "outbound"]);
      const [asked, replied] = (await client.query<{ at: Date }>(`SELECT created_at AS at FROM crm_messages WHERE conversation_id = $1 ORDER BY direction = 'outbound'`, [nouraChat])).rows;
      expect(replied.at.getTime()).toBeGreaterThan(asked.at.getTime());
      // An auto reply is not the team's answer: the client still waits.
      expect((await client.query(`SELECT waiting_since FROM crm_conversations WHERE id = $1`, [nouraChat])).rows[0].waiting_since).not.toBeNull();

      await inbound(conversations, workspaceId, nouraChat, "Also, do you do kitchens?");
      expect(await autoReplies(client, nouraChat)).toHaveLength(1);
      // The provider delivering the same message again changes nothing.
      const providerMessageId = `wamid.${randomUUID()}`;
      await client.query(`UPDATE crm_messages SET created_at = now() - interval '20 days' WHERE conversation_id = $1`, [nouraChat]);
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Back again", providerMessageId } as never);
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Back again", providerMessageId } as never);
      expect((await autoReplies(client, nouraChat)).map((reply) => reply.kind)).toEqual(["greeting", "greeting"]);
    });
  });

  it("sends the away message outside hours once per window, never to a blocked number or while a person is replying", async () => {
    await withWorld(async (client, { workspaceId, nouraChat, strangerChat, conversations, inbox }) => {
      // Open only three days from now, so it is closed whenever the test runs.
      const closedToday = [(new Date().getUTCDay() + 3) % 7];
      await inbox.updateAutoReplies(actor, workspaceId, settings({ greetingEnabled: false, awayEnabled: true, workingDays: closedToday, dayStart: "09:00", dayEnd: "18:00", timeZone: "UTC" }) as never);
      await inbound(conversations, workspaceId, nouraChat, "Are you there?");
      await inbound(conversations, workspaceId, nouraChat, "Hello?");
      expect(await autoReplies(client, nouraChat)).toEqual([{ kind: "away", body: "We are closed now and will reply when we open.", status: "queued", notification: "pending" }]);

      // A person answered a minute ago: nothing automatic cuts in.
      await client.query(`DELETE FROM crm_auto_replies WHERE conversation_id = $1`, [nouraChat]);
      await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", bodyText: "Yes, here.", clientMessageId: randomUUID() } as never);
      await inbound(conversations, workspaceId, nouraChat, "Great");
      expect(await autoReplies(client, nouraChat)).toEqual([]);

      await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: true, spam: true });
      await inbound(conversations, workspaceId, strangerChat, "Buy followers");
      expect(await autoReplies(client, strangerChat)).toEqual([]);
      // Notes are the team's own and never answered.
      await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "internal", bodyText: "Call her tomorrow" } as never);
      expect(await autoReplies(client, nouraChat)).toEqual([]);
    });
  });

  it("uses a number's own auto replies for messages to that number", async () => {
    await withWorld(async (client, { workspaceId, admin, noura, nouraChat, conversations, inbox }) => {
      const second = randomUUID();
      await client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
        VALUES($1,$2,'whatsapp','WhatsApp 2','connected',$3,'waba-2','{"phoneNumberId":"pn-2","displayPhoneNumber":"+1 555 0200"}')`, [second, workspaceId, admin]);
      await inbox.updateAutoReplies(actor, workspaceId, settings() as never);
      const read = await inbox.updateAutoReplies(actor, workspaceId, settings({ connectionId: second, greetingText: "Welcome to the second showroom, {{contact.first_name}}!" }) as never);
      expect(read.numbers.map((number: { connectionId: string; override: unknown }) => [number.connectionId, Boolean(number.override)])).toEqual(expect.arrayContaining([[second, true]]));
      await inbound(conversations, workspaceId, nouraChat, "Hi", { connectionId: second });
      expect((await autoReplies(client, nouraChat)).map((reply) => reply.body)).toEqual(["Welcome to the second showroom, Noura!"]);

      const removed = await inbox.removeAutoRepliesOverride(actor, workspaceId, second, { version: 1 });
      expect(removed.numbers.find((number: { connectionId: string }) => number.connectionId === second)?.override).toBeNull();
      void noura;
    });
  });
});
