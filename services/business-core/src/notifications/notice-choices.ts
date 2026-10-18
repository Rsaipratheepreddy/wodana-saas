import type { PoolClient } from "pg";
import { workspaceHours } from "../crm/conversations/inbox/auto-replies";
import { isTimeZone, nextOpenWindow, resolveRecipientZone, type ReminderClock } from "../reminders/engine/engine";
import type { HoursWindow } from "../reminders/reminders-contract";

type Db = Pick<PoolClient, "query">;

/**
 * How each person is told (Settings › Notifications): the one rule every path that tells a team member something goes
 * through, whether it is an in-app notice, an email, a WhatsApp message or a push, from a module, the reminder engine
 * or the notification engine.
 *
 * - A notice belongs to a group by the first part of its event ("site.report_missing" → projects).
 * - Each person switches each group on or off per channel (notification_channel_choices; no row = on). A mute of one
 *   kind of notice ("Mute notices like this", notification_preferences) is more specific and wins over the group.
 * - Only channels the workspace has turned on are used: the app and email always, WhatsApp once it is connected, push
 *   once phones are registered.
 * - An alert (`critical`) ignores the person's switches and their quiet hours: it lands in the app and goes by the
 *   fastest channel the person can be reached on (push, then WhatsApp, then email).
 * - During the person's quiet hours (in their zone: their own, their phone's, else the workspace's region zone) email,
 *   WhatsApp and push wait until the hours end; the in-app notice still lands, silently.
 */
export const NOTICE_CHANNELS = ["in_app", "email", "whatsapp", "push"] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

/** The groups and the event prefixes in each (the same list as the web's notification-modules.ts). */
export const NOTICE_GROUPS = [
  { id: "sales", prefixes: ["crm"] },
  { id: "planning", prefixes: ["design", "quotation", "request", "portal", "client_portal", "pre_project"] },
  { id: "projects", prefixes: ["project", "work", "site", "handover", "warranty", "gallery"] },
  { id: "operations", prefixes: ["purchasing", "stock", "supplier", "factory"] },
  { id: "finance", prefixes: ["payables", "petty_cash", "receivables", "accounting"] },
  { id: "ledger", prefixes: ["books"] },
  { id: "people", prefixes: ["hrms"] },
  { id: "workspace", prefixes: ["account", "workspace", "delivery"] },
] as const;
export type NoticeGroup = (typeof NOTICE_GROUPS)[number]["id"];
export const NOTICE_GROUP_IDS: readonly NoticeGroup[] = NOTICE_GROUPS.map((group) => group.id);

/** Fastest first: the channel an alert takes besides the app. */
export const CHANNEL_SPEED: readonly NoticeChannel[] = ["push", "whatsapp", "email"];

export const isNoticeChannel = (value: unknown): value is NoticeChannel => (NOTICE_CHANNELS as readonly unknown[]).includes(value);
export const isNoticeGroup = (value: unknown): value is NoticeGroup => (NOTICE_GROUP_IDS as readonly unknown[]).includes(value);

/** The group an event belongs to; anything unknown is the workspace's. */
export function noticeGroup(eventType: string | null | undefined): NoticeGroup {
  const prefix = String(eventType ?? "").split(".")[0];
  return NOTICE_GROUPS.find((group) => (group.prefixes as readonly string[]).includes(prefix))?.id ?? "workspace";
}

/** Why a channel isn't used: the person switched it off, the workspace hasn't, or the person can't be reached on it. */
export type NoticeSkip = "recipient_preference" | "channel_off" | "push_off" | "no_device" | "destination_missing";
export type NoticeReach = "ok" | Exclude<NoticeSkip, "recipient_preference" | "channel_off">;

/** One person's choices for one notice, as read from the tables. */
export type NoticeChoices = {
  userId: string;
  membershipId: string | null;
  group: NoticeGroup;
  /** On or off per channel after the most specific switch wins; a channel without one is on. */
  switches: Partial<Record<NoticeChannel, boolean>>;
  /** The person's own quiet hours. */
  quiet: HoursWindow | null;
  /** The zone the quiet hours are in; null only when no quiet hours apply and the person has no zone of their own. */
  timeZone: string | null;
  /** The channels the workspace has turned on. */
  workspaceChannels: readonly NoticeChannel[];
  reach: Record<NoticeChannel, NoticeReach>;
};

