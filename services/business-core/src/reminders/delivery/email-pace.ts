import type { ConfigService } from "@nestjs/config";
import type { EngineContext } from "../engine/context";
import type { Db } from "../engine/engine";

/** Reminder emails one sweep may hand to delivery per workspace (REMINDERS_SWEEP_EMAIL_CAP). */
export const DEFAULT_SWEEP_EMAIL_CAP = 20;

/** REMINDERS_SWEEP_EMAIL_CAP (a positive whole number), else the default. */
export function sweepEmailCap(config: Pick<ConfigService, "get">): number {
  const text = String(config.get<string | number>("REMINDERS_SWEEP_EMAIL_CAP") ?? "").trim();
  const value = Number(text);
  return text && Number.isInteger(value) && value > 0 ? value : DEFAULT_SWEEP_EMAIL_CAP;
}

export type PaceResult = { carried: number };

/**
 * The sweep's email cap (the last phase, in the sweep's transaction, before anything it wrote can be sent): of the
 * engine's emails for this workspace that are due before the next sweep (reminders, escalations, unreachable notices,
 * digests and delivery alerts, all keyed `rem:`), at most `cap` go now, less those already handed to delivery this
 * minute; the rest move to the following minutes, `cap` per minute, oldest and critical first. They are due anyway, so
 * the next sweeps carry them; nothing is dropped, and each keeps its notice and idempotency key, so nothing is sent
 * twice. In-app notices are never held back. A notice already claimed by a dispatcher is left alone.
 */
export async function paceReminderEmails(db: Db, ctx: Pick<EngineContext, "workspaceId" | "now">, cap: number): Promise<PaceResult> {
  const limit = Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_SWEEP_EMAIL_CAP;
  const moved = await db.query(
    `WITH slot AS (SELECT date_trunc('minute', $2::timestamptz) AS start),
     handed AS (
       SELECT count(*)::int AS count FROM notifications notice, slot
        WHERE notice.workspace_id = $1 AND notice.channel = 'email' AND notice.created_at >= slot.start - interval '7 days'
          AND notice.idempotency_key LIKE 'rem:%' AND notice.status IN ('processing', 'sent', 'delivered', 'failed') AND notice.updated_at >= slot.start),
     waiting AS (
       SELECT notice.id, notice.scheduled_for, notice.critical, notice.created_at FROM notifications notice
        WHERE notice.workspace_id = $1 AND notice.channel = 'email' AND notice.idempotency_key LIKE 'rem:%'
          AND notice.status IN ('pending', 'scheduled') AND notice.scheduled_for < $2::timestamptz + interval '1 minute'
        FOR UPDATE OF notice SKIP LOCKED),
     ranked AS (
       SELECT waiting.id, (row_number() OVER (ORDER BY waiting.scheduled_for, waiting.critical DESC, waiting.created_at, waiting.id) - 1)::int AS position FROM waiting)
     UPDATE notifications notice
        SET status = 'scheduled',
            scheduled_for = GREATEST(notice.scheduled_for, slot.start + ((ranked.position + handed.count) / $3) * interval '1 minute'),
            version = notice.version + 1
       FROM ranked, handed, slot
      WHERE notice.workspace_id = $1 AND notice.id = ranked.id AND ranked.position + handed.count >= $3
        AND notice.status IN ('pending', 'scheduled')
      RETURNING notice.id`, [ctx.workspaceId, ctx.now, limit]);
  return { carried: moved.rowCount ?? 0 };
}
