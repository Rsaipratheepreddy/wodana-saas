import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import type { CrmInboxService } from "../crm/conversations/crm-inbox.service";
import { renderAutoReply } from "../crm/conversations/inbox/auto-reply-rules";
import { seedDefaultQuickReplies } from "../crm/conversations/inbox/default-quick-replies";
import { renderTemplate } from "../crm/conversations/inbox/inbox-rules";
import { resolveTemplateSources } from "../crm/conversations/inbox/template-variables";

/**
 * The showcase's team inbox: WhatsApp chats with the seeded clients (their enquiries and projects), a few
 * WhatsApp templates in Meta's states, the default quick replies and auto replies switched on.
 *
 * Records only: every message is written as already sent or received, with no notification queued, so nothing
 * is ever delivered to anyone. Clients are the showcase's own fictional people, found by their demo phone numbers;
 * a client the showcase hasn't created (or who already has a WhatsApp chat) is skipped. Idempotent: each chat,
 * message and template has a stable key, so a second run finds them and adds nothing.
 */

type StaffRole = "sales" | "salesAdmin" | "manager" | "projectManager" | "finance";
type Staff = RequestActor & { userId: string; membershipId: string | null };
type Db = Pick<PoolClient, "query">;

export type InboxSeedContext = {
  workspaceId: string;
  owner: Staff;
  inbox: CrmInboxService;
  /** Runs work in one tenant transaction as the owner (forced RLS applies). */
  transaction: <T>(work: (db: Db) => Promise<T>) => Promise<T>;
  staff: (role: StaffRole) => Promise<Staff>;
  /** A stable id for a key in this workspace. */
  id: (key: string) => string;
  made: (label: string) => void;
  kept: (label: string) => void;
  skip: (stage: string, reason: string) => void;
};

/** One line of a chat, `at` hours ago. */
type Line =
  | { at: number; from: "client"; text: string; file?: { kind: "image" | "document"; name: string } }
  | { at: number; from: StaffRole; text: string; status?: "sent" | "delivered" | "read" }
  | { at: number; from: "note"; by: StaffRole; text: string }
  | { at: number; from: "auto_reply" }
  | { at: number; from: "reminder"; template: string };

type Chat = {
  key: string; client: string; mobile: string; subject: string; owner: StaffRole;
  state: "open" | "snoozed" | "closed"; unread: boolean; labels: string[];
  /** For a snoozed chat: when it comes back, in hours from now. */
  snoozeFor?: number;
  lines: Line[];
};

const LABELS: Array<{ name: string; color: string }> = [
  { name: "Quote request", color: "viz-2" }, { name: "Site visit", color: "viz-3" }, { name: "Payment", color: "viz-4" }, { name: "Urgent", color: "viz-5" },
];

/** WhatsApp templates as Meta would hold them: approved, waiting for review and rejected (with Meta's reason). */
const TEMPLATES: Array<{ code: string; body: string; category: "utility" | "marketing"; state: "approved" | "pending" | "rejected"; reason?: string; sources?: string[] }> = [
  { code: "quotation_ready", body: "Hi {{1}}, your quotation {{2}} is ready. You can review and approve it in your client portal.", category: "utility", state: "approved", sources: ["contact.first_name", "quote.number"] },
  { code: "site_visit_confirmed", body: "Hi {{1}}, your site visit is confirmed. Our team will see you then; reply here if anything changes.", category: "utility", state: "approved", sources: ["contact.first_name"] },
  { code: "payment_reminder_friendly", body: "Hi {{1}}, a friendly reminder that your payment for {{2}} is due on {{3}}. Reply here if you have any questions.", category: "utility", state: "approved", sources: ["contact.first_name", "project.name", "invoice.due_date"] },
  { code: "handover_invitation", body: "Hi {{1}}, your home is ready for handover. Reply with a day and time that suits you.", category: "utility", state: "pending", sources: ["contact.first_name"] },
  { code: "seasonal_offer", body: "Hi {{1}}, enjoy 15% off all living room furniture this month only!", category: "marketing", state: "rejected",
    reason: "Promotional content isn't allowed in a utility template. Submit it in the Marketing category.", sources: ["contact.first_name"] },
];

