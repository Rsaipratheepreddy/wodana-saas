import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { chatClosingSource } from "../../reminders/sources/sales-checks";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { readDashboard } from "../../management-reports/management-reports";
import { CrmClosingMessagesService } from "../conversations/crm-closing-messages.service";
import { CrmConversationsService } from "../conversations/crm-conversations.service";
import { CrmInboxService } from "../conversations/crm-inbox.service";
import { CrmMessageReceiptService } from "../conversations/crm-message-receipt.service";
import { CrmIntakeService } from "../intake/crm-intake.service";
import { CrmLeadsService } from "../leads/crm-leads.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmSpamService } from "./crm-spam.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each scenario is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Ids = {
  workspaceId: string; admin: string; salesAdmin: string; sales: string; adminMember: string; salesAdminMember: string; salesMember: string; queueId: string;
};
type Services = {
  conversations: CrmConversationsService; inbox: CrmInboxService; closing: CrmClosingMessagesService; spam: CrmSpamService; leads: CrmLeadsService; intake: CrmIntakeService;
};

const PALM_RECEIVED = "Thank you, {{name}}! Your enquiry is now with our team. An Account Manager will contact you shortly. – Palm Living Interiors";
const PALM_FORM = "Hi {{name}}, to take your enquiry forward, please complete this short form: {{form_link}}. Once we receive it, our team will be in touch.";
const PALM_CLOSING = "Hi {{name}}, we haven't heard back from you, so we'll close this chat for now. If you'd like to continue with your project, simply message us here anytime and we'll be happy to help. – Palm Living Interiors";

/**
 * PLM-137 (chat status, the three closing messages, WhatsApp's 24-hour window) and PLM-138 (spam: the chat, the
 * contact and its enquiries, later messages on any channel, "Not spam" with a reason, the spam figures). Every command
 * runs as the app role (forced RLS) with the real permission checks.
 */