/** The firm's side of the clock, for the reminder engine: its (or a rule's) quiet hours and working days. */
export type HoldPolicy = {
  /** Quiet hours for people who didn't set their own (the rule's, else the firm's). An alert waits for these only. */
  quiet: HoursWindow | null;
  /** The firm lets alerts through its quiet hours. */
  criticalBreaksQuiet: boolean;
  /** Non-critical sends also wait for a working day. */
  calendar?: Pick<ReminderClock, "workingDays" | "holidays">;
};

export type NoticeRequest = { critical: boolean; now: Date; hold?: HoldPolicy };
export type NoticeSend = { channel: NoticeChannel; send: true; at: Date; held: boolean; silent: boolean; forced?: boolean };
export type NoticeDecision = NoticeSend | { channel: NoticeChannel; send: false; reason: NoticeSkip };
export type NoticePlan = { sends: NoticeSend[]; skipped: Array<Extract<NoticeDecision, { send: false }>> };

const insideQuiet = (now: Date, quiet: HoursWindow | null, zone: string | null) =>
  Boolean(quiet && zone && nextOpenWindow(now, quiet, zone).getTime() > now.getTime());

/**
 * When a send may go. In-app is always now. An alert is never held by the person's own quiet hours, only by the
 * firm's when the firm said so. Anything else waits for the end of the person's quiet hours (else the firm's, for the
 * reminder engine) and, with a calendar, for a working day.
 */
export function noticeSendAt(input: { channel: NoticeChannel; critical: boolean; now: Date; quiet: HoursWindow | null; timeZone: string | null; hold?: HoldPolicy }): Date {
  if (input.channel === "in_app" || !input.timeZone) return input.now;
  if (input.critical) {
    if (!input.hold || input.hold.criticalBreaksQuiet || !input.hold.quiet) return input.now;
    return nextOpenWindow(input.now, input.hold.quiet, input.timeZone);
  }
  return nextOpenWindow(input.now, input.quiet ?? input.hold?.quiet ?? null, input.timeZone, input.hold?.calendar);
}

/** Whether one channel is used for one notice to one person, and when: their switch first, then the workspace and their reach. */
export function decideChannel(choices: NoticeChoices, channel: NoticeChannel, notice: NoticeRequest): NoticeDecision {
  if (!notice.critical && choices.switches[channel] === false) return { channel, send: false, reason: "recipient_preference" };
  if (channel !== "in_app" && !choices.workspaceChannels.includes(channel)) return { channel, send: false, reason: "channel_off" };
  const reach = choices.reach[channel];
  if (reach !== "ok") return { channel, send: false, reason: reach };
  const at = noticeSendAt({ channel, critical: notice.critical, now: notice.now, quiet: choices.quiet, timeZone: choices.timeZone, hold: notice.hold });
  const silent = channel === "in_app" && !notice.critical && insideQuiet(notice.now, choices.quiet ?? notice.hold?.quiet ?? null, choices.timeZone);
  return { channel, send: true, at, held: at.getTime() > notice.now.getTime(), silent };
}

/**
 * The channels one notice takes to one person. `channels` are the ones the sender asks for; `available` the ones it
 * can send on (a template exists). An alert always lands in the app and also goes by the fastest channel the person
 * can be reached on, whatever they chose.
 */
export function planNotice(choices: NoticeChoices, notice: NoticeRequest & { channels: readonly NoticeChannel[]; available?: readonly NoticeChannel[] }): NoticePlan {
  const can = (channel: NoticeChannel) => !notice.available || notice.available.includes(channel);
  const asked = [...new Set<NoticeChannel>([...(notice.critical ? ["in_app" as const] : []), ...notice.channels])].filter(can);
  const plan: NoticePlan = { sends: [], skipped: [] };
  for (const channel of asked) {
    const decision = decideChannel(choices, channel, notice);
    if (decision.send) plan.sends.push(decision); else plan.skipped.push(decision);
  }
  if (notice.critical) {
    const fastest = CHANNEL_SPEED.filter(can).map((channel) => decideChannel(choices, channel, notice)).find((decision): decision is NoticeSend => decision.send);
    if (fastest && !plan.sends.some((send) => send.channel === fastest.channel)) plan.sends.push({ ...fastest, forced: true });
  }
  plan.sends.sort((left, right) => NOTICE_CHANNELS.indexOf(left.channel) - NOTICE_CHANNELS.indexOf(right.channel));
  return plan;
}