const CHATS: Chat[] = [
  { key: "hessa", client: "Hessa Al Suwaidi", mobile: "+971506000011", subject: "Majlis and dining room", owner: "sales", state: "open", unread: true, labels: ["Quote request"], lines: [
    { at: 2.2, from: "client", text: "Hello! I saw your majlis project on Instagram. We want to redo the majlis and the dining room before Ramadan. Can you help?" },
    { at: 2.19, from: "auto_reply" },
    { at: 2.0, from: "client", text: "The majlis is about 6 by 8 metres. Do you also do the curtains and the lighting?" },
  ] },
  { key: "daniel", client: "Daniel Okafor", mobile: "+971506000012", subject: "Living room refresh", owner: "salesAdmin", state: "open", unread: true, labels: ["Quote request"], lines: [
    { at: 26, from: "client", text: "Hi, I'm looking to refresh the living room of my one-bedroom apartment: sofa, rug, lighting and curtains." },
    { at: 25.5, from: "salesAdmin", text: "Hi Daniel, thanks for reaching out! Could you share your floor plan? A photo or a PDF is fine. It helps us plan the space and prepare an accurate quotation." },
    { at: 3.1, from: "client", text: "Here is the floor plan.", file: { kind: "image", name: "floor-plan-living-room.jpg" } },
    { at: 3.0, from: "client", text: "The wall facing the window is 4.2 m long, if that helps." },
  ] },
  { key: "mariam", client: "Mariam Haddad", mobile: "+971506000013", subject: "Kitchen", owner: "sales", state: "snoozed", snoozeFor: 20, unread: false, labels: [], lines: [
    { at: 70, from: "sales", text: "Hi Mariam, I tried calling about your kitchen. When is a good time to talk?" },
    { at: 50, from: "client", text: "Sorry, I was travelling. Can you call me tomorrow after 4?" },
    { at: 49.6, from: "sales", text: "Of course, I'll call you tomorrow after 4 pm." },
    { at: 49.5, from: "note", by: "sales", text: "Snoozed until her call tomorrow afternoon. She prefers calls after 4 pm." },
  ] },
  { key: "aisha", client: "Aisha Karim", mobile: "+971506000015", subject: "Master suite", owner: "sales", state: "open", unread: false, labels: ["Site visit"], lines: [
    { at: 30, from: "client", text: "Hi, I'd like to see the dressing room options in your showroom." },
    { at: 29, from: "sales", text: "Happy to show you! A showroom visit takes about an hour. Which day and time suit you best?" },
    { at: 27, from: "client", text: "Tuesday at 11 works for me." },
    { at: 26.5, from: "sales", text: "Booked for Tuesday at 11. See you then!" },
    { at: 26.4, from: "note", by: "sales", text: "Bring the walnut and oak veneer samples for the dressing room." },
  ] },
  { key: "sofia", client: "Sofia Bennett", mobile: "+971565000005", subject: "Penthouse quotation", owner: "manager", state: "open", unread: true, labels: ["Quote request", "Urgent"], lines: [
    { at: 52, from: "manager", text: "Hi Sofia, your quotation has been sent. Take your time to review it, and let us know if you have any questions." },
    { at: 5, from: "client", text: "Thanks. Could you split the lighting into a separate option? We may do it in a second phase." },
    { at: 4.8, from: "note", by: "manager", text: "Asking the estimator for a lighting-only option before we reply." },
  ] },
  { key: "haddad", client: "Omar and Layla Haddad", mobile: "+971553000003", subject: "Villa project", owner: "projectManager", state: "open", unread: true, labels: ["Payment"], lines: [
    { at: 75, from: "reminder", template: "payment_reminder_friendly" },
    { at: 73, from: "client", text: "Thanks for the reminder. We paid today; here is the receipt.", file: { kind: "document", name: "payment-receipt.pdf" } },
    { at: 72, from: "finance", text: "Received, thank you! We'll confirm as soon as it clears." },
    { at: 20, from: "client", text: "Also, when can we do the handover walk-through?" },
    { at: 19.5, from: "projectManager", text: "Your project is nearly ready for handover. Which day and time work for you to walk through it with us?" },
    { at: 4, from: "client", text: "Saturday morning would be perfect." },
  ] },
  { key: "faris", client: "Faris Khoury", mobile: "+971524000004", subject: "Office walk-through", owner: "salesAdmin", state: "closed", unread: false, labels: ["Site visit"], lines: [
    { at: 100, from: "client", text: "Can your team walk the office with me this week?" },
    { at: 99, from: "salesAdmin", text: "Sure. How about Thursday at 4 pm?" },
    { at: 98, from: "client", text: "Perfect, thanks." },
    { at: 97, from: "salesAdmin", text: "Great, see you on Thursday." },
  ] },
  { key: "nikolai", client: "Nikolai Petrov", mobile: "+971506000016", subject: "Apartment fit-out", owner: "salesAdmin", state: "closed", unread: false, labels: [], lines: [
    { at: 150, from: "salesAdmin", text: "Hi Nikolai, did you have a chance to review our proposal for the apartment fit-out?" },
    { at: 148, from: "client", text: "Thanks for your time. We decided to go with another studio this time." },
    { at: 147, from: "salesAdmin", text: "Understood, thank you for letting us know. We're here whenever you need us." },
  ] },
];

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
const later = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