integration("inbox status, closing messages and spam (real Postgres)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function scenario(work: (client: PoolClient, ids: Ids, as: (userId: string) => Services) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), queueId = randomUUID();
    const [admin, salesAdmin, sales] = [randomUUID(), randomUUID(), randomUUID()];
    const [adminMember, salesAdminMember, salesMember] = [randomUUID(), randomUUID(), randomUUID()];
    const [adminRole, salesAdminRole, salesRole] = [randomUUID(), randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[admin, "Owner Olivia"], [salesAdmin, "Sana Admin"], [sales, "Sara Sales"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${name.split(" ")[0].toLowerCase()}-${id.slice(0, 8)}@example.com`, name]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,created_by) VALUES($1,'Inbox studio',$2,'USD','en',$3)", [workspaceId, `inbox-${workspaceId.slice(0, 8)}`, admin]);
      await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$4,$5,'active'),($2,$4,$6,'active'),($3,$4,$7,'active')`,
        [adminMember, salesAdminMember, salesMember, workspaceId, admin, salesAdmin, sales]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$4,'owner','Owner',true),($2,$4,'sales_admin','Sales admin',false),($3,$4,'sales','Account managers',false)",
        [adminRole, salesAdminRole, salesRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, adminRole]);
      const sell = ["crm.leads.view", "crm.leads.manage", "crm.parties.view", "crm.parties.manage", "crm.opportunities.view", "crm.opportunities.manage", "crm.activities.view", "crm.activities.manage", "crm.communications.view", "crm.communications.send"];
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`,
        [workspaceId, salesAdminRole, [...sell, "crm.leads.assign", "crm.inbox.team", "crm.inbox.close_chats"]]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, salesRole, sell]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$7)",
        [workspaceId, adminMember, adminRole, salesAdminMember, salesAdminRole, salesMember, salesRole]);
      await client.query("INSERT INTO crm_queues(id,workspace_id,code,name,is_fallback) VALUES($1,$2,'sales','Sales',true)", [queueId, workspaceId]);
      await client.query("INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id) VALUES($1,$2,$3)", [workspaceId, queueId, salesMember]);
      await client.query("INSERT INTO crm_sla_policies(workspace_id,name,event_type,warning_after_minutes,breach_after_minutes) VALUES($1,'First response','first_response',30,60)", [workspaceId]);
      await client.query(`INSERT INTO integration_connections(workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
        VALUES($1,'whatsapp','WhatsApp','connected',$2,'waba-1','{"phoneNumberId":"pn-1","displayPhoneNumber":"+1 555 0100"}')`, [workspaceId, admin]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SET LOCAL session_replication_role = origin");
      const database = {
        tenantTransaction: async (ws: string, actorUserId: string, fn: (c: PoolClient) => Promise<unknown>) => {
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
        },
      };
      const config = { get: (key: string) => (key === "WEB_ORIGIN" ? "https://app.example.com" : undefined) };
      const as = (userId: string): Services => {
        const access = new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
        const events = new CrmEventsService();
        const leads = new CrmLeadsService(database as never, access, events);
        const intake = new CrmIntakeService(database as never, access, events, leads);
        const conversations = new CrmConversationsService(database as never, access, events, {} as never, new CrmMessageReceiptService(), config as never);
        return {
          conversations, leads, intake, inbox: new CrmInboxService(database as never, access, events),
          closing: new CrmClosingMessagesService(access, events, conversations, config as never), spam: new CrmSpamService(access, events, leads, intake),
        };
      };
      await work(client, { workspaceId, admin, salesAdmin, sales, adminMember, salesAdminMember, salesMember, queueId }, as);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** A client's WhatsApp message, as the provider delivers it. */
  const whatsapp = (services: Services, ids: Ids, contact: string, text: string, name?: string) => services.conversations.ingestProviderMessage({
    workspaceId: ids.workspaceId, channel: "whatsapp", providerThreadId: `wa:${contact}`, providerMessageId: `wamid.${randomUUID()}`, contact, displayName: name, bodyText: text,
  }) as Promise<{ conversationId: string; partyId: string }>;
  const chat = async (client: PoolClient, id: string) => (await client.query("SELECT * FROM crm_conversations WHERE id = $1", [id])).rows[0];
  const events = async (client: PoolClient, id: string) => (await client.query<{ kind: string; method: string | null; reason: string | null }>(
    "SELECT kind, method, reason FROM crm_conversation_events WHERE conversation_id = $1 ORDER BY created_at, id", [id])).rows;
  const reply = (services: Services, ids: Ids, conversationId: string, text: string) =>
    services.conversations.addMessage(actor, ids.workspaceId, conversationId, { direction: "outbound", bodyText: text, clientMessageId: randomUUID() } as never);
  /** Our last reply and its quiet clock moved into the past, as if the client had been silent since. */
  const quietSince = async (client: PoolClient, conversationId: string, hours: number) => {
    await client.query(`UPDATE crm_messages SET created_at = now() - make_interval(hours => $2) WHERE conversation_id = $1 AND direction = 'outbound'`, [conversationId, hours]);
    await client.query(`UPDATE crm_conversations SET closing_due_at = now() - interval '1 minute' WHERE id = $1`, [conversationId]);
  };
  const refusal = async (promise: Promise<unknown>) => {
    try { await promise; } catch (error) { return error as { message: string; status?: number }; }
    throw new Error("Expected the command to be refused");
  };

  it("PLM-137: a chat is Open, Unresolved, Resolved or Spam; a client message reopens it; two people resolving at once change it once", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId } = await whatsapp(staff, ids, "+447911124444", "Hi, I need a kitchen", "Noura Haddad");
      expect((await chat(client, conversationId)).status).toBe("open");
      let current = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      await staff.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "unresolved" } as never);
      const summary = await staff.inbox.summary(actor, ids.workspaceId) as Record<string, number>;
      expect(summary).toMatchObject({ unresolved: 1, spam: 0, all: 1 });
      const listed = await staff.conversations.list(actor, ids.workspaceId, { status: "open,unresolved", limit: 25 } as never) as { data: Array<{ id: string; status: string }> };
      expect(listed.data.map((row) => [row.id, row.status])).toEqual([[conversationId, "unresolved"]]);
      // The client writes again: the chat is Open (our turn).
      await whatsapp(staff, ids, "+447911124444", "Any news?");
      expect((await chat(client, conversationId)).status).toBe("open");
      // Two people resolve it at once: the second changes nothing and isn't refused.
      current = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      await staff.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "closed" } as never);
      await as(ids.sales).conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: current.version, status: "closed" } as never);
      expect((await events(client, conversationId)).filter((event) => event.kind === "resolved")).toHaveLength(1);
      // A resolved chat reopens on the client's next message.
      await whatsapp(staff, ids, "+447911124444", "One more thing");
      expect((await chat(client, conversationId)).status).toBe("open");
      expect((await events(client, conversationId)).map((event) => event.kind)).toEqual(expect.arrayContaining(["unresolved", "reopened", "resolved"]));
      // An old chat from before the statuses (no quiet clock) still opens and reads its closing state from its messages.
      await client.query("UPDATE crm_conversations SET closing_due_at = NULL WHERE id = $1", [conversationId]);
      const thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { closing: { problem: string | null; canClose: boolean } };
      expect(thread.closing).toMatchObject({ problem: "The client is waiting for our reply.", canClose: true });
    });
  });

  it("PLM-137: the closing messages: the firm's texts, the form link filled in, Unresolved while the form is awaited, Closing the chat only after the quiet working hours, re-checked at the moment it is sent", async () => {
    await scenario(async (client, ids, as) => {
      const admin = as(ids.admin);
      const settings = await admin.closing.settings(actor, ids.workspaceId) as { version: number };
      await admin.closing.update(actor, ids.workspaceId, { version: settings.version, texts: { received: PALM_RECEIVED, form: PALM_FORM, closing: PALM_CLOSING }, formUrl: "https://palm.example.com/enquire", afterHours: 3 });
      await expect(admin.closing.update(actor, ids.workspaceId, { version: settings.version, afterHours: 4 })).rejects.toThrow(/changed/);
      await expect(admin.closing.update(actor, ids.workspaceId, { version: settings.version + 1, texts: { form: "Hi {{client}}" } })).rejects.toThrow("{{client}}");
      const saved = await admin.closing.settings(actor, ids.workspaceId) as { messages: Array<{ kind: string; text: string; custom: boolean; templateProblem: string | null }>; formLink: string };
      expect(saved.messages.map((message) => [message.kind, message.custom, message.templateProblem])).toEqual([["received", true, null], ["form", true, null], ["closing", true, null]]);
      expect(saved.formLink).toBe("https://palm.example.com/enquire");

      const staff = as(ids.salesAdmin);
      const { conversationId } = await whatsapp(staff, ids, "+447911125555", "Hello, can you quote a villa?", "Noura Haddad");
      // "Please complete the form" inside the window: the text as written, with the name and the form link; the chat waits.
      let thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      const form = await staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "form" });
      expect(form).toMatchObject({ sent: true, status: "unresolved", template: null });
      const sent = (await client.query("SELECT body_text, metadata FROM crm_messages WHERE id = $1", [form.messageId])).rows[0];
      expect(sent.body_text).toBe("Hi Noura, to take your enquiry forward, please complete this short form: https://palm.example.com/enquire. Once we receive it, our team will be in touch.");
      expect(sent.metadata.closing).toBe("form");
      expect((await chat(client, conversationId)).closing_due_at).not.toBeNull();

      // "Closing the chat" isn't offered yet: the client still has time.
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect((await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "closing" }))).message).toBe("The client still has time to reply.");
      // Only someone allowed (crm.inbox.close_chats) may send it, never an Account Manager.
      await quietSince(client, conversationId, 30);
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect((await refusal(as(ids.sales).closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "closing" }))).message).toMatch(/Permissions required/);
      // It waits in the Sales admins' My day and in the inbox's "closing due" list.
      expect((await staff.conversations.list(actor, ids.workspaceId, { closing: "due", limit: 25 } as never) as { data: Array<{ id: string }> }).data.map((row) => row.id)).toEqual([conversationId]);
      await client.query("SET LOCAL ROLE wodana_app");
      expect((await chatClosingSource.open(client, ids.workspaceId, { now: new Date(), limit: 10, clock: {} as never })).map((item) => item.sourceId)).toEqual([conversationId]);
      await client.query("RESET ROLE");

      // The client replies at the last second: the version the Sales admin saw is stale, and the chat now waits on us.
      const seen = thread.version;
      await whatsapp(staff, ids, "+447911125555", "Sorry, sending it now");
      expect((await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: seen, kind: "closing" }))).message).toMatch(/changed since you opened it/);
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect((await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "closing" }))).message).toBe("The client is waiting for our reply.");

      // We answer, the client goes quiet again for longer than the firm's hours: it can be closed, and that resolves the chat.
      await reply(staff, ids, conversationId, "Thanks, waiting for it.");
      await quietSince(client, conversationId, 30);
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      const closed = await staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "closing" });
      expect(closed).toMatchObject({ sent: true, status: "closed" });
      expect((await client.query("SELECT body_text FROM crm_messages WHERE id = $1", [closed.messageId])).rows[0].body_text).toMatch(/^Hi Noura, we haven't heard back from you/);
      expect((await events(client, conversationId)).filter((event) => event.kind === "closing_sent").map((event) => event.reason).sort()).toEqual(["closing", "form"]);
      // Never to a resolved chat.
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect((await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "closing" }))).message).toBe("This chat is already resolved.");
    });
  });

  it("PLM-137: outside WhatsApp's 24-hour window a closing message goes only as its approved template, else it is refused saying why", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId } = await whatsapp(staff, ids, "+447911126666", "Hi", "Layla Noor");
      await client.query("UPDATE crm_conversations SET last_inbound_at = now() - interval '2 days' WHERE id = $1", [conversationId]);
      // No form link set and no published enquiry form: the form message can't go, and says what to set.
      let thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect((await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "form" }))).message).toBe("Add the enquiry form link in Settings › Inbox › Closing messages.");
      await client.query(`INSERT INTO crm_inbox_settings (workspace_id, closing_form_url) VALUES ($1, 'https://studio.example.com/form')`, [ids.workspaceId]);
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      const refused = await refusal(staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "form" }));
      expect(refused.message).toBe(`WhatsApp's 24-hour window has closed, so "Please complete the form" can only go as a WhatsApp template, and Meta hasn't approved it yet. Wait for the client to write, or ask an admin to submit it in Settings › Inbox › WhatsApp templates (wd_chat_form).`);
      expect((await client.query("SELECT count(*)::int AS n FROM crm_messages WHERE conversation_id = $1 AND direction = 'outbound'", [conversationId])).rows[0].n).toBe(0);
      await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, body_template, provider_status, approved_at)
        VALUES ($1, 'wd_chat_form', 'whatsapp', 'en', 1, 'approved', 'Hi {{1}}, please complete this short form: {{2}} Thank you.', 'approved', now())`, [ids.workspaceId]);
      await client.query(`INSERT INTO crm_template_variables (workspace_id, channel, template_code, position, source) VALUES ($1, 'whatsapp', 'wd_chat_form', 1, 'contact.first_name'), ($1, 'whatsapp', 'wd_chat_form', 2, 'form.link')`, [ids.workspaceId]);
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      const sent = await staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "form" });
      expect(sent).toMatchObject({ sent: true, template: "wd_chat_form", status: "unresolved" });
      expect((await client.query("SELECT body_text, metadata FROM crm_messages WHERE id = $1", [sent.messageId])).rows[0]).toMatchObject({
        body_text: "Hi Layla, please complete this short form: https://studio.example.com/form Thank you.", metadata: expect.objectContaining({ template: expect.objectContaining({ code: "wd_chat_form" }) }) });
    });
  });

  it("PLM-137: a new enquiry from the chat gets \"We have everything\" once, as free text inside the window; sending it again resolves the chat without a second message", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId, partyId } = await whatsapp(staff, ids, "+447911127777", "I want to redo my villa", "Omar Saleh");
      const created = await staff.intake.createManual(actor, ids.workspaceId, `chat:${randomUUID()}`, undefined, {
        source: "company", channel: "whatsapp", intakeMethod: "manual", serviceType: "not_sure", identity: "existing", partyId,
        party: { displayName: "Omar Saleh", mobile: "+447911127777" }, details: { emirate: "north" }, assignment: { mode: "unassigned" }, originalPayload: { origin: "test" },
      } as never) as unknown as { leadId: string };
      const welcome = (await client.query("SELECT body_text, metadata FROM crm_messages WHERE conversation_id = $1 AND metadata->>'automatic' = 'crm.enquiry.created'", [conversationId])).rows;
      expect(welcome).toHaveLength(1);
      expect(welcome[0].body_text).toBe("Thank you, Omar! Your enquiry is now with our team, and we will contact you shortly.");
      await client.query("UPDATE crm_conversations SET lead_id = $2 WHERE id = $1", [conversationId, created.leadId]);
      const thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      expect(await staff.closing.send(actor, ids.workspaceId, conversationId, { version: thread.version, kind: "received" })).toMatchObject({ sent: false, messageId: null, status: "closed" });
      expect((await client.query("SELECT count(*)::int AS n FROM crm_messages WHERE conversation_id = $1 AND direction = 'outbound'", [conversationId])).rows[0].n).toBe(1);
    });
  });

  it("PLM-138: marking a chat as spam flags the contact and creates its enquiry already spam; later messages on any channel are spam too", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId, partyId } = await whatsapp(staff, ids, "+447911128888", "Buy followers cheap", "Promo Bot");
      const thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      const marked = await staff.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: true });
      expect(marked).toMatchObject({ status: "spam", changed: true });
      // Twice at once: the second changes nothing.
      expect(await as(ids.admin).spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: true })).toMatchObject({ status: "spam", changed: false });
      expect((await client.query("SELECT spam_at IS NOT NULL AS spam FROM crm_parties WHERE id = $1", [partyId])).rows[0].spam).toBe(true);
      const leads = (await client.query(`SELECT lead.id, lead.status, lead.disqualification_reason AS reason, lead.spam_at IS NOT NULL AS spam, lead.owner_membership_id AS owner,
          enquiry.source, enquiry.channel, (SELECT count(*)::int FROM crm_sla_instances sla WHERE sla.lead_id = lead.id) AS timers
        FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.id = lead.enquiry_id WHERE lead.party_id = $1`, [partyId])).rows;
      expect(leads).toEqual([expect.objectContaining({ status: "disqualified", reason: "Spam", spam: true, owner: null, channel: "whatsapp", timers: 0 })]);
      expect((await chat(client, conversationId)).lead_id).toBe(leads[0].id);
      expect((await client.query("SELECT count(*)::int AS n FROM crm_messages WHERE conversation_id = $1 AND direction = 'outbound'", [conversationId])).rows[0].n).toBe(0);

      // A later WhatsApp message: kept, still Spam, nobody waits on it or is told.
      const noticesBefore = (await client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1", [ids.workspaceId])).rows[0].n;
      await whatsapp(staff, ids, "+447911128888", "Last chance offer");
      expect(await chat(client, conversationId)).toMatchObject({ status: "spam", waiting_since: null });
      expect((await client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1", [ids.workspaceId])).rows[0].n).toBe(noticesBefore);
      // The same mobile through a form, under another name: an enquiry, already spam, never routed.
      const form = await staff.intake.createInternal(ids.workspaceId, `form:${randomUUID()}`, undefined, {
        source: "company", channel: "website", intakeMethod: "form", serviceType: "not_sure", party: { displayName: "Bob", mobile: "+447911128888" },
        details: { emirate: "north" }, originalPayload: { origin: "test" },
      } as never) as unknown as { leadId: string; spam?: boolean };
      expect((await client.query("SELECT status, spam_at IS NOT NULL AS spam, owner_membership_id AS owner FROM crm_leads WHERE id = $1", [form.leadId])).rows[0]).toEqual({ status: "disqualified", spam: true, owner: null });

      // The spam figures count them by source and channel; the other figures leave them out.
      const { kpis } = await readDashboard(client, ids.workspaceId, "sales-pipeline", { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }, new Date(), undefined, "all");
      const spamKpi = kpis.find((kpi) => kpi.code === "spam_by_source")!;
      expect(spamKpi.value).toBe("2");
      expect((spamKpi.chart as { items: Array<{ key: string; count: number }> }).items.map((item) => [item.key, item.count]).sort()).toEqual([["company/website", 1], ["company/whatsapp", 1]]);
      expect(kpis.find((kpi) => kpi.code === "new_leads")!.value).toBe("0");
    });
  });

  it("PLM-138: only someone allowed clears a wrong spam flag, with a reason; the contact's enquiries go back into the flow as new leads and its chats reopen", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId, partyId } = await whatsapp(staff, ids, "+447911129999", "Hi", "Real Client");
      let thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      await staff.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: true });
      thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      // A spam chat can't be reopened around the flag.
      await expect(staff.conversations.updateConversation(actor, ids.workspaceId, conversationId, { version: thread.version, status: "open" } as never)).rejects.toThrow("Mark it Not spam first");
      // The Sales admin isn't allowed to clear it (by default owners and administrators are).
      await expect(staff.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: false, reason: "Real client" })).rejects.toThrow(/Permissions required/);
      const owner = as(ids.admin);
      await expect(owner.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: false })).rejects.toThrow("Say why this isn't spam");
      const cleared = await owner.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: false, reason: "Called them: a real villa owner" }) as { status: string; leads: string[] };
      expect(cleared.status).toBe("open");
      expect((await client.query("SELECT spam_at, blocked_at FROM crm_parties WHERE id = $1", [partyId])).rows[0]).toEqual({ spam_at: null, blocked_at: null });
      const lead = (await client.query(`SELECT status, spam_at, owner_membership_id AS owner, (SELECT count(*)::int FROM crm_sla_instances sla WHERE sla.lead_id = crm_leads.id AND sla.status IN ('active', 'warning')) AS timers
        FROM crm_leads WHERE id = $1`, [cleared.leads[0]])).rows[0];
      expect(lead).toEqual({ status: "new", spam_at: null, owner: ids.salesMember, timers: 1 });
      const history = (await client.query(`SELECT action, after->>'reason' AS reason FROM audit_events WHERE workspace_id = $1 AND action IN ('crm.lead.spam_reopened.v1', 'crm.party.spam_reopened.v1') ORDER BY occurred_at`, [ids.workspaceId])).rows;
      expect(history).toEqual([{ action: "crm.party.spam_reopened.v1", reason: "Called them: a real villa owner" }, { action: "crm.lead.spam_reopened.v1", reason: "Called them: a real villa owner" }]);
      expect((await events(client, conversationId)).filter((event) => event.kind === "unspam").map((event) => event.reason)).toEqual(["Called them: a real villa owner"]);
      // The next message is an ordinary one again: routed and waited on.
      await whatsapp(staff, ids, "+447911129999", "So, about my villa");
      expect(await chat(client, conversationId)).toMatchObject({ status: "open" });
      expect((await chat(client, conversationId)).waiting_since).not.toBeNull();
    });
  });

  it("PLM-138: a client with an opportunity can't be marked as spam from the inbox", async () => {
    await scenario(async (client, ids, as) => {
      const staff = as(ids.salesAdmin);
      const { conversationId, partyId } = await whatsapp(staff, ids, "+447911121234", "Hello again", "Known Client");
      const pipeline = randomUUID(), stage = randomUUID();
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'sales','Sales',true)", [pipeline, ids.workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'qualified','New Opportunity',1)", [stage, ids.workspaceId, pipeline]);
      await client.query(`INSERT INTO crm_opportunities(workspace_id,party_id,pipeline_id,stage_id,title,owner_membership_id,reference) VALUES($1,$2,$3,$4,'Villa',$5,'O-0001')`,
        [ids.workspaceId, partyId, pipeline, stage, ids.salesMember]);
      const thread = await staff.conversations.get(actor, ids.workspaceId, conversationId) as { version: number };
      await expect(staff.spam.setChatSpam(actor, ids.workspaceId, conversationId, { version: thread.version, spam: true })).rejects.toThrow("This client has an opportunity with you");
      expect((await chat(client, conversationId)).status).toBe("open");
    });
  });
});
