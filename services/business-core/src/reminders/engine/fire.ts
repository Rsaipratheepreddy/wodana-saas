import { addDays, zonedInstant } from "../../booking/booking.domain";
import { recordAudit } from "../../audit/record-audit";
import { clientDailyGate, releaseClientDay } from "../delivery/client-gate";
import { TemplateCache } from "../delivery/notices";
import { readStaffPeople, type StaffPerson } from "../delivery/people";
import { deliverToStaff, type StaffSendResult } from "../delivery/staff-router";
import {
  REMINDER_KIND_DEFAULTS, REMINDER_KIND_INFO, WAITING_REMINDER_KINDS, reminderStepKey, reminderTemplateCode,
  type ClientDecisionKind, type EngineReminderKind, type ReminderChannel, type ReminderSkipReason,
} from "../reminders-contract";
import type { EngineContext } from "./context";
import { clientQuietWindow, localDate, nextOpenWindow, type Db, type ReminderRule, type ReminderSource } from "./engine";
import { escalationRecipients } from "./escalation";
import { inSavepoint, messageOf } from "./savepoint";
import { closeSubjects, doneKeys } from "./scan";
import { normalizeSubject, SUBJECT_COLUMNS, subjectRef, type SubjectRow } from "./subjects";
import { dueText } from "./text";

/** At most this many steps fire per workspace per pass, each in its own savepoint. */
export const FIRE_LIMIT = 500;

export type FireResult = { fired: number; sent: number; digested: number; held: number; skipped: number; cancelled: number; escalated: number; closed: number; errors: string[] };

type StepRow = { stepId: string; dueRevisionOfStep: number; stepKey: string; stepKind: "remind" | "escalate"; level: number; fireAt: Date; subject: SubjectRow };

type Outcome =
  | { state: "sent" | "digested"; recipients: string[]; channels: ReminderChannel[] }
  | { state: "held"; reason: "quiet_hours" | "client_cap" | "client_window"; until: Date }
  | { state: "skipped"; reason: ReminderSkipReason }
  | { state: "cancelled" };

const isWaiting = (kind: string) => (WAITING_REMINDER_KINDS as readonly string[]).includes(kind);
const noEscalation = (subject: SubjectRow) => subject.variables?.noEscalation === "true";

/** The template variables of a send: the subject's snapshot, the "due" phrase in the recipient's zone, and extras. */
function variablesFor(subject: SubjectRow, now: Date, timeZone: string, extra: Record<string, string> = {}): Record<string, string> {
  const { noEscalation: _skip, ...snapshot } = subject.variables ?? {};
  return { ...snapshot, title: subject.title, context: subject.context, due: dueText(subject.dueAt, now, timeZone, isWaiting(subject.kind)), ...extra };
}

async function setOutcome(db: Db, ctx: EngineContext, step: StepRow, outcome: Outcome) {
  if (outcome.state === "sent" || outcome.state === "digested") {
    await db.query(
      `UPDATE reminder_steps SET state = $3, fired_at = $4, recipient_membership_ids = $5::uuid[], channels = $6::text[], skip_reason = NULL, hold_reason = NULL,
              held_until = NULL, version = version + 1, updated_at = $4 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, step.stepId, outcome.state, ctx.now, [...new Set(outcome.recipients)], outcome.channels]);
  } else if (outcome.state === "held") {
    await db.query(
      `UPDATE reminder_steps SET state = 'held', hold_reason = $3, held_until = $4, version = version + 1, updated_at = $5 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, step.stepId, outcome.reason, outcome.until, ctx.now]);
  } else if (outcome.state === "skipped") {
    await db.query(
      `UPDATE reminder_steps SET state = 'skipped', skip_reason = $3, hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $4 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, step.stepId, outcome.reason, ctx.now]);
  } else {
    await db.query(
      `UPDATE reminder_steps SET state = 'cancelled', hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $3 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, step.stepId, ctx.now]);
  }
}