export async function seedShowcaseInbox(ctx: InboxSeedContext) {
  const { workspaceId: w } = ctx;
  await ctx.transaction((db) => seedDefaultQuickReplies(db, w)).then((added) => added ? ctx.made(`inbox · ${added} default quick replies`) : ctx.kept("inbox · default quick replies"));
  const labels = await ensureLabels(ctx);
  const templates = await ensureTemplates(ctx);
  const greeting = await ensureAutoReplies(ctx);
  for (const chat of CHATS) {
    try { await seedChat(ctx, chat, labels, templates, greeting); }
    catch (error) { ctx.skip(`inbox · ${chat.client}`, error instanceof Error ? error.message : String(error)); }
  }
}

async function ensureLabels(ctx: InboxSeedContext) {
  const ids = new Map<string, string>();
  for (const label of LABELS) {
    try {
      const saved = await ctx.inbox.createLabel(ctx.owner, ctx.workspaceId, label) as { id: string; idempotentReplay?: boolean };
      ids.set(label.name, saved.id);
      if (saved.idempotentReplay) ctx.kept(`inbox label · ${label.name}`); else ctx.made(`inbox label · ${label.name}`);
    } catch {
      // The firm already has this label in another colour: use it as it is.
      const existing = await ctx.transaction((db) => db.query<{ id: string }>(`SELECT id FROM crm_conversation_labels WHERE workspace_id = $1 AND lower(btrim(name)) = lower($2) AND status = 'active'`, [ctx.workspaceId, label.name]));
      if (existing.rows[0]) { ids.set(label.name, existing.rows[0].id); ctx.kept(`inbox label · ${label.name}`); }
    }
  }
  return ids;
}

