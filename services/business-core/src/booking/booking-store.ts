import type { PoolClient } from "pg";
import { workspaceHours } from "../crm/conversations/inbox/auto-replies";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import {
  addDays, computeSlots, parseQuestions, validTimeZone, wallClock, zonedInstant,
  type BookingQuestion, type HostAvailability, type Slot, type WorkCalendar,
} from "./booking.domain";

type Db = Pick<PoolClient, "query">;

export const LIVE_STATUSES = ["pending", "confirmed"] as const;

export type BookingTypeRow = {
  id: string; name: string; slug: string; durationMinutes: number; color: string; locationKind: string; locationDetail: string | null;
  bufferBeforeMinutes: number; bufferAfterMinutes: number; minimumNoticeMinutes: number; windowDays: number; maxPerDay: number | null;
  slotStepMinutes: number; cancelNoticeMinutes: number; questions: BookingQuestion[]; enquiryType: string | null; source: string; channel: string;
  hostsMode: "one" | "round_robin" | "enquiry_type"; confirmation: "automatic" | "approval"; active: boolean; version: number;
  hosts: Array<{ membershipId: string; enquiryType: string | null; position: number; name?: string }>;
};

export const TYPE_COLUMNS = `type.id, type.name, type.slug, type.duration_minutes AS "durationMinutes", type.color, type.location_kind AS "locationKind",
  type.location_detail AS "locationDetail", type.buffer_before_minutes AS "bufferBeforeMinutes", type.buffer_after_minutes AS "bufferAfterMinutes",
  type.minimum_notice_minutes AS "minimumNoticeMinutes", type.window_days AS "windowDays", type.max_per_day AS "maxPerDay",
  type.slot_step_minutes AS "slotStepMinutes", type.cancel_notice_minutes AS "cancelNoticeMinutes", type.questions, type.enquiry_type AS "enquiryType",
  type.source, type.channel, type.hosts_mode AS "hostsMode", type.confirmation, type.active, type.version,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('membershipId', host.membership_id, 'enquiryType', host.enquiry_type, 'position', host.position, 'name', account.display_name)
      ORDER BY host.position, account.display_name)
    FROM booking_type_hosts host JOIN workspace_memberships member ON member.id = host.membership_id AND member.workspace_id = host.workspace_id
    JOIN users account ON account.id = member.user_id
    WHERE host.workspace_id = type.workspace_id AND host.booking_type_id = type.id AND member.status = 'active'), '[]'::jsonb) AS hosts`;

export function mapType(row: Record<string, unknown>): BookingTypeRow {
  return { ...(row as unknown as BookingTypeRow), version: Number(row.version), questions: parseQuestions(row.questions) };
}

export async function loadTypeBySlug(db: Db, workspaceId: string, slug: string, lock = false) {
  const row = (await db.query(`SELECT ${TYPE_COLUMNS} FROM booking_types type WHERE type.workspace_id = $1 AND type.slug = $2${lock ? " FOR SHARE OF type" : ""}`, [workspaceId, slug])).rows[0];
  return row ? mapType(row) : null;
}

export async function loadTypeById(db: Db, workspaceId: string, id: string, lock = false) {
  const row = (await db.query(`SELECT ${TYPE_COLUMNS} FROM booking_types type WHERE type.workspace_id = $1 AND type.id = $2${lock ? " FOR UPDATE OF type" : ""}`, [workspaceId, id])).rows[0];
  return row ? mapType(row) : null;
}

/** The hosts who can take a booking of this type (for "by enquiry type", those for the chosen type or any). */
export function hostsFor(type: BookingTypeRow, enquiryType?: string | null) {
  if (type.hostsMode === "one") return type.hosts.slice(0, 1);
  if (type.hostsMode === "enquiry_type") return type.hosts.filter((host) => !host.enquiryType || host.enquiryType === enquiryType);
  return type.hosts;
}

