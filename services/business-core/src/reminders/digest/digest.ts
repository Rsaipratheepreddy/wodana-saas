import { wallClock } from "../../booking/booking.domain";
import { workdays } from "../../project-core/work-calendar";
import { reminderTemplateCode } from "../reminders-contract";
import type { EngineContext } from "../engine/context";
import { localDate, type Db } from "../engine/engine";
import { inSavepoint, messageOf } from "../engine/savepoint";
import { dueText } from "../engine/text";
import { TemplateCache } from "../delivery/notices";
import { readStaffPeople, type StaffPerson } from "../delivery/people";
import { deliverToStaff } from "../delivery/staff-router";
import { myDayPermissionCodes, readMyDay, type MyDayResponse } from "../my-day/my-day";

export type DigestResult = { due: number; sent: number; empty: number; errors: string[] };
/** At most this many items are listed in a digest (the counts cover everything). */
export const DIGEST_ITEMS = 10;

const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return (hour || 0) * 60 + (minute || 0); };

/** The permissions a member holds, of these codes (their roles; for the sweep, which has no request). */
export async function memberPermissions(db: Db, workspaceId: string, membershipId: string, codes: readonly string[]): Promise<Set<string>> {
  const rows = (await db.query<{ code: string }>(
    `SELECT DISTINCT permission.code FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id
       JOIN permissions permission ON permission.id = granted.permission_id
      WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active' AND permission.code = ANY($3::text[])`,
    [workspaceId, membershipId, codes])).rows;
  return new Set(rows.map((row) => row.code));
}

/** The digest's list: up to ten items, grouped by job, one line each. */
export function digestLines(day: MyDayResponse, now: Date, limit = DIGEST_ITEMS): string {
  const lines: string[] = [];
  for (const group of day.groups) {
    for (const item of group.items) {
      if (lines.length >= limit) break;
      const where = group.title ? `${group.title}: ` : "";
      const due = dueText(item.dueAt ? new Date(item.dueAt) : null, now, day.timeZone, item.urgency === "waiting");
      lines.push(`• ${where}${item.title} (${due})${item.critical ? " · critical" : ""}`);
    }
  }
  return lines.join("\n");
}

/** Whether it is time for a person's digest: their digest time has passed today, in their zone, on a working day. */
export function digestDue(person: Pick<StaffPerson, "timeZone" | "digestTime" | "digestEnabled">, now: Date, calendar: { workingDays: number[]; holidays: string[] }): string | null {
  if (!person.digestEnabled) return null;
  const local = wallClock(now.getTime(), person.timeZone);
  if (!workdays({ workingDays: calendar.workingDays, holidays: calendar.holidays }).isWorking(local.date)) return null;
  return local.minutes >= minutesOf(person.digestTime) ? local.date : null;
}

/**
 * The personal digest (plan §6.24a "Digest", check 11): at each person's digest time (08:00 local by default), on
 * working days, one in-app notice and one branded email with My day's counts and up to ten grouped items; nothing on
 * holidays or when the list is empty. One per person per local day (reminder_digests); the steps that went only into
 * the digest are linked to it.
 */
export async function runDigests(db: Db, ctx: EngineContext): Promise<DigestResult> {
  const result: DigestResult = { due: 0, sent: 0, empty: 0, errors: [] };
  const ids = (await db.query<{ membershipId: string }>(
    `SELECT id AS "membershipId" FROM workspace_memberships WHERE workspace_id = $1 AND status = 'active' ORDER BY id`, [ctx.workspaceId])).rows.map((row) => row.membershipId);
  if (!ids.length) return result;
  // Digests already made in the last days (a person's local day can be a day either side of UTC); the unique key settles the rest.
  const done = (await db.query<{ membershipId: string; day: string }>(
    `SELECT membership_id AS "membershipId", digest_date::text AS day FROM reminder_digests WHERE workspace_id = $1 AND digest_date >= ($2::timestamptz AT TIME ZONE 'UTC')::date - 1`,
    [ctx.workspaceId, ctx.now])).rows;
  const people = await readStaffPeople(db, ctx.workspaceId, ids, ctx.settings, ctx.clock.timeZone);
  const doneOn = new Set(done.map((row) => `${row.membershipId}:${row.day}`));
  const codes = myDayPermissionCodes(ctx.sources);
  const templates = new TemplateCache(db, ctx.workspaceId);
  for (const person of people.values()) {
    const day = digestDue(person, ctx.now, ctx.clock);
    if (!day || doneOn.has(`${person.membershipId}:${day}`)) continue;
    result.due += 1;
    try {
      await inSavepoint(db, async () => {
        const permissions = await memberPermissions(db, ctx.workspaceId, person.membershipId, codes);
        const myDay = await readMyDay(db, { workspaceId: ctx.workspaceId, membershipId: person.membershipId, userId: person.userId, permissions, timeZone: person.timeZone },
          ctx.sources, { scope: "me" }, ctx.now);
        const { counts } = myDay;
        const listed = counts.overdue + counts.today + counts.waiting;
        const digest = (await db.query<{ id: string }>(
          `INSERT INTO reminder_digests (workspace_id, membership_id, digest_date, overdue_count, today_count, upcoming_count, waiting_count, item_count, created_at)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace_id, membership_id, digest_date) DO NOTHING RETURNING id`,
          [ctx.workspaceId, person.membershipId, day, counts.overdue, counts.today, counts.upcoming, counts.waiting, counts.total, ctx.now])).rows[0];
        if (!digest) return;
        if (!listed) { result.empty += 1; return; }
        const sent = await deliverToStaff(db, {
          workspaceId: ctx.workspaceId, stepId: null, code: reminderTemplateCode.digest, eventType: "reminders.digest", critical: false,
          channels: ["in_app", "email"], recipients: [person], deepLink: "/workspace/my-day", now: ctx.now, digest: false,
          // The digest goes at the person's chosen time: their quiet hours don't hold it.
          criticalBreaksQuiet: true, ruleQuiet: null, calendar: ctx.clock, templates,
          variables: () => ({ count: String(listed), overdue: String(counts.overdue), today: String(counts.today), waiting: String(counts.waiting), items: digestLines(myDay, ctx.now) }),
          noticeKey: (membershipId, channel) => `rem:digest:${membershipId}:${day}:${channel}`,
        });
        await db.query(`UPDATE reminder_digests SET notification_ids = $3::uuid[] WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, digest.id, sent.notificationIds]);
        await db.query(
          `UPDATE reminder_steps SET digest_id = $3, version = version + 1, updated_at = $4
            WHERE workspace_id = $1 AND state = 'digested' AND digest_id IS NULL AND $2 = ANY(recipient_membership_ids)`,
          [ctx.workspaceId, person.membershipId, digest.id, ctx.now]);
        if (sent.delivered.length) result.sent += 1;
      });
    } catch (error) {
      result.errors.push(`digest ${person.membershipId}: ${messageOf(error)}`);
    }
  }
  return result;
}

export const digestDateOf = (now: Date, timeZone: string) => localDate(now, timeZone);
