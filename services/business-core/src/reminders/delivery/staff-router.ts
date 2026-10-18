import { addDays, wallClock, zonedInstant } from "../../booking/booking.domain";
import { defaultNoticeChoices, noticeSendAt, planNotice, readNoticeChoices, type HoldPolicy, type NoticeChannel } from "../../notifications/notice-choices";
import { workdays } from "../../project-core/work-calendar";
import type { HoursWindow, ReminderChannel } from "../reminders-contract";
import type { Db, ReminderClock } from "../engine/engine";
import { insertNotice, reminderNoticeKey, type TemplateCache } from "./notices";
import type { StaffPerson } from "./people";

/** One staff send of a step: the people, the template, the channels the rule lists. */
export type StaffSend = {
  workspaceId: string;
  /** The step the notices belong to (recorded on them); null for a notice that is no step's (the digest). */
  stepId: string | null;
  /** Template code (reminders.<kind>, reminders.escalated, a client kind's staff copy, reminders.unreachable). */
  code: string;
  eventType: string;
  critical: boolean;
  channels: readonly ReminderChannel[];
  recipients: readonly StaffPerson[];
  variables: (person: StaffPerson) => Record<string, string>;
  deepLink: string | null;
  now: Date;
  /** Non-critical reminders the person gets in their digest instead (the rule's digest switch). */
  digest: boolean;
  /**
   * A reminder on the person's own My day: a push or email held for their quiet hours is folded into their digest
   * when the digest goes first (it lists the item), instead of arriving beside it. The in-app notice stays.
   */
  foldHeldIntoDigest?: boolean;
  criticalBreaksQuiet: boolean;
  /** The rule's own quiet hours (used for people who didn't set theirs). */
  ruleQuiet: HoursWindow | null;
  calendar: Pick<ReminderClock, "workingDays" | "holidays">;
  templates: TemplateCache;
  /** The notice key; defaults to `rem:{stepId}:{membership}:{channel}`. */
  noticeKey?: (membershipId: string, channel: string) => string;
};

export type StaffSendResult = {
  /** Reached now on at least one channel (an in-app notice, or a push or email queued). */
  delivered: string[];
  digested: string[];
  muted: string[];
  /** People whose held push or email was folded into their digest (their digest goes first). */
  folded: string[];
  channels: ReminderChannel[];
  notificationIds: string[];
  /** Pushes and emails waiting for the end of someone's quiet hours. */
  heldUntil: Date | null;
};

/** The firm's side of the clock for one person: the rule's quiet hours, else the firm's, and its working days. */
function holdFor(person: StaffPerson, options: { criticalBreaksQuiet: boolean; ruleQuiet: HoursWindow | null; calendar: Pick<ReminderClock, "workingDays" | "holidays"> }): HoldPolicy {
  const firm = person.ownQuiet ? person.firmQuiet ?? null : person.quiet;
  return { quiet: options.ruleQuiet ?? firm, criticalBreaksQuiet: options.criticalBreaksQuiet, calendar: options.calendar };
}

const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return (hour || 0) * 60 + (minute || 0); };

/**
 * The next time a person's digest goes: their digest time today if it is still ahead, else on their next working day
 * (in their zone). Null when they switched the digest off.
 */
export function nextDigestAt(person: Pick<StaffPerson, "timeZone" | "digestTime" | "digestEnabled">, now: Date, calendar: Pick<ReminderClock, "workingDays" | "holidays">): Date | null {
  if (!person.digestEnabled) return null;
  const local = wallClock(now.getTime(), person.timeZone);
  const at = minutesOf(person.digestTime);
  const working = workdays({ workingDays: calendar.workingDays, holidays: calendar.holidays });
  for (let offset = local.minutes < at ? 0 : 1; offset <= 14; offset += 1) {
    const day = addDays(local.date, offset);
    if (!working.isWorking(day)) continue;
    const instant = zonedInstant(day, at, person.timeZone, "compatible");
    return instant === null ? null : new Date(instant);
  }
  return null;
}

/**
 * When a person's push or email may go (notice-choices.ts noticeSendAt): now, or the end of their quiet hours (their
 * own, else the rule's, else the firm's) in their zone; a non-critical one also waits for a working day. A critical
 * one ignores the person's own quiet hours and breaks the firm's only when the firm said so.
 */
