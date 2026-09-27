import type { PoolClient } from "pg";
import {
  notifyUserInApp,
  queueUserEmail,
} from "../notifications/default-templates";
import { Calendar, formatWhen, localDate, zonedInstant } from "./hrms-domain";

type Db = Pick<PoolClient, "query">;
const GRACE_MS = 3_600_000;

/**
 * Someone still checked in an hour after their working day should have ended is told once per
 * session (in-app and email). The day ends at the calendar's end time on the day they checked in,
 * or a full working day after they checked in when that's later (a late start or an evening shift).
 * Nothing is closed for them: they check out, or ask for a correction with the time they left.
 */
export async function processHrmsCheckouts(db: Db, workspaceId: string, now = new Date()) {
  const open = (
    await db.query<{
      sessionId: string;
      userId: string;
      startedAt: Date;
      calendar: Calendar;
      place: string | null;
    }>(
      `SELECT s.id AS "sessionId",m.user_id AS "userId",s.started_at AS "startedAt",s.calendar_snapshot AS calendar,
              coalesce(g.context_snapshot->'location'->>'name',g.context_snapshot->>'name') AS place
         FROM hrms_sessions s
         JOIN workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.membership_id AND m.status='active'
         LEFT JOIN hrms_segments g ON g.workspace_id=s.workspace_id AND g.session_id=s.id AND g.ended_at IS NULL
        WHERE s.workspace_id=$1 AND s.ended_at IS NULL`,
      [workspaceId],
    )
  ).rows;
  if (!open.length) return { sent: 0 };
  const locale =
    (
      await db.query<{ locale: string | null }>(
        `SELECT default_locale AS locale FROM workspaces WHERE id=$1`,
        [workspaceId],
      )
    ).rows[0]?.locale ?? "en";
  let sent = 0;
  for (const session of open) {
    const { timezone, dayStart, dayEnd } = session.calendar;
    const day = localDate(session.startedAt, timezone);
    const end = zonedInstant(day, dayEnd, timezone).getTime();
    const length = end - zonedInstant(day, dayStart, timezone).getTime();
    const due =
      Math.max(end, new Date(session.startedAt).getTime() + length) + GRACE_MS;
    if (now.getTime() < due) continue;
    const variables = {
      person: "",
      leaveType: "",
      dates: "",
      days: "",
      note: "",
      actor: "",
      when: formatWhen(session.startedAt, timezone, locale),
      place: session.place ?? "",
    };
    const notice = {
      workspaceId,
      recipientUserId: session.userId,
      code: "hrms.checkout_missing",
      eventType: "hrms.checkout_missing",
      variables,
      deepLink: `/workspace/hrms?day=${day}`,
    };
    const key = `hrms.checkout_missing:${session.sessionId}:${session.userId}`;
    const result = await notifyUserInApp(db, { ...notice, idempotencyKey: key });
    await queueUserEmail(db, { ...notice, idempotencyKey: `${key}:email` });
    if (result.queued) sent += 1;
  }
  return { sent };
}
