import type { HoursWindow, ReminderChannel } from "../reminders-contract";
import { nextOpenWindow, type Db, type ReminderClock } from "../engine/engine";
import { insertNotice, reminderNoticeKey, type TemplateCache } from "./notices";
import { readMutes, type StaffPerson } from "./people";

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
  channels: ReminderChannel[];
  notificationIds: string[];
  /** Pushes and emails waiting for the end of someone's quiet hours. */
  heldUntil: Date | null;
};

/**
 * When a person's push or email may go: now, or the end of their quiet hours (their own, else the rule's, else the
 * firm's) in their zone; a non-critical one also waits for a working day. A critical one breaks quiet hours only
 * when the firm said so.
 */
export function staffSendAt(person: StaffPerson, now: Date, options: { critical: boolean; criticalBreaksQuiet: boolean; ruleQuiet: HoursWindow | null; calendar: Pick<ReminderClock, "workingDays" | "holidays"> }): Date {
  if (options.critical && options.criticalBreaksQuiet) return now;
  const quiet = person.ownQuiet ? person.quiet : options.ruleQuiet ?? person.quiet;
  return nextOpenWindow(now, quiet, person.timeZone, options.critical ? undefined : options.calendar);
}

/**
 * Staff delivery (plan §6.24a "Channels"): in-app now (always for critical), then push and branded email from the
 * rule's channels, held to the end of quiet hours. A muted event (the person's preference for it or its module) is
 * not sent unless the item is critical (R13); the phone's own switch is never overridden. Idempotent per step,
 * recipient and channel.
 */
export async function deliverToStaff(db: Db, send: StaffSend): Promise<StaffSendResult> {
  const result: StaffSendResult = { delivered: [], digested: [], muted: [], channels: [], notificationIds: [], heldUntil: null };
  if (!send.recipients.length) return result;
  const mutes = send.critical ? null : await readMutes(db, send.workspaceId, send.recipients.map((person) => person.userId), send.eventType);
  const channels = new Set<ReminderChannel>(send.channels.filter((channel) => channel !== "whatsapp"));
  if (send.critical) channels.add("in_app");
  const used = new Set<ReminderChannel>();
  for (const person of send.recipients) {
    const muted = mutes?.get(person.userId) ?? { in_app: false, push: false, email: false };
    const open = [...channels].filter((channel) => !muted[channel as keyof typeof muted]);
    if (!open.length) { result.muted.push(person.membershipId); continue; }
    if (send.digest && !send.critical && person.digestEnabled) { result.digested.push(person.membershipId); continue; }
    const variables = send.variables(person);
    const sendAt = staffSendAt(person, send.now, send);
    let reached = false;
    for (const channel of (["in_app", "push", "email"] as const).filter((item) => open.includes(item))) {
      if (channel === "push" && !person.pushReachable) continue;
      const template = await send.templates.get(send.code, channel);
      if (!template) continue;
      const id = await insertNotice(db, {
        workspaceId: send.workspaceId, template, variables, recipientType: "user", recipientId: person.userId, channel, eventType: send.eventType,
        scheduledFor: channel === "in_app" ? send.now : sendAt, now: send.now, deepLink: send.deepLink,
        idempotencyKey: send.noticeKey ? send.noticeKey(person.membershipId, channel) : reminderNoticeKey(send.stepId ?? "none", person.membershipId, channel), critical: send.critical, stepId: send.stepId,
      });
      // A key already used is the same notice from an earlier pass: it still counts as reached.
      reached = true;
      used.add(channel);
      if (id) result.notificationIds.push(id);
      if (channel !== "in_app" && sendAt.getTime() > send.now.getTime()) result.heldUntil = result.heldUntil && result.heldUntil < sendAt ? result.heldUntil : sendAt;
    }
    if (reached) result.delivered.push(person.membershipId);
  }
  result.channels = [...used];
  return result;
}
