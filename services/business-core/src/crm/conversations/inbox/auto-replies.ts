import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../../../audit/record-audit";
import { readCalendar } from "../../../project-core/work-calendar";
import {
  AUTO_REPLY_FIELDS, decideAutoReply, DEFAULT_AWAY_TEXT, DEFAULT_AWAY_WINDOW_HOURS, DEFAULT_GREETING_TEXT, DEFAULT_SILENCE_DAYS, FALLBACK_DAY,
  renderAutoReply, validTimeZone, type AutoReplyDecision, type AutoReplyKind, type AutoReplyRule, type BusinessHours,
} from "./auto-reply-rules";
import { resolveTemplateSources } from "./template-variables";

type Db = Pick<PoolClient, "query">;

/** One scope's settings as stored: the workspace's (connectionId null) or one WhatsApp number's override. */
export type AutoReplySettings = {
  connectionId: string | null;
  greeting: { enabled: boolean; text: string; silenceDays: number };
  away: { enabled: boolean; text: string; windowHours: number };
  /** Null values follow the workspace (its work calendar, else its region pack, and its time zone). */
  hours: { workingDays: number[] | null; start: string | null; end: string | null; timeZone: string | null };
  version: number;
};

const COLUMNS = `connection_id AS "connectionId", greeting_enabled AS "greetingEnabled", greeting_text AS "greetingText",
  greeting_silence_days AS "silenceDays", away_enabled AS "awayEnabled", away_text AS "awayText", away_window_hours AS "windowHours",
  working_days AS "workingDays", to_char(day_start, 'HH24:MI') AS "start", to_char(day_end, 'HH24:MI') AS "end", time_zone AS "timeZone", version`;

type Row = {
  connectionId: string | null; greetingEnabled: boolean; greetingText: string; silenceDays: number; awayEnabled: boolean; awayText: string;
  windowHours: number; workingDays: number[] | null; start: string | null; end: string | null; timeZone: string | null; version: number;
};

const toSettings = (row: Row): AutoReplySettings => ({
  connectionId: row.connectionId,
  greeting: { enabled: row.greetingEnabled, text: row.greetingText, silenceDays: Number(row.silenceDays) },
  away: { enabled: row.awayEnabled, text: row.awayText, windowHours: Number(row.windowHours) },
  hours: { workingDays: row.workingDays?.map(Number) ?? null, start: row.start, end: row.end, timeZone: row.timeZone },
  version: Number(row.version),
});

/** A workspace that never saved its auto replies: both off, with starter wording ready to switch on. */
export function defaultAutoReplySettings(connectionId: string | null = null): AutoReplySettings {
  return {
    connectionId,
    greeting: { enabled: false, text: DEFAULT_GREETING_TEXT, silenceDays: DEFAULT_SILENCE_DAYS },
    away: { enabled: false, text: DEFAULT_AWAY_TEXT, windowHours: DEFAULT_AWAY_WINDOW_HOURS },
    hours: { workingDays: null, start: null, end: null, timeZone: null },
    version: 0,
  };
}

/** Every saved scope: the workspace's settings first (or the defaults), then each number's override. */
export async function readAutoReplyScopes(db: Db, workspaceId: string) {
  const rows = (await db.query<Row>(`SELECT ${COLUMNS} FROM crm_auto_reply_settings WHERE workspace_id = $1 ORDER BY connection_id NULLS FIRST, created_at`, [workspaceId])).rows;
  const workspace = rows.find((row) => !row.connectionId);
  return { workspace: workspace ? toSettings(workspace) : defaultAutoReplySettings(), numbers: rows.filter((row) => row.connectionId).map(toSettings) };
}

/**
 * What an unset hour means for this workspace: the work calendar's week (else the region pack's), the calendar's
 * start and end of day, and the workspace's time zone (else the region pack's, else UTC).
 */
export async function workspaceHours(db: Db, workspaceId: string) {
  const calendar = await readCalendar(db, workspaceId);
  const facts = (await db.query<{ timeZone: string | null; regionTimeZone: string | null; calendarTimeZone: string | null; start: string | null; end: string | null }>(
    `SELECT workspace.default_timezone AS "timeZone", profile.configuration->>'timezone' AS "regionTimeZone",
            calendar.timezone AS "calendarTimeZone", to_char(calendar.day_start, 'HH24:MI') AS start, to_char(calendar.day_end, 'HH24:MI') AS "end"
       FROM workspaces workspace
       LEFT JOIN LATERAL (SELECT configuration FROM tenant_setup_profiles WHERE kind = 'region' AND code = upper(split_part(workspace.default_locale, '-', 2))
                           ORDER BY version DESC LIMIT 1) profile ON true
       LEFT JOIN LATERAL (SELECT own.timezone, own.day_start, own.day_end FROM hrms_calendars own
                            LEFT JOIN hrms_settings settings ON settings.workspace_id = own.workspace_id
                           WHERE own.workspace_id = workspace.id
                           ORDER BY (own.id = settings.default_calendar_id) DESC NULLS LAST, own.created_at, own.id LIMIT 1) calendar ON true
      WHERE workspace.id = $1`, [workspaceId])).rows[0];
  return {
    workingDays: [...calendar.workingDays].map(Number).sort((a, b) => a - b),
    holidays: calendar.holidays.map((day) => String(day).slice(0, 10)),
    start: facts?.start ?? FALLBACK_DAY.start,
    end: facts?.end ?? FALLBACK_DAY.end,
    timeZone: validTimeZone(facts?.timeZone) ?? validTimeZone(facts?.calendarTimeZone) ?? validTimeZone(facts?.regionTimeZone) ?? "UTC",
  };
}