type SwitchRow = { eventType: string; channel: string; enabled: boolean };

/**
 * The most specific switch per channel: this exact kind of notice, then a family of it ("crm.lead.*"), then the
 * person's group switch, then an older single-prefix switch ("crm.*"), then everything ("*", not push: there it is the
 * phone's own switch).
 */
export function resolveSwitches(eventType: string, group: Partial<Record<string, boolean>>, rows: readonly SwitchRow[]): Partial<Record<NoticeChannel, boolean>> {
  const rank = (row: SwitchRow) => {
    if (row.eventType === eventType) return 0;
    if (row.eventType === "*") return 4000;
    const segments = row.eventType.split(".").length - 1;
    // Longer families are more specific; a family of two or more parts beats the group switch, a single prefix doesn't.
    return segments >= 2 ? 1000 - row.eventType.length : 3000 - row.eventType.length;
  };
  const matches = (row: SwitchRow) => row.eventType === eventType || row.eventType === "*"
    || (row.eventType.endsWith(".*") && eventType.startsWith(row.eventType.slice(0, -1)));
  const result: Partial<Record<NoticeChannel, boolean>> = {};
  for (const channel of NOTICE_CHANNELS) {
    const candidates: Array<{ rank: number; enabled: boolean }> = rows
      .filter((row) => row.channel === channel && matches(row) && !(channel === "push" && row.eventType === "*"))
      .map((row) => ({ rank: rank(row), enabled: row.enabled }));
    if (typeof group[channel] === "boolean") candidates.push({ rank: 2000, enabled: group[channel] as boolean });
    candidates.sort((left, right) => left.rank - right.rank);
    if (candidates.length) result[channel] = candidates[0].enabled;
  }
  return result;
}

type ChoiceRow = {
  userId: string; membershipId: string | null; groupSwitches: Record<string, boolean> | null; eventSwitches: SwitchRow[] | null;
  pushSwitch: boolean; pushDevice: boolean; quietStart: string | null; quietEnd: string | null;
  personZone: string | null; deviceZone: string | null; preferredZone: string | null; workspacePush: boolean; workspaceWhatsapp: boolean;
};

const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);

/** Everyone not found (no row) gets the defaults: every switch on, no quiet hours, push not reachable. */
export function defaultNoticeChoices(userId: string, eventType: string): NoticeChoices {
  return { userId, membershipId: null, group: noticeGroup(eventType), switches: {}, quiet: null, timeZone: null, workspaceChannels: ["in_app", "email"],
    reach: { in_app: "ok", email: "ok", whatsapp: "destination_missing", push: "push_off" } };
}

