import { contactEmailSql } from "../../client-portal/contact-email";
import { effectiveSections, readPortalSettings, readProjectAccess, type Section } from "../../client-portal/portal-settings";
import { portalLink } from "../../client-portal/portal-site";
import { partyOfCase, sendClientEvent } from "../../crm/conversations/inbox/client-messages";
import type { TemplateContext } from "../../crm/conversations/inbox/template-variables";
import type { StarterEvent } from "../../crm/conversations/inbox/whatsapp-starter-pack";
import { REMINDER_KIND_INFO, reminderTemplateCode, type EngineReminderKind } from "../reminders-contract";
import type { ClientDelivery, ClientDeliveryResult, Db } from "../engine/engine";
import { insertNotice, reminderNoticeKey, TemplateCache } from "./notices";

export type ClientRoute = {
  /** The client message (Settings › Inbox) the WhatsApp goes as; null = email only. */
  whatsappEvent: StarterEvent | null;
  /** The portal section the email opens (and that must be visible to the client). */
  section: Section;
  /** Only the project's decision-makers are emailed (a decision), else every contact with an email. */
  approversOnly: boolean;
  /** The WhatsApp template's values (the record the reminder is about). */
  record?: TemplateContext["record"];
};

/**
 * The default client delivery of a reminder (plan §6.24a "Channels" and "Fallback"): WhatsApp when the rule lists it
 * and the client consented, the number is connected and the template is approved (`sendClientEvent`, which writes the
 * chat message and its notice); otherwise the branded email to the portal contacts with the kind's template. A
 * WhatsApp that fails later falls back to email in the sweep's fallback pass. Nothing goes while the portal is off,
 * the project is paused in it or its section is hidden. Nobody reachable = `unreachable` (the owner is told once).
 */
export async function deliverClientDefault(db: Db, workspaceId: string, delivery: ClientDelivery, route: ClientRoute): Promise<ClientDeliveryResult> {
  const { subject } = delivery;
  if (!subject.caseId) return { status: "skipped", channel: null, notificationIds: [], reason: "no_recipient" };
  const settings = await readPortalSettings(db, workspaceId);
  const access = subject.projectId ? await readProjectAccess(db, workspaceId, subject.projectId) : null;
  if (!settings.enabled || access?.paused || !effectiveSections(settings, access)[route.section]) return { status: "skipped", channel: null, notificationIds: [], reason: "disabled" };
  let consentMissing = false;
  if (delivery.channels.includes("whatsapp") && route.whatsappEvent && !delivery.fallbackOf) {
    const party = subject.partyId ? { partyId: subject.partyId, leadId: (await partyOfCase(db, workspaceId, subject.caseId)).leadId } : await partyOfCase(db, workspaceId, subject.caseId);
    const sent = await sendClientEvent(db, { workspaceId, event: route.whatsappEvent, partyId: party.partyId, leadId: party.leadId, recordKey: delivery.idempotencyKey,
      record: { projectId: subject.projectId, ...route.record } });
    if (sent.sent) {
      const tagged = (await db.query<{ id: string }>(
        `UPDATE notifications SET reminder_step_id = $3 WHERE workspace_id = $1 AND idempotency_key = $2 AND reminder_step_id IS NULL RETURNING id`,
        [workspaceId, `message:${sent.messageId}`, delivery.stepId])).rows.map((row) => row.id);
      return { status: "queued", channel: "whatsapp", notificationIds: tagged, reason: null };
    }
    consentMissing = sent.reason === "no_consent";
  }
  if (!delivery.channels.includes("email")) return { status: "skipped", channel: null, notificationIds: [], reason: consentMissing ? "consent_missing" : "unreachable" };
  const kind = subject.kind as EngineReminderKind;
  const eventType = REMINDER_KIND_INFO[kind].eventType ?? kind;
  const contacts = (await db.query<{ id: string }>(
    `SELECT grant_row.id FROM client_portal_grants grant_row
      WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.active AND ${contactEmailSql("grant_row")} IS NOT NULL
        AND ($3::boolean = false OR grant_row.role = 'approver')
        AND coalesce((SELECT preference.enabled FROM notification_preferences preference WHERE preference.workspace_id = grant_row.workspace_id
              AND preference.recipient_type = 'portal_contact' AND preference.recipient_id = grant_row.id AND preference.channel = 'email'
              AND preference.event_type::text IN ($4::text, 'portal.*', '*')
            ORDER BY CASE WHEN preference.event_type::text = $4::text THEN 0 WHEN preference.event_type::text = '*' THEN 2 ELSE 1 END LIMIT 1), true)
      ORDER BY grant_row.created_at, grant_row.id`,
    [workspaceId, subject.caseId, route.approversOnly, eventType])).rows;
  const template = await new TemplateCache(db, workspaceId).get(reminderTemplateCode.kind(kind), "email");
  if (!contacts.length || !template) return { status: "skipped", channel: null, notificationIds: [], reason: "unreachable" };
  const link = await portalLink(db, workspaceId, settings.slug, `?project=${subject.caseId}&open=${route.section}`);
  const ids: string[] = [];
  for (const contact of contacts) {
    const id = await insertNotice(db, {
      workspaceId, template, variables: delivery.variables, recipientType: "portal_contact", recipientId: contact.id, channel: "email", eventType,
      scheduledFor: delivery.now, now: delivery.now, deepLink: link, idempotencyKey: reminderNoticeKey(delivery.stepId, contact.id, "email"),
      critical: REMINDER_KIND_INFO[kind].critical, stepId: delivery.stepId, fallbackOf: delivery.fallbackOf ?? null,
    });
    if (id) ids.push(id);
  }
  return { status: "queued", channel: "email", notificationIds: ids, reason: null };
}
