import { zonedInstant } from "../../booking/booking.domain";
import { UNDELIVERED_REASONS } from "../../notifications/delivery-health.service";
import { reminderTemplateCode } from "../reminders-contract";
import type { EngineContext } from "../engine/context";
import { localDate, type Db } from "../engine/engine";
import { TemplateCache } from "../delivery/notices";
import { readAdmins, readStaffPeople } from "../delivery/people";
import { deliverToStaff } from "../delivery/staff-router";

export type HealthAlertResult = { groups: number; alerted: number };

const CHANNEL_NAMES: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", push: "Push", in_app: "In-app" };

/**
 * Failing deliveries the people running the workspace must know about (plan §6.24a "Health"): messages to clients,
 * and notices about critical items, that failed today. Owners and administrators get one alert per channel, error
 * code and local day (the notice key), in the app and by branded email.
 */
export async function runHealthAlerts(db: Db, ctx: EngineContext): Promise<HealthAlertResult> {
  const day = localDate(ctx.now, ctx.clock.timeZone);
  const since = new Date(zonedInstant(day, 0, ctx.clock.timeZone, "compatible") ?? ctx.now.getTime() - 86_400_000);
  const groups = (await db.query<{ channel: string; code: string; count: number }>(
    `SELECT notification.channel, coalesce(attempt.code, notification.suppressed_reason, 'DELIVERY_FAILED') AS code, count(*)::int AS count
       FROM notifications notification
       LEFT JOIN LATERAL (SELECT attempt.error_code AS code FROM notification_delivery_attempts attempt
                           WHERE attempt.workspace_id = notification.workspace_id AND attempt.notification_id = notification.id AND attempt.error_code IS NOT NULL
                           ORDER BY attempt.attempt DESC LIMIT 1) attempt ON true
      WHERE notification.workspace_id = $1 AND notification.updated_at >= $2
        AND (notification.status = 'failed' OR (notification.status = 'suppressed' AND notification.suppressed_reason = ANY($3::text[])))
        AND (notification.recipient_type IN ('party', 'portal_contact') OR notification.critical)
        AND notification.channel <> 'in_app'
      GROUP BY 1, 2 ORDER BY 1, 2`, [ctx.workspaceId, since, UNDELIVERED_REASONS])).rows;
  const result: HealthAlertResult = { groups: groups.length, alerted: 0 };
  if (!groups.length) return result;
  const people = await readStaffPeople(db, ctx.workspaceId, await readAdmins(db, ctx.workspaceId), ctx.settings, ctx.clock.timeZone);
  const recipients = [...people.values()];
  if (!recipients.length) return result;
  const templates = new TemplateCache(db, ctx.workspaceId);
  for (const group of groups) {
    const code = group.code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
    const sent = await deliverToStaff(db, {
      workspaceId: ctx.workspaceId, stepId: null, code: reminderTemplateCode.deliveryFailed, eventType: "reminders.delivery_failed", critical: true,
      channels: ["in_app", "email"], recipients, deepLink: "/workspace/settings/delivery", now: ctx.now, digest: false,
      criticalBreaksQuiet: ctx.settings.criticalBreaksQuiet, ruleQuiet: null, calendar: ctx.clock, templates,
      variables: () => ({ channel: CHANNEL_NAMES[group.channel] ?? group.channel, count: String(group.count), error: group.code }),
      noticeKey: (membershipId, channel) => `rem:health:${group.channel}:${code}:${day}:${membershipId}:${channel}`,
    });
    if (sent.notificationIds.length) result.alerted += 1;
  }
  return result;
}