/** The rule for a message to one number: that number's override when it has one, else the workspace's. */
export async function autoReplyRule(db: Db, workspaceId: string, connectionId: string | null): Promise<{ rule: AutoReplyRule; settings: AutoReplySettings } | null> {
  const rows = (await db.query<Row>(
    `SELECT ${COLUMNS} FROM crm_auto_reply_settings WHERE workspace_id = $1 AND (connection_id IS NULL OR connection_id = $2::uuid)
      ORDER BY (connection_id IS NULL) LIMIT 1`, [workspaceId, connectionId])).rows;
  if (!rows.length) return null;
  const settings = toSettings(rows[0]);
  if (!settings.greeting.enabled && !settings.away.enabled) return { rule: { greeting: settings.greeting, away: settings.away, hours: { timeZone: "UTC", workingDays: [], start: FALLBACK_DAY.start, end: FALLBACK_DAY.end } }, settings };
  const fallback = await workspaceHours(db, workspaceId);
  const custom = Boolean(settings.hours.start && settings.hours.end);
  const hours: BusinessHours = {
    timeZone: validTimeZone(settings.hours.timeZone) ?? fallback.timeZone,
    workingDays: settings.hours.workingDays ?? fallback.workingDays,
    start: custom ? settings.hours.start! : fallback.start,
    end: custom ? settings.hours.end! : fallback.end,
    // The work calendar's holidays count when the week is the calendar's own.
    holidays: settings.hours.workingDays ? [] : fallback.holidays,
  };
  return { rule: { greeting: settings.greeting, away: settings.away, hours }, settings };
}

