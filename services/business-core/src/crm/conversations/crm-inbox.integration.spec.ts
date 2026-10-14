import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboxService } from "./crm-inbox.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";
import { CrmWhatsAppTemplatesService } from "./crm-whatsapp-templates.service";
import { sendClientEvent } from "./inbox/client-messages";
import { STARTER_PACK } from "./inbox/whatsapp-starter-pack";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = {
  workspaceId: string; manager: string; sara: string; ali: string; saraMember: string; aliMember: string; managerMember: string;
  noura: string; stranger: string; nouraChat: string; strangerChat: string; queueId: string; templateId: string; leadId: string;
  as: (userId: string) => void; conversations: CrmConversationsService; inbox: CrmInboxService; templates: CrmWhatsAppTemplatesService;
  salesRole: string; adminRole: string;
  /** Permission checks follow the roles in the database instead of always passing (inbox visibility tests). */
  realPermissions: () => void;
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
      await client.query(`INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES
        ($1,$2,'phone','+15550002222','+15550002222',true),($1,$3,'phone','+15550001111','+15550001111',true)`, [workspaceId, noura, stranger]);
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
      await client.query(`INSERT INTO integration_connections(workspace_id,provider,display_name,status,connected_by,external_account_id,configuration) VALUES($1,'whatsapp','WhatsApp','connected',$2,'waba-1','{"phoneNumberId":"pn-1","displayPhoneNumber":"+1 555 0100"}')`, [workspaceId, manager]);
      await client.query("SET LOCAL session_replication_role = origin");
      let current = sara;
      let enforce = false;
      const database = { tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) };
      // The roles in the database decide once realPermissions() is called (inbox visibility tests); before, everything passes.
      const holds = async (userId: string, code: string) => !enforce || Boolean((await client.query(
        `SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles assigned ON assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
          JOIN role_permissions granted ON granted.role_id = assigned.role_id JOIN permissions permission ON permission.id = granted.permission_id
         WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND permission.code = $3`, [workspaceId, userId, code])).rowCount);
      const run = async (_a: unknown, _w: string, permissions: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
        let allowed = false;
        for (const code of Array.isArray(permissions) ? permissions : [permissions]) if (await holds(current, code)) { allowed = true; break; }
        if (!allowed) throw new ForbiddenException("Permission required");
        return fn(client, { userId: current });
      };
      const access = { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, userId: string, code: string) => holds(userId, code) };
      const realPermissions = () => { enforce = true; };
      const events = { record: async () => randomUUID() };
      const conversations = new CrmConversationsService(database as never, access as never, events as never, {} as never, new CrmMessageReceiptService());
      const inbox = new CrmInboxService(database as never, access as never, events as never);
      const templates = new CrmWhatsAppTemplatesService(database as never, access as never, events as never);
      await work(client, { workspaceId, manager, sara, ali, saraMember, aliMember, managerMember, noura, stranger, nouraChat, strangerChat, queueId, templateId, leadId, as: (userId) => { current = userId; }, conversations, inbox, templates, salesRole, adminRole, realPermissions });
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
    await withInbox(async (client, { workspaceId, manager, aliMember, managerMember, nouraChat, strangerChat, inbox, conversations, as }) => {
      as(manager);
      // Someone who assigns a chat to themselves "took" it: the history knows it by who they are, not by name.
      expect(await inbox.bulk(actor, workspaceId, { conversationIds: [strangerChat], action: "assign", ownerMembershipId: managerMember })).toMatchObject({ changed: 1 });
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
      const taken = (await conversations.get(actor, workspaceId, strangerChat)) as unknown as { events: Array<{ kind: string; actorName: string; ownerName: string; self: boolean }> };
      const assigned = taken.events.filter((event) => event.kind === "assigned").map(({ actorName, ownerName, self }) => ({ actorName, ownerName, self }));
      expect(assigned).toHaveLength(2);
      expect(assigned).toEqual(expect.arrayContaining([{ actorName: "Maya Manager", ownerName: "Maya Manager", self: true }, { actorName: "Maya Manager", ownerName: "Ali Noor", self: false }]));
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

  it("submits the starter pack once, keeps Meta's status current, and sends only approved templates", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, nouraChat, conversations, templates, as }) => {
      as(manager);
      const first = await templates.submitStarterPack(actor, workspaceId, { languages: ["en", "ar"] });
      // PLM-137: with them, the inbox's three closing messages, in English, from the firm's own texts.
      expect(first.added).toBe(STARTER_PACK.length * 2 + 3);
      expect(await templates.submitStarterPack(actor, workspaceId, { languages: ["en"] })).toEqual({ added: 0, skipped: STARTER_PACK.length, closingSkipped: 0 });
      const closingMapping = await client.query(`SELECT position, source FROM crm_template_variables WHERE workspace_id=$1 AND template_code='wd_chat_form' ORDER BY position`, [workspaceId]);
      expect(closingMapping.rows.map((row) => row.source)).toEqual(["contact.first_name", "form.link"]);
      const mapping = await client.query(`SELECT position, source FROM crm_template_variables WHERE workspace_id=$1 AND template_code='wd_payment_due' ORDER BY position`, [workspaceId]);
      expect(mapping.rows.map((row) => row.source)).toEqual(["contact.first_name", "payment.amount", "invoice.due_date", "portal.link"]);

      const work = await templates.dueWorkInternal(workspaceId);
      expect(work.sync).toBe(true);
      expect(work.submissions).toHaveLength(STARTER_PACK.length * 2 + 3);
      expect(work.submissions.find((item) => item.name === "wd_chat_form")).toMatchObject({ language: "en", examples: ["Noura", expect.stringMatching(/\/enquiry\/form$/)] });
      expect(work.submissions.find((item) => item.name === "wd_invoice_issued" && item.language === "en")).toMatchObject({ category: "UTILITY", examples: ["Noura", "INV-0101", expect.stringContaining("12,500"), expect.stringMatching(/\/portal$/)] });
      // Claimed for ten minutes: a second pass doesn't submit them again, and the daily sync isn't due again.
      expect(await templates.dueWorkInternal(workspaceId)).toEqual({ submissions: [], sync: false });

      const quote = work.submissions.find((item) => item.name === "wd_quote_ready" && item.language === "en")!;
      const welcome = work.submissions.find((item) => item.name === "wd_enquiry_welcome" && item.language === "en")!;
      await templates.submittedInternal(workspaceId, quote.id, { providerTemplateId: "meta-quote", status: "PENDING" });
      await templates.submittedInternal(workspaceId, welcome.id, { error: "Template name already exists" });
      await templates.syncInternal(workspaceId, { full: true, templates: [
        { id: "meta-quote", name: "wd_quote_ready", language: "en", status: "APPROVED", category: "UTILITY", quality: "GREEN" },
        { id: "meta-new", name: "studio_hours", language: "en", status: "APPROVED", category: "UTILITY", body: "We open at nine, Sunday to Thursday." },
      ] });
      const listed = await (await import("./crm-inbox.service")).CrmInboxService.prototype.templates.call({ access: { withPermission: (_a: unknown, _w: string, _p: string, fn: (c: PoolClient) => unknown) => fn(client) } }, actor, workspaceId) as Array<Record<string, unknown>>;
      expect(listed.find((item) => item.code === "wd_quote_ready" && item.locale === "en")).toMatchObject({ approved: true, providerStatus: "approved", category: "utility", quality: "green" });
      expect(listed.find((item) => item.code === "wd_enquiry_welcome" && item.locale === "en")).toMatchObject({ approved: false, providerStatus: "rejected", providerReason: "Template name already exists" });
      expect(listed.find((item) => item.code === "studio_hours")).toMatchObject({ approved: true });
      expect(await notices(client, workspaceId, manager, "crm.whatsapp.template_status")).toEqual([expect.objectContaining({ subject: "Template wd_enquiry_welcome (en) is rejected" })]);
      const synced = await client.query(`SELECT configuration->>'templatesSyncedAt' AS at FROM integration_connections WHERE workspace_id=$1`, [workspaceId]);
      expect(synced.rows[0].at).toBeTruthy();

      // An approved starter template sends; once Meta pauses it, it can't be sent.
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Hello" } as never);
      as(sara);
      const approvedId = listed.find((item) => item.code === "wd_quote_ready" && item.locale === "en")!.id as string;
      await expect(conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", templateId: approvedId, clientMessageId: randomUUID() } as never)).rejects.toThrow(/Quote number/);
      await templates.syncInternal(workspaceId, { full: false, templates: [{ id: "meta-quote", name: "wd_quote_ready", language: "en", status: "PAUSED", reason: "Low quality" }] });
      await expect(conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", templateId: approvedId, templateParameters: ["Noura", "V1", "https://x.example/portal"], clientMessageId: randomUUID() } as never)).rejects.toThrow(/not approved/);
    });
  });

  it("messages the client about an event once, in their chat, only with consent and an approved template", async () => {
    await withInbox(async (client, { workspaceId, manager, noura, stranger, nouraChat, leadId, templates, as }) => {
      as(manager);
      await templates.submitStarterPack(actor, workspaceId, { languages: ["en"] });
      await templates.syncInternal(workspaceId, { full: true, templates: [{ id: "meta-welcome", name: "wd_enquiry_welcome", language: "en", status: "APPROVED" }] });

      const sent = await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: noura, leadId, recordKey: leadId });
      expect(sent).toMatchObject({ sent: true, conversationId: nouraChat, duplicate: false });
      const again = await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: noura, leadId, recordKey: leadId });
      expect(again).toMatchObject({ sent: true, duplicate: true });
      const messages = await client.query(`SELECT body_text AS body, status, authorship, metadata->>'automatic' AS automatic FROM crm_messages WHERE conversation_id=$1`, [nouraChat]);
      expect(messages.rows).toEqual([{ body: "Hello Noura, thank you for contacting Inbox Studio. We have received your enquiry E-1042 and will be in touch shortly.", status: "queued", authorship: "automation", automatic: "crm.enquiry.created" }]);
      const queued = await client.query(`SELECT channel, template_parameters AS parameters FROM notifications WHERE workspace_id=$1 AND recipient_id=$2 AND channel='whatsapp'`, [workspaceId, noura]);
      expect(queued.rows).toEqual([{ channel: "whatsapp", parameters: ["Noura", "Inbox Studio", "E-1042"] }]);
      // An automatic message isn't a reply: nobody's wait ends and no owner is assigned by it.
      expect((await client.query(`SELECT waiting_since, owner_membership_id FROM crm_conversations WHERE id=$1`, [nouraChat])).rows[0]).toEqual({ waiting_since: null, owner_membership_id: null });

      expect(await sendClientEvent(client, { workspaceId, event: "project.stage_started", partyId: noura, recordKey: "p:s", record: { stageName: "Joinery" } })).toEqual({ sent: false, reason: "template_not_approved" });
      expect(await sendClientEvent(client, { workspaceId, event: "receivables.payment_received", partyId: noura, recordKey: "missing" })).toEqual({ sent: false, reason: "template_not_approved" });
      await templates.syncInternal(workspaceId, { full: false, templates: [{ id: "meta-paid", name: "wd_payment_received", language: "en", status: "APPROVED" }] });
      expect(await sendClientEvent(client, { workspaceId, event: "receivables.payment_received", partyId: noura, recordKey: "missing", record: { paymentId: "no-such-payment" } })).toEqual({ sent: false, reason: "value_missing", field: "Payment amount" });

      const listed = await templates.clientMessages(actor, workspaceId);
      expect(listed.events.find((row) => row.event === "crm.enquiry.created")).toMatchObject({ channel: "whatsapp", enabled: true, templateCode: "wd_enquiry_welcome" });
      expect(listed.events.find((row) => row.event === "portal.quote_issued")).toMatchObject({ channel: "email", template: { providerStatus: "submitting", approved: false } });
      expect(listed.events.find((row) => row.event === "project.stage_started")).toMatchObject({ channel: "none" });
      await templates.setClientMessage(actor, workspaceId, "crm.enquiry.created", { version: 0, enabled: false });
      await expect(templates.setClientMessage(actor, workspaceId, "crm.enquiry.created", { version: 0, enabled: true })).rejects.toThrow(/changed/);
      expect(await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: stranger, recordKey: "other" })).toEqual({ sent: false, reason: "off" });
      await templates.setClientMessage(actor, workspaceId, "crm.enquiry.created", { version: 1, enabled: true });

      await client.query(`UPDATE crm_consents SET status='withdrawn' WHERE workspace_id=$1 AND party_id=$2`, [workspaceId, stranger]);
      expect(await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: stranger, recordKey: "other" })).toEqual({ sent: false, reason: "no_consent" });
      await client.query(`UPDATE crm_consents SET status='granted' WHERE workspace_id=$1 AND party_id=$2`, [workspaceId, stranger]);
      await client.query(`UPDATE crm_parties SET blocked_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, stranger]);
      expect(await sendClientEvent(client, { workspaceId, event: "crm.enquiry.created", partyId: stranger, recordKey: "other" })).toEqual({ sent: false, reason: "blocked" });
    });
  });

  it("keeps a blocked number's messages without notices or assignment, and hides a message from views only", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, strangerChat, nouraChat, conversations, inbox, as }) => {
      as(sara);
      expect(await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: true, spam: true })).toMatchObject({ blocked: true, spam: true });
      expect(await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: true, spam: true })).toMatchObject({ blocked: true });
      await conversations.addInboundInternal(workspaceId, strangerChat, { direction: "inbound", bodyText: "Buy followers" } as never);
      expect((await chat(client, strangerChat)).owner_membership_id).toBeNull();
      expect(await notices(client, workspaceId, manager, "crm.inbox.unassigned")).toEqual([]);
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_messages WHERE conversation_id=$1`, [strangerChat])).rows[0].n).toBe(1);
      // PLM-138: unblocking keeps the spam flag (only "Not spam", with a reason, clears it): its messages stay spam.
      await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: false });
      await conversations.addInboundInternal(workspaceId, strangerChat, { direction: "inbound", bodyText: "Still selling" } as never);
      expect(await chat(client, strangerChat)).toMatchObject({ owner_membership_id: null, status: "spam", waiting_since: null });
      // A number blocked without spam comes back into the inbox once unblocked.
      await client.query(`UPDATE crm_parties SET spam_at = NULL WHERE workspace_id = $1 AND id = (SELECT party_id FROM crm_conversations WHERE id = $2)`, [workspaceId, strangerChat]);
      await client.query(`UPDATE crm_conversations SET status = 'open' WHERE id = $1`, [strangerChat]);
      await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: true });
      await inbox.blockConversation(actor, workspaceId, strangerChat, { blocked: false });
      await conversations.addInboundInternal(workspaceId, strangerChat, { direction: "inbound", bodyText: "Sorry, real question" } as never);
      expect((await chat(client, strangerChat)).owner_membership_id).not.toBeNull();
      expect((await client.query(`SELECT kind FROM crm_conversation_events WHERE conversation_id=$1 AND kind IN ('blocked','unblocked') ORDER BY created_at`, [strangerChat])).rows.map((row) => row.kind)).toEqual(["blocked", "unblocked", "blocked", "unblocked"]);

      const message = await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "My card number is 4111…" } as never) as { id: string };
      await inbox.hideMessage(actor, workspaceId, nouraChat, message.id, { hidden: true });
      const thread = await conversations.get(actor, workspaceId, nouraChat);
      expect(thread.messages.find((item: { id: string }) => item.id === message.id)).toMatchObject({ bodyText: null, hiddenByName: "Sara Khan" });
      expect((await client.query(`SELECT body_text FROM crm_messages WHERE id=$1`, [message.id])).rows[0].body_text).toBe("My card number is 4111…");
      await inbox.hideMessage(actor, workspaceId, nouraChat, message.id, { hidden: false });
      expect((await conversations.get(actor, workspaceId, nouraChat)).messages.find((item: { id: string }) => item.id === message.id)).toMatchObject({ bodyText: "My card number is 4111…", hiddenAt: null });
    });
  });

  it("filters chats by their record's stage, and the view counts follow", async () => {
    await withInbox(async (client, { workspaceId, sara, nouraChat, strangerChat, conversations, inbox, as }) => {
      as(sara);
      const ids = async (stage: string) => (await conversations.list(actor, workspaceId, { stage, limit: 50 } as never)).data.map((row: { id: string }) => row.id).sort();
      expect(await ids("lead:connected")).toEqual([nouraChat]);
      expect(await ids("none")).toEqual([strangerChat]);
      expect(await ids("lead:connected,none")).toEqual([nouraChat, strangerChat].sort());
      expect(await ids("lead:new")).toEqual([]);
      expect(await ids("bogus:thing")).toEqual([nouraChat, strangerChat].sort());
      expect(await inbox.summary(actor, workspaceId, "none")).toMatchObject({ all: 1 });
      expect((await inbox.stages(actor, workspaceId)).enquiry.map((item) => item.id)).toContain("lead:connected");
      await client.query(`UPDATE crm_leads SET status = 'paused', paused_reason = 'Travelling' WHERE workspace_id = $1`, [workspaceId]);
      expect(await ids("lead:paused")).toEqual([nouraChat]);
    });
  });

  it("keeps the number's standing, stops sending when Meta blocks it, and shows messages sent from the phone once", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, nouraChat, conversations, templates, as }) => {
      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Hello" } as never);
      await templates.syncInternal(workspaceId, { full: true, templates: [], health: { quality: "GREEN", limit: "TIER_1K", status: "CONNECTED" } });
      as(sara);
      expect((await conversations.get(actor, workspaceId, nouraChat)).numberHealth).toBe("connected");
      await templates.syncInternal(workspaceId, { full: false, templates: [], health: { quality: "RED", event: "FLAGGED" } });
      expect((await conversations.get(actor, workspaceId, nouraChat)).numberHealth).toBe("limited");
      expect(await notices(client, workspaceId, manager, "crm.whatsapp.number_health")).toEqual([expect.objectContaining({ subject: "Your WhatsApp number is limited" })]);
      await conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", purpose: "service", bodyText: "Still fine", clientMessageId: randomUUID() } as never);
      await templates.syncInternal(workspaceId, { full: false, templates: [], health: { status: "BANNED" } });
      await expect(conversations.addMessage(actor, workspaceId, nouraChat, { direction: "outbound", purpose: "service", bodyText: "Blocked", clientMessageId: randomUUID() } as never)).rejects.toThrow(/stopped sending/);

      await conversations.addInboundInternal(workspaceId, nouraChat, { direction: "inbound", bodyText: "Are you there?" } as never);
      const echo = { workspaceId, channel: "whatsapp", providerThreadId: "15550002222", providerMessageId: "wamid.phone-1", contact: "+15550002222", bodyText: "Yes, calling you now", metadata: { messageType: "text" } };
      const first = await conversations.ingestProviderEcho(echo as never);
      expect(first).toMatchObject({ conversationId: nouraChat, duplicate: false });
      expect(await conversations.ingestProviderEcho(echo as never)).toMatchObject({ duplicate: true });
      const phone = await client.query(`SELECT direction, status, metadata->>'sentFromPhone' AS phone FROM crm_messages WHERE provider_message_id = 'wamid.phone-1'`);
      expect(phone.rows).toEqual([{ direction: "outbound", status: "sent", phone: "true" }]);
      expect((await chat(client, nouraChat)).waiting_since).toBeNull();
    });
  });

  /** Someone beyond the fixture's people, with one role holding exactly these permissions (none: no role at all). */
  async function member(client: PoolClient, workspaceId: string, name: string, codes: string[]) {
    const [user, membership, role] = [randomUUID(), randomUUID(), randomUUID()];
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [user, `${user.slice(0, 8)}@example.com`, name]);
    await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [membership, workspaceId, user]);
    if (codes.length) {
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$4)", [role, workspaceId, `role-${role.slice(0, 8)}`, name]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, role, codes]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, role]);
    }
    await client.query("SET LOCAL session_replication_role = origin");
    return { user, membership };
  }

  /** The roles of plan §5b: Sales (own chats), a Sales admin (team), a designer and a project manager (no inbox), someone with no access. */
  async function people(client: PoolClient, workspaceId: string, salesRole: string, adminRole: string) {
    // Sales opens the jobs it works on (the Sales template's codes); the administrator opens every kind of job.
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('crm.leads.view','crm.opportunities.view') ON CONFLICT DO NOTHING", [workspaceId, salesRole]);
    await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('crm.leads.view','crm.opportunities.view','projects.view') ON CONFLICT DO NOTHING", [workspaceId, adminRole]);
    return {
      adam: await member(client, workspaceId, "Adam Admin", ["crm.communications.view", "crm.communications.send", "crm.inbox.team", "crm.parties.identity", "crm.leads.view", "crm.opportunities.view", "projects.view"]),
      dana: await member(client, workspaceId, "Dana Designer", ["crm.opportunities.view", "projects.view", "pre_projects.view"]),
      pete: await member(client, workspaceId, "Pete Manager", ["projects.view", "projects.manage"]),
      nobody: await member(client, workspaceId, "No Access", []),
    };
  }

  /** The contact's opportunity (owned by Sara, Dana on its team) and project (Pete assigned as its manager). */
  async function jobs(client: PoolClient, workspaceId: string, noura: string, saraMember: string, dana: string, pete: string, createdBy: string) {
    const [opportunity, project] = [randomUUID(), randomUUID()];
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference) VALUES($1,$2,$3,$4,$5,$6,'Villa joinery','O-7')`,
      [opportunity, workspaceId, noura, randomUUID(), randomUUID(), saraMember]);
    await client.query("INSERT INTO crm_opportunity_team(workspace_id,opportunity_id,membership_id,role) VALUES($1,$2,$3,'designer')", [workspaceId, opportunity, dana]);
    await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by) VALUES($1,$2,$3,'Villa fit-out','P-3',$5,now(),$4)", [project, workspaceId, randomUUID(), createdBy, randomUUID()]);
    await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active) VALUES($1,$2,$3,true,true)", [workspaceId, project, pete]);
    await client.query("SET LOCAL session_replication_role = origin");
    return { opportunity, project };
  }

  it("shows each person only what their level reaches: the intake to the Sales admin, own chats to Sales, nothing to others", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, ali, aliMember, salesRole, adminRole, nouraChat, strangerChat, conversations, inbox, as, realPermissions }) => {
      const { adam, dana, pete, nobody } = await people(client, workspaceId, salesRole, adminRole);
      const aliChat = randomUUID();
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,owner_membership_id) VALUES($1,$2,(SELECT party_id FROM crm_conversations WHERE id=$3),'whatsapp','Ali has it',$4)`, [aliChat, workspaceId, strangerChat, aliMember]);
      realPermissions();
      const ids = async (query: Record<string, unknown> = {}) => (await conversations.list(actor, workspaceId, { status: "open", limit: 50, ...query } as never)).data.map((row: { id: string }) => row.id).sort();

      // Sales admin (Team chats, in no queue): the whole unfiled intake, with its counts and search.
      as(adam.user);
      expect(await ids()).toEqual([nouraChat, strangerChat, aliChat].sort());
      expect(await ids({ view: "unassigned" })).toEqual([nouraChat, strangerChat].sort());
      expect(await ids({ search: "Noura" })).toEqual([nouraChat]);
      expect(await inbox.summary(actor, workspaceId)).toMatchObject({ scope: "team", unassigned: 2, team: 1, all: 3 });
      expect((await conversations.get(actor, workspaceId, nouraChat)).id).toBe(nouraChat);

      // Sales (Own chats): their own chat only; the others do not exist for them, in lists, counts, search, the thread and commands.
      as(ali);
      expect(await ids()).toEqual([aliChat]);
      expect(await ids({ search: "Noura" })).toEqual([]);
      expect(await inbox.summary(actor, workspaceId)).toMatchObject({ scope: "own", mine: 1, unassigned: 0, all: 1 });
      await expect(conversations.get(actor, workspaceId, nouraChat)).rejects.toThrow("Conversation not found");
      await expect(conversations.messages(actor, workspaceId, nouraChat, { limit: 20 })).rejects.toThrow("Conversation not found");
      await expect(conversations.addMessage(actor, workspaceId, nouraChat, { direction: "internal", bodyText: "Hi" } as never)).rejects.toThrow("Conversation not found");
      await expect(inbox.context(actor, workspaceId, nouraChat)).rejects.toThrow("Conversation not found");
      expect(await inbox.bulk(actor, workspaceId, { conversationIds: [aliChat, nouraChat], action: "resolve" } as never).catch((error: Error) => error.message)).toBe("Some chats were not found");
      as(sara);
      expect(await ids()).toEqual([]);

      // A designer and a project manager have no inbox: nothing until a chat is filed into their job.
      for (const person of [dana, pete]) {
        as(person.user);
        expect(await ids()).toEqual([]);
        expect(await inbox.summary(actor, workspaceId)).toMatchObject({ scope: "job", all: 0, unassigned: 0 });
        await expect(conversations.get(actor, workspaceId, strangerChat)).rejects.toThrow("Conversation not found");
      }
      // No access at all: refused.
      as(nobody.user);
      await expect(conversations.list(actor, workspaceId, { limit: 20 } as never)).rejects.toThrow("Permission required");
      await expect(inbox.summary(actor, workspaceId)).rejects.toThrow("Permission required");

      // Manager: everything.
      as(manager);
      expect(await ids()).toEqual([nouraChat, strangerChat, aliChat].sort());
      expect(await inbox.summary(actor, workspaceId)).toMatchObject({ scope: "manage", all: 3 });

      // E6-2: a message from an unknown number lands in the intake: the Sales admin sees it, the designer does not.
      const arrived = await conversations.ingestProviderMessage({ workspaceId, channel: "whatsapp", providerThreadId: "wa:15550007777", providerMessageId: `wamid.${randomUUID()}`, contact: "+15550007777", bodyText: "Do you do kitchens?" } as never) as { conversationId?: string; id?: string };
      const intakeChat = String(arrived.conversationId ?? (await client.query(`SELECT conversation.id FROM crm_conversations conversation JOIN crm_contact_points contact ON contact.party_id = conversation.party_id WHERE conversation.workspace_id=$1 AND contact.normalized_value='+15550007777'`, [workspaceId])).rows[0].id);
      expect(await chat(client, intakeChat)).toMatchObject({ job_kind: null, job_id: null });
      as(adam.user);
      expect(await ids()).toContain(intakeChat);
      as(dana.user);
      expect(await ids()).not.toContain(intakeChat);
    });
  });

  it("files a chat into a job: the job's team sees it, the intake no longer does, and leaving the team hides it again", async () => {
    await withInbox(async (client, { workspaceId, manager, sara, saraMember, salesRole, adminRole, noura, nouraChat, strangerChat, leadId, conversations, inbox, as, realPermissions }) => {
      const { adam, dana, pete } = await people(client, workspaceId, salesRole, adminRole);
      const { opportunity, project } = await jobs(client, workspaceId, noura, saraMember, dana.membership, pete.membership, manager);
      await client.query(`INSERT INTO crm_messages(workspace_id,conversation_id,direction,status,authorship,sender_type,body_text) VALUES($1,$2,'inbound','delivered','provider','provider','Can we change the wardrobe?')`, [workspaceId, nouraChat]);
      realPermissions();
      const ids = async () => (await conversations.list(actor, workspaceId, { status: "open", limit: 50 } as never)).data.map((row: { id: string }) => row.id).sort();

      // The Sales admin files Noura's chat into her opportunity. Nobody owned it: the opportunity's owner does now.
      as(adam.user);
      const version = (await chat(client, nouraChat)).version;
      await expect(inbox.fileIntoJob(actor, workspaceId, strangerChat, { kind: "opportunity", id: opportunity, version: (await chat(client, strangerChat)).version })).rejects.toThrow("This job belongs to another client");
      const filed = await inbox.fileIntoJob(actor, workspaceId, nouraChat, { kind: "opportunity", id: opportunity, version });
      expect(filed).toMatchObject({ changed: true, visible: false, job: { kind: "opportunity", id: opportunity, reference: "O-7", title: "Villa joinery" } });
      expect(await chat(client, nouraChat)).toMatchObject({ job_kind: "opportunity", job_id: opportunity, owner_membership_id: saraMember, filed_by: adam.user });
      const history = await client.query(`SELECT kind, method, reason FROM crm_conversation_events WHERE conversation_id=$1 ORDER BY created_at, id`, [nouraChat]);
      expect(history.rows).toEqual(expect.arrayContaining([{ kind: "filed", method: "manual", reason: "O-7 · Villa joinery" }, { kind: "assigned", method: "relationship", reason: "Owns the job this chat was filed into" }]));
      expect(await notices(client, workspaceId, sara, "crm.conversation.assigned")).toEqual([expect.objectContaining({ subject: "Conversation with Noura Haddad is yours" })]);
      // It left the intake: the Sales admin no longer sees it. A replay of the same filing changes nothing.
      expect(await ids()).toEqual([strangerChat]);
      await expect(conversations.get(actor, workspaceId, nouraChat)).rejects.toThrow("Conversation not found");
      expect(await inbox.fileIntoJob(actor, workspaceId, nouraChat, { kind: "opportunity", id: opportunity, version })).toMatchObject({ changed: false, visible: false });
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_conversation_events WHERE conversation_id=$1 AND kind='filed'`, [nouraChat])).rows[0].n).toBe(1);

      // The job's team sees it: the designer reads it (without answering), the owner works it.
      as(dana.user);
      expect(await ids()).toEqual([nouraChat]);
      const thread = await conversations.get(actor, workspaceId, nouraChat);
      expect(thread).toMatchObject({ canSend: false, job: { kind: "opportunity", id: opportunity } });
      expect(await inbox.summary(actor, workspaceId)).toMatchObject({ scope: "job", all: 1, team: 1 });
      await expect(inbox.fileIntoJob(actor, workspaceId, nouraChat, { kind: null, version: thread.version })).rejects.toThrow("Permission required");
      as(sara);
      expect(await ids()).toEqual([nouraChat]);
      // Stale version: refused.
      await expect(inbox.fileIntoJob(actor, workspaceId, nouraChat, { kind: "enquiry", id: leadId, version: thread.version - 1 })).rejects.toThrow("Conversation changed");

      // E6-4: the designer leaves the opportunity's team: the chat is gone for them, its history is kept.
      await client.query(`DELETE FROM crm_opportunity_team WHERE opportunity_id=$1 AND membership_id=$2`, [opportunity, dana.membership]);
      as(dana.user);
      expect(await ids()).toEqual([]);
      await expect(conversations.get(actor, workspaceId, nouraChat)).rejects.toThrow("Conversation not found");
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_messages WHERE conversation_id=$1`, [nouraChat])).rows[0].n).toBe(1);

      // Sara's own chat filed into the project by the manager: the project manager is told and sees it; Sara, not on
      // the project, no longer does. Pete is not an inbox member, so the chat keeps its owner.
      const saraChat = randomUUID();
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,owner_membership_id) VALUES($1,$2,$3,'whatsapp','Snag photos',$4)`, [saraChat, workspaceId, noura, saraMember]);
      as(manager);
      const projectFiled = await inbox.fileIntoJob(actor, workspaceId, saraChat, { kind: "project", id: project, version: (await chat(client, saraChat)).version });
      expect(projectFiled).toMatchObject({ changed: true, visible: true, job: { kind: "project", reference: "P-3", title: "Villa fit-out" } });
      expect(await notices(client, workspaceId, pete.user, "crm.inbox.filed")).toEqual([{ subject: "A chat with Noura Haddad is in P-3 · Villa fit-out", body: "Maya Manager filed it into your job. New messages from them reach you here.", readAt: null }]);
      as(pete.user);
      expect(await ids()).toEqual([saraChat]);
      as(sara);
      expect(await ids()).toEqual([nouraChat]);
      // Pete's assignment ends: the chat is gone for him.
      await client.query(`UPDATE project_assignments SET active=false WHERE project_id=$1`, [project]);
      as(pete.user);
      expect(await ids()).toEqual([]);

      // Out of the job again: back in the intake, its owner sees it; the history says so.
      as(manager);
      expect(await inbox.fileIntoJob(actor, workspaceId, saraChat, { kind: null, version: projectFiled.version })).toMatchObject({ changed: true, job: null });
      expect((await client.query(`SELECT kind FROM crm_conversation_events WHERE conversation_id=$1 ORDER BY kind`, [saraChat])).rows.map((row) => row.kind)).toEqual(["filed", "unfiled"]);
      as(sara);
      expect(await ids()).toEqual([nouraChat, saraChat].sort());
    });
  });

  it("keeps each organization's chats to itself, under the app role's row-level security", async () => {
    await withInbox(async (client, { workspaceId, manager, nouraChat, strangerChat, conversations, inbox, as, realPermissions }) => {
      const [otherWorkspace, otherParty, otherChat] = [randomUUID(), randomUUID(), randomUUID()];
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Other Studio',$2,'USD',$3)", [otherWorkspace, `other-${otherWorkspace.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Other Client','other client')", [otherParty, otherWorkspace]);
      await client.query("INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject) VALUES($1,$2,$3,'whatsapp','Theirs')", [otherChat, otherWorkspace, otherParty]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, manager]);
      realPermissions();
      as(manager);
      const ids = (await conversations.list(actor, workspaceId, { limit: 50 } as never)).data.map((row: { id: string }) => row.id).sort();
      expect(ids).toEqual([nouraChat, strangerChat].sort());
      await expect(conversations.get(actor, workspaceId, otherChat)).rejects.toThrow("Conversation not found");
      await expect(inbox.fileIntoJob(actor, workspaceId, otherChat, { kind: null, version: 1 })).rejects.toThrow("Conversation not found");
      expect((await client.query(`SELECT count(*)::int AS n FROM crm_conversations WHERE id=$1`, [otherChat])).rows[0].n).toBe(0);
    });
  });

  it("proposes the contact's live job and the quick replies that fit, with no model needed", async () => {
    await withInbox(async (client, { workspaceId, sara, leadId, nouraChat, strangerChat, inbox, as }) => {
      await client.query(`INSERT INTO crm_quick_replies(workspace_id,shortcut,body) VALUES($1,'address','Our studio is on Beach Road.'),($1,'visit','A site visit takes about an hour; which day suits you?')`, [workspaceId]);
      await client.query(`INSERT INTO crm_messages(workspace_id,conversation_id,direction,status,authorship,sender_type,body_text) VALUES($1,$2,'inbound','delivered','provider','provider','Can you visit our villa this week?')`, [workspaceId, nouraChat]);
      as(sara);
      const context = await inbox.context(actor, workspaceId, nouraChat);
      expect(context.job).toBeNull();
      expect(context.suggestedJob).toMatchObject({ kind: "enquiry", id: leadId, reference: "E-1042", title: "Villa" });
      expect((await inbox.context(actor, workspaceId, strangerChat)).suggestedJob).toBeNull();
      const insights = await inbox.insights(actor, workspaceId, nouraChat);
      expect(insights).toMatchObject({ source: "rules", summary: null, suggestedEnquiryType: null, summaryForEnquiry: "Can you visit our villa this week?" });
      expect(insights.suggestedReplies.map((reply) => reply.shortcut)).toEqual(["visit"]);
    });
  });
});