/** The firm's working calendar: its work calendar's week, hours and holidays, else its region pack's. */
export async function firmCalendar(db: Db, workspaceId: string): Promise<WorkCalendar> {
  const hours = await workspaceHours(db, workspaceId);
  return { timeZone: validTimeZone(hours.timeZone) ?? "UTC", workingDays: hours.workingDays, start: hours.start, end: hours.end, holidays: hours.holidays };
}

/**
 * Everything that makes a host busy or away between two firm-local dates: approved leave (HRMS), their
 * availability overrides, pending meetings they own or attend, live bookings and connected-calendar busy time.
 */
export async function loadHostAvailability(db: Db, workspaceId: string, input: {
  calendar: WorkCalendar; typeId: string; hostIds: string[]; from: string; to: string; ignoreBookingId?: string | null;
}): Promise<HostAvailability[]> {
  if (!input.hostIds.length) return [];
  const rangeStart = new Date(zonedInstant(addDays(input.from, -1), 0, input.calendar.timeZone, "compatible")!);
  const rangeEnd = new Date(zonedInstant(addDays(input.to, 2), 0, input.calendar.timeZone, "compatible")!);
  // One client runs one query at a time: these run in turn.
  const leave = await db.query<{ membershipId: string; start: string; end: string; dayPart: string }>(
      `SELECT membership_id AS "membershipId", start_date::text AS start, end_date::text AS "end", day_part AS "dayPart" FROM hrms_leave_requests
        WHERE workspace_id = $1 AND membership_id = ANY($2::uuid[]) AND status IN ('approved', 'cancellation_pending')
          AND start_date <= $4::date AND end_date >= $3::date`, [workspaceId, input.hostIds, addDays(input.from, -1), addDays(input.to, 1)]);
  const overrides = await db.query<{ membershipId: string; startsOn: string; endsOn: string; kind: "extra" | "blocked"; startTime: string | null; endTime: string | null }>(
      `SELECT membership_id AS "membershipId", starts_on::text AS "startsOn", ends_on::text AS "endsOn", kind,
              to_char(start_time, 'HH24:MI') AS "startTime", to_char(end_time, 'HH24:MI') AS "endTime"
         FROM availability_overrides WHERE workspace_id = $1 AND membership_id = ANY($2::uuid[]) AND starts_on <= $4::date AND ends_on >= $3::date`,
      [workspaceId, input.hostIds, addDays(input.from, -1), addDays(input.to, 1)]);
  const meetings = await db.query<{ owner: string | null; attendees: string[]; startsAt: Date; endsAt: Date }>(
      `SELECT activity.owner_membership_id AS owner, appointment.attendee_membership_ids AS attendees, appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt"
         FROM crm_appointments appointment JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
        WHERE appointment.workspace_id = $1 AND activity.status = 'pending' AND appointment.attendance_status = 'scheduled'
          AND appointment.starts_at < $4 AND appointment.ends_at > $3
          AND (activity.owner_membership_id = ANY($2::uuid[]) OR appointment.attendee_membership_ids ?| $6::text[])
          AND NOT EXISTS (SELECT 1 FROM bookings own WHERE own.workspace_id = activity.workspace_id AND own.activity_id = activity.id AND own.id = $5::uuid)`,
      [workspaceId, input.hostIds, rangeStart, rangeEnd, input.ignoreBookingId ?? null, input.hostIds]);
  const bookings = await db.query<{ host: string; typeId: string; startsAt: Date; endsAt: Date }>(
      `SELECT host_membership_id AS host, booking_type_id AS "typeId", starts_at AS "startsAt", ends_at AS "endsAt" FROM bookings
        WHERE workspace_id = $1 AND host_membership_id = ANY($2::uuid[]) AND status IN ('pending', 'confirmed')
          AND starts_at < $4 AND ends_at > $3 AND ($5::uuid IS NULL OR id <> $5::uuid)`,
      [workspaceId, input.hostIds, rangeStart, rangeEnd, input.ignoreBookingId ?? null]);
  const external = await db.query<{ membershipId: string; startsAt: Date; endsAt: Date }>(
      `SELECT membership_id AS "membershipId", starts_at AS "startsAt", ends_at AS "endsAt" FROM booking_external_busy
        WHERE workspace_id = $1 AND membership_id = ANY($2::uuid[]) AND starts_at < $4 AND ends_at > $3`,
      [workspaceId, input.hostIds, rangeStart, rangeEnd]);
  return input.hostIds.map((membershipId) => {
    const bookedPerDay: Record<string, number> = {};
    for (const booking of bookings.rows) if (booking.host === membershipId && booking.typeId === input.typeId) {
      const date = wallClock(new Date(booking.startsAt).getTime(), input.calendar.timeZone).date;
      bookedPerDay[date] = (bookedPerDay[date] ?? 0) + 1;
    }
    const interval = (row: { startsAt: Date; endsAt: Date }) => ({ start: new Date(row.startsAt).getTime(), end: new Date(row.endsAt).getTime() });
    return {
      membershipId,
      leave: leave.rows.filter((row) => row.membershipId === membershipId).map((row) => ({ start: row.start, end: row.end, dayPart: row.dayPart as "full" })),
      overrides: overrides.rows.filter((row) => row.membershipId === membershipId),
      busy: [
        ...meetings.rows.filter((row) => row.owner === membershipId || (Array.isArray(row.attendees) && row.attendees.includes(membershipId))).map(interval),
        ...bookings.rows.filter((row) => row.host === membershipId).map(interval),
        ...external.rows.filter((row) => row.membershipId === membershipId).map(interval),
      ],
      bookedPerDay,
    };
  });
}

