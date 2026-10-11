import type { ReminderChannel } from "../reminders-contract";
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
      digestEnabled: row.digestEnabled ?? true,
      digestTime: hhmm(row.digestTime) ?? firm.digestTime,
      pushReachable: row.pushReachable,
    }];
  }));
}

/** One person's switches for an event (exact, its module's `prefix.*`, or everything `*`), per channel. */
export type ChannelMutes = Record<Exclude<ReminderChannel, "whatsapp">, boolean>;

/**
 * Which channels a person muted for an event: the most specific preference wins (the event, then its module,
 * then everything), except push, whose `*` row is the phone's own switch (handled as reachability, not a mute).
 */
export async function readMutes(db: Db, workspaceId: string, userIds: readonly string[], eventType: string): Promise<Map<string, ChannelMutes>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, ChannelMutes>(ids.map((id) => [id, { in_app: false, push: false, email: false }]));
  if (!ids.length) return result;
  const rows = (await db.query<{ userId: string; channel: string; eventType: string; enabled: boolean }>(
    `SELECT recipient_id AS "userId", channel::text AS channel, event_type::text AS "eventType", enabled FROM notification_preferences
      WHERE workspace_id = $1 AND recipient_type = 'user' AND recipient_id = ANY($2::uuid[]) AND channel::text IN ('in_app', 'push', 'email')
        AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')`,
    [workspaceId, ids, eventType])).rows;
  const rank = (type: string) => (type === eventType ? 0 : type === "*" ? 2 : 1);
  for (const id of ids) {
    const mine = rows.filter((row) => row.userId === id);
    for (const channel of ["in_app", "push", "email"] as const) {
      const candidates = mine.filter((row) => row.channel === channel && !(channel === "push" && row.eventType === "*")).sort((a, b) => rank(a.eventType) - rank(b.eventType));
      if (candidates[0]?.enabled === false) result.get(id)![channel] = true;
    }
  }
  return result;
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
