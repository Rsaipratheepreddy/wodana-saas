import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { portalLink } from "./portal-site";
import { effectiveSections, readPortalSettings, readProjectAccess, type Section } from "./portal-settings";
import { partyOfCase, recordClientMessageSkipped, sendClientEvent } from "../crm/conversations/inbox/client-messages";
import type { TemplateContext } from "../crm/conversations/inbox/template-variables";
import type { StarterEvent } from "../crm/conversations/inbox/whatsapp-starter-pack";

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
export type ClientEvent = "quote_issued" | "invoice_issued" | "decision_waiting" | "update_published" | "team_replied" | "payment_checked" | "issue_triaged" | "payment_due";

//   team_replied       the team answered them on the moodboard   everyone on the project
//   payment_checked    finance checked a payment they reported   everyone on the project
//   issue_triaged      the manager took up or declined an issue  everyone on the project
//   payment_due        a reminder that a payment is due          everyone on the project
const SECTION: Record<ClientEvent, Section> = { quote_issued: "decisions", invoice_issued: "payments", decision_waiting: "decisions", update_published: "progress",
  team_replied: "moodboard", payment_checked: "payments", issue_triaged: "progress", payment_due: "payments" };
const TEMPLATE: Record<ClientEvent, string> = {
  quote_issued: "portal.quote_issued", invoice_issued: "portal.invoice_issued", decision_waiting: "portal.decision_waiting", update_published: "portal.update_published",
  team_replied: "portal.team_replied", payment_checked: "portal.payment_checked", issue_triaged: "portal.issue_triaged", payment_due: "portal.payment_due",
};
/** The WhatsApp client message a portal event is (the others go by email only). */
const WHATSAPP_EVENT: Partial<Record<ClientEvent, StarterEvent>> = {
  quote_issued: "portal.quote_issued", invoice_issued: "portal.invoice_issued", decision_waiting: "portal.decision_waiting", update_published: "portal.update_published",
  payment_due: "payments.reminder",
};

const render = (template: string, variables: Record<string, string>) => template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => variables[key] ?? "");

/** The pre-project a delivery project was started from: client contacts are granted on it. */
export async function caseOf(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0].caseId;
}

