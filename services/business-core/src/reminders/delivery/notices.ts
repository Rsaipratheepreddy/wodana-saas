import { renderNoticeText, wakeDelivery } from "../../notifications/default-templates";
import type { Db } from "../engine/engine";

type Template = { id: string; subject: string | null; body: string };

/**
 * The workspace's approved templates (en, newest version), read once per sweep. Emails queued here are sent by the
 * staff email dispatcher in the tenant's brand (renderBrandedEmail through TransactionalEmailService.sendStaffNotice),
 * pushes by the worker through Expo, in-app notices are delivered as they are written.
 */
export class TemplateCache {
  private readonly cache = new Map<string, Template | null>();

  constructor(private readonly db: Db, private readonly workspaceId: string) {}

  async get(code: string, channel: string): Promise<Template | null> {
    const key = `${code}:${channel}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const row = (await this.db.query<Template>(
      `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
        WHERE workspace_id = $1 AND code = $2 AND channel = $3 AND status = 'approved' AND locale = 'en' ORDER BY version_number DESC LIMIT 1`,
      [this.workspaceId, code, channel])).rows[0] ?? null;
    this.cache.set(key, row);
    return row;
  }
}

export type NoticeInput = {
  workspaceId: string;
  template: Template;
  variables: Record<string, string>;
  recipientType: "user" | "portal_contact" | "party";
  recipientId: string;
  channel: "in_app" | "push" | "email";
  eventType: string;
  /** When a push or email may go (the end of the recipient's quiet hours); in-app is always now. */
  scheduledFor: Date;
  now: Date;
  deepLink: string | null;
  /** `rem:{stepId}:{recipient}:{channel}` */
  idempotencyKey: string;
  critical: boolean;
  stepId: string | null;
  fallbackOf?: string | null;
};

/** Writes one notice (idempotent on its key) and wakes the worker for one due now. Null when the key was used. */
export async function insertNotice(db: Db, input: NoticeInput): Promise<string | null> {
  const subject = input.template.subject ? renderNoticeText(input.template.subject, input.variables) : null;
  const body = renderNoticeText(input.template.body, input.variables);
  const inApp = input.channel === "in_app";
  const later = !inApp && input.scheduledFor.getTime() > input.now.getTime();
  const row = (await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status, scheduled_for, subject, body,
       deep_link, idempotency_key, correlation_id, delivered_at, critical, reminder_step_id, fallback_of)
     VALUES ($1, $2, $3, $4, $5, $6, $7::notification_status, $8, $9, $10, $11, $12, gen_random_uuid(), $13, $14, $15, $16)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, input.template.id, input.recipientType, input.recipientId, input.channel, input.eventType,
      inApp ? "delivered" : later ? "scheduled" : "pending", inApp ? input.now : input.scheduledFor, subject, body, input.deepLink,
      input.idempotencyKey.slice(0, 160), inApp ? input.now : null, input.critical, input.stepId, input.fallbackOf ?? null])).rows[0];
  if (!row) return null;
  if (!inApp && !later) await wakeDelivery(db, input.workspaceId, row.id, row.correlationId, input.channel);
  return row.id;
}

/** `rem:{stepId}:{recipient}:{channel}`: one notice per step, recipient and channel, however often the sweep runs. */
export const reminderNoticeKey = (stepId: string, recipient: string, channel: string) => `rem:${stepId}:${recipient}:${channel}`;
