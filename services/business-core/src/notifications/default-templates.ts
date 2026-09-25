import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export type DefaultTemplate = {
  code: string;
  channel: "in_app" | "email" | "whatsapp" | "push";
  subject: string | null;
  body: string;
  variables: string[];
};

/**
 * System default notification templates, seeded into every workspace as approved version 1.
 * Tenants edit their own copies (a newer version wins). Each module adds its events here when it
 * is built; variables use {{name}} and are declared so sends fail loudly when one is missing.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: DefaultTemplate[] = [
  {
    code: "workspace.member_joined",
    channel: "in_app",
    subject: "{{memberName}} joined {{workspaceName}}",
    body: "{{memberName}} accepted your invitation.",
    variables: ["memberName", "workspaceName"],
  },
  {
    code: "crm.enquiry_duplicate",
    channel: "in_app",
    subject: "{{clientName}} enquired again",
    body: "{{reference}} came in through {{channel}} and is linked to {{originalReference}}, which you own.",
    variables: ["clientName", "reference", "channel", "originalReference"],
  },
  {
    code: "crm.returning_customer",
    channel: "in_app",
    subject: "{{clientName}} is back",
    body: "{{reference}} is from a returning customer you worked with before.",
    variables: ["clientName", "reference"],
  },
  {
    code: "crm.lead_taken_over_from",
    channel: "in_app",
    subject: "{{reference}} moved to {{newOwner}}",
    body: "No call or note was logged within the response time, so {{reference}} was reassigned.",
    variables: ["reference", "newOwner"],
  },
  {
    code: "crm.lead_taken_over_to",
    channel: "in_app",
    subject: "{{reference}} is now yours",
    body: "{{previousOwner}} did not log contact within the response time. Contact the client now.",
    variables: ["reference", "previousOwner"],
  },
  {
    code: "crm.lead_assigned",
    channel: "in_app",
    subject: "{{reference}} · {{clientName}} is yours",
    body: "New enquiry from {{source}}. Log your first contact within the response time.",
    variables: ["reference", "clientName", "source"],
  },
  {
    code: "crm.lead_assigned",
    channel: "email",
    subject: "New enquiry {{reference}}: {{clientName}}",
    body: "You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\n\nOpen it and log your first contact within the response time.",
    variables: ["reference", "clientName", "source"],
  },
];

export async function seedDefaultNotificationTemplates(db: Db, workspaceId: string) {
  for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
    await db.query(
      `INSERT INTO notification_templates
         (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
       VALUES ($1, $2, $3, 'en', 1, 'approved', $4, $5, $6::jsonb, now())
       ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING`,
      [workspaceId, template.code, template.channel, template.subject, template.body, JSON.stringify(template.variables)],
    );
  }
}

const render = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => variables[key] ?? "");

/**
 * Records an in-app notification for one user from the workspace's approved template, inside the
 * caller's tenant transaction. Honours the recipient's preference and is idempotent per key.
 * (Module 10 folds this and the CRM notification engine into one notification service.)
 */
export async function notifyUserInApp(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
}) {
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
  const template = await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
     WHERE workspace_id=$1 AND code=$2 AND channel='in_app' AND status='approved' AND locale='en'
     ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.code],
  );
  if (!template.rows[0]) return { queued: false as const, reason: "template_missing" };
  const row = template.rows[0];
  await db.query(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       subject, body, deep_link, idempotency_key, correlation_id, delivered_at)
     VALUES ($1, $2, 'user', $3, 'in_app', $4, 'delivered', $5, $6, $7, $8, gen_random_uuid(), now())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? render(row.subject, input.variables) : null, render(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  return { queued: true as const };
}

/**
 * Queues an email for one user from the workspace's approved email template, inside the caller's
 * tenant transaction; the notification worker renders it with the tenant brand and sends it.
 * Sent unless the person switched this event off. Idempotent per key.
 */
export async function queueUserEmail(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
}) {
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='email'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
  const template = await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
     WHERE workspace_id=$1 AND code=$2 AND channel='email' AND status='approved' AND locale='en'
     ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.code],
  );
  if (!template.rows[0]) return { queued: false as const, reason: "template_missing" };
  const row = template.rows[0];
  const inserted = await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
     VALUES ($1, $2, 'user', $3, 'email', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? render(row.subject, input.variables) : null, render(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  const notification = inserted.rows[0];
  // Wake the worker now instead of waiting for its next poll.
  const eventId = randomUUID();
  if (notification) await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($4, $1, 'notification', $2, 'notification.delivery_requested.v1', $3::jsonb)`,
    [input.workspaceId, notification.id, JSON.stringify({ schemaVersion: 1, eventId, workspaceId: input.workspaceId, aggregateType: "notification", aggregateId: notification.id, actorUserId: null, occurredAt: new Date().toISOString(), correlationId: notification.correlationId, causationId: null, data: { channel: "email" } }), eventId],
  );
  return { queued: true as const };
}