/** The staff outcome of a send: reached now, only digested, or nobody (everyone muted the event). */
function staffOutcome(result: StaffSendResult): Outcome {
  if (result.delivered.length) return { state: "sent", recipients: [...result.delivered, ...result.digested], channels: result.channels };
  if (result.digested.length) return { state: "digested", recipients: result.digested, channels: [] };
  return { state: "skipped", reason: result.muted.length ? "muted" : "no_recipient" };
}

/**
 * The next escalation of a subject, planned once enough reminders went unanswered (the rule's escalate after N): level
 * L after N + L − 1 reminders. A client kind's first level is the staff copy to the owner, then the chain; a staff
 * kind's levels are the chain's. Each level is a step `e:<level>` of the due revision, so it fires once.
 */
async function planEscalation(db: Db, ctx: EngineContext, subject: SubjectRow, rule: ReminderRule, remindersSent: number) {
  if (rule.escalateAfter === null || noEscalation(subject)) return;
  const audience = REMINDER_KIND_INFO[subject.kind].audience;
  const levels = Math.min(6, (audience === "client" ? 1 : 0) + rule.chain.length);
  const planned = Number((await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM reminder_steps WHERE workspace_id = $1 AND subject_id = $2 AND due_revision = $3 AND kind = 'escalate'`,
    [ctx.workspaceId, subject.id, subject.dueRevision])).rows[0]?.count ?? 0);
  const level = planned + 1;
  if (level > levels || remindersSent < rule.escalateAfter + planned) return;
  await db.query(
    `INSERT INTO reminder_steps (workspace_id, subject_id, due_revision, step_key, kind, level, fire_at, state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'escalate', $5, $6, 'planned', $6, $6) ON CONFLICT (workspace_id, subject_id, due_revision, step_key) DO NOTHING`,
    [ctx.workspaceId, subject.id, subject.dueRevision, reminderStepKey.escalate(level), level, ctx.now]);
}

/** The person a step is about, by name, for an escalation notice. */
const ownerName = (people: Map<string, StaffPerson>, subject: SubjectRow) => (subject.ownerMembershipId ? people.get(subject.ownerMembershipId)?.name : null) ?? "Nobody";

type FireDeps = { ctx: EngineContext; templates: TemplateCache };

async function people(db: Db, ctx: EngineContext, ids: readonly (string | null)[]) {
  return readStaffPeople(db, ctx.workspaceId, ids.filter((id): id is string => Boolean(id)), ctx.settings, ctx.clock.timeZone);
}

async function fireStaffRemind(db: Db, { ctx, templates }: FireDeps, step: StepRow, rule: ReminderRule): Promise<Outcome> {
  const { subject } = step;
  const kind = subject.kind as EngineReminderKind;
  const found = await people(db, ctx, [subject.ownerMembershipId, ...subject.ccMembershipIds]);
  const recipients = [...found.values()];
  if (!recipients.length) return { state: "skipped", reason: "no_recipient" };
  const result = await deliverToStaff(db, {
    workspaceId: ctx.workspaceId, stepId: step.stepId, code: reminderTemplateCode.kind(kind), eventType: REMINDER_KIND_INFO[kind].eventType ?? kind,
    critical: subject.critical, channels: rule.channels, recipients, variables: (person) => variablesFor(subject, ctx.now, person.timeZone), deepLink: subject.href,
    now: ctx.now, digest: rule.digest, criticalBreaksQuiet: ctx.settings.criticalBreaksQuiet, ruleQuiet: rule.quietHours, calendar: ctx.clock, templates,
  });
  return staffOutcome(result);
}

async function fireEscalation(db: Db, { ctx, templates }: FireDeps, step: StepRow, rule: ReminderRule): Promise<Outcome> {
  const { subject } = step;
  const kind = subject.kind as EngineReminderKind;
  const audience = REMINDER_KIND_INFO[kind].audience;
  const staffCopy = audience === "client" && step.level === 1;
  let ids: string[];
  if (staffCopy) ids = [subject.ownerMembershipId, ...subject.ccMembershipIds].filter((id): id is string => Boolean(id));
  else {
    const level = audience === "client" ? step.level - 1 : step.level;
    ids = (await escalationRecipients(db, ctx.workspaceId, rule.chain, level, subject))?.membershipIds ?? [];
  }
  const found = await people(db, ctx, [...ids, subject.ownerMembershipId]);
  const recipients = ids.map((id) => found.get(id)).filter((person): person is StaffPerson => Boolean(person));
  if (!recipients.length) return { state: "skipped", reason: "no_recipient" };
  const result = await deliverToStaff(db, {
    workspaceId: ctx.workspaceId, stepId: step.stepId, code: staffCopy ? reminderTemplateCode.staffCopy(kind as ClientDecisionKind) : reminderTemplateCode.escalated,
    eventType: REMINDER_KIND_INFO[kind].eventType ?? kind, critical: subject.critical, channels: audience === "client" ? ["in_app", "push", "email"] : rule.channels,
    recipients, deepLink: subject.href, now: ctx.now, digest: false, criticalBreaksQuiet: ctx.settings.criticalBreaksQuiet, ruleQuiet: rule.quietHours, calendar: ctx.clock, templates,
    variables: (person) => variablesFor(subject, ctx.now, person.timeZone, { owner: ownerName(found, subject), reminders: String(subject.remindersSent) }),
  });
  const outcome = staffOutcome(result);
  if (outcome.state === "sent") {
    await db.query(`UPDATE reminder_subjects SET escalation_level = GREATEST(escalation_level, $3), last_step_at = $4 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, subject.id, step.level, ctx.now]);
    await recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: null, source: "internal", action: "reminders.escalated.v1", entityType: "reminder_subject", entityId: subject.id,
      after: { kind, level: step.level, to: outcome.recipients, reminders: subject.remindersSent, staffCopy } });
  }
  return outcome;
}