export async function tellClients(db: Db, input: {
  workspaceId: string; caseId: string; event: ClientEvent; recordId: string; title: string; due?: string | null; note?: string; demo?: boolean;
  /** The event's own record for the WhatsApp values (e.g. a reminder's invoice and the amount still due). */
  record?: TemplateContext["record"];
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
  // WhatsApp first when the firm has the event on and an approved template; email to the portal contacts otherwise.
  const whatsappEvent = WHATSAPP_EVENT[input.event];
  if (whatsappEvent) {
    const client = await partyOfCase(db, input.workspaceId, input.caseId);
    const whatsapp = await sendClientEvent(db, {
      workspaceId: input.workspaceId, event: whatsappEvent, partyId: client.partyId, leadId: client.leadId, recordKey: input.recordId,
      record: input.record ? { projectId: facts.projectId, ...input.record } : input.event === "invoice_issued" ? { invoiceId: input.recordId, projectId: facts.projectId }
        : input.event === "quote_issued" ? { quoteId: input.recordId.split(":")[0], projectId: facts.projectId } : { projectId: facts.projectId },
    });
    if (whatsapp.sent) return { queued: 1, reason: null, channel: "whatsapp" as const, messageId: whatsapp.messageId };
    await recordClientMessageSkipped(db, input.workspaceId, whatsappEvent, input.recordId, whatsapp, true);
  }
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

/**
 * The first time a client signs in, the people running their project hear it in the app: the managers named
 * on each started project of the case, and the case's owner. Once per client and person.
 */
export async function tellStaffClientSignedIn(db: Db, workspaceId: string, contacts: Array<{ id: string; caseId: string; name: string }>) {
  let told = 0;
  for (const contact of contacts) {
    const projects = (await db.query<{ id: string; title: string }>(
      `SELECT id, reference || ' · ' || name AS title FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND started_at IS NOT NULL ORDER BY started_at`,
      [workspaceId, contact.caseId])).rows;
    for (const project of projects) {
      const people = (await db.query<{ userId: string }>(
        `SELECT DISTINCT membership.user_id AS "userId"
           FROM project_assignments assignment
           JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
          WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager
         UNION
         SELECT membership.user_id
           FROM pre_project_cases pre_case
           JOIN workspace_memberships membership ON membership.workspace_id = pre_case.workspace_id AND membership.id = pre_case.owner_membership_id AND membership.status = 'active'
          WHERE pre_case.workspace_id = $1 AND pre_case.id = $3`, [workspaceId, project.id, contact.caseId])).rows;
      for (const person of people) {
        const result = await notifyUserInApp(db, {
          workspaceId, recipientUserId: person.userId, code: "client_portal.client_signed_in", eventType: "client_portal.client_signed_in",
          variables: { client: contact.name, title: project.title }, deepLink: `/workspace/projects/${project.id}/updates`,
          idempotencyKey: `client_portal.client_signed_in:${contact.id}:${person.userId}`,
        });
        if (result.queued) told += 1;
      }
    }
  }
  return told;
}

/**
 * Who works a case, by what they do there (the user ids of active members):
 *   design    the opportunity's designer and account manager, and the case owner (the moodboard, designs)
 *   managers  the managers named on the case's started projects (issues, site, handover)
 *   finance   everyone who verifies client receipts (a reported payment)
 */
export async function caseTeam(db: Db, workspaceId: string, caseId: string, who: Array<"design" | "managers" | "finance">) {
  const people: string[] = [];
  if (who.includes("design"))
    people.push(...(await db.query<{ userId: string }>(
      `SELECT membership.user_id AS "userId"
         FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
         JOIN workspace_memberships membership ON membership.workspace_id = pre_case.workspace_id AND membership.status = 'active'
          AND membership.id IN (designer.membership_id, opportunity.owner_membership_id, pre_case.owner_membership_id)
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows.map((row) => row.userId));
  if (who.includes("managers"))
    people.push(...(await db.query<{ userId: string }>(
      `SELECT membership.user_id AS "userId" FROM delivery_projects project
         JOIN project_assignments assignment ON assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND assignment.is_manager
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE project.workspace_id = $1 AND project.case_id = $2 AND project.started_at IS NOT NULL`, [workspaceId, caseId])).rows.map((row) => row.userId));
  if (who.includes("finance"))
    people.push(...(await db.query<{ userId: string }>(
      `SELECT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'commercial.finance.verify'
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId));
  return [...new Set(people)];
}

/** The project (or opportunity) and client names a staff notice about a case starts from. */
export async function caseTitle(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ title: string; clientName: string; projectId: string | null }>(
    `SELECT coalesce(project.reference || ' · ' || project.name, opportunity.title) AS title, coalesce(party.display_name, opportunity.title) AS "clientName",
            project.id AS "projectId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 ORDER BY project.started_at LIMIT 1`, [workspaceId, caseId])).rows[0] ?? { title: "", clientName: "", projectId: null };
}

/**
 * Tells the case's people what the client did: in the app, and by email for what needs acting on. Once per person
 * and event (the key names the event); never the person who acted.
 */
export async function tellStaff(db: Db, input: { workspaceId: string; recipients: string[]; code: string; variables: Record<string, string>; deepLink: string; key: string;
  email?: boolean; except?: string | null }) {
  let told = 0;
  for (const userId of input.recipients.filter((id) => id !== input.except)) {
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables: input.variables, deepLink: input.deepLink };
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}`.slice(0, 160) });
    if (input.email) await queueUserEmail(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}:email`.slice(0, 160) });
    if (result.queued) told += 1;
  }
  return told;
}