/** The choices of each person (by user id) for one kind of notice, in one query (and the workspace's zone when needed). */
export async function readNoticeChoices(db: Db, workspaceId: string, userIds: readonly string[], eventType: string): Promise<Map<string, NoticeChoices>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const result = new Map<string, NoticeChoices>();
  if (!ids.length) return result;
  const group = noticeGroup(eventType);
  const rows = (await db.query<ChoiceRow>(
    `SELECT account.id AS "userId", membership.id AS "membershipId",
            (SELECT jsonb_object_agg(choice.channel, choice.enabled) FROM notification_channel_choices choice
              WHERE choice.workspace_id = $1 AND choice.membership_id = membership.id AND choice.notice_group = $3) AS "groupSwitches",
            (SELECT jsonb_agg(jsonb_build_object('eventType', mute.event_type, 'channel', mute.channel, 'enabled', mute.enabled))
               FROM notification_preferences mute
              WHERE mute.workspace_id = $1 AND mute.recipient_type = 'user' AND mute.recipient_id = account.id
                AND (mute.event_type::text IN ($4::text, '*') OR (right(mute.event_type::text, 2) = '.*' AND starts_with($4::text, left(mute.event_type::text, -1))))) AS "eventSwitches",
            EXISTS (SELECT 1 FROM notification_preferences phone WHERE phone.workspace_id = $1 AND phone.recipient_type = 'user' AND phone.recipient_id = account.id
                     AND phone.channel = 'push' AND phone.event_type = '*' AND phone.enabled) AS "pushSwitch",
            coalesce(device.present, false) AS "pushDevice",
            person.quiet_start::text AS "quietStart", person.quiet_end::text AS "quietEnd", person.time_zone AS "personZone",
            device.zone AS "deviceZone", account.preferred_timezone AS "preferredZone",
            EXISTS (SELECT 1 FROM device_endpoints endpoint WHERE endpoint.workspace_id = $1 AND endpoint.status = 'active') AS "workspacePush",
            EXISTS (SELECT 1 FROM integration_connections connection WHERE connection.workspace_id = $1 AND connection.provider = 'whatsapp'
                     AND connection.status = 'connected') AS "workspaceWhatsapp"
       FROM users account
       LEFT JOIN workspace_memberships membership ON membership.workspace_id = $1 AND membership.user_id = account.id AND membership.status = 'active'
       LEFT JOIN notification_person_settings person ON person.workspace_id = $1 AND person.membership_id = membership.id
       LEFT JOIN LATERAL (SELECT true AS present, endpoint.timezone AS zone FROM device_endpoints endpoint
                           WHERE endpoint.workspace_id = $1 AND endpoint.user_id = account.id AND endpoint.status = 'active'
                           ORDER BY endpoint.last_seen_at DESC NULLS LAST LIMIT 1) device ON true
      WHERE account.id = ANY($2::uuid[])`,
    [workspaceId, ids, group, eventType])).rows.filter((row) => typeof row?.userId === "string");
  const ownZone = (row: ChoiceRow) => (isTimeZone(row.personZone) ? row.personZone : isTimeZone(row.deviceZone) ? row.deviceZone
    : row.preferredZone !== "UTC" && isTimeZone(row.preferredZone) ? row.preferredZone : null);
  const quietOf = (row: ChoiceRow): HoursWindow | null => {
    const start = hhmm(row.quietStart), end = hhmm(row.quietEnd);
    return start && end && start !== end ? { start, end } : null;
  };
  // The workspace's zone (its region settings) only when someone's quiet hours need it.
  const workspaceZone = rows.some((row) => quietOf(row) && !ownZone(row)) ? (await workspaceHours(db, workspaceId)).timeZone : null;
  for (const row of rows) {
    const quiet = quietOf(row);
    const zone = ownZone(row) ?? (workspaceZone ? resolveRecipientZone(row.personZone, row.deviceZone, row.preferredZone, workspaceZone) : null);
    result.set(row.userId, {
      userId: row.userId, membershipId: row.membershipId, group,
      switches: resolveSwitches(eventType, row.groupSwitches ?? {}, Array.isArray(row.eventSwitches) ? row.eventSwitches : []),
      quiet, timeZone: zone,
      workspaceChannels: NOTICE_CHANNELS.filter((channel) => channel === "in_app" || channel === "email" || (channel === "push" ? row.workspacePush : row.workspaceWhatsapp)),
      // Team members have no WhatsApp number on record, so a WhatsApp message can't reach them.
      reach: { in_app: "ok", email: "ok", whatsapp: "destination_missing", push: !row.pushSwitch ? "push_off" : !row.pushDevice ? "no_device" : "ok" },
    });
  }
  return result;
}

/** One person's choices for one kind of notice (the defaults when they aren't found). */
export async function readNoticeChoice(db: Db, workspaceId: string, userId: string, eventType: string): Promise<NoticeChoices> {
  return (await readNoticeChoices(db, workspaceId, [userId], eventType)).get(userId) ?? defaultNoticeChoices(userId, eventType);
}

/** Whether, and when, one channel is used to tell one person about one notice. */
export async function noticeDecision(db: Db, input: { workspaceId: string; userId: string; eventType: string; channel: NoticeChannel; critical?: boolean; now?: Date }): Promise<NoticeDecision> {
  const choices = await readNoticeChoice(db, input.workspaceId, input.userId, input.eventType);
  return decideChannel(choices, input.channel, { critical: input.critical === true, now: input.now ?? new Date() });
}
