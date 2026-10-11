import { createHmac, randomUUID } from "node:crypto";
import { ConflictException, NotAcceptableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { CrmNotificationsService } from "../notifications/crm-notifications.service";
import { dispatchChatEmails } from "../notifications/chat-email-dispatch";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmInboundEmailService } from "./crm-inbound-email.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const KEY = "key-test-signing";
const DOMAIN = "in.test.example";
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type World = {
  client: PoolClient; a: string; b: string; manager: string; sara: string; saraMember: string; aliMember: string; noura: string;
  inbound: CrmInboundEmailService; conversations: CrmConversationsService; receipts: CrmMessageReceiptService; addressA: string; addressB: string;
  database: { query: (text: string, values?: unknown[]) => Promise<unknown>; tenantTransaction: <T>(w: string, a: string, fn: (c: PoolClient) => Promise<T>) => Promise<T> };
  stored: string[];
};

let tokenCount = 0;
/** A Mailgun Route post, signed with the test key (a fresh token each time unless one is given). */
function post(fields: Record<string, string>, options: { token?: string; key?: string; timestamp?: number } = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const token = options.token ?? `tok${String(++tokenCount).padStart(4, "0")}${randomUUID().replace(/-/g, "")}`;
  const signature = createHmac("sha256", options.key ?? KEY).update(timestamp + token).digest("hex");
  const { messageId, inReplyTo, references, ...rest } = fields;
  const headers = [["Message-Id", messageId], ...(inReplyTo ? [["In-Reply-To", inReplyTo]] : []), ...(references ? [["References", references]] : []), ["To", "info@palm.example"]].filter(([, value]) => value);
  return { timestamp, token, signature, "message-headers": JSON.stringify(headers), ...rest };
}

