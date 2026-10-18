import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { CrmAttachmentsService } from "./crm-attachments.service";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";
import { CrmScheduledMessagesService } from "./crm-scheduled-messages.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type World = {
  workspaceId: string; other: string; admin: string; noura: string; chat: string; numberA: string; numberB: string;
  conversations: CrmConversationsService; attachments: CrmAttachmentsService; scheduled: CrmScheduledMessagesService;
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

integration("team inbox files, numbers and scheduled messages", () => {
  let pool: Pool;
  let storageDir: string;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    storageDir = await mkdtemp(join(tmpdir(), "wodana-inbox-files-"));
  });
  afterAll(async () => { await pool.end(); await rm(storageDir, { recursive: true, force: true }); });
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  async function withWorld(work: (client: PoolClient, world: World) => Promise<void>) {
    const client = await pool.connect();
    const [workspaceId, other, admin, adminMember, noura, chat, numberA, numberB] = Array.from({ length: 8 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Maya Admin')", [admin, `${admin.slice(0, 8)}@example.com`]);
      for (const [id, name] of [[workspaceId, "Studio One"], [other, "Other Studio"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,$2,$3,'USD','UTC',$4)", [id, name, `files-${id.slice(0, 8)}`, admin]);
      }
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id) VALUES($1,$2,$3)", [adminMember, workspaceId, admin]);
      await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES ($1,$2,'person','Noura Haddad','noura haddad')`, [noura, workspaceId]);
      await client.query(`INSERT INTO crm_consents(workspace_id,party_id,purpose,channel,status) VALUES ($1,$2,'service','whatsapp','granted')`, [workspaceId, noura]);
      await client.query(`INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES ($1,$2,'phone','+15550002222','+15550002222',true)`, [workspaceId, noura]);
      await client.query(`INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,provider_thread_id) VALUES ($1,$2,$3,'whatsapp','Noura','15550002222')`, [chat, workspaceId, noura]);
      for (const [id, number, isDefault] of [[numberA, "+1 555 0100", true], [numberB, "+1 555 0200", false]] as const) {
        await client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,connected_by,external_account_id,configuration)
          VALUES($1,$2,'whatsapp','WhatsApp','connected',$3,'waba-1',$4)`, [id, workspaceId, admin, { phoneNumberId: `pn-${number}`, displayPhoneNumber: number, isDefault }]);
      }
      await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
        VALUES ($1, 'crm.inbox_scheduled_failed', 'in_app', 'en', 1, 'approved', 'Your message to {{clientName}} wasn''t sent', '{{reason}}', '["clientName","reason"]', now())`, [workspaceId]);
      await client.query("SET LOCAL session_replication_role = origin");
      const database = { tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) };
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: admin });
      const access = { withPermission: run, withAnyPermission: run, hasPermission: async () => true };
      const events = { record: async () => randomUUID() };
      const config = { get: (key: string, fallback?: string) => (key === "BRAND_ASSET_STORAGE_DIR" ? storageDir : fallback) };
      const storage = new BrandAssetStorageService(config as never);
      const conversations = new CrmConversationsService(database as never, access as never, events as never, {} as never, new CrmMessageReceiptService());
      const attachments = new CrmAttachmentsService(database as never, access as never, events as never, storage);
      const scheduled = new CrmScheduledMessagesService(database as never, access as never, events as never, conversations);
      await work(client, { workspaceId, other, admin, noura, chat, numberA, numberB, conversations, attachments, scheduled });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const inbound = (world: World, metadata: Record<string, unknown>, text = "Photo received") => world.conversations.ingestProviderMessage({
    workspaceId: world.workspaceId, channel: "whatsapp", providerThreadId: "15550002222", providerMessageId: `wamid.${randomUUID()}`, contact: "+15550002222",
    bodyText: text, metadata: { provider: "whatsapp", ...metadata },
  } as never);

  it("keeps chat files and scheduled messages inside their workspace (forced RLS)", async () => {
    await withWorld(async (client, world) => {
      const tables = ["crm_message_attachments", "crm_scheduled_messages"];
      const guarded = await client.query<{ name: string }>(`SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity ORDER BY relname`, [tables]);
      expect(guarded.rows.map((row) => row.name)).toEqual(tables);
      const policies = await client.query<{ table: string }>(`SELECT tablename AS table FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = ANY($1::text[]) ORDER BY tablename`, [tables]);
      expect(policies.rows.map((row) => row.table)).toEqual(tables);

      await inbound(world, { messageType: "image", mediaId: "1001", mimeType: "image/jpeg", connectionId: world.numberA });
      await client.query(`UPDATE crm_conversations SET last_inbound_at = now() WHERE id = $1`, [world.chat]);
      await world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: inAnHour(), bodyText: "See you at 5" } as never);

      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [world.workspaceId]);
      expect((await client.query(`SELECT 1 FROM crm_message_attachments`)).rowCount).toBe(1);
      expect((await client.query(`SELECT 1 FROM crm_scheduled_messages`)).rowCount).toBe(1);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [world.other]);
      expect((await client.query(`SELECT 1 FROM crm_message_attachments`)).rowCount).toBe(0);
      expect((await client.query(`SELECT 1 FROM crm_scheduled_messages`)).rowCount).toBe(0);
      await client.query("SAVEPOINT cross_tenant");
      await expect(client.query(`INSERT INTO crm_scheduled_messages(workspace_id,conversation_id,body_text,rendered_text,send_at,client_request_id,request_hash,created_by)
        VALUES($1,$2,'x','x',now(),gen_random_uuid(),'h',$3)`, [world.workspaceId, world.chat, world.admin])).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
      // The worker's pass finds due work through the SECURITY DEFINER function, not by reading tenants' rows.
      const due = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM list_crm_workspaces_with_due_inbox_work()`);
      expect(due.rows.map((row) => row.workspace_id)).toContain(world.workspaceId);
    });
  });

  it("queues a client's photo for fetching without ever losing the message, then shows it from storage", async () => {
    await withWorld(async (client, world) => {
      const received = await inbound(world, { messageType: "image", mediaId: "1001", mimeType: "image/jpeg", connectionId: world.numberB });
      // A media id the provider could never have sent is not queued, and its message is still kept.
      await inbound(world, { messageType: "document", mediaId: "../../etc", connectionId: world.numberB }, "Plan.pdf");
      expect((await client.query(`SELECT 1 FROM crm_messages WHERE conversation_id = $1 AND direction = 'inbound'`, [world.chat])).rowCount).toBe(2);
      const claimed = await world.attachments.claimFetchesInternal(world.workspaceId);
      expect(claimed.items).toEqual([expect.objectContaining({ providerMediaId: "1001", connectionId: world.numberB, kind: "image", mimeType: "image/jpeg", attempts: 1 })]);
      // Leased: a second pass does not fetch it again.
      expect((await world.attachments.claimFetchesInternal(world.workspaceId)).items).toEqual([]);
      const id = String(claimed.items[0].id);
      const stored = await world.attachments.storeFetchedInternal(world.workspaceId, id, { buffer: PNG, originalname: "photo.png", mimetype: "image/png", size: PNG.length });
      expect(stored).toMatchObject({ status: "stored", byteSize: PNG.length, kind: "image" });
      // Stored twice is still one file.
      expect(await world.attachments.storeFetchedInternal(world.workspaceId, id, { buffer: PNG, originalname: "photo.png", mimetype: "image/png", size: PNG.length })).toMatchObject({ status: "stored" });
      const file = await world.attachments.content(actor, world.workspaceId, world.chat, id);
      expect(file).toMatchObject({ contentType: "image/jpeg", inline: true });
      expect(Buffer.compare(file.body, PNG)).toBe(0);
      const thread = await world.conversations.get(actor, world.workspaceId, world.chat) as unknown as { messages: Array<{ id: string; attachment: Record<string, unknown> | null }> };
      expect(thread.messages.find((message) => message.id === (received.message as { id: string }).id)?.attachment).toMatchObject({ id, status: "stored", kind: "image" });
    });
  });

  it("retries a fetch the provider may recover from and marks a lost file unavailable", async () => {
    await withWorld(async (client, world) => {
      await inbound(world, { messageType: "audio", mediaId: "2002", mimeType: "audio/ogg", connectionId: world.numberA });
      const [item] = (await world.attachments.claimFetchesInternal(world.workspaceId)).items;
      const retried = await world.attachments.failedFetchInternal(world.workspaceId, String(item.id), { code: "provider_unavailable", retryable: true });
      expect(retried).toMatchObject({ status: "pending", failureCode: "provider_unavailable" });
      const failed = await world.attachments.failedFetchInternal(world.workspaceId, String(item.id), { code: "media_unavailable", retryable: false });
      expect(failed).toMatchObject({ status: "failed", failureCode: "media_unavailable" });
      await expect(world.attachments.content(actor, world.workspaceId, world.chat, String(item.id))).rejects.toThrow(/isn't available/);
      expect((await client.query(`SELECT 1 FROM crm_messages WHERE conversation_id = $1`, [world.chat])).rowCount).toBe(1);
    });
  });

  it("replies from the number the client wrote to, and sends our file with the reply once", async () => {
    await withWorld(async (client, world) => {
      await inbound(world, { connectionId: world.numberB }, "Hello");
      const thread = await world.conversations.get(actor, world.workspaceId, world.chat) as unknown as { replyingAs: { number: string; connectionId: string } };
      expect(thread.replyingAs).toMatchObject({ number: "+1 555 0200", connectionId: world.numberB });
      expect((await world.conversations.list(actor, world.workspaceId, { connectionId: world.numberB, limit: 25 } as never)).data.map((row) => row.id)).toEqual([world.chat]);
      expect((await world.conversations.list(actor, world.workspaceId, { connectionId: world.numberA, limit: 25 } as never)).data).toEqual([]);

      const attachmentId = randomUUID();
      await expect(world.attachments.upload(actor, world.workspaceId, world.chat, randomUUID(), { buffer: Buffer.from("MZ not a picture"), originalname: "run.exe", mimetype: "image/png", size: 16 }))
        .rejects.toThrow(/can't send this type/);
      const uploaded = await world.attachments.upload(actor, world.workspaceId, world.chat, attachmentId, { buffer: PNG, originalname: "kitchen.png", mimetype: "image/png", size: PNG.length });
      expect(uploaded).toMatchObject({ id: attachmentId, kind: "image", mimeType: "image/png", status: "stored" });
      const sent = await world.conversations.addMessage(actor, world.workspaceId, world.chat, { direction: "outbound", purpose: "service", bodyText: "The kitchen today", attachmentId, clientMessageId: randomUUID() } as never) as { id: string };
      const row = (await client.query(`SELECT message.metadata->>'messageType' AS kind, attachment.message_id AS "linked", notification.body
          FROM crm_messages message JOIN crm_message_attachments attachment ON attachment.message_id = message.id
          JOIN notifications notification ON notification.idempotency_key = 'message:' || message.id WHERE message.id = $1`, [sent.id])).rows[0];
      expect(row).toEqual({ kind: "image", linked: sent.id, body: "The kitchen today" });
      await expect(world.conversations.addMessage(actor, world.workspaceId, world.chat, { direction: "outbound", purpose: "service", attachmentId } as never)).rejects.toThrow(/already sent/);
    });
  });

  it("schedules free text only while the window will be open, sends it when due, and tells its author when it can't go", async () => {
    await withWorld(async (client, world) => {
      await client.query(`UPDATE crm_conversations SET last_inbound_at = now() - interval '23 hours' WHERE id = $1`, [world.chat]);
      await expect(world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), bodyText: "Late" } as never))
        .rejects.toThrow(/24-hour window will be closed/);
      const requestId = randomUUID();
      const input = { clientRequestId: requestId, sendAt: new Date(Date.now() + 30 * 60_000).toISOString(), bodyText: "We are on our way" };
      const first = await world.scheduled.create(actor, world.workspaceId, world.chat, input as never);
      expect(first).toMatchObject({ status: "scheduled", renderedText: "We are on our way", version: 1 });
      // The same request again is the same message; another text under the same request id is refused.
      expect(await world.scheduled.create(actor, world.workspaceId, world.chat, input as never)).toMatchObject({ id: first.id, idempotentReplay: true });
      await expect(world.scheduled.create(actor, world.workspaceId, world.chat, { ...input, bodyText: "Other" } as never)).rejects.toThrow(/different message/);
      const edited = await world.scheduled.update(actor, world.workspaceId, world.chat, first.id, { version: 1, bodyText: "We are 10 minutes away" } as never);
      expect(edited).toMatchObject({ renderedText: "We are 10 minutes away", version: 2 });
      await expect(world.scheduled.update(actor, world.workspaceId, world.chat, first.id, { version: 1, bodyText: "Stale" } as never)).rejects.toThrow(/changed/);
      const thread = await world.conversations.get(actor, world.workspaceId, world.chat) as unknown as { scheduledMessages: Array<{ id: string; status: string }> };
      expect(thread.scheduledMessages).toEqual([expect.objectContaining({ id: first.id, status: "scheduled" })]);

      const cancelled = await world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: new Date(Date.now() + 40 * 60_000).toISOString(), bodyText: "Never mind" } as never);
      expect(await world.scheduled.cancel(actor, world.workspaceId, world.chat, cancelled.id, { version: 1 })).toMatchObject({ status: "cancelled" });

      // Its time comes: the worker's pass sends it through the normal reply path, once.
      await client.query(`UPDATE crm_scheduled_messages SET send_at = now() - interval '1 minute' WHERE workspace_id = $1`, [world.workspaceId]);
      const due = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM list_crm_workspaces_with_due_inbox_work()`);
      expect(due.rows.map((row) => row.workspace_id)).toContain(world.workspaceId);
      const pass = await world.scheduled.processDueInternal(world.workspaceId);
      expect(pass.items).toEqual([expect.objectContaining({ id: first.id, status: "sent" })]);
      const message = (await client.query(`SELECT body_text AS "bodyText", status::text, sender_id AS "senderId", metadata->>'scheduledMessageId' AS "scheduledMessageId" FROM crm_messages WHERE conversation_id = $1 AND direction = 'outbound'`, [world.chat])).rows;
      expect(message).toEqual([{ bodyText: "We are 10 minutes away", status: "queued", senderId: world.admin, scheduledMessageId: first.id }]);
      expect((await world.scheduled.processDueInternal(world.workspaceId)).items).toEqual([]);

      // One that can't go (the chat was resolved meanwhile) fails, and its author is told.
      await client.query(`UPDATE crm_conversations SET last_inbound_at = now() WHERE id = $1`, [world.chat]);
      const blocked = await world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: inAnHour(), bodyText: "After resolve" } as never);
      await client.query(`UPDATE crm_conversations SET status = 'closed' WHERE id = $1`, [world.chat]);
      await client.query(`UPDATE crm_scheduled_messages SET send_at = now() - interval '1 minute' WHERE id = $1`, [blocked.id]);
      const failed = await world.scheduled.processDueInternal(world.workspaceId);
      expect(failed.items).toEqual([expect.objectContaining({ id: blocked.id, status: "failed", reason: expect.stringMatching(/Reopen/) })]);
      const notice = await client.query(`SELECT subject, body FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'crm.inbox.scheduled_failed'`, [world.workspaceId, world.admin]);
      expect(notice.rows).toEqual([{ subject: "Your message to Noura Haddad wasn't sent", body: expect.stringMatching(/Reopen/) }]);
    });
  });

  it("cancels a scheduled follow-up when the client writes first, tells its author, and keeps one marked to go anyway (X-1)", async () => {
    await withWorld(async (client, world) => {
      await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
        VALUES ($1, 'crm.inbox_scheduled_cancelled', 'in_app', 'en', 1, 'approved', '{{clientName}} replied first', '{{preview}}', '["clientName","preview"]', now())`, [world.workspaceId]);
      await client.query(`UPDATE crm_conversations SET last_inbound_at = now() WHERE id = $1`, [world.chat]);
      const nudge = await world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: inAnHour(), bodyText: "Any thoughts on the quote?" } as never);
      const anyway = await world.scheduled.create(actor, world.workspaceId, world.chat, { clientRequestId: randomUUID(), sendAt: inAnHour(), bodyText: "Site visit confirmed", cancelOnReply: false } as never);
      expect(nudge).toMatchObject({ cancelOnReply: true });
      await inbound(world, {}, "Yes, go ahead");
      const rows = (await client.query(`SELECT id, status, cancel_reason AS reason FROM crm_scheduled_messages WHERE workspace_id = $1`, [world.workspaceId])).rows;
      expect(Object.fromEntries(rows.map((row) => [row.id, [row.status, row.reason]]))).toEqual({ [nudge.id]: ["cancelled", "client_replied"], [anyway.id]: ["scheduled", null] });
      const notice = await client.query(`SELECT subject, body FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'crm.inbox.scheduled_cancelled'`, [world.workspaceId, world.admin]);
      expect(notice.rows).toEqual([{ subject: "Noura Haddad replied first", body: "Any thoughts on the quote?" }]);
    });
  });

  it("saves a chat photo to one of the client's projects, once, and never to another client's (IN-18)", async () => {
    await withWorld(async (client, world) => {
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();
      const attachmentId = randomUUID();
      await world.attachments.upload(actor, world.workspaceId, world.chat, attachmentId, { buffer: png, originalname: "site.png", mimetype: "image/png", size: png.length });
      const [opportunity, caseId, otherCase, otherOpportunity] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference) VALUES($1,$2,$3,$4,$4,'Villa 12','OP-1'),($5,$2,$6,$4,$4,'Other','OP-2')`,
        [opportunity, world.workspaceId, world.noura, randomUUID(), otherOpportunity, randomUUID()]);
      await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by,status) VALUES($1,$2,$3,$4,'active'),($5,$2,$6,$4,'active')`,
        [caseId, world.workspaceId, opportunity, world.admin, otherCase, otherOpportunity]);
      await client.query("SET LOCAL session_replication_role = origin");
      expect((await world.attachments.saveTargets(actor, world.workspaceId, world.chat)).items).toEqual([{ caseId, title: "Villa 12", projectReference: null }]);
      const fileId = randomUUID();
      await expect(world.attachments.saveToCase(actor, world.workspaceId, world.chat, attachmentId, { caseId, fileId })).resolves.toEqual({ id: fileId, caseId, saved: true });
      await expect(world.attachments.saveToCase(actor, world.workspaceId, world.chat, attachmentId, { caseId, fileId })).resolves.toEqual({ id: fileId, caseId, saved: true });
      expect((await client.query(`SELECT original_name AS name, mime_type AS type, preview_key IS NOT NULL AS preview FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2`, [world.workspaceId, caseId])).rows)
        .toEqual([{ name: "site.png", type: "image/png", preview: true }]);
      await expect(world.attachments.saveToCase(actor, world.workspaceId, world.chat, attachmentId, { caseId: otherCase, fileId: randomUUID() })).rejects.toThrow(/this client's projects/);
    });
  });
});

