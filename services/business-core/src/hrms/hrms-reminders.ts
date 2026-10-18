import type { PoolClient } from "pg";
import {
  notifyUserInApp,
  queueUserEmail,
} from "../notifications/default-templates";
import { Calendar, formatDates, formatWhen, localDate, zonedInstant } from "./hrms-domain";
import { EXPIRING_DAYS } from "./hrms-documents.service";

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

const KIND_LABEL: Record<string, string> = {
  identity: "identity document", work_permit: "work permit", residence: "residence permit", licence: "licence", insurance: "insurance",
  safety_induction: "safety induction", medical: "medical certificate", other: "document",
};

/**
 * Documents running out: 30 days before, HR is told (in-app and email) and so is the employee whose
 * document it is; on expiry HR hears again, and for a worker so does their crew's lead. Once per
 * document and expiry date, so a renewed document starts afresh.
 */
export async function processHrmsDocuments(db: Db, workspaceId: string) {
  const workspace = (await db.query<{ today: string; locale: string | null }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  if (!workspace) return { sent: 0 };
  const due = (await db.query<{ id: string; kind: string; title: string; expiresOn: string; person: string; ownerUserId: string | null; leadUserId: string | null; expired: boolean }>(
    `SELECT document.id, document.kind, document.title, document.expires_on::text AS "expiresOn", coalesce(person.display_name, worker.name) AS person,
            CASE WHEN member.status = 'active' THEN member.user_id END AS "ownerUserId", lead_member.user_id AS "leadUserId",
            document.expires_on < $2::date AS expired
       FROM hrms_documents document
       LEFT JOIN workspace_memberships member ON member.workspace_id = document.workspace_id AND member.id = document.membership_id
       LEFT JOIN users person ON person.id = member.user_id
       LEFT JOIN hrms_workers worker ON worker.workspace_id = document.workspace_id AND worker.id = document.worker_id AND worker.active
       LEFT JOIN hrms_crews crew ON crew.workspace_id = worker.workspace_id AND crew.id = worker.crew_id
       LEFT JOIN workspace_memberships lead_member ON lead_member.workspace_id = crew.workspace_id AND lead_member.id = crew.lead_membership_id AND lead_member.status = 'active'
      WHERE document.workspace_id = $1 AND document.expires_on IS NOT NULL
        AND document.expires_on BETWEEN $2::date - 30 AND $2::date + $3::int
        AND (document.membership_id IS NULL OR member.status = 'active') AND (document.worker_id IS NULL OR worker.id IS NOT NULL)`,
    [workspaceId, workspace.today, EXPIRING_DAYS])).rows;
  if (!due.length) return { sent: 0 };
  const hr = (await db.query<{ userId: string }>(
    `SELECT DISTINCT member.user_id AS "userId" FROM workspace_memberships member
       JOIN effective_member_roles role ON role.workspace_id = member.workspace_id AND role.membership_id = member.id
       JOIN role_permissions granted ON granted.role_id = role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'hrms.manage'
      WHERE member.workspace_id = $1 AND member.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let sent = 0;
  for (const document of due) {
    const code = document.expired ? "hrms.document_expired" : "hrms.document_expiring";
    const variables = { person: document.person, leaveType: "", dates: formatDates(document.expiresOn, document.expiresOn, workspace.locale), days: "",
      note: `${KIND_LABEL[document.kind] ?? "document"} (${document.title})`, actor: "", when: "", place: "" };
    const recipients = new Set([...hr, ...(document.ownerUserId && !document.expired ? [document.ownerUserId] : []), ...(document.leadUserId && document.expired ? [document.leadUserId] : [])]);
    for (const userId of recipients) {
      const notice = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/hrms/documents?document=${document.id}` };
      const key = `${code}:${document.id}:${document.expiresOn}:${userId}`;
      const result = await notifyUserInApp(db, { ...notice, idempotencyKey: key });
      if (!document.expired && hr.includes(userId)) await queueUserEmail(db, { ...notice, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