/** Free slots for a type between two firm-local dates. */
export async function slotsFor(db: Db, workspaceId: string, type: BookingTypeRow, input: {
  from: string; to: string; enquiryType?: string | null; hostIds?: string[]; ignoreBookingId?: string | null; now?: Date;
  /** A staff move (another host for a booked time): the visitor's notice and window do not apply. */
  staff?: boolean;
}) {
  const calendar = await firmCalendar(db, workspaceId);
  const hostIds = input.hostIds ?? hostsFor(type, input.enquiryType).map((host) => host.membershipId);
  const hosts = await loadHostAvailability(db, workspaceId, { calendar, typeId: type.id, hostIds, from: input.from, to: input.to, ignoreBookingId: input.ignoreBookingId });
  const slots = computeSlots({
    rules: { durationMinutes: type.durationMinutes, bufferBeforeMinutes: type.bufferBeforeMinutes, bufferAfterMinutes: type.bufferAfterMinutes,
      minimumNoticeMinutes: input.staff ? 0 : type.minimumNoticeMinutes, windowDays: input.staff ? 366 : type.windowDays, maxPerDay: type.maxPerDay, stepMinutes: type.slotStepMinutes },
    calendar, hosts, from: input.from, to: input.to, now: input.now ?? new Date(),
  });
  return { calendar, slots };
}

/** The slot at exactly this start, re-checked now (at confirmation), with the hosts still free for it. */
export async function recheckSlot(db: Db, workspaceId: string, type: BookingTypeRow, start: Date, input: { enquiryType?: string | null; hostIds?: string[]; ignoreBookingId?: string | null }) {
  const calendar = await firmCalendar(db, workspaceId);
  const date = wallClock(start.getTime(), calendar.timeZone).date;
  const { slots } = await slotsFor(db, workspaceId, type, { ...input, from: date, to: date });
  return { calendar, slot: slots.find((slot) => Date.parse(slot.start) === start.getTime()) ?? null };
}