export function staffSendAt(person: StaffPerson, now: Date, options: { critical: boolean; criticalBreaksQuiet: boolean; ruleQuiet: HoursWindow | null; calendar: Pick<ReminderClock, "workingDays" | "holidays"> }): Date {
  return noticeSendAt({ channel: "email", critical: options.critical, now, quiet: person.ownQuiet ? person.quiet : null, timeZone: person.timeZone, hold: holdFor(person, options) });
}

/**
 * Staff delivery (plan §6.24a "Channels"): in-app now (always for critical), then push and branded email from the
 * rule's channels, held to the end of quiet hours. Each person's choices decide (notice-choices.ts planNotice): a
 * channel they switched off for the notice's group or kind isn't used unless the item is critical (R13), which also
 * goes by their fastest channel; the phone's own switch is never overridden. Idempotent per step, recipient and channel.
 */
export async function deliverToStaff(db: Db, send: StaffSend): Promise<StaffSendResult> {
  const result: StaffSendResult = { delivered: [], digested: [], muted: [], folded: [], channels: [], notificationIds: [], heldUntil: null };
  if (!send.recipients.length) return result;
  const choices = await readNoticeChoices(db, send.workspaceId, send.recipients.map((person) => person.userId), send.eventType);
  // Team members have no WhatsApp number on record: their reminders go in the app, on the phone and by email.
  const asked = send.channels.filter((channel): channel is NoticeChannel => channel !== "whatsapp");
  const available: NoticeChannel[] = [];
  for (const channel of ["in_app", "push", "email"] as const) if (await send.templates.get(send.code, channel)) available.push(channel);
  const used = new Set<ReminderChannel>();
  for (const person of send.recipients) {
    const found = choices.get(person.userId) ?? defaultNoticeChoices(person.userId, send.eventType);
    // The router's view of the person (their zone and the phone's reach) is the one the reminder was planned with.
    const mine = { ...found, timeZone: person.timeZone, reach: { ...found.reach, push: person.pushReachable ? "ok" as const : found.reach.push === "ok" ? "no_device" as const : found.reach.push },
      workspaceChannels: person.pushReachable && !found.workspaceChannels.includes("push") ? [...found.workspaceChannels, "push" as const] : found.workspaceChannels };
    const plan = planNotice(mine, { channels: asked, available, critical: send.critical, now: send.now, hold: holdFor(person, send) });
    if (!plan.sends.length && plan.skipped.length && plan.skipped.every((skip) => skip.reason === "recipient_preference")) { result.muted.push(person.membershipId); continue; }
    if (send.digest && !send.critical && person.digestEnabled) { result.digested.push(person.membershipId); continue; }
    const variables = send.variables(person);
    let reached = false;
    // When the person's digest goes before (or as) their quiet hours end, the held push and email wait in it instead.
    const digestAt = send.foldHeldIntoDigest && !send.critical ? nextDigestAt(person, send.now, send.calendar) : null;
    let folded = false;
    for (const planned of plan.sends) {
      const channel = planned.channel as "in_app" | "push" | "email";
      if (digestAt && planned.held && channel !== "in_app" && digestAt.getTime() <= planned.at.getTime()) { folded = true; continue; }
      const template = await send.templates.get(send.code, channel);
      if (!template) continue;
      const id = await insertNotice(db, {
        workspaceId: send.workspaceId, template, variables, recipientType: "user", recipientId: person.userId, channel, eventType: send.eventType,
        scheduledFor: planned.at, now: send.now, deepLink: send.deepLink, silent: planned.silent,
        idempotencyKey: send.noticeKey ? send.noticeKey(person.membershipId, channel) : reminderNoticeKey(send.stepId ?? "none", person.membershipId, channel), critical: send.critical, stepId: send.stepId,
      });
      // A key already used is the same notice from an earlier pass: it still counts as reached.
      reached = true;
      used.add(channel);
      if (id) result.notificationIds.push(id);
      if (planned.held) result.heldUntil = result.heldUntil && result.heldUntil < planned.at ? result.heldUntil : planned.at;
    }
    if (reached) result.delivered.push(person.membershipId);
    if (folded) result.folded.push(person.membershipId);
  }
  result.channels = [...used];
  return result;
}
