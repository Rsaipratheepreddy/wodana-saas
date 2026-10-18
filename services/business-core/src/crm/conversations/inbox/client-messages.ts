import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../../../audit/record-audit";
import { readProjectAccess } from "../../../client-portal/portal-settings";
import { firstName, normalizeTemplateParameter, renderTemplate, TEMPLATE_SOURCE_NAMES, templatePlaceholders, type TemplateVariableSource } from "./inbox-rules";
import { CLOSING_TEMPLATE_CODES, closingCompany, closingFieldsOf, readClosingSettings, renderClosing } from "./closing-messages";
import { resolveTemplateSources, type TemplateContext } from "./template-variables";
import { starterForEvent, startersForEvent, type StarterEvent } from "./whatsapp-starter-pack";
import { clientDailyGate } from "../../../reminders/delivery/client-gate";

type Db = Pick<PoolClient, "query">;
type Config = { get(key: string): unknown };

/** Business events that can message the client, in the order Settings → Inbox lists them (the client's journey). */
export const CLIENT_EVENTS: StarterEvent[] = [
  "crm.enquiry.created", "crm.meeting.booked", "crm.meeting.reminder", "crm.enquiry.quiet",
  "portal.quote_issued", "commercial.quote_follow_up", "crm.opportunity.won",
  "portal.invoice_issued", "receivables.payment_received", "portal.decision_waiting", "portal.update_published",
  "project.stage_started", "payments.reminder", "project.handover_thanks",
];

/** Events that also go by email (to the portal contacts) when WhatsApp can't carry them. */
export const EMAIL_FALLBACK = new Set<StarterEvent>(["portal.quote_issued", "portal.invoice_issued", "portal.decision_waiting", "portal.update_published", "payments.reminder"]);

export type ClientMessageResult =
  | { sent: true; messageId: string; conversationId: string; duplicate: boolean }
  | { sent: false; reason: "no_client" | "off" | "blocked" | "not_connected" | "no_consent" | "no_phone" | "template_not_approved" | "paused" | "value_missing" | "capped"; field?: string };

/** An automatic reminder to the client claims the day's one client reminder (plan §6.24a); a transactional notice doesn't. */
export type ClientGateClaim = { key: string; priority: number };

const SOURCE_NAMES = TEMPLATE_SOURCE_NAMES;

/** The rule for an event: on, with the starter template, unless the firm changed it. */
export async function clientMessageRule(db: Db, workspaceId: string, event: StarterEvent) {
  const row = (await db.query<{ enabled: boolean; templateCode: string | null; version: number }>(
    `SELECT enabled, template_code AS "templateCode", version FROM crm_client_message_rules WHERE workspace_id = $1 AND event = $2`, [workspaceId, event])).rows[0];
  return { enabled: row ? row.enabled : true, templateCode: row?.templateCode ?? starterForEvent(event)?.name ?? null, chosen: Boolean(row?.templateCode), version: row?.version ?? 0 };
}

/** The approved template to send for a code: the client's language, then the workspace's, then any approved one. */
export async function approvedTemplate(db: Db, workspaceId: string, code: string, languages: string[]) {
  const result = await db.query<{ id: string; locale: string; body: string }>(
    `SELECT DISTINCT ON (locale) id, locale, body_template AS body FROM notification_templates
      WHERE workspace_id = $1 AND channel = 'whatsapp' AND code = $2 AND status = 'approved' AND COALESCE(provider_status, 'approved') = 'approved'
      ORDER BY locale, version_number DESC`, [workspaceId, code]);
  const rank = (locale: string) => { const index = languages.indexOf(locale.split(/[_-]/)[0].toLowerCase()); return index < 0 ? languages.length : index; };
  return [...result.rows].sort((a, b) => rank(a.locale) - rank(b.locale))[0] ?? null;
}

/**
 * Messages the client about a business event on WhatsApp with the firm's approved template, filled from the
 * event's record, and puts it in the client's chat marked Automatic. Never without the client's WhatsApp consent,
 * an approved template or a connected number; once per event, record and client. The caller falls back to email.
 */
