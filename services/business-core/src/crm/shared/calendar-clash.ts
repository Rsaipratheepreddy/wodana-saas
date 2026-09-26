import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";

/** Refuses a booking that overlaps another pending appointment the member owns or attends. */
export async function assertMemberFree(db: Pick<PoolClient, "query">, workspaceId: string, membershipId: string, startsAt: string, endsAt: string, who: string, ignoreActivityId?: string | null) {
  const clash = await db.query<{ title: string }>(
    `SELECT activity.title FROM crm_appointments appointment
       JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
      WHERE appointment.workspace_id = $1 AND activity.status = 'pending' AND ($5::uuid IS NULL OR activity.id <> $5::uuid)
        AND (activity.owner_membership_id = $2 OR appointment.attendee_membership_ids ? $2::text)
        AND tstzrange(appointment.starts_at, appointment.ends_at) && tstzrange($3::timestamptz, $4::timestamptz) LIMIT 1`,
    [workspaceId, membershipId, startsAt, endsAt, ignoreActivityId ?? null]);
  if (clash.rowCount) throw new ConflictException(`${who} is busy then (${clash.rows[0].title}). Choose another time.`);
}