export type AutoReplyResult =
  | { sent: true; kind: AutoReplyKind; messageId: string; duplicate: boolean }
  | { sent: false; reason: Extract<AutoReplyDecision, { send: false }>["reason"] | "off" | "no_client" | "not_connected" | "number_blocked" | "no_consent" | "no_phone" | "empty" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * After a client's WhatsApp message is stored: the greeting or the away message, when one is due, as free text
 * (the client just wrote, so WhatsApp's 24-hour window is open). It goes the same way as a person's reply: a
 * queued message in the chat, marked as an auto reply, and a notification the delivery worker sends (so the
 * delivery allowlist and receipts apply). Once per client message; never to a blocked or spam number, and not
 * while a teammate is talking to the client.
 */
export async function sendAutoReply(db: Db, input: {
  workspaceId: string; conversation: Record<string, unknown>; inboundMessageId: string; metadata?: Record<string, unknown> | null; now?: Date;
}): Promise<AutoReplyResult> {
  const { workspaceId, conversation, inboundMessageId } = input;
  const now = input.now ?? new Date();
  const conversationId = String(conversation.id);
  const partyId = (conversation.party_id as string | null) ?? null;
  if (conversation.channel !== "whatsapp") return { sent: false, reason: "channel" };
  if (!partyId) return { sent: false, reason: "no_client" };
  const connectionId = typeof input.metadata?.connectionId === "string" && UUID.test(input.metadata.connectionId) ? input.metadata.connectionId : null;
  const found = await autoReplyRule(db, workspaceId, connectionId);
  if (!found || (!found.settings.greeting.enabled && !found.settings.away.enabled)) return { sent: false, reason: "off" };

  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`auto-reply:${workspaceId}:${conversationId}`]);
  const facts = (await db.query<{
    blocked: boolean; spam: boolean; answered: boolean; previous: Date | null; human: Date | null; away: Date | null;
  }>(
    `SELECT party.blocked_at IS NOT NULL AS blocked, party.spam_at IS NOT NULL AS spam,
            EXISTS (SELECT 1 FROM crm_auto_replies WHERE workspace_id = $1 AND inbound_message_id = $3) AS answered,
            (SELECT max(created_at) FROM crm_messages WHERE workspace_id = $1 AND conversation_id = $2 AND id <> $3
                AND direction IN ('inbound', 'outbound')) AS previous,
            (SELECT max(created_at) FROM crm_messages WHERE workspace_id = $1 AND conversation_id = $2 AND direction = 'outbound'
                AND (authorship = 'human' OR metadata->>'sentFromPhone' = 'true')) AS human,
            (SELECT max(created_at) FROM crm_auto_replies WHERE workspace_id = $1 AND conversation_id = $2 AND kind = 'away') AS away
       FROM crm_parties party WHERE party.workspace_id = $1 AND party.id = $4`,
    [workspaceId, conversationId, inboundMessageId, partyId])).rows[0];
  if (!facts) return { sent: false, reason: "no_client" };
  const decision = decideAutoReply(found.rule, {
    now, channel: "whatsapp", direction: "inbound", messageType: typeof input.metadata?.messageType === "string" ? input.metadata.messageType : null,
    blocked: facts.blocked, spam: facts.spam, alreadyAnswered: facts.answered,
    previousActivityAt: facts.previous ? new Date(facts.previous) : null, lastHumanReplyAt: facts.human ? new Date(facts.human) : null, lastAwayAt: facts.away ? new Date(facts.away) : null,
  });
  if (!decision.send) return { sent: false, reason: decision.reason };

  // The same gates as a person's reply: a connected number Meta hasn't stopped, the client's consent and a phone.
  const number = (await db.query<{ state: string | null }>(
    `SELECT configuration->'health'->>'state' AS state FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected'
      ORDER BY (id = $2::uuid) DESC, COALESCE((configuration->>'isDefault')::boolean, false) DESC, updated_at DESC LIMIT 1`, [workspaceId, connectionId])).rows[0];
  // A demonstration chat answers without a number: the reply shows as sent and nothing reaches Meta.
  const demo = typeof conversation.provider_thread_id === "string" && conversation.provider_thread_id.startsWith("demo:");
  if (!number && !demo) return { sent: false, reason: "not_connected" };
  if (number?.state === "blocked" && !demo) return { sent: false, reason: "number_blocked" };
  const consent = (await db.query<{ status: string; expiresAt: Date | null }>(
    `SELECT status, expires_at AS "expiresAt" FROM crm_consents WHERE workspace_id = $1 AND party_id = $2 AND channel IN ('whatsapp', 'all') AND purpose = 'service'
      ORDER BY captured_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0];
  if (!consent || consent.status !== "granted" || (consent.expiresAt && new Date(consent.expiresAt) <= now)) return { sent: false, reason: "no_consent" };
  const phone = await db.query(`SELECT 1 FROM crm_contact_points WHERE workspace_id = $1 AND party_id = $2 AND type = 'phone' AND status = 'active' LIMIT 1`, [workspaceId, partyId]);
  if (!phone.rowCount) return { sent: false, reason: "no_phone" };

  const kind = decision.kind;
  const values = await resolveTemplateSources(db, { workspaceId, partyId, leadId: (conversation.lead_id as string | null) ?? null, staffUserId: null }, AUTO_REPLY_FIELDS);
  const body = renderAutoReply(kind === "greeting" ? found.rule.greeting.text : found.rule.away.text, values);
  if (!body) return { sent: false, reason: "empty" };

  const messageId = randomUUID();
  const eventKey = `auto_reply:${inboundMessageId}`;
  const inserted = await db.query(
    `INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, sender_id, body_text, metadata)
     VALUES ($1, $2, $3, 'outbound', ${demo ? "'sent'" : "'queued'"}, 'automation', 'system', NULL, $4, $5)
     ON CONFLICT (workspace_id, (metadata->>'eventKey')) WHERE metadata ? 'eventKey' DO NOTHING RETURNING id`,
    [messageId, workspaceId, conversationId, body, { automatic: "auto_reply", autoReply: kind, inReplyTo: inboundMessageId, eventKey, ...(connectionId ? { connectionId } : {}) }]);
  if (!inserted.rowCount) {
    const prior = (await db.query<{ id: string }>(`SELECT id FROM crm_messages WHERE workspace_id = $1 AND metadata ? 'eventKey' AND metadata->>'eventKey' = $2`, [workspaceId, eventKey])).rows[0];
    return { sent: true, kind, messageId: prior?.id ?? messageId, duplicate: true };
  }
  await db.query(`INSERT INTO crm_auto_replies (workspace_id, conversation_id, inbound_message_id, reply_message_id, kind) VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, conversationId, inboundMessageId, messageId, kind]);
  // An auto reply is not a person's answer: the client's wait keeps running.
  await db.query(`UPDATE crm_conversations SET last_message_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId]);
  if (demo) return { sent: true, kind, messageId, duplicate: false };
  const notificationId = randomUUID();
  await db.query(
    `INSERT INTO notifications (id, workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, idempotency_key, correlation_id)
     VALUES ($1, $2, NULL, 'party', $3, 'whatsapp', 'crm.inbox.auto_reply', 'pending', now(), $4, $5, $6, gen_random_uuid())`,
    [notificationId, workspaceId, partyId, conversation.subject ?? null, body, `message:${messageId}`]);
  await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "notification.delivery_requested.v1", entityType: "notification", entityId: notificationId,
    after: { messageId, channel: "whatsapp", partyId, event: "crm.inbox.auto_reply", kind } });
  await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "crm.inbox.auto_reply.sent.v1", entityType: "crm_message", entityId: messageId,
    after: { conversationId, inboundMessageId, kind, connectionId } });
  return { sent: true, kind, messageId, duplicate: false };
}
