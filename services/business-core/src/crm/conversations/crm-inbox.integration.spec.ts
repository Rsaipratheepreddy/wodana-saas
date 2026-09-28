import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = {
  workspaceId: string; manager: string; sara: string; ali: string; saraMember: string; aliMember: string; managerMember: string;
  noura: string; stranger: string; nouraChat: string; strangerChat: string; queueId: string; templateId: string;
  as: (userId: string) => void; conversations: CrmConversationsService; inbox: CrmInboxService;
};

integration("team inbox", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function withInbox(work: (client: PoolClient, ids: Ids) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID();
    const [manager, sara, ali] = [randomUUID(), randomUUID(), randomUUID()];
    const [managerMember, saraMember, aliMember] = [randomUUID(), randomUUID(), randomUUID()];
    const [salesRole, adminRole, noura, stranger, nouraChat, strangerChat, queueId, enquiryId, leadId, templateId] = Array.from({ length: 10 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      for (const [id, name] of [[manager, "Maya Manager"], [sara, "Sara Khan"], [ali, "Ali Noor"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      }
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Inbox Studio',$2,'USD',$3)", [workspaceId, `inbox-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$3,'sales','Sales'),($2,$3,'admin','Admin')", [salesRole, adminRole, workspaceId]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id)
        SELECT $1::uuid, $2::uuid, id FROM permissions WHERE code IN ('crm.communications.view','crm.communications.send')
        UNION ALL SELECT $1::uuid, $3::uuid, id FROM permissions WHERE code IN ('crm.communications.view','crm.communications.send','crm.settings.manage')`, [workspaceId, salesRole, adminRole]);
      for (const [membership, user, role] of [[managerMember, manager, adminRole], [saraMember, sara, salesRole], [aliMember, ali, salesRole]]) {
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [membership, workspaceId, user]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
      }
      await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES
        ($1,$3,'person','Noura Haddad','noura haddad'),($2,$3,'person','WhatsApp +15550001111','whatsapp +15550001111')`, [noura, stranger, workspaceId]);
      await client.query(`INSERT INTO crm_consents(workspace_id,party_id,purpose,channel,status) VALUES
        ($1,$2,'service','whatsapp','granted'),($1,$3,'service','whatsapp','granted')`, [workspaceId, noura, stranger]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','company','whatsapp',now(),'E-1042','fit_out','{}')`, [enquiryId, workspaceId, randomUUID(), noura]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status) VALUES($1,$2,$3,$4,$5,'connected')", [leadId, workspaceId, enquiryId, noura, saraMember]);
      await client.query("INSERT INTO crm_queues(id,workspace_id,code,name,is_fallback) VALUES($1,$2,'sales','Sales',true)", [queueId, workspaceId]);
      await client.query("INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id) VALUES($1,$2,$3)", [workspaceId, queueId, aliMember]);
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject) VALUES
        ($1,$3,$4,'whatsapp','Noura'),($2,$3,$5,'whatsapp','Stranger')`, [nouraChat, strangerChat, workspaceId, noura, stranger]);
      await client.query(`INSERT INTO notification_templates(id,workspace_id,code,channel,locale,version_number,status,body_template,approved_at)
        VALUES($1,$2,'quote_ready','whatsapp','en_US',1,'approved','Hi {{1}}, about {{2}}.',now())`, [templateId, workspaceId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      let current = sara;
      const database = { tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) };
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: current });
      const access = { withPermission: run, withAnyPermission: run, hasPermission: async () => true };
      const events = { record: async () => randomUUID() };
      const conversations = new CrmConversationsService(database as never, access as never, events as never, {} as never, new CrmMessageReceiptService());
      const inbox = new CrmInboxService(database as never, access as never, events as never);
      await work(client, { workspaceId, manager, sara, ali, saraMember, aliMember, managerMember, noura, stranger, nouraChat, strangerChat, queueId, templateId, as: (userId) => { current = userId; }, conversations, inbox });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const notices = (client: PoolClient, workspaceId: string, userId: string, eventType: string) =>
    client.query<{ subject: string; body: string; readAt: Date | null }>(`SELECT subject, body, read_at AS "readAt" FROM notifications WHERE workspace_id=$1 AND recipient_id=$2 AND event_type=$3 AND channel='in_app'`, [workspaceId, userId, eventType]).then((result) => result.rows);
  const chat = (client: PoolClient, id: string) => client.query(`SELECT * FROM crm_conversations WHERE id=$1`, [id]).then((result) => result.rows[0]);

  it("gives a client's chat to whoever already looks after them, with one notice per chat until it is read", async () => {
    await withInbox(async (client, { workspaceId, sara, saraMember, nouraChat, conversations, inbox, as }) => {
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Can you visit on Thursday?" } as never);
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Image received", metadata: { messageType: "image" } } as never);
      const assigned = await chat(client, nouraChat);
      expect(assigned).toMatchObject({ owner_membership_id: saraMember, status: "open", unread_count: 2 });
      expect(assigned.waiting_since).not.toBeNull();
      const history = await client.query(`SELECT kind, method, reason FROM crm_conversation_events WHERE conversation_id=$1`, [nouraChat]);
      expect(history.rows).toEqual([{ kind: "assigned", method: "relationship", reason: "Owns the client's enquiry" }]);
      expect(await notices(client, workspaceId, sara, "crm.inbox.message")).toEqual([{ subject: "Noura Haddad wrote", body: "2 new messages", readAt: null }]);

      as(sara);
      expect((await inbox.summary(actor, workspaceId)) as Record<string, unknown>).toMatchObject({ mine: 1, unassigned: 1, all: 2 });
      const mine = await conversations.list(actor, workspaceId, { view: "mine", status: "open", limit: 20 } as never);
      expect(mine.data.map((row: { id: string }) => row.id)).toEqual([nouraChat]);
      await conversations.markRead(actor, workspaceId, nouraChat);
      expect((await notices(client, workspaceId, sara, "crm.inbox.message"))[0].readAt).not.toBeNull();

      const reply = await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", bodyText: "Yes, 4 pm works.", clientMessageId: randomUUID() } as never);
      expect(reply.bodyText).toBe("Yes, 4 pm works.");
      expect((await chat(client, nouraChat)).waiting_since).toBeNull();
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Thanks" } as never);
      const again = await notices(client, workspaceId, sara, "crm.inbox.message");
      expect(again).toHaveLength(2);
      expect(again.find((notice) => !notice.readAt)?.body).toBe("Thanks");
    });
  });

  it("sends a stranger to the inbox queue, and tells the managers when nobody can take it", async () => {
    await withInbox(async (client, { workspaceId, manager, aliMember, queueId, strangerChat, stranger, conversations }) => {
      await conversations.addInboundInternal(workspaceId, strangerChat, { direction: "inbound", bodyText: "Hi" } as never);
      expect((await chat(client, strangerChat)).owner_membership_id).toBe(aliMember);

      await client.query(`UPDATE crm_queue_members SET is_available=false WHERE queue_id=$1`, [queueId]);
      const another = randomUUID();
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel) VALUES($1,$2,$3,'whatsapp')`, [another, workspaceId, stranger]);
      await conversations.addInboundInternal(workspaceId, another, { direction: "inbound", bodyText: "Anyone there?" } as never);
      expect((await chat(client, another)).owner_membership_id).toBeNull();
      expect(await notices(client, workspaceId, manager, "crm.inbox.unassigned")).toEqual([expect.objectContaining({ subject: "WhatsApp +15550001111 is waiting" })]);
    });
  });

  it("snoozes, comes back when the client writes, and wakes on schedule", async () => {
    await withInbox(async (client, { workspaceId, sara, nouraChat, conversations, inbox, as }) => {
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Hello" } as never);
      as(sara);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      let current = await chat(client, nouraChat);
      const snoozed = await conversations.updateConversation(actor, workspaceId, nouraChat, { version: current.version, status: "snoozed", snoozedUntil: tomorrow } as never);
      expect(snoozed).toMatchObject({ status: "snoozed" });
      // The same request again changes nothing, even with the old version.
      await expect(conversations.updateConversation(actor, workspaceId, nouraChat, { version: current.version, status: "snoozed", snoozedUntil: tomorrow } as never)).resolves.toMatchObject({ status: "snoozed" });
      current = await chat(client, nouraChat);
      await expect(conversations.updateConversation(actor, workspaceId, nouraChat, { version: current.version, status: "snoozed", snoozedUntil: new Date(Date.now() - 60_000).toISOString() } as never)).rejects.toThrow(/future/);

      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Actually, today?" } as never);
      expect(await chat(client, nouraChat)).toMatchObject({ status: "open", snoozed_until: null });

      current = await chat(client, nouraChat);
      await conversations.updateConversation(actor, workspaceId, nouraChat, { version: current.version, status: "snoozed", snoozedUntil: tomorrow } as never);
      await client.query(`UPDATE crm_conversations SET snoozed_until = now() - interval '1 minute' WHERE id=$1`, [nouraChat]);
      expect(await inbox.wakeSnoozedInternal(workspaceId)).toEqual({ woken: 1 });
      expect(await chat(client, nouraChat)).toMatchObject({ status: "open", snoozed_until: null });
      expect(await notices(client, workspaceId, sara, "crm.inbox.woke")).toHaveLength(1);
      const kinds = await client.query(`SELECT kind, method FROM crm_conversation_events WHERE conversation_id=$1 ORDER BY created_at, kind`, [nouraChat]);
      expect(kinds.rows.map((row) => `${row.kind}:${row.method}`)).toEqual(expect.arrayContaining(["snoozed:manual", "reopened:client_replied", "woke:schedule"]));
    });
  });

  it("labels and bulk actions are idempotent and leave history", async () => {
    await withInbox(async (client, { workspaceId, manager, aliMember, nouraChat, strangerChat, inbox, conversations, as }) => {
      as(manager);
      const label = await inbox.createLabel(actor, workspaceId, { name: " Quote  request ", color: "viz-2" }) as { id: string; name: string };
      expect(label.name).toBe("Quote request");
      expect(await inbox.createLabel(actor, workspaceId, { name: "quote request", color: "viz-2" })).toMatchObject({ id: label.id, idempotentReplay: true });
      await expect(inbox.createLabel(actor, workspaceId, { name: "Quote request", color: "viz-3" })).rejects.toThrow(/already exists/);

      await inbox.setConversationLabels(actor, workspaceId, nouraChat, { labelIds: [label.id] });
      await inbox.setConversationLabels(actor, workspaceId, nouraChat, { labelIds: [label.id] });
      const labelled = await conversations.list(actor, workspaceId, { labelId: label.id, limit: 20 } as never);
      expect(labelled.data).toEqual([expect.objectContaining({ id: nouraChat, labels: [{ id: label.id, name: "Quote request", color: "viz-2" }] })]);

      expect(await inbox.bulk(actor, workspaceId, { conversationIds: [nouraChat, strangerChat], action: "assign", ownerMembershipId: aliMember })).toMatchObject({ changed: 2 });
      expect(await inbox.bulk(actor, workspaceId, { conversationIds: [nouraChat, strangerChat], action: "resolve" })).toMatchObject({ changed: 2 });
      expect(await inbox.bulk(actor, workspaceId, { conversationIds: [nouraChat, strangerChat], action: "resolve" })).toMatchObject({ changed: 0, unchanged: 2 });
      expect(await chat(client, nouraChat)).toMatchObject({ status: "closed", owner_membership_id: aliMember });
      const history = await client.query(`SELECT kind FROM crm_conversation_events WHERE conversation_id=$1 ORDER BY created_at`, [nouraChat]);
      expect(history.rows.map((row) => row.kind)).toEqual(["labelled", "assigned", "resolved"]);
      const archived = await inbox.updateLabel(actor, workspaceId, label.id, { version: 1, status: "archived" });
      expect(archived).toMatchObject({ status: "archived" });
      await expect(inbox.setConversationLabels(actor, workspaceId, strangerChat, { labelIds: [label.id] })).rejects.toThrow(/active label/);
    });
  });

  it("keeps internal notes in the team's thread, never sends them, and tells the people mentioned", async () => {
    await withInbox(async (client, { workspaceId, sara, ali, aliMember, nouraChat, conversations, as }) => {
      as(sara);
      const note = await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "internal", bodyText: "@Ali Noor call her after 5", mentions: [aliMember] } as never);
      const thread = await conversations.get(actor, workspaceId, nouraChat);
      expect(thread.messages).toEqual([expect.objectContaining({ id: note.id, direction: "internal", senderName: "Sara Khan" })]);
      const queued = await client.query(`SELECT 1 FROM notifications WHERE workspace_id=$1 AND idempotency_key=$2`, [workspaceId, `message:${note.id}`]);
      expect(queued.rowCount).toBe(0);
      expect(await notices(client, workspaceId, ali, "crm.inbox.mention")).toEqual([expect.objectContaining({ subject: "Sara Khan mentioned you", body: "Noura Haddad: @Ali Noor call her after 5" })]);
      expect((await chat(client, nouraChat)).waiting_since).toBeNull();
    });
  });

  it("fills a template from the chat's records and blocks a send whose value is missing", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, templateId, nouraChat, strangerChat, conversations, inbox, as }) => {
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Hello" } as never);
      await conversations.addInboundInternal(workspaceId, strangerChat, { direction: "inbound", bodyText: "Hello" } as never);
      as(manager);
      const mapping = await inbox.setTemplateVariables(actor, workspaceId, templateId, { version: 0, variables: [{ position: 1, source: "contact.first_name" }, { position: 2, source: "enquiry.reference" }] });
      expect(mapping.mappingVersion).toBe(1);
      await expect(inbox.setTemplateVariables(actor, workspaceId, templateId, { version: 0, variables: [{ position: 1, source: "contact.name" }] })).rejects.toThrow(/changed/);
      expect((await inbox.templates(actor, workspaceId)).find((template) => template.id === templateId)).toMatchObject({ positions: [1, 2], usable: true, mappingVersion: 1 });

      as(sara);
      const sent = await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", templateId, clientMessageId: randomUUID() } as never);
      expect(sent.bodyText).toBe("Hi Noura, about E-1042.");
      const queued = await client.query(`SELECT template_parameters AS parameters, body FROM notifications WHERE workspace_id=$1 AND idempotency_key=$2`, [workspaceId, `message:${sent.id}`]);
      expect(queued.rows[0]).toEqual({ parameters: ["Noura", "E-1042"], body: "Hi Noura, about E-1042." });

      await expect(conversations.addMessage(actor, workspaceId, strangerChat, { direction: "outbound", templateId, clientMessageId: randomUUID() } as never)).rejects.toThrow(/Client first name/);
      const explicit = await conversations.addMessage(actor, workspaceId, strangerChat, { direction: "outbound", templateId, templateParameters: ["there", "your visit"], clientMessageId: randomUUID() } as never);
      expect(explicit.bodyText).toBe("Hi there, about your visit.");
      const context = await inbox.context(actor, workspaceId, nouraChat);
      expect(context.variables).toMatchObject({ "contact.first_name": "Noura", "enquiry.reference": "E-1042", "business.name": "Inbox Studio" });
    });
  });
});