/** When the client may next be reminded: inside the client window (else the work calendar's hours) on a working day. */
function clientOpenAt(ctx: EngineContext, from: Date) {
  const window = ctx.settings.clientWindow ?? { start: ctx.clock.start, end: ctx.clock.end };
  return nextOpenWindow(from, clientQuietWindow(window), ctx.clock.timeZone, ctx.clock);
}

/** Tells the subject's owner, once per due revision, that the client couldn't be reached on any channel. */
async function tellUnreachable(db: Db, { ctx, templates }: FireDeps, step: StepRow) {
  const { subject } = step;
  const found = await people(db, ctx, [subject.ownerMembershipId]);
  const recipients = [...found.values()];
  if (!recipients.length) return;
  await deliverToStaff(db, {
    workspaceId: ctx.workspaceId, stepId: step.stepId, code: reminderTemplateCode.unreachable, eventType: REMINDER_KIND_INFO[subject.kind].eventType ?? subject.kind,
    critical: subject.critical, channels: ["in_app", "email"], recipients, deepLink: subject.href, now: ctx.now, digest: false,
    criticalBreaksQuiet: ctx.settings.criticalBreaksQuiet, ruleQuiet: null, calendar: ctx.clock, templates,
    variables: () => ({ client: subject.variables?.client || subject.context || "the client", title: subject.title, context: subject.context }),
    noticeKey: (membershipId, channel) => `rem:unreachable:${subject.id}:${subject.dueRevision}:${membershipId}:${channel}`,
  });
}

