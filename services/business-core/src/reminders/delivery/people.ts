import { isTimeZone, resolveRecipientZone, type Db } from "../engine/engine";
import type { ReminderSettings } from "../engine/context";

/** A staff recipient as the delivery router needs them: who, where they are, when they are quiet, how they hear. */
export type StaffPerson = {
  membershipId: string;
  userId: string;
  name: string;
  timeZone: string;
  /** The person's quiet hours, else the firm's; null when none apply (start = end). */
  quiet: { start: string; end: string } | null;
  /** The person set their own quiet hours (a rule's quiet hours apply only when they didn't). */
  ownQuiet: boolean;
  /** The firm's quiet hours (null when start = end): an alert waits only for these, when the firm says so. */
  firmQuiet?: { start: string; end: string } | null;
  digestEnabled: boolean;
  digestTime: string;
  /** The phone's switch is on and a phone is registered. */
  pushReachable: boolean;
};

type PersonRow = {
  membershipId: string; userId: string; name: string; personZone: string | null; deviceZone: string | null; preferredZone: string | null;
  quietStart: string | null; quietEnd: string | null; digestEnabled: boolean | null; digestTime: string | null; pushReachable: boolean;
};

const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null);

/** Active members by membership id, with their reminder settings resolved against the firm's. */
export async function readStaffPeople(db: Db, workspaceId: string, membershipIds: readonly string[], firm: ReminderSettings, workspaceZone: string): Promise<Map<string, StaffPerson>> {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await db.query<PersonRow>(
    `SELECT membership.id AS "membershipId", membership.user_id AS "userId",
            coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
            person.time_zone AS "personZone", device.timezone AS "deviceZone", account.preferred_timezone AS "preferredZone",
            person.quiet_start::text AS "quietStart", person.quiet_end::text AS "quietEnd",
            person.digest_enabled AS "digestEnabled", person.digest_time::text AS "digestTime",
            EXISTS (SELECT 1 FROM notification_preferences master WHERE master.workspace_id = membership.workspace_id AND master.recipient_type = 'user'
                     AND master.recipient_id = membership.user_id AND master.channel = 'push' AND master.event_type = '*' AND master.enabled)
              AND EXISTS (SELECT 1 FROM device_endpoints endpoint WHERE endpoint.workspace_id = membership.workspace_id AND endpoint.user_id = membership.user_id
                     AND endpoint.status = 'active') AS "pushReachable"
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id
       LEFT JOIN notification_person_settings person ON person.workspace_id = membership.workspace_id AND person.membership_id = membership.id
       LEFT JOIN LATERAL (SELECT endpoint.timezone FROM device_endpoints endpoint WHERE endpoint.workspace_id = membership.workspace_id
                           AND endpoint.user_id = membership.user_id AND endpoint.status = 'active' ORDER BY endpoint.last_seen_at DESC NULLS LAST LIMIT 1) device ON true
      WHERE membership.workspace_id = $1 AND membership.id = ANY($2::uuid[]) AND membership.status = 'active'`,
    [workspaceId, ids])).rows;
  return new Map(rows.map((row) => {
    const quietStart = hhmm(row.quietStart) ?? firm.quietStart;
    const quietEnd = hhmm(row.quietEnd) ?? firm.quietEnd;
    return [row.membershipId, {
      membershipId: row.membershipId,
      userId: row.userId,
      name: row.name,
      timeZone: resolveRecipientZone(row.personZone, row.deviceZone, row.preferredZone, workspaceZone),
      quiet: quietStart === quietEnd ? null : { start: quietStart, end: quietEnd },
      ownQuiet: Boolean(row.quietStart && row.quietEnd),
      firmQuiet: firm.quietStart === firm.quietEnd ? null : { start: firm.quietStart, end: firm.quietEnd },
      digestEnabled: row.digestEnabled ?? true,
      digestTime: hhmm(row.digestTime) ?? firm.digestTime,
      pushReachable: row.pushReachable,
    }];
  }));
}

/** Owners and administrators (system roles), active. */
export async function readAdmins(db: Db, workspaceId: string, codes: readonly string[] = ["owner", "administrator"]): Promise<string[]> {
  return (await db.query<{ membershipId: string }>(
    `SELECT DISTINCT membership.id AS "membershipId" FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id AND role.is_system AND role.code = ANY($2::text[])
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY membership.id`, [workspaceId, codes])).rows.map((row) => row.membershipId);
}

/** Active members holding any of these permissions. */
export async function readPermissionHolders(db: Db, workspaceId: string, permissions: readonly string[]): Promise<string[]> {
  return (await db.query<{ membershipId: string }>(
    `SELECT DISTINCT membership.id AS "membershipId" FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY membership.id`, [workspaceId, permissions])).rows.map((row) => row.membershipId);
}

/** The membership of each user (active), for sources that know people by user id. */
export async function membershipsOfUsers(db: Db, workspaceId: string, userIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const rows = (await db.query<{ userId: string; membershipId: string }>(
    `SELECT user_id AS "userId", id AS "membershipId" FROM workspace_memberships WHERE workspace_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, ids])).rows;
  return new Map(rows.map((row) => [row.userId, row.membershipId]));
}

export const validZone = (value: string | null | undefined, fallback: string) => (isTimeZone(value) ? value : fallback);