/** The next free slots after a refused one, so the visitor can pick again at once. */
export async function nextSlots(db: Db, workspaceId: string, type: BookingTypeRow, after: Date, enquiryType?: string | null, count = 3): Promise<Slot[]> {
  const calendar = await firmCalendar(db, workspaceId);
  const from = wallClock(after.getTime(), calendar.timeZone).date;
  const { slots } = await slotsFor(db, workspaceId, type, { from, to: addDays(from, 14), enquiryType });
  return slots.filter((slot) => Date.parse(slot.start) > after.getTime()).slice(0, count);
}

/* ── Host notices ─────────────────────────────────────────────────────────────────────────────────── */

/** The booking notices, in the app and by email. Seeded into a workspace the first time it needs them. */
export const BOOKING_NOTICE_TEMPLATES = [
  { code: "booking.created", channel: "in_app", subject: "{{clientName}} booked {{typeName}}", body: "{{when}}", variables: ["clientName", "typeName", "when"] },
  { code: "booking.created", channel: "email", subject: "New booking: {{typeName}} with {{clientName}}", body: "{{clientName}} booked {{typeName}}.\n\nWhen: {{when}}\n\nIt is on your calendar.", variables: ["clientName", "typeName", "when"] },
  { code: "booking.requested", channel: "in_app", subject: "{{clientName}} asked for {{typeName}}", body: "{{when}}. Confirm or decline it.", variables: ["clientName", "typeName", "when"] },
  { code: "booking.requested", channel: "email", subject: "Booking request: {{typeName}} with {{clientName}}", body: "{{clientName}} asked for {{typeName}}.\n\nWhen: {{when}}\n\nConfirm or decline it in Bookings.", variables: ["clientName", "typeName", "when"] },
  { code: "booking.rescheduled", channel: "in_app", subject: "{{clientName}} moved {{typeName}}", body: "Now {{when}}", variables: ["clientName", "typeName", "when"] },
  { code: "booking.rescheduled", channel: "email", subject: "Booking moved: {{typeName}} with {{clientName}}", body: "{{clientName}} moved {{typeName}}.\n\nNow: {{when}}", variables: ["clientName", "typeName", "when"] },
  { code: "booking.cancelled", channel: "in_app", subject: "{{clientName}} cancelled {{typeName}}", body: "{{when}}", variables: ["clientName", "typeName", "when"] },
  { code: "booking.cancelled", channel: "email", subject: "Booking cancelled: {{typeName}} with {{clientName}}", body: "{{clientName}} cancelled {{typeName}}.\n\nIt was {{when}}.", variables: ["clientName", "typeName", "when"] },
  { code: "booking.host_away", channel: "in_app", subject: "{{typeName}} with {{clientName}} needs a host", body: "{{hostName}} is away {{when}}. Choose another host or move it.", variables: ["clientName", "typeName", "when", "hostName"] },
  { code: "booking.host_away", channel: "email", subject: "{{typeName}} with {{clientName}} needs a host", body: "{{hostName}} is away {{when}} and nobody else in the team is free.\n\nChoose another host or move the booking.", variables: ["clientName", "typeName", "when", "hostName"] },
] as const;

export async function ensureBookingTemplates(db: Db, workspaceId: string) {
  for (const template of BOOKING_NOTICE_TEMPLATES) {
    await db.query(
      `INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
       VALUES ($1, $2, $3, 'en', 1, 'approved', $4, $5, $6::jsonb, now())
       ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING`,
      [workspaceId, template.code, template.channel, template.subject, template.body, JSON.stringify(template.variables)]);
  }
}

/** Tells a member about a booking, in the app and by email, once per event key. */
export async function noticeMember(db: Db, workspaceId: string, membershipId: string | null, code: string, variables: Record<string, string>, key: string) {
  if (!membershipId) return;
  const member = (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId])).rows[0];
  if (!member) return;
  await ensureBookingTemplates(db, workspaceId);
  const deepLink = "/workspace/crm/calendar";
  await notifyUserInApp(db, { workspaceId, recipientUserId: member.userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${member.userId}` });
  await queueUserEmail(db, { workspaceId, recipientUserId: member.userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${member.userId}:email` });
}
