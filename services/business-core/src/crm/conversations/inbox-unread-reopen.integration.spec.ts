import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";
import { REOPEN_REFUSED } from "./inbox/inbox-commands";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = { workspaceId: string; admin: string; salesAdmin: string; sales: string; adminMember: string; salesAdminMember: string; salesMember: string };
type Services = { conversations: CrmConversationsService; inbox: CrmInboxService };
type Tenant = <T>(workspaceId: string, actorUserId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>;
type Row = Record<string, unknown>;

/**
 * The inbox's Unread view (read per person, opening a chat reads it) and Reopen (only whoever resolved the chat, or an
 * inbox manager). Every command runs as the app role (forced RLS) with the real permission checks.
 */
integration("inbox unread per person and resolver-only reopen (real Postgres)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  /** A workspace with an owner (manages the inbox), a sales admin (the team's chats) and an account manager (own chats, in the queue). */
  async function workspace(client: PoolClient, label: string): Promise<Ids> {
    const workspaceId = randomUUID(), queueId = randomUUID();
    const [admin, salesAdmin, sales] = [randomUUID(), randomUUID(), randomUUID()];
    const [adminMember, salesAdminMember, salesMember] = [randomUUID(), randomUUID(), randomUUID()];
    const [adminRole, salesAdminRole, salesRole] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [id, name] of [[admin, "Owner"], [salesAdmin, "Sales admin"], [sales, "Account manager"]]) {
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${label}-${id.slice(0, 8)}@example.com`, name]);
    }
    await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
    await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,created_by) VALUES($1,'Inbox studio',$2,'USD','en',$3)", [workspaceId, `${label}-${workspaceId.slice(0, 8)}`, admin]);
    await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$4,$5,'active'),($2,$4,$6,'active'),($3,$4,$7,'active')`,
      [adminMember, salesAdminMember, salesMember, workspaceId, admin, salesAdmin, sales]);
    await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'owner','Owner',true),($2,$4,'sales_admin','Sales admin',false),($3,$4,'sales','Account managers',false)",
      [adminRole, salesAdminRole, salesRole, workspaceId]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, adminRole]);
    const sell = ["crm.leads.view", "crm.leads.manage", "crm.parties.view", "crm.parties.manage", "crm.opportunities.view", "crm.activities.view", "crm.communications.view", "crm.communications.send"];
    await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, salesAdminRole, [...sell, "crm.inbox.team"]]);
    await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, salesRole, sell]);
    await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$7)",
      [workspaceId, adminMember, adminRole, salesAdminMember, salesAdminRole, salesMember, salesRole]);
    await client.query("INSERT INTO crm_queues(id,workspace_id,code,name,is_fallback) VALUES($1,$2,'sales','Sales',true)", [queueId, workspaceId]);
    await client.query("INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id) VALUES($1,$2,$3)", [workspaceId, queueId, salesMember]);
    await client.query(`INSERT INTO integration_connections(workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
      VALUES($1,'whatsapp','WhatsApp','connected',$2,$3,'{"phoneNumberId":"pn-1","displayPhoneNumber":"+1 555 0100"}')`, [workspaceId, admin, `waba-${workspaceId.slice(0, 8)}`]);
    await seedDefaultNotificationTemplates(client, workspaceId);
    await client.query("SET LOCAL session_replication_role = origin");
    return { workspaceId, admin, salesAdmin, sales, adminMember, salesAdminMember, salesMember };
  }

  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => Services, tenant: Tenant) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ids = await workspace(client, "inbox");
      const tenant: Tenant = async (ws, actorUserId, fn) => {
        await client.query("SAVEPOINT tenant");
        try {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, actorUserId]);
          await client.query("SET LOCAL ROLE wodana_app");
          const result = await fn(client);
          await client.query("RESET ROLE");
          await client.query("RELEASE SAVEPOINT tenant");
          return result;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT tenant");
          await client.query("RESET ROLE");
          throw error;
        }
      };
      const database = { tenantTransaction: (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => tenant(ws, actorUserId, fn) };
      const config = { get: (key: string) => (key === "WEB_ORIGIN" ? "https://app.example.com" : undefined) };
      const as = (userId: string): Services => {
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        const events = new CrmEventsService();
        return { conversations: new CrmConversationsService(database as never, access, events, {} as never, new CrmMessageReceiptService(), config as never), inbox: new CrmInboxService(database as never, access, events) };
      };
      await work(client, ids, as, tenant);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** A client's WhatsApp message, as the provider delivers it. */
  const whatsapp = (services: Services, workspaceId: string, contact: string, text: string) => services.conversations.ingestProviderMessage({
    workspaceId, channel: "whatsapp", providerThreadId: `wa:${contact}`, providerMessageId: `wamid.${randomUUID()}`, contact, displayName: "Noura Haddad", bodyText: text,
  }) as Promise<{ conversationId: string }>;
  const chat = async (client: PoolClient, id: string) => (await client.query<Row>("SELECT * FROM crm_conversations WHERE id = $1", [id])).rows[0];
  const unreadIds = async (services: Services, workspaceId: string) =>
    ((await services.conversations.list(actor, workspaceId, { view: "unread", status: "open,unresolved", limit: 100 } as never)) as { data: Row[] }).data.map((row) => row.id);
  const unreadCount = async (services: Services, workspaceId: string) => ((await services.inbox.summary(actor, workspaceId)) as Row).unread;
  const thread = (services: Services, workspaceId: string, id: string) => services.conversations.get(actor, workspaceId, id) as Promise<Row>;
  const refusal = async (promise: Promise<unknown>) => {
    try { await promise; } catch (error) { return error as { message: string; status?: number; getStatus?: () => number }; }
    throw new Error("Expected the command to be refused");
  };

  it("keeps unread per person: opening a chat reads it for that person only, and a newer client message makes it unread again", async () => {
    await scenario(async (client, ids, as) => {
      const [owner, salesAdmin, sales] = [as(ids.admin), as(ids.salesAdmin), as(ids.sales)];
      const { conversationId } = await whatsapp(sales, ids.workspaceId, "+447911125555", "Hi, I'd like a quote");
      expect((await chat(client, conversationId)).owner_membership_id).toBe(ids.salesMember);
      // Everyone who can see the chat has it unread, with the Unread count and the row saying so.
      for (const person of [owner, salesAdmin, sales]) {
        expect(await unreadIds(person, ids.workspaceId)).toEqual([conversationId]);
        expect(await unreadCount(person, ids.workspaceId)).toBe(1);
      }
      expect(await thread(salesAdmin, ids.workspaceId, conversationId)).toMatchObject({ unread: true });

      // The account manager opens it: read for them, still unread for the others.
      await sales.conversations.markRead(actor, ids.workspaceId, conversationId);
      await sales.conversations.markRead(actor, ids.workspaceId, conversationId); // safe to repeat
      expect(await unreadIds(sales, ids.workspaceId)).toEqual([]);
      expect(await unreadCount(sales, ids.workspaceId)).toBe(0);
      expect(await thread(sales, ids.workspaceId, conversationId)).toMatchObject({ unread: false });
      expect(await unreadIds(salesAdmin, ids.workspaceId)).toEqual([conversationId]);
      expect(await unreadCount(owner, ids.workspaceId)).toBe(1);
      const reads = await client.query<{ user_id: string }>("SELECT user_id FROM crm_conversation_reads WHERE workspace_id = $1 AND conversation_id = $2", [ids.workspaceId, conversationId]);
      expect(reads.rows.map((row) => row.user_id)).toEqual([ids.sales]);
      // The Open list still holds it for everyone, with the row's own unread state.
      const open = (await sales.conversations.list(actor, ids.workspaceId, { status: "open,unresolved", limit: 100 } as never)) as { data: Row[] };
      expect(open.data.find((row) => row.id === conversationId)).toMatchObject({ unread: false });

      // The client writes again after that read: unread for the account manager again.
      await client.query("UPDATE crm_conversation_reads SET last_read_at = now() - interval '1 minute' WHERE conversation_id = $1", [conversationId]);
      await whatsapp(sales, ids.workspaceId, "+447911125555", "Are you there?");
      expect(await unreadIds(sales, ids.workspaceId)).toEqual([conversationId]);

      // A chat from before reads were kept per person, read then, is read by everyone.
      await client.query("UPDATE crm_conversations SET read_baseline_at = last_inbound_at WHERE id = $1", [conversationId]);
      expect(await unreadIds(owner, ids.workspaceId)).toEqual([]);
      expect(await unreadCount(salesAdmin, ids.workspaceId)).toBe(0);

      // Unread counts only chats still to work on.
      const { conversationId: other } = await whatsapp(sales, ids.workspaceId, "+447911126666", "Hello");
      expect(await unreadIds(salesAdmin, ids.workspaceId)).toEqual([other]);
      const current = await thread(salesAdmin, ids.workspaceId, other);
      await salesAdmin.conversations.updateConversation(actor, ids.workspaceId, other, { version: current.version, status: "closed" } as never);
      expect(await unreadCount(salesAdmin, ids.workspaceId)).toBe(0);
    });
  });

  it("lets only whoever resolved a chat, or an inbox manager, reopen it; anyone else gets a 403; reopen is audited like resolve", async () => {
    await scenario(async (client, ids, as) => {
      const [owner, salesAdmin, sales] = [as(ids.admin), as(ids.salesAdmin), as(ids.sales)];
      const { conversationId } = await whatsapp(sales, ids.workspaceId, "+447911127777", "Thanks, that's all");
      let current = await thread(salesAdmin, ids.workspaceId, conversationId);
      await salesAdmin.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "closed" } as never);
      expect(await chat(client, conversationId)).toMatchObject({ status: "closed", resolved_by: ids.salesAdmin });

      // Who sees Reopen.
      expect(await thread(sales, ids.workspaceId, conversationId)).toMatchObject({ status: "closed", canReopen: false });
      expect(await thread(salesAdmin, ids.workspaceId, conversationId)).toMatchObject({ canReopen: true });
      expect(await thread(owner, ids.workspaceId, conversationId)).toMatchObject({ canReopen: true });
      const resolved = (await sales.conversations.list(actor, ids.workspaceId, { status: "closed", limit: 100 } as never)) as { data: Row[] };
      expect(resolved.data.find((row) => row.id === conversationId)).toMatchObject({ canReopen: false });

      // The chat's owner did not resolve it and doesn't manage the inbox: refused, nothing changes.
      current = await thread(sales, ids.workspaceId, conversationId);
      const refused = await refusal(sales.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "open" } as never));
      expect(refused.getStatus?.()).toBe(403);
      expect(refused.message).toBe(REOPEN_REFUSED);
      const bulk = await refusal(sales.inbox.bulk(actor, ids.workspaceId, { conversationIds: [conversationId], action: "reopen" } as never));
      expect(bulk.getStatus?.()).toBe(403);
      expect((await chat(client, conversationId)).status).toBe("closed");

      // The person who resolved it reopens it: a history line and an audit event, like resolve.
      current = await thread(salesAdmin, ids.workspaceId, conversationId);
      await salesAdmin.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "open" } as never);
      expect(await chat(client, conversationId)).toMatchObject({ status: "open", resolved_by: null, resolved_at: null });
      const history = await client.query<{ kind: string; actor_user_id: string | null }>("SELECT kind, actor_user_id FROM crm_conversation_events WHERE conversation_id = $1 AND kind IN ('resolved', 'reopened') ORDER BY created_at, id", [conversationId]);
      expect(history.rows).toHaveLength(2);
      expect(history.rows).toEqual(expect.arrayContaining([{ kind: "resolved", actor_user_id: ids.salesAdmin }, { kind: "reopened", actor_user_id: ids.salesAdmin }]));
      const audit = await client.query<{ actor_user_id: string; before: Row; after: Row }>(
        "SELECT actor_user_id, before, after FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 AND action = 'crm.conversation.updated.v1' ORDER BY occurred_at, id", [ids.workspaceId, conversationId]);
      expect(audit.rows.map((row) => [row.actor_user_id, row.before.status, row.after.status]).sort()).toEqual([[ids.salesAdmin, "closed", "open"], [ids.salesAdmin, "open", "closed"]]);
      expect(audit.rows.find((row) => row.after.status === "open")?.before).toMatchObject({ resolvedBy: ids.salesAdmin });

      // An inbox manager reopens a chat someone else resolved.
      current = await thread(sales, ids.workspaceId, conversationId);
      await sales.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "closed" } as never);
      current = await thread(owner, ids.workspaceId, conversationId);
      await owner.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "open" } as never);
      expect((await chat(client, conversationId)).status).toBe("open");

      // A chat the system resolved (a quiet chat) is its owner's to reopen; the sales admin, neither owner nor manager, is refused.
      await client.query("UPDATE crm_conversations SET status = 'closed', resolved_at = now(), resolved_by = NULL, version = version + 1 WHERE id = $1", [conversationId]);
      expect(await thread(sales, ids.workspaceId, conversationId)).toMatchObject({ canReopen: true });
      expect((await refusal(salesAdmin.inbox.bulk(actor, ids.workspaceId, { conversationIds: [conversationId], action: "reopen" } as never))).getStatus?.()).toBe(403);
      expect(await sales.inbox.bulk(actor, ids.workspaceId, { conversationIds: [conversationId], action: "reopen" } as never)).toMatchObject({ changed: 1 });

      // A client's message reopens any resolved chat, whoever resolved it.
      current = await thread(salesAdmin, ids.workspaceId, conversationId);
      await salesAdmin.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "closed" } as never);
      await whatsapp(sales, ids.workspaceId, "+447911127777", "One more question");
      expect(await chat(client, conversationId)).toMatchObject({ status: "open", resolved_by: null });
    });
  });

  it("keeps each workspace's reads to itself", async () => {
    await scenario(async (client, ids, as, tenant) => {
      const { conversationId } = await whatsapp(as(ids.sales), ids.workspaceId, "+447911128888", "Hello");
      await as(ids.sales).conversations.markRead(actor, ids.workspaceId, conversationId);
      await client.query("SAVEPOINT other_workspace");
      const other = await workspace(client, "elsewhere");
      // Another workspace's owner can't read (or mark read) this workspace's chat, and sees none of its reads.
      const outsider = as(other.admin);
      expect((await refusal(outsider.conversations.markRead(actor, other.workspaceId, conversationId))).getStatus?.()).toBe(404);
      expect(await unreadCount(outsider, other.workspaceId)).toBe(0);
      const seen = await tenant(other.workspaceId, other.admin, async (db) => (await db.query("SELECT 1 FROM crm_conversation_reads")).rowCount);
      expect(seen).toBe(0);
      expect(await tenant(ids.workspaceId, ids.sales, async (db) => (await db.query("SELECT 1 FROM crm_conversation_reads")).rowCount)).toBe(1);
      // Writing a read into another workspace, or about another workspace's chat, is refused by the database.
      await expect(tenant(other.workspaceId, other.admin, (db) => db.query("INSERT INTO crm_conversation_reads (workspace_id, conversation_id, user_id) VALUES ($1, $2, $3)", [ids.workspaceId, conversationId, other.admin])))
        .rejects.toThrow(/row-level security|Cross-workspace reference/);
      await expect(tenant(other.workspaceId, other.admin, (db) => db.query("INSERT INTO crm_conversation_reads (workspace_id, conversation_id, user_id) VALUES ($1, $2, $3)", [other.workspaceId, conversationId, other.admin])))
        .rejects.toThrow(/Cross-workspace reference/);
      // Even with this workspace's own chat, a read can't be written under the other workspace's name.
      const own = (await whatsapp(outsider, other.workspaceId, "+447911129999", "Hi")).conversationId;
      await expect(tenant(other.workspaceId, other.admin, (db) => db.query("INSERT INTO crm_conversation_reads (workspace_id, conversation_id, user_id) VALUES ($1, $2, $3)", [ids.workspaceId, own, other.admin])))
        .rejects.toThrow(/row-level security|Cross-workspace reference/);
      await client.query("RELEASE SAVEPOINT other_workspace");
    });
  });
});