async function ensureTemplates(ctx: InboxSeedContext) {
  const w = ctx.workspaceId;
  const ids = new Map<string, { id: string; body: string; sources: string[] }>();
  await ctx.transaction(async (db) => {
    const locale = (await db.query<{ locale: string }>(`SELECT split_part(coalesce(nullif(default_locale, ''), 'en'), '-', 1) AS locale FROM workspaces WHERE id = $1`, [w])).rows[0]?.locale ?? "en";
    for (const template of TEMPLATES) {
      const positions = [...new Set([...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1]))];
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO notification_templates (id, workspace_id, code, channel, locale, version_number, status, body_template, variables, provider_status, provider_reason,
                provider_category, provider_quality, provider_submitted_at, provider_synced_at, approved_at)
         VALUES ($1, $2, $3, 'whatsapp', $4, 1, $5, $6, $7, $8, $9, $10, $11, now() - interval '3 days', now() - interval '1 day', $12)
         ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING RETURNING id`,
        [ctx.id(`template:${template.code}`), w, template.code, locale, template.state === "approved" ? "approved" : "draft", template.body, JSON.stringify(positions),
          template.state, template.reason ?? null, template.category, template.state === "approved" ? "green" : null, template.state === "approved" ? new Date(Date.now() - 2 * 86_400_000) : null]);
      const row = inserted.rows[0] ?? (await db.query<{ id: string }>(`SELECT id FROM notification_templates WHERE workspace_id = $1 AND channel = 'whatsapp' AND code = $2 ORDER BY version_number DESC LIMIT 1`, [w, template.code])).rows[0];
      if (inserted.rowCount) ctx.made(`WhatsApp template · ${template.code} (${template.state})`); else ctx.kept(`WhatsApp template · ${template.code}`);
      // Which field fills each {{n}}, so an approved one sends from a chat without typing.
      for (const [index, source] of (template.sources ?? []).entries()) {
        await db.query(`INSERT INTO crm_template_variables (workspace_id, channel, template_code, position, source, updated_by) VALUES ($1, 'whatsapp', $2, $3, $4, $5)
          ON CONFLICT DO NOTHING`, [w, template.code, index + 1, source, ctx.owner.userId]);
      }
      if (row) ids.set(template.code, { id: row.id, body: template.body, sources: template.sources ?? [] });
    }
  });
  return ids;
}

/** Greeting and away message on (with the starter wording unless the firm wrote its own); returns the greeting text. */
async function ensureAutoReplies(ctx: InboxSeedContext) {
  const current = await ctx.inbox.autoReplies(ctx.owner, ctx.workspaceId);
  const workspace = current.workspace;
  if (workspace.greeting.enabled && workspace.away.enabled) { ctx.kept("inbox · auto replies on"); return workspace.greeting.text; }
  await ctx.inbox.updateAutoReplies(ctx.owner, ctx.workspaceId, {
    version: workspace.version, greetingEnabled: true, greetingText: workspace.greeting.text, greetingSilenceDays: workspace.greeting.silenceDays,
    awayEnabled: true, awayText: workspace.away.text, awayWindowHours: workspace.away.windowHours,
    workingDays: workspace.hours.workingDays, dayStart: workspace.hours.start, dayEnd: workspace.hours.end, timeZone: workspace.hours.timeZone,
  });
  ctx.made("inbox · auto replies on (greeting and away message)");
  return workspace.greeting.text;
}

async function seedChat(ctx: InboxSeedContext, chat: Chat, labels: Map<string, string>, templates: Map<string, { id: string; body: string; sources: string[] }>, greeting: string) {
  const w = ctx.workspaceId;
  const conversationId = ctx.id(`chat:${chat.key}`);
  const label = `inbox chat · ${chat.client} (${chat.state})`;
  const people = new Map<StaffRole, Staff>();
  for (const role of new Set<StaffRole>([chat.owner, ...chat.lines.flatMap((line) => line.from === "note" ? [line.by] : ["sales", "salesAdmin", "manager", "projectManager", "finance"].includes(line.from) ? [line.from as StaffRole] : [])])) people.set(role, await ctx.staff(role));
  await ctx.transaction(async (db) => {
    if ((await db.query(`SELECT 1 FROM crm_conversations WHERE workspace_id = $1 AND id = $2`, [w, conversationId])).rowCount) { ctx.kept(label); return; }
    const client = (await db.query<{ partyId: string; leadId: string | null; projectId: string | null; chats: number }>(
      `SELECT party.id AS "partyId",
              (SELECT lead.id FROM crm_leads lead WHERE lead.workspace_id = party.workspace_id AND lead.party_id = party.id ORDER BY lead.created_at DESC LIMIT 1) AS "leadId",
              (SELECT project.id FROM delivery_projects project JOIN pre_project_cases pc ON pc.workspace_id = project.workspace_id AND pc.id = project.case_id
                 JOIN crm_opportunities opportunity ON opportunity.workspace_id = pc.workspace_id AND opportunity.id = pc.opportunity_id
                WHERE project.workspace_id = party.workspace_id AND opportunity.party_id = party.id ORDER BY project.created_at DESC LIMIT 1) AS "projectId",
              (SELECT count(*)::int FROM crm_conversations chat WHERE chat.workspace_id = party.workspace_id AND chat.party_id = party.id AND chat.channel = 'whatsapp') AS chats
         FROM crm_parties party
         JOIN crm_contact_points contact ON contact.workspace_id = party.workspace_id AND contact.party_id = party.id AND contact.type = 'phone' AND contact.status = 'active'
        WHERE party.workspace_id = $1 AND party.status = 'active' AND (contact.normalized_value = $2 OR contact.raw_value = $2)
        ORDER BY (party.display_name = $3) DESC, party.created_at LIMIT 1`, [w, chat.mobile, chat.client])).rows[0];
    if (!client) { ctx.skip(label, "the showcase hasn't created this client yet"); return; }
    if (client.chats) { ctx.skip(label, "this client already has a WhatsApp chat"); return; }
    const owner = people.get(chat.owner)!;
    const first = hoursAgo(Math.max(...chat.lines.map((line) => line.at)));
    const last = hoursAgo(Math.min(...chat.lines.map((line) => line.at)));
    /** `reply` marks a person's answer (automatic messages don't end the client's wait). */
    const messages: Array<{ id: string; at: Date; direction: "inbound" | "outbound" | "internal"; reply?: boolean }> = [];
    await db.query(
      `INSERT INTO crm_conversations (id, workspace_id, party_id, lead_id, channel, subject, status, owner_membership_id, assigned_at, created_at)
       VALUES ($1, $2, $3, $4, 'whatsapp', $5, 'open', $6, $7, $7)`,
      [conversationId, w, client.partyId, client.leadId, chat.subject, owner.membershipId, first]);
    await db.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'party', $3) ON CONFLICT DO NOTHING`, [w, conversationId, client.partyId]);
    if (owner.membershipId) await db.query(`INSERT INTO crm_conversation_events (workspace_id, conversation_id, kind, actor_user_id, owner_membership_id, method, created_at) VALUES ($1, $2, 'assigned', NULL, $3, 'queue', $4)`,
      [w, conversationId, owner.membershipId, later(first, 1)]);
    for (const [index, line] of chat.lines.entries()) {
      const id = ctx.id(`message:${chat.key}:${index}`);
      const at = hoursAgo(line.at);
      const seed = { seed: "showcase" };
      if (line.from === "client") {
        await db.query(
          `INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, provider_message_id, body_text, metadata, created_at)
           VALUES ($1, $2, $3, 'inbound', 'delivered', 'provider', 'provider', $4, $5, $6, $7)`,
          [id, w, conversationId, `showcase:inbox:${chat.key}:${index}`, line.text, { ...seed, provider: "whatsapp", messageType: line.file?.kind ?? "text", ...(line.file ? { fileName: line.file.name } : {}) }, at]);
        messages.push({ id, at, direction: "inbound" });
      } else if (line.from === "note") {
        const by = people.get(line.by)!;
        await db.query(`INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, sender_id, body_text, metadata, created_at)
          VALUES ($1, $2, $3, 'internal', 'sent', 'human', 'user', $4, $5, $6, $7)`, [id, w, conversationId, by.userId, line.text, seed, at]);
        messages.push({ id, at, direction: "internal" });
      } else if (line.from === "auto_reply") {
        const inbound = [...messages].reverse().find((message) => message.direction === "inbound");
        const values = await resolveTemplateSources(db, { workspaceId: w, partyId: client.partyId, leadId: client.leadId, staffUserId: null }, ["contact.first_name", "contact.name", "business.name"]);
        await db.query(`INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, body_text, metadata, sent_at, delivered_at, read_at, created_at)
          VALUES ($1, $2, $3, 'outbound', 'read', 'automation', 'system', $4, $5, $6, $6, $6, $6)`,
          [id, w, conversationId, renderAutoReply(greeting, values), { ...seed, automatic: "auto_reply", autoReply: "greeting", inReplyTo: inbound?.id ?? null, eventKey: `auto_reply:showcase:${chat.key}` }, at]);
        if (inbound) await db.query(`INSERT INTO crm_auto_replies (workspace_id, conversation_id, inbound_message_id, reply_message_id, kind, created_at) VALUES ($1, $2, $3, $4, 'greeting', $5) ON CONFLICT DO NOTHING`,
          [w, conversationId, inbound.id, id, at]);
        messages.push({ id, at, direction: "outbound" });
      } else if (line.from === "reminder") {
        const template = templates.get(line.template);
        // Due two days after the reminder, written in the workspace's own locale and time zone.
        const values = await resolveTemplateSources(db, { workspaceId: w, partyId: client.partyId, leadId: client.leadId, staffUserId: null, record: { projectId: client.projectId },
          now: hoursAgo(line.at - 48) }, ["contact.first_name", "project.name", "today.date"]);
        const parameters = [values["contact.first_name"] ?? "", values["project.name"] ?? chat.subject, values["today.date"] ?? ""];
        await db.query(`INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, body_text, metadata, sent_at, delivered_at, read_at, created_at)
          VALUES ($1, $2, $3, 'outbound', 'read', 'automation', 'system', $4, $5, $6, $6, $6, $6)`,
          [id, w, conversationId, renderTemplate(template?.body ?? "{{1}}", parameters), { ...seed, automatic: "payments.reminder", eventKey: `payments.reminder:showcase:${chat.key}`,
            ...(template ? { template: { id: template.id, code: line.template, parameters } } : {}) }, at]);
        messages.push({ id, at, direction: "outbound" });
      } else {
        const by = people.get(line.from)!;
        const status = line.status ?? "read";
        await db.query(`INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, sender_id, body_text, metadata, sent_at, delivered_at, read_at, created_at)
          VALUES ($1, $2, $3, 'outbound', $4, 'human', 'user', $5, $6, $7, $8, $9, $10, $8)`,
          [id, w, conversationId, status, by.userId, line.text, seed, at, status === "sent" ? null : later(at, 1), status === "read" ? later(at, 5) : null]);
        messages.push({ id, at, direction: "outbound", reply: true });
      }
    }
    for (const [index, name] of chat.labels.entries()) {
      const labelId = labels.get(name);
      if (!labelId) continue;
      const at = later(first, 2 + index);
      await db.query(`INSERT INTO crm_conversation_label_links (workspace_id, conversation_id, label_id, added_by, added_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [w, conversationId, labelId, owner.userId, at]);
      await db.query(`INSERT INTO crm_conversation_events (workspace_id, conversation_id, kind, actor_user_id, label_id, method, created_at) VALUES ($1, $2, 'labelled', $3, $4, 'manual', $5)`, [w, conversationId, owner.userId, labelId, at]);
    }
    // The chat's state: what the client is waiting on, what the team hasn't read, snoozed or resolved.
    const inbound = messages.filter((message) => message.direction === "inbound");
    const lastReply = messages.filter((message) => message.reply).at(-1);
    const unanswered = inbound.filter((message) => !lastReply || message.at > lastReply.at);
    const snoozedUntil = chat.state === "snoozed" ? new Date(Date.now() + (chat.snoozeFor ?? 16) * 3_600_000) : null;
    await db.query(
      `UPDATE crm_conversations SET status = $3, snoozed_until = $4, resolved_at = $5, waiting_since = $6, unread_count = $7,
              last_message_at = $8, last_inbound_at = $9, version = version + 1
        WHERE workspace_id = $1 AND id = $2`,
      [w, conversationId, chat.state, snoozedUntil, chat.state === "closed" ? later(last, 30) : null, chat.state === "closed" ? null : unanswered[0]?.at ?? null,
        chat.unread ? unanswered.length : 0, messages.filter((message) => message.direction !== "internal").at(-1)?.at ?? last, inbound.at(-1)?.at ?? null]);
    if (chat.state === "snoozed") await db.query(`INSERT INTO crm_conversation_events (workspace_id, conversation_id, kind, actor_user_id, snoozed_until, method, created_at) VALUES ($1, $2, 'snoozed', $3, $4, 'manual', $5)`, [w, conversationId, owner.userId, snoozedUntil, later(last, 1)]);
    if (chat.state === "closed") await db.query(`INSERT INTO crm_conversation_events (workspace_id, conversation_id, kind, actor_user_id, method, created_at) VALUES ($1, $2, 'resolved', $3, 'manual', $4)`, [w, conversationId, owner.userId, later(last, 30)]);
    ctx.made(label);
  });
}