async function fireClientRemind(db: Db, deps: FireDeps, step: StepRow, rule: ReminderRule, source: ReminderSource): Promise<Outcome> {
  const { ctx } = deps;
  const { subject } = step;
  if (!subject.partyId || !subject.caseId) return { state: "skipped", reason: "no_recipient" };
  const open = clientOpenAt(ctx, ctx.now);
  if (open.getTime() > ctx.now.getTime()) return { state: "held", reason: "client_window", until: open };
  const day = localDate(ctx.now, ctx.clock.timeZone);
  const key = `rem:${step.stepId}`;
  const priority = REMINDER_KIND_DEFAULTS[subject.kind as EngineReminderKind]?.priority ?? 3;
  const gate = await clientDailyGate(db, ctx.workspaceId, { partyId: subject.partyId, priority, key, localDate: day });
  if (!gate.allowed) {
    // The client already had today's reminder: the next working day's window, in the workspace's zone.
    const midnight = zonedInstant(addDays(day, 1), 0, ctx.clock.timeZone, "compatible") ?? ctx.now.getTime() + 86_400_000;
    return { state: "held", reason: "client_cap", until: clientOpenAt(ctx, new Date(midnight)) };
  }
  const channels = rule.channels.filter((channel): channel is "whatsapp" | "email" => channel === "whatsapp" || channel === "email");
  const result = await source.deliverClient!(db, ctx.workspaceId, {
    subject: { ...subjectRef(subject), title: subject.title, context: subject.context, href: subject.href }, stepId: step.stepId, channels, idempotencyKey: key,
    variables: variablesFor(subject, ctx.now, ctx.clock.timeZone), now: ctx.now,
  });
  if (result.status === "queued" && result.channel) return { state: "sent", recipients: [], channels: [result.channel] };
  if (!gate.replay) await releaseClientDay(db, ctx.workspaceId, subject.partyId, key, day);
  if (result.reason === "unreachable" || result.status === "failed") {
    await tellUnreachable(db, deps, step);
    return { state: "skipped", reason: "unreachable" };
  }
  return { state: "skipped", reason: result.reason ?? "unreachable" };
}

/** One step, in order: still open, snoozed, switched off, recipients, mutes and quiet hours, the client cap, deliver. */
async function fireOne(db: Db, deps: FireDeps, step: StepRow): Promise<Outcome> {
  const { ctx } = deps;
  let subject = step.subject;
  const source = ctx.sources.get(subject.kind);
  const rule = ctx.rules.get(subject.kind as EngineReminderKind);
  if (step.dueRevisionOfStep !== subject.dueRevision) return { state: "cancelled" };
  if (!source || !rule || REMINDER_KIND_INFO[subject.kind].notify !== "engine") return { state: "skipped", reason: "disabled" };
  if (subject.status === "snoozed") {
    if (subject.snoozedUntil && subject.snoozedUntil.getTime() <= ctx.now.getTime()) {
      await db.query(`UPDATE reminder_subjects SET status = 'open', snoozed_until = NULL, snooze_reason = NULL, snoozed_by = NULL, version = version + 1, updated_at = $3
                       WHERE workspace_id = $1 AND id = $2 AND status = 'snoozed'`, [ctx.workspaceId, subject.id, ctx.now]);
      subject = { ...subject, status: "open", snoozedUntil: null, snoozeReason: null };
    } else if (step.stepKind === "remind" || !subject.critical) {
      // A critical item's escalation clock keeps running while it is snoozed.
      return { state: "skipped", reason: "snoozed" };
    }
  }
  if (!rule.enabled) return { state: "skipped", reason: "disabled" };
  const current = { ...step, subject };
  if (step.stepKind === "escalate") return fireEscalation(db, deps, current, rule);
  return REMINDER_KIND_INFO[subject.kind].audience === "client" ? fireClientRemind(db, deps, current, rule, source) : fireStaffRemind(db, deps, current, rule);
}

/**
 * The fire step (every pass, plan §6.24a "Fire"): the steps due now, each in its own savepoint. The done predicate is
 * checked first for all of them at once (closed subjects skip their steps as done); client steps go in priority order
 * so a payment reminder wins the day's one client message over a decision. A sent reminder counts towards the
 * subject's escalation, which is planned as its own step.
 */