export async function sendClientEvent(db: Db, input: {
  workspaceId: string; event: StarterEvent; partyId: string | null; recordKey: string;
  leadId?: string | null; record?: TemplateContext["record"]; config?: Config; actorUserId?: string | null;
  /** An automatic reminder (a quiet-enquiry nudge): at most one client reminder per day goes, the rest are "capped". */
  gate?: ClientGateClaim;
}): Promise<ClientMessageResult> {
  const { workspaceId, event, partyId } = input;
  if (!partyId) return { sent: false, reason: "no_client" };
  const rule = await clientMessageRule(db, workspaceId, event);
  if (!rule.enabled || !rule.templateCode) return { sent: false, reason: "off" };
  const party = (await db.query<{ blocked: boolean; locale: string | null; workspaceLocale: string }>(
    `SELECT (party.blocked_at IS NOT NULL OR party.spam_at IS NOT NULL) AS blocked, party.preferred_locale AS locale, workspace.default_locale AS "workspaceLocale"
       FROM crm_parties party JOIN workspaces workspace ON workspace.id = party.workspace_id WHERE party.workspace_id = $1 AND party.id = $2`,
    [workspaceId, partyId])).rows[0];
  if (!party) return { sent: false, reason: "no_client" };
  if (party.blocked) return { sent: false, reason: "blocked" };
  const connected = await db.query(`SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected' LIMIT 1`, [workspaceId]);
  if (!connected.rowCount) return { sent: false, reason: "not_connected" };
  const consent = (await db.query<{ status: string; expiresAt: Date | null }>(
    `SELECT status, expires_at AS "expiresAt" FROM crm_consents WHERE workspace_id = $1 AND party_id = $2 AND channel IN ('whatsapp', 'all') AND purpose = 'service'
      ORDER BY captured_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0];
  if (!consent || consent.status !== "granted" || (consent.expiresAt && consent.expiresAt <= new Date())) return { sent: false, reason: "no_consent" };
  const phone = await db.query(`SELECT 1 FROM crm_contact_points WHERE workspace_id = $1 AND party_id = $2 AND type = 'phone' AND status = 'active' LIMIT 1`, [workspaceId, partyId]);
  if (!phone.rowCount) return { sent: false, reason: "no_phone" };
  if (input.record?.projectId && (await readProjectAccess(db, workspaceId, input.record.projectId)).paused) return { sent: false, reason: "paused" };
  const languages = [party.locale, party.workspaceLocale, "en"].filter((value): value is string => Boolean(value)).map((value) => value.split(/[_-]/)[0].toLowerCase());

  const eventKey = `${event}:${input.recordKey}:${partyId}`.slice(0, 300);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${workspaceId}:${eventKey}`]);
  const prior = (await db.query<{ id: string; conversationId: string }>(
    `SELECT id, conversation_id AS "conversationId" FROM crm_messages WHERE workspace_id = $1 AND metadata ? 'eventKey' AND metadata->>'eventKey' = $2`, [workspaceId, eventKey])).rows[0];
  if (prior) return { sent: true, messageId: prior.id, conversationId: prior.conversationId, duplicate: true };

  // The firm's chosen template, else the starter templates for the event in order: the first that is approved and
  // whose every value the record has (a visit with its address, else without it).
  // PLM-137: a new enquiry's welcome is the inbox's closing message "We have everything": its own template first.
  const welcome = event === "crm.enquiry.created";
  const codes = rule.chosen ? [rule.templateCode] : [...new Set([...(welcome ? [CLOSING_TEMPLATE_CODES.received] : []), rule.templateCode, ...startersForEvent(event).map((starter) => starter.name)])];
  let chosen: { code: string; template: { id: string; body: string }; parameters: string[] } | null = null;
  let missing: Extract<ClientMessageResult, { sent: false }> | null = null;
  for (const code of codes) {
    const template = await approvedTemplate(db, workspaceId, code, [...new Set(languages)]);
    if (!template) continue;
    const filled = await fillEventTemplate(db, { ...input, partyId }, code, template.body);
    if ("field" in filled) { missing ??= { sent: false, reason: "value_missing", field: filled.field }; continue; }
    chosen = { code, template, parameters: filled.parameters };
    break;
  }
  // PLM-137: no approved template yet, but the client wrote to us on WhatsApp in the last 24 hours: the welcome goes as
  // the firm's own text of "We have everything", which WhatsApp allows inside that window.
  const freeText = !chosen && welcome ? await welcomeInWindow(db, workspaceId, partyId) : null;
  if (!chosen && !freeText) return missing ?? { sent: false, reason: "template_not_approved" };
  // Only a message that can go claims the day's one client reminder.
  if (input.gate && !(await clientDailyGate(db, workspaceId, { partyId, priority: input.gate.priority, key: input.gate.key })).allowed) return { sent: false, reason: "capped" };
  const template = chosen?.template ?? null;
  const parameters = chosen?.parameters ?? [];
  const body = chosen ? renderTemplate(chosen.template.body, chosen.parameters) : freeText!;

  const found = (await db.query<{ id: string }>(
    `SELECT id FROM crm_conversations WHERE workspace_id = $1 AND party_id = $2 AND channel = 'whatsapp'
      ORDER BY (provider_thread_id IS NOT NULL) DESC, last_message_at DESC NULLS LAST, created_at DESC LIMIT 1 FOR UPDATE`, [workspaceId, partyId])).rows[0];
  let conversationId = found?.id;
  if (!conversationId) {
    conversationId = randomUUID();
    await db.query(`INSERT INTO crm_conversations (id, workspace_id, party_id, lead_id, channel, subject) VALUES ($1, $2, $3, $4, 'whatsapp', 'WhatsApp conversation')`, [conversationId, workspaceId, partyId, input.leadId ?? null]);
    await db.query(`INSERT INTO crm_conversation_participants (workspace_id, conversation_id, participant_type, participant_id) VALUES ($1, $2, 'party', $3) ON CONFLICT DO NOTHING`, [workspaceId, conversationId, partyId]);
  }
  const messageId = randomUUID();
  await db.query(
    `INSERT INTO crm_messages (id, workspace_id, conversation_id, direction, status, authorship, sender_type, sender_id, body_text, metadata)
     VALUES ($1, $2, $3, 'outbound', 'queued', 'automation', 'system', NULL, $4, $5)`,
    [messageId, workspaceId, conversationId, body, { automatic: event, eventKey, ...(chosen && template ? { template: { id: template.id, code: chosen.code, parameters } } : {}) }]);
  // An automatic message is not a reply: the client's wait keeps running.
  await db.query(`UPDATE crm_conversations SET last_message_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, conversationId]);
  const notificationId = randomUUID();
  await db.query(
    `INSERT INTO notifications (id, workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, body, idempotency_key, correlation_id, template_parameters)
     VALUES ($1, $2, $3, 'party', $4, 'whatsapp', $5, 'pending', now(), $6, $7, gen_random_uuid(), $8)`,
    [notificationId, workspaceId, template?.id ?? null, partyId, event, body, `message:${messageId}`, parameters]);
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId ?? null, source: "internal", action: "notification.delivery_requested.v1", entityType: "notification", entityId: notificationId,
    after: { messageId, channel: "whatsapp", partyId, event, template: chosen?.code ?? null } });
  return { sent: true, messageId, conversationId, duplicate: false };
}

/**
 * The welcome as free text ("We have everything", PLM-137) when the client wrote to us on WhatsApp in the last 24 hours;
 * null outside that window, or when the text needs a field the client hasn't got.
 */
async function welcomeInWindow(db: Db, workspaceId: string, partyId: string) {
  const open = await db.query(
    `SELECT 1 FROM crm_conversations WHERE workspace_id = $1 AND party_id = $2 AND channel = 'whatsapp' AND last_inbound_at > now() - interval '24 hours' LIMIT 1`, [workspaceId, partyId]);
  if (!open.rowCount) return null;
  const text = (await readClosingSettings(db, workspaceId)).texts.received;
  if (closingFieldsOf(text).some((field) => field !== "name" && field !== "company")) return null;
  const party = (await db.query<{ name: string | null }>(`SELECT display_name AS name FROM crm_parties WHERE workspace_id = $1 AND id = $2`, [workspaceId, partyId])).rows[0];
  return renderClosing(text, { name: firstName(party?.name), company: await closingCompany(db, workspaceId) }) || null;
}

/** A template's {{n}} values from the event's record, by the firm's mapping; the first missing one is named. */
async function fillEventTemplate(db: Db, input: { workspaceId: string; partyId: string; leadId?: string | null; record?: TemplateContext["record"]; config?: Config }, code: string, body: string): Promise<{ parameters: string[] } | { field: string }> {
  const positions = templatePlaceholders(body);
  const mapping = await db.query<{ position: number; source: TemplateVariableSource }>(
    `SELECT position, source FROM crm_template_variables WHERE workspace_id = $1 AND channel = 'whatsapp' AND template_code = $2`, [input.workspaceId, code]);
  const sources = new Map(mapping.rows.map((row) => [Number(row.position), row.source]));
  const unmapped = positions.find((position) => !sources.has(position));
  if (unmapped) return { field: `{{${unmapped}}}` };
  const values = await resolveTemplateSources(db, { workspaceId: input.workspaceId, partyId: input.partyId, leadId: input.leadId ?? null, staffUserId: null,
    config: input.config ?? { get: (key: string) => process.env[key] }, record: input.record }, sources.values());
  const parameters: string[] = [];
  for (const position of positions) {
    const source = sources.get(position)!;
    const value = values[source];
    if (!value) return { field: SOURCE_NAMES[source] };
    parameters.push(normalizeTemplateParameter(value));
  }
  return { parameters };
}

/** A WhatsApp that couldn't go is recorded with why (and the missing field), so the firm can fix it. */
export async function recordClientMessageSkipped(db: Db, workspaceId: string, event: StarterEvent, recordKey: string, result: Extract<ClientMessageResult, { sent: false }>, fellBackToEmail: boolean) {
  if (result.reason === "off" || result.reason === "no_client") return;
  await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "crm.client_message.skipped.v1", entityType: "crm_client_message", entityId: randomUUID(),
    after: { event, recordKey, reason: result.reason, field: result.field ?? null, emailInstead: fellBackToEmail } });
}

/** The client (party) behind a pre-project case. */
export async function partyOfCase(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ partyId: string | null; leadId: string | null }>(
    `SELECT opportunity.party_id AS "partyId", opportunity.lead_id AS "leadId" FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0] ?? { partyId: null, leadId: null };
}
