import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { portalLink } from "./portal-site";
import { effectiveSections, readPortalSettings, readProjectAccess, type Section } from "./portal-settings";

type Db = Pick<PoolClient, "query">;

/**
 * What clients are told, once per event, by email (WhatsApp once the tenant's templates are approved):
 *   quote_issued       a quotation or variation is ready          everyone on the project
 *   invoice_issued     a tax invoice was issued (payment due)     everyone on the project
 *   decision_waiting   a design, material list or handover waits  the project's decision-makers
 *   update_published   the team shared a status update            everyone on the project
 * Nothing goes out while the portal is off, the project is paused, or the section it belongs to is hidden.
 * Each email opens the portal where the thing is.
 */
export type ClientEvent = "quote_issued" | "invoice_issued" | "decision_waiting" | "update_published";

const SECTION: Record<ClientEvent, Section> = { quote_issued: "decisions", invoice_issued: "payments", decision_waiting: "decisions", update_published: "progress" };
const TEMPLATE: Record<ClientEvent, string> = {
  quote_issued: "portal.quote_issued", invoice_issued: "portal.invoice_issued", decision_waiting: "portal.decision_waiting", update_published: "portal.update_published",
};

const render = (template: string, variables: Record<string, string>) => template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => variables[key] ?? "");

/** The pre-project a delivery project was started from: client contacts are granted on it. */
export async function caseOf(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0].caseId;
}

export async function tellClients(db: Db, input: {
  workspaceId: string; caseId: string; event: ClientEvent; recordId: string; title: string; due?: string | null; note?: string; demo?: boolean;
}) {
  const settings = await readPortalSettings(db, input.workspaceId);
  if (!settings.enabled) return { queued: 0, reason: "portal_off" as const };
  const facts = (await db.query<{ projectId: string | null; project: string; company: string; locale: string }>(
    `SELECT project.id AS "projectId", coalesce(project.name, opportunity.title) AS project, coalesce(branding.display_name, workspace.name) AS company,
            workspace.default_locale AS locale
       FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN tenant_login_branding branding ON branding.workspace_id = pre_case.workspace_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [input.workspaceId, input.caseId])).rows[0];
  if (!facts) return { queued: 0, reason: "not_found" as const };
  const access = facts.projectId ? await readProjectAccess(db, input.workspaceId, facts.projectId) : null;
  if (access?.paused) return { queued: 0, reason: "paused" as const };
  const section = SECTION[input.event];
  if (!effectiveSections(settings, access)[section]) return { queued: 0, reason: "hidden" as const };
  const recipients = (await db.query<{ id: string }>(
    `SELECT id FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND active AND email IS NOT NULL AND ($3::boolean = false OR test_contact)
       AND ($4::boolean = false OR role = 'approver') ORDER BY created_at`,
    [input.workspaceId, input.caseId, input.demo ?? (process.env.PORTAL_DEMO_OTP === "true" && process.env.NODE_ENV !== "production"), input.event === "decision_waiting"])).rows;
  if (!recipients.length) return { queued: 0, reason: "no_contact" as const };
  const template = (await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
      WHERE workspace_id = $1 AND code = $2 AND channel = 'email' AND status = 'approved' AND locale = 'en' ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, TEMPLATE[input.event]])).rows[0];
  if (!template) return { queued: 0, reason: "template_missing" as const };
  let due = "";
  if (input.due) {
    try { due = `Due ${new Intl.DateTimeFormat(facts.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${input.due.slice(0, 10)}T00:00:00Z`))}.`; }
    catch { due = `Due ${input.due.slice(0, 10)}.`; }
  }
  const variables = { company: facts.company, project: facts.project, title: input.title, due, note: (input.note ?? "").slice(0, 480) };
  const link = await portalLink(db, input.workspaceId, settings.slug, `?project=${input.caseId}&open=${section}`);
  let queued = 0;
  for (const recipient of recipients) {
    const preference = (await db.query<{ enabled: boolean }>(
      `SELECT enabled FROM notification_preferences WHERE workspace_id = $1 AND recipient_type = 'portal_contact' AND recipient_id = $2 AND channel = 'email'
         AND event_type::text IN ($3::text, 'portal.*', '*') ORDER BY CASE WHEN event_type::text = $3::text THEN 0 WHEN event_type::text = '*' THEN 2 ELSE 1 END LIMIT 1`,
      [input.workspaceId, recipient.id, TEMPLATE[input.event]])).rows[0];
    if (preference?.enabled === false) continue;
    const inserted = (await db.query<{ id: string; correlationId: string }>(
      `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
       VALUES ($1, $2, 'portal_contact', $3, 'email', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid())
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING id, correlation_id AS "correlationId"`,
      [input.workspaceId, template.id, recipient.id, TEMPLATE[input.event], template.subject ? render(template.subject, variables) : null, render(template.body, variables),
        link, `${TEMPLATE[input.event]}:${input.recordId}:${recipient.id}`.slice(0, 160)])).rows[0];
    if (!inserted) continue;
    queued += 1;
    // Wake the notification worker now rather than at its next poll.
    const eventId = randomUUID();
    await db.query(
      `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, 'notification', $3, 'notification.delivery_requested.v1', $4::jsonb)`,
      [eventId, input.workspaceId, inserted.id, JSON.stringify({ schemaVersion: 1, eventId, workspaceId: input.workspaceId, aggregateType: "notification", aggregateId: inserted.id,
        actorUserId: null, occurredAt: new Date().toISOString(), correlationId: inserted.correlationId, causationId: null, data: { channel: "email" } })]);
  }
  return { queued, reason: null };
}
