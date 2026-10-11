import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

// Structural copy of DeliveryHealthMessage in packages/contracts/src/reminders.ts.
export const DELIVERY_MESSAGE_STATUSES = ["pending", "sent", "delivered", "read", "failed", "held", "suppressed"] as const;
export type DeliveryMessageStatus = (typeof DELIVERY_MESSAGE_STATUSES)[number];
export type DeliveryHealthMessage = {
  id: string; createdAt: string; updatedAt: string; channel: string; eventType: string; recipient: { type: string; id: string; label: string };
  status: DeliveryMessageStatus; reason: string | null; attempts: number; providerMessageId: string | null; critical: boolean;
  reminderStepId: string | null; fallbackOf: string | null; href: string | null;
};
export type DeliveryMessagesQuery = { status?: string; channel?: string; from?: string; to?: string; cursor?: string; limit?: string | number };

const CHANNELS = ["email", "whatsapp", "push", "in_app", "webhook", "sms"];
/** One message's state as people read it: waiting, held (to the end of quiet hours or a scheduled time), sent, delivered, read, failed, suppressed. */
const STATUS_SQL = `CASE
  WHEN notification.status IN ('pending', 'scheduled') AND notification.scheduled_for > now() THEN 'held'
  WHEN notification.status IN ('pending', 'scheduled', 'processing') THEN 'pending'
  WHEN notification.status = 'delivered' AND notification.read_at IS NOT NULL THEN 'read'
  WHEN notification.status = 'delivered' THEN 'delivered'
  WHEN notification.status = 'sent' THEN 'sent'
  WHEN notification.status = 'failed' THEN 'failed'
  ELSE 'suppressed' END`;

const iso = (value: Date | string) => new Date(value).toISOString();
const day = (value: string | undefined, label: string) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${label} must be a date.`);
  return value;
};

/**
 * Delivery health's per-message list (plan §6.24a "Health"): every notice that leaves the app (in-app ones only when
 * asked for), newest change first, with its state and why it was held, suppressed or failed, its attempts, the
 * provider's id, whether it was critical, the reminder step it belongs to and the notice it falls back from. Keyset
 * paged (the cursor is the last row's change time and id).
 */
export async function readDeliveryMessages(db: Db, workspaceId: string, query: DeliveryMessagesQuery): Promise<{ items: DeliveryHealthMessage[]; nextCursor: string | null }> {
  const status = query.status || null;
  if (status && !(DELIVERY_MESSAGE_STATUSES as readonly string[]).includes(status)) throw new BadRequestException("Unknown status.");
  const channel = query.channel || null;
  if (channel && !CHANNELS.includes(channel)) throw new BadRequestException("Unknown channel.");
  const limit = query.limit === undefined || query.limit === "" ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException("Limit is 1 to 200.");
  let cursor: { at: string; id: string } | null = null;
  if (query.cursor) {
    const [at, id] = Buffer.from(query.cursor, "base64url").toString("utf8").split("|");
    if (!at || !id || !/^\d{4}-\d{2}-\d{2}[ T][0-9:.]+([+-]\d{2}(:?\d{2})?|Z)?$/.test(at) || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException("The page link is not valid.");
    cursor = { at, id };
  }
  const rows = (await db.query<{ id: string; createdAt: Date; updatedAt: Date; channel: string; eventType: string; recipientType: string; recipientId: string; label: string | null;
    status: DeliveryMessageStatus; suppressedReason: string | null; errorCode: string | null; attempts: number; providerMessageId: string | null; critical: boolean;
    reminderStepId: string | null; fallbackOf: string | null; href: string | null; scheduledFor: Date; updatedKey: string }>(
    `SELECT * FROM (
       SELECT notification.id, notification.created_at AS "createdAt", notification.updated_at AS "updatedAt", notification.channel, notification.event_type AS "eventType",
              notification.recipient_type AS "recipientType", notification.recipient_id AS "recipientId",
              CASE notification.recipient_type
                WHEN 'user' THEN (SELECT coalesce(nullif(btrim(account.display_name), ''), account.primary_email) FROM users account WHERE account.id = notification.recipient_id)
                WHEN 'portal_contact' THEN (SELECT grant_row.name FROM client_portal_grants grant_row WHERE grant_row.workspace_id = notification.workspace_id AND grant_row.id = notification.recipient_id)
                WHEN 'party' THEN (SELECT party.display_name FROM crm_parties party WHERE party.workspace_id = notification.workspace_id AND party.id = notification.recipient_id)
                WHEN 'finance_inbox' THEN 'Finance inbox' END AS label,
              ${STATUS_SQL} AS status, notification.suppressed_reason AS "suppressedReason", attempt.code AS "errorCode", coalesce(attempt.count, 0) AS attempts,
              attempt.provider_id AS "providerMessageId", notification.critical, notification.reminder_step_id AS "reminderStepId", notification.fallback_of AS "fallbackOf",
              notification.deep_link AS href, notification.scheduled_for AS "scheduledFor", notification.updated_at::text AS "updatedKey"
         FROM notifications notification
         LEFT JOIN LATERAL (SELECT count(*)::int AS count,
                                   (array_agg(attempt.error_code ORDER BY attempt.attempt DESC) FILTER (WHERE attempt.error_code IS NOT NULL))[1] AS code,
                                   (array_agg(attempt.provider_message_id ORDER BY attempt.attempt DESC) FILTER (WHERE attempt.provider_message_id IS NOT NULL))[1] AS provider_id
                              FROM notification_delivery_attempts attempt
                             WHERE attempt.workspace_id = notification.workspace_id AND attempt.notification_id = notification.id) attempt ON true
        WHERE notification.workspace_id = $1
          AND (CASE WHEN $3::text IS NULL THEN notification.channel <> 'in_app' ELSE notification.channel = $3 END)
          AND ($4::date IS NULL OR notification.updated_at >= $4::date)
          AND ($5::date IS NULL OR notification.updated_at < $5::date + 1)
          AND ($6::timestamptz IS NULL OR (notification.updated_at, notification.id) < ($6::timestamptz, $7::uuid))
     ) message
     WHERE $2::text IS NULL OR message.status = $2
     ORDER BY message."updatedAt" DESC, message.id DESC
     LIMIT $8`,
    [workspaceId, status, channel, day(query.from, "From"), day(query.to, "To"), cursor?.at ?? null, cursor?.id ?? null, limit + 1])).rows;
  const page = rows.slice(0, limit);
  const items = page.map((row): DeliveryHealthMessage => ({
    id: row.id, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), channel: row.channel, eventType: row.eventType,
    recipient: { type: row.recipientType, id: row.recipientId, label: row.label ?? "" }, status: row.status,
    reason: row.status === "held" ? (row.reminderStepId ? "quiet_hours" : "scheduled") : row.status === "failed" ? row.errorCode ?? row.suppressedReason ?? "DELIVERY_FAILED"
      : row.status === "suppressed" ? row.suppressedReason ?? "cancelled" : null,
    attempts: Number(row.attempts), providerMessageId: row.providerMessageId, critical: row.critical, reminderStepId: row.reminderStepId, fallbackOf: row.fallbackOf,
    href: row.href?.startsWith("/workspace") ? row.href : null,
  }));
  const last = page.at(-1);
  return { items, nextCursor: rows.length > limit && last ? Buffer.from(`${last.updatedKey}|${last.id}`, "utf8").toString("base64url") : null };
}