integration("inbound email (PLM-025)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withWorld(work: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const [a, b, manager, sara, ali, managerMember, saraMember, aliMember, salesRole, adminRole, noura, enquiryId, leadId, queueId] = Array.from({ length: 14 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const [id, name] of [[manager, "Maya Manager"], [sara, "Sara Khan"], [ali, "Ali Noor"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id.slice(0, 8)}@example.com`, name]);
      }
      for (const [id, name] of [[a, "Palm Studio"], [b, "Other Studio"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [id, name, `ws-${id.slice(0, 8)}`, manager]);
      }
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$3,'sales','Sales'),($2,$3,'admin','Admin')", [salesRole, adminRole, a]);
      for (const [membership, user, role] of [[managerMember, manager, adminRole], [saraMember, sara, salesRole], [aliMember, ali, salesRole]]) {
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [membership, a, user]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [a, membership, role]);
      }
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id)
        SELECT $1::uuid, $2::uuid, id FROM permissions WHERE code IN ('crm.communications.view','crm.communications.send')
        UNION ALL SELECT $1::uuid, $3::uuid, id FROM permissions WHERE code IN ('crm.communications.view','crm.communications.send','crm.settings.manage')`, [a, salesRole, adminRole]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Noura Haddad','noura haddad')", [noura, a]);
      await client.query("INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES($1,$2,'email','Noura@Example.com','noura@example.com',true)", [a, noura]);
      await client.query(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at,reference,service_type,details)
        VALUES($1,$2,$3,$4,'Villa','company','email',now(),'E-2001','fit_out','{}')`, [enquiryId, a, randomUUID(), noura]);
      await client.query("INSERT INTO crm_leads(id,workspace_id,enquiry_id,party_id,owner_membership_id,status) VALUES($1,$2,$3,$4,$5,'connected')", [leadId, a, enquiryId, noura, saraMember]);
      await client.query("INSERT INTO crm_queues(id,workspace_id,code,name,is_fallback) VALUES($1,$2,'sales','Sales',true)", [queueId, a]);
      await client.query("INSERT INTO crm_queue_members(workspace_id,queue_id,membership_id) VALUES($1,$2,$3)", [a, queueId, aliMember]);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [a]);
      await seedDefaultNotificationTemplates(client, a);
      await client.query("SET LOCAL session_replication_role = origin");

      // Everything below runs as the app role: forced RLS, the role's grants and the SECURITY DEFINER lookups apply.
      await client.query("SET LOCAL ROLE wodana_app");
      const database = {
        query: (text: string, values: unknown[] = []) => client.query(text, values),
        tenantTransaction: async <T,>(workspaceId: string, actorId: string, fn: (c: PoolClient) => Promise<T>) => {
          await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, actorId]);
          await client.query("SAVEPOINT tenant_work");
          try { const result = await fn(client); await client.query("RELEASE SAVEPOINT tenant_work"); return result; }
          catch (error) { await client.query("ROLLBACK TO SAVEPOINT tenant_work"); throw error; }
        },
      };
      let current = manager;
      const run = async (_a: unknown, workspaceId: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => database.tenantTransaction(workspaceId, current, (c) => fn(c, { userId: current }) as Promise<unknown>);
      const access = { withPermission: run, withAnyPermission: run, hasPermission: async () => true };
      const events = { record: async () => randomUUID() };
      const receipts = new CrmMessageReceiptService();
      const conversations = new CrmConversationsService(database as never, access as never, events as never, {} as never, receipts, new ConfigService({ INBOUND_EMAIL_DOMAIN: DOMAIN }));
      const stored: string[] = [];
      const storage = { put: vi.fn(async (key: string) => { stored.push(key); }) };
      const config = new ConfigService({ MAILGUN_WEBHOOK_SIGNING_KEY: KEY, INBOUND_EMAIL_DOMAIN: DOMAIN });
      const inbound = new CrmInboundEmailService(database as never, access as never, events as never, conversations, storage as never, config, { senderAddress: () => "hello@mg.test.example" } as never);
      // Each workspace's address, made by its manager (the second workspace's as the same person, for the fixture).
      const addressA = (await inbound.setAddress(actor, a, { version: 0, commandId: randomUUID() })).address!;
      const addressB = (await inbound.setAddress(actor, b, { version: 0, commandId: randomUUID() })).address!;
      current = sara;
      await work({ client, a, b, manager, sara, saraMember, aliMember, noura, inbound, conversations, receipts, addressA, addressB, database, stored });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const tenant = async <T,>(world: World, workspaceId: string, sql: string, values: unknown[] = []) =>
    world.database.tenantTransaction(workspaceId, workspaceId, async (c) => (await c.query(sql, values)).rows as T[]);
  const count = async (world: World, workspaceId: string, table: string) => Number((await tenant<{ n: number }>(world, workspaceId, `SELECT count(*)::int AS n FROM ${table}`))[0].n);

  it("makes an unguessable address per workspace, version-checked and idempotent", async () => {
    await withWorld(async ({ inbound, a, addressA, addressB }) => {
      expect(addressA).toMatch(new RegExp(`^ws[0-9a-f]{6,8}-[a-z2-9]{10}@${DOMAIN.replace(/\./g, "\\.")}$`));
      expect(addressA).not.toBe(addressB);
      await expect(inbound.setAddress(actor, a, { version: 0, commandId: randomUUID() })).rejects.toBeInstanceOf(ConflictException);
      const command = randomUUID();
      const next = await inbound.setAddress(actor, a, { version: 1, commandId: command });
      expect(next.address).not.toBe(addressA);
      expect(await inbound.setAddress(actor, a, { version: 1, commandId: command })).toMatchObject({ address: next.address, idempotentReplay: true });
      expect(await inbound.address(actor, a)).toMatchObject({ address: next.address, version: 2, available: true });
    });
  });

  it("refuses a bad signature and a replayed request, and keeps nothing from them", async () => {
    await withWorld(async (world) => {
      const fields = { recipient: world.addressA, from: "Noura <noura@example.com>", subject: "Villa", "body-plain": "Hello", messageId: "<sig1@example.com>" };
      await expect(world.inbound.receiveMailgun(post(fields, { key: "wrong-key" }))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(world.inbound.receiveMailgun({ ...post(fields), signature: "0".repeat(64) })).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(world.inbound.receiveMailgun(post(fields, { timestamp: Math.floor(Date.now() / 1000) - 9 * 3600 }))).rejects.toBeInstanceOf(NotAcceptableException);
      expect(await count(world, world.a, "crm_email_messages")).toBe(0);
      const signed = post(fields);
      expect(await world.inbound.receiveMailgun(signed)).toMatchObject({ status: "stored" });
      await expect(world.inbound.receiveMailgun(signed)).rejects.toBeInstanceOf(NotAcceptableException);
      expect(await count(world, world.a, "crm_email_messages")).toBe(1);
    });
  });

  it("keeps the same email delivered twice as one message", async () => {
    await withWorld(async (world) => {
      const fields = { recipient: world.addressA, from: "Noura <noura@example.com>", subject: "Villa", "body-plain": "Hello", messageId: "<dup1@example.com>" };
      const first = await world.inbound.receiveMailgun(post(fields));
      const second = await world.inbound.receiveMailgun(post(fields));
      expect(second).toMatchObject({ status: "duplicate", messageId: first.messageId, conversationId: first.conversationId });
      expect(await count(world, world.a, "crm_messages")).toBe(1);
    });
  });

  it("matches a known client, assigns and tells, threads replies both ways, and sends our reply with its threading headers", async () => {
    await withWorld(async (world) => {
      const { a, sara, saraMember, noura, conversations } = world;
      const first = await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "Noura Haddad <Noura@Example.com>", subject: "Villa kitchen",
        "body-plain": "Can you visit on Thursday?\n\nOn Mon, Palm wrote:\n> Hello", "stripped-text": "Can you visit on Thursday?", "body-html": "<p onclick='x'>Can you visit on Thursday?</p><script>bad()</script>", messageId: "<n1@example.com>" }));
      expect(first.status).toBe("stored");
      const [chat] = await tenant<Record<string, unknown>>(world, a, "SELECT * FROM crm_conversations WHERE id = $1", [first.conversationId]);
      expect(chat).toMatchObject({ party_id: noura, channel: "email", subject: "Villa kitchen", owner_membership_id: saraMember, unread_count: 1 });
      const [message] = await tenant<Record<string, unknown>>(world, a, "SELECT body_text, body_html FROM crm_messages WHERE id = $1", [first.messageId]);
      expect(message).toEqual({ body_text: "Can you visit on Thursday?", body_html: "<p>Can you visit on Thursday?</p>" });
      const notices = await tenant<{ recipient_id: string }>(world, a, "SELECT recipient_id FROM notifications WHERE event_type = 'crm.inbox.message' AND channel = 'in_app'");
      expect(notices.map((row) => row.recipient_id)).toEqual([sara]);
      const view = await conversations.get(actor, a, first.conversationId!) as Record<string, unknown>;
      expect(view.email).toEqual({ address: world.addressA, via: "inbound" });
      expect((view.messages as Array<{ email: Record<string, unknown> }>)[0].email).toMatchObject({ subject: "Villa kitchen", from: "noura@example.com", fullText: expect.stringContaining("> Hello"), attachments: [] });

      // Our reply goes out by email, from the platform sender with Reply-To on the inbound address, in the same thread.
      const reply = await conversations.addMessage(actor, a, first.conversationId!, { direction: "outbound", bodyText: "Yes, 4 pm works.", clientMessageId: randomUUID() } as never) as { id: string; status: string };
      expect(reply.status).toBe("queued");
      const notifications = new CrmNotificationsService(world.database as never, {} as never, { record: async () => randomUUID() } as never, world.receipts);
      // The worker's connector never claims it: the platform mailer sends it.
      const claimed = (await notifications.claimInternal({ workspaceId: a, limit: 50 } as never)).items as Array<{ idempotencyKey: string }>;
      expect(claimed.filter((item) => item.idempotencyKey === `message:${reply.id}`)).toEqual([]);
      const mailer = { sendConversationReply: vi.fn<(input: { headers: Record<string, string> }) => Promise<Record<string, unknown>>>(async (input) => ({ status: "sent", provider: "mailgun", messageId: input.headers["Message-Id"] })) };
      const deps = { database: world.database as never, mailer: mailer as never, receipts: world.receipts, inboundDomain: DOMAIN };
      // Mailgun throttles the first try: the reply waits for its retry, still queued in the chat, never failed.
      mailer.sendConversationReply.mockResolvedValueOnce({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_429", retryable: true, retryAfterMs: 1_000 });
      expect(await dispatchChatEmails(deps, a)).toEqual({ claimed: 1, delivered: 0 });
      const waiting = await tenant<{ status: string; attempts: string[] }>(world, a, `SELECT notice.status::text AS status, array(SELECT attempt.status FROM notification_delivery_attempts attempt
        WHERE attempt.notification_id = notice.id ORDER BY attempt.attempt)::text[] AS attempts FROM notifications notice WHERE notice.idempotency_key = $1`, [`message:${reply.id}`]);
      expect(waiting).toEqual([{ status: "scheduled", attempts: ["retry"] }]);
      expect((await tenant<{ status: string }>(world, a, "SELECT status FROM crm_messages WHERE id = $1", [reply.id]))[0].status).toBe("queued");
      await tenant(world, a, "UPDATE notifications SET scheduled_for = now() - interval '1 minute' WHERE idempotency_key = $1", [`message:${reply.id}`]);
      expect(await dispatchChatEmails(deps, a)).toEqual({ claimed: 1, delivered: 1 });
      const ownId = `<m.${reply.id}@${DOMAIN}>`;
      expect(mailer.sendConversationReply).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: a, to: "noura@example.com", subject: "Re: Villa kitchen", body: "Yes, 4 pm works.", replyTo: world.addressA,
        headers: { "Message-Id": ownId, "In-Reply-To": "<n1@example.com>", References: "<n1@example.com>" },
      }), {});
      const [sent] = await tenant<{ status: string }>(world, a, "SELECT status FROM crm_messages WHERE id = $1", [reply.id]);
      expect(sent.status).toBe("sent");

      // The client's answer names our Message-Id: same conversation.
      const answer = await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "noura@example.com", subject: "Re: Villa kitchen", "body-plain": "Great",
        messageId: "<n2@example.com>", inReplyTo: ownId, references: `<n1@example.com> ${ownId}` }));
      expect(answer.conversationId).toBe(first.conversationId);
      // No threading headers, but the same sender and subject within the window: same conversation too.
      const loose = await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "noura@example.com", subject: "FW: Villa kitchen", "body-plain": "One more thing", messageId: "<n3@example.com>" }));
      expect(loose.conversationId).toBe(first.conversationId);
      // A new subject starts a new conversation.
      const other = await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "noura@example.com", subject: "Invoice question", "body-plain": "Hi", messageId: "<n4@example.com>" }));
      expect(other.conversationId).not.toBe(first.conversationId);
      // The next reply in the first thread answers the client's latest email.
      const second = await conversations.addMessage(actor, a, first.conversationId!, { direction: "outbound", bodyText: "Noted.", clientMessageId: randomUUID() } as never) as { id: string };
      await dispatchChatEmails(deps, a);
      expect(mailer.sendConversationReply).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { "Message-Id": `<m.${second.id}@${DOMAIN}>`, "In-Reply-To": "<n3@example.com>", References: "<n3@example.com>" } }), {});
    });
  });

  it("opens a conversation for an unknown sender (a new contact, to the queue) and keeps only allowed files", async () => {
    await withWorld(async (world) => {
      const { a, aliMember } = world;
      const pdf = Buffer.from("%PDF-1.4\n%test\n");
      const program = Buffer.from("MZ\x90\x00binary");
      const result = await world.inbound.receiveMailgun(post({ recipient: `Info <${world.addressA}>`, from: "Omar Saleh <omar@new.example>", subject: "New villa", "body-plain": "Please see the plan.", messageId: "<u1@new.example>" }),
        [{ fieldname: "attachment-1", originalname: "plan.pdf", mimetype: "application/pdf", buffer: pdf }, { fieldname: "attachment-2", originalname: "setup.exe", mimetype: "application/octet-stream", buffer: program }]);
      expect(result.status).toBe("stored");
      const [chat] = await tenant<Record<string, unknown>>(world, a, `SELECT conversation.owner_membership_id, conversation.lead_id, party.display_name, contact.normalized_value
        FROM crm_conversations conversation JOIN crm_parties party ON party.id = conversation.party_id
        JOIN crm_contact_points contact ON contact.party_id = party.id AND contact.type = 'email' WHERE conversation.id = $1`, [result.conversationId]);
      expect(chat).toEqual({ owner_membership_id: aliMember, lead_id: null, display_name: "Omar Saleh", normalized_value: "omar@new.example" });
      const files = await tenant<Record<string, unknown>>(world, a, "SELECT position, kind, status, failure_code, file_name FROM crm_message_attachments WHERE message_id = $1 ORDER BY position", [result.messageId]);
      expect(files).toEqual([
        { position: 0, kind: "document", status: "stored", failure_code: null, file_name: "plan.pdf" },
        { position: 1, kind: "document", status: "failed", failure_code: "type_not_allowed", file_name: "setup.exe" },
      ]);
      expect(world.stored).toHaveLength(1);
      expect(world.stored[0]).toMatch(new RegExp(`^crm-inbox/${a}/email/`));
      // An out-of-office from someone new never opens a conversation.
      const auto = await world.inbound.receiveMailgun({ ...post({ recipient: world.addressA, from: "robot@else.example", subject: "Out of office", "body-plain": "Away", messageId: "<auto1@else.example>" }),
        "message-headers": JSON.stringify([["Message-Id", "<auto1@else.example>"], ["Auto-Submitted", "auto-replied"]]) });
      expect(auto).toMatchObject({ status: "ignored", reason: "automatic" });
      // Our own sending address and unknown inbound addresses are ignored.
      expect(await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "hello@mg.test.example", subject: "Loop", "body-plain": "x", messageId: "<loop@x>" }))).toMatchObject({ status: "ignored", reason: "own_address" });
      expect(await world.inbound.receiveMailgun(post({ recipient: `nobody-abcdefghij@${DOMAIN}`, from: "omar@new.example", subject: "x", "body-plain": "x", messageId: "<lost@x>" }))).toMatchObject({ status: "ignored", reason: "unknown_recipient" });
    });
  });

  it("keeps each workspace's email inside it (forced RLS)", async () => {
    await withWorld(async (world) => {
      const { a, b } = world;
      const toA = await world.inbound.receiveMailgun(post({ recipient: world.addressA, from: "noura@example.com", subject: "For A", "body-plain": "A", messageId: "<rls-a@example.com>" }));
      const toB = await world.inbound.receiveMailgun(post({ recipient: world.addressB, from: "noura@example.com", subject: "For B", "body-plain": "B", messageId: "<rls-b@example.com>" }));
      expect(toA.workspaceId).toBe(a);
      expect(toB.workspaceId).toBe(b);
      // The same sender in workspace B is a new contact of B's, never A's client.
      const seenFromA = await tenant<{ id: string }>(world, a, "SELECT message_id AS id FROM crm_email_messages");
      expect(seenFromA.map((row) => row.id)).toEqual([toA.messageId]);
      const seenFromB = await tenant<{ id: string; party: string }>(world, b, "SELECT email.message_id AS id, conversation.party_id AS party FROM crm_email_messages email JOIN crm_conversations conversation ON conversation.id = email.conversation_id");
      expect(seenFromB.map((row) => row.id)).toEqual([toB.messageId]);
      expect(seenFromB[0].party).not.toBe(world.noura);
      expect(await tenant(world, a, "SELECT 1 FROM crm_inbound_email_addresses WHERE workspace_id = $1", [b])).toEqual([]);
      // A client's privacy erasure can remove their emails' facts (the app role may delete them, in its workspace only).
      expect(await tenant(world, a, "DELETE FROM crm_email_messages WHERE message_id = $1 RETURNING message_id", [toB.messageId])).toEqual([]);
      expect(await tenant(world, a, "DELETE FROM crm_email_messages WHERE message_id = $1 RETURNING message_id AS id", [toA.messageId])).toEqual([{ id: toA.messageId }]);
      // The token store is not readable by the app role at all.
      await expect(tenant(world, a, "SELECT count(*) FROM inbound_webhook_tokens")).rejects.toThrow(/permission denied/);
      const guarded = await tenant<{ name: string }>(world, a, "SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname",
        [["crm_email_messages", "crm_inbound_email_addresses", "inbound_webhook_tokens"]]);
      expect(guarded.map((row) => row.name)).toEqual(["crm_email_messages", "crm_inbound_email_addresses", "inbound_webhook_tokens"]);
    });
  });
});