export async function fireSteps(db: Db, ctx: EngineContext, options: { limit?: number } = {}): Promise<FireResult> {
  const result: FireResult = { fired: 0, sent: 0, digested: 0, held: 0, skipped: 0, cancelled: 0, escalated: 0, closed: 0, errors: [] };
  const rows = (await db.query<{ stepId: string; dueRevisionOfStep: number; stepKey: string; stepKind: "remind" | "escalate"; level: number; fireAt: Date } & SubjectRow>(
    `SELECT step.id AS "stepId", step.due_revision AS "dueRevisionOfStep", step.step_key AS "stepKey", step.kind AS "stepKind", step.level, step.fire_at AS "fireAt",
            ${SUBJECT_COLUMNS}
       FROM reminder_steps step
       JOIN reminder_subjects subject ON subject.workspace_id = step.workspace_id AND subject.id = step.subject_id
      WHERE step.workspace_id = $1 AND step.state IN ('planned', 'held') AND coalesce(step.held_until, step.fire_at) <= $2
      ORDER BY coalesce(step.held_until, step.fire_at), step.id
      LIMIT $3
      FOR UPDATE OF step SKIP LOCKED`, [ctx.workspaceId, ctx.now, options.limit ?? FIRE_LIMIT])).rows;
  let steps: StepRow[] = rows.map(({ stepId, dueRevisionOfStep, stepKey, stepKind, level, fireAt, ...subject }) => ({
    stepId, dueRevisionOfStep: Number(dueRevisionOfStep), stepKey, stepKind, level: Number(level), fireAt, subject: normalizeSubject(subject as SubjectRow) }));

  // 1. Still open? One question per kind; what is done closes (and its steps are skipped as done).
  const done = new Set<string>();
  for (const kind of new Set(steps.map((step) => step.subject.kind))) {
    const source = ctx.sources.get(kind);
    if (!source) continue;
    const mine = steps.filter((step) => step.subject.kind === kind && step.subject.status !== "done" && step.subject.status !== "cancelled");
    try {
      const keys = await inSavepoint(db, () => doneKeys(db, ctx.workspaceId, source, [...new Set(mine.map((step) => step.subject.sourceKey))], { now: ctx.now, today: ctx.clock.today }));
      if (keys.length) {
        result.closed += await closeSubjects(db, ctx.workspaceId, kind, keys, ctx.now);
        for (const step of mine) if (keys.includes(step.subject.sourceKey)) done.add(step.stepId);
      }
    } catch (error) {
      result.errors.push(`${kind} stillOpen: ${messageOf(error)}`);
      for (const step of mine) done.add(step.stepId);
    }
  }
  steps = steps.filter((step) => !done.has(step.stepId) && step.subject.status !== "done" && step.subject.status !== "cancelled");

  // 2. Client steps in priority order (payment, decision, other), then by when they were due.
  const priority = (step: StepRow) => (REMINDER_KIND_INFO[step.subject.kind].audience === "client" && step.stepKind === "remind"
    ? REMINDER_KIND_DEFAULTS[step.subject.kind as EngineReminderKind]?.priority ?? 3 : 0);
  steps.sort((left, right) => priority(left) - priority(right) || left.fireAt.getTime() - right.fireAt.getTime() || left.stepId.localeCompare(right.stepId));

  const deps: FireDeps = { ctx, templates: new TemplateCache(db, ctx.workspaceId) };
  for (const step of steps) {
    try {
      await inSavepoint(db, async () => {
        const outcome = await fireOne(db, deps, step);
        await setOutcome(db, ctx, step, outcome);
        result.fired += 1;
        if (outcome.state === "sent" || outcome.state === "digested") {
          result[outcome.state] += 1;
          if (step.stepKind === "escalate") result.escalated += 1;
          else {
            const counted = (await db.query<{ remindersSent: number }>(
              `UPDATE reminder_subjects SET reminders_sent = reminders_sent + 1, last_step_at = $3 WHERE workspace_id = $1 AND id = $2 RETURNING reminders_sent AS "remindersSent"`,
              [ctx.workspaceId, step.subject.id, ctx.now])).rows[0];
            const rule = ctx.rules.get(step.subject.kind as EngineReminderKind);
            if (rule && counted) await planEscalation(db, ctx, step.subject, rule, Number(counted.remindersSent));
          }
        } else if (outcome.state === "held") result.held += 1;
        else if (outcome.state === "skipped") result.skipped += 1;
        else result.cancelled += 1;
      });
    } catch (error) {
      result.errors.push(`${step.subject.kind} ${step.stepKey}: ${messageOf(error)}`);
    }
  }
  return result;
}
