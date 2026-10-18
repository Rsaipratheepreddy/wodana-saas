import type { PoolClient } from "pg";
import { zonedInstant } from "../booking/booking.domain";
import { workspaceHours } from "../crm/conversations/inbox/auto-replies";

type Db = Pick<PoolClient, "query">;

export type Clock = { today: string; timeZone: string; locale: string; start: string; end: string; workingDays: number[]; holidays: string[] };

/** The workspace's day, zone, working week and hours (its work calendar, else its region pack). */
export async function workspaceClock(db: Db, workspaceId: string): Promise<Clock> {
  const hours = await workspaceHours(db, workspaceId);
  const row = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE $2)::date::text AS today, coalesce(nullif(default_locale, ''), 'en') AS locale FROM workspaces WHERE id = $1`, [workspaceId, hours.timeZone])).rows[0];
  return { ...hours, today: row?.today ?? new Date().toISOString().slice(0, 10), locale: row?.locale ?? "en" };
}

const minutes = (time: string) => { const [hour, minute] = time.split(":").map(Number); return (hour || 0) * 60 + (minute || 0); };

/** The instant a working day ends in the workspace's zone (a booking is due by the end of its last day). */
export function endOfWorkingDay(day: string, clock: Pick<Clock, "end" | "timeZone">) {
  return new Date(zonedInstant(day, minutes(clock.end), clock.timeZone, "compatible") ?? Date.parse(`${day}T23:59:00Z`));
}

/** The instant a working day starts in the workspace's zone. */
export function startOfWorkingDay(day: string, clock: Pick<Clock, "start" | "timeZone">) {
  return new Date(zonedInstant(day, minutes(clock.start), clock.timeZone, "compatible") ?? Date.parse(`${day}T09:00:00Z`));
}
