import { UNDELIVERED_REASONS } from "../../notifications/delivery-health.service";
import { REMINDER_KIND_INFO, reminderTemplateCode, type EngineReminderKind } from "../reminders-contract";
import type { EngineContext } from "../engine/context";
import type { Db } from "../engine/engine";
import { inSavepoint, messageOf } from "../engine/savepoint";
import { normalizeSubject, SUBJECT_COLUMNS, subjectRef, type SubjectRow } from "../engine/subjects";
import { dueText } from "../engine/text";
import { TemplateCache } from "./notices";
import { readStaffPeople } from "./people";
import { deliverToStaff } from "./staff-router";

export type FallbackResult = { checked: number; fellBack: number; unreachable: number; errors: string[] };

/**
 * The fallback pass (plan §6.24a "Fallback"): a client reminder whose WhatsApp failed or couldn't be delivered goes
 * to the next consented channel (the branded email), each new notice recording the one it falls back from
 * (`fallback_of`). When no channel is left the client is unreachable and the subject's owner is told once.
 */
export async function runFallbacks(db: Db, ctx: EngineContext, options: { limit?: number } = {}): Promise<FallbackResult> {
  const result: FallbackResult = { checked: 0, fellBack: 0, unreachable: 0, errors: [] };
  const rows = (await db.query<{ notificationId: string; stepId: string } & SubjectRow>(
    `SELECT notification.id AS "notificationId", step.id AS "stepId", ${SUBJECT_COLUMNS}
       FROM notifications notification
       JOIN reminder_steps step ON step.workspace_id = notification.workspace_id AND step.id = notification.reminder_step_id
       JOIN reminder_subjects subject ON subject.workspace_id = step.workspace_id AND subject.id = step.subject_id
      WHERE notification.workspace_id = $1 AND notification.channel = 'whatsapp' AND notification.recipient_type = 'party'
        AND (notification.status = 'failed' OR (notification.status = 'suppressed' AND notification.suppressed_reason = ANY($2::text[])))
        AND notification.updated_at > now() - interval '7 days'
        AND subject.status IN ('open', 'snoozed')
        AND NOT EXISTS (SELECT 1 FROM notifications later WHERE later.workspace_id = notification.workspace_id AND later.fallback_of = notification.id)
        AND NOT EXISTS (SELECT 1 FROM notifications told WHERE told.workspace_id = notification.workspace_id AND told.reminder_step_id = step.id
                         AND told.idempotency_key LIKE 'rem:unreachable:%')
      ORDER BY notification.updated_at LIMIT $3`,
    [ctx.workspaceId, UNDELIVERED_REASONS.concat(["consent_missing"]), options.limit ?? 100])).rows;
  const templates = new TemplateCache(db, ctx.workspaceId);
  for (const row of rows) {
    const { notificationId, stepId, ...rest } = row;
    const subject = normalizeSubject(rest as SubjectRow);
    const source = ctx.sources.get(subject.kind);
    const rule = ctx.rules.get(subject.kind as EngineReminderKind);
    result.checked += 1;
    if (!source?.deliverClient || !rule) continue;
    try {
      await inSavepoint(db, async () => {
        const left = rule.channels.filter((channel): channel is "email" => channel === "email");
        const delivered = left.length ? await source.deliverClient!(db, ctx.workspaceId, {
          subject: { ...subjectRef(subject), title: subject.title, context: subject.context, href: subject.href }, stepId, channels: left,
          idempotencyKey: `rem:${stepId}`, now: ctx.now, fallbackOf: notificationId,
          variables: { ...subject.variables, title: subject.title, context: subject.context, due: dueText(subject.dueAt, ctx.now, ctx.clock.timeZone, false) },
        }) : null;
        if (delivered?.status === "queued") {
          await db.query(`UPDATE reminder_steps SET channels = array(SELECT DISTINCT unnest(channels || ARRAY['email'])), version = version + 1, updated_at = $3
                           WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, stepId, ctx.now]);
          result.fellBack += 1;
          return;
        }
        const owner = await readStaffPeople(db, ctx.workspaceId, subject.ownerMembershipId ? [subject.ownerMembershipId] : [], ctx.settings, ctx.clock.timeZone);
        await deliverToStaff(db, {
          workspaceId: ctx.workspaceId, stepId, code: reminderTemplateCode.unreachable, eventType: REMINDER_KIND_INFO[subject.kind].eventType ?? subject.kind,
          critical: subject.critical, channels: ["in_app", "email"], recipients: [...owner.values()], deepLink: subject.href, now: ctx.now, digest: false,
          criticalBreaksQuiet: ctx.settings.criticalBreaksQuiet, ruleQuiet: null, calendar: ctx.clock, templates,
          variables: () => ({ client: subject.variables?.client || subject.context || "the client", title: subject.title, context: subject.context }),
          noticeKey: (membershipId, channel) => `rem:unreachable:${subject.id}:${subject.dueRevision}:${membershipId}:${channel}`,
        });
        result.unreachable += 1;
      });
    } catch (error) {
      result.errors.push(`fallback ${notificationId}: ${messageOf(error)}`);
    }
  }
  return result;
}
