import type { PoolClient } from "pg";
import { addDays, wallClock, zonedInstant } from "../../booking/booking.domain";
import type { JobLineageLink } from "../../jobs/job-lineage";
import { workdays } from "../../project-core/work-calendar";
import type { Clock } from "../../team-calendars/workspace-clock";
import {
  REMINDER_KIND_DEFAULTS, REMINDER_KIND_INFO, reminderStepKey,
  type EngineReminderKind, type HoursWindow, type ReminderAudience, type ReminderChainLink, type ReminderChannel, type ReminderKind,
  type ReminderModule, type ReminderNotify, type ReminderUnit,
} from "../reminders-contract";

/**
 * The reminder engine's contract (plan §6.24a): what a source adapter provides, and the pure planning helpers the
 * sweep, the fire step and the delivery routers share. Nothing here reads the database.
 */

export type Db = Pick<PoolClient, "query">;

/** The workspace clock a plan needs: its zone, the start of its working day, its working week and holidays. */
export type ReminderClock = Pick<Clock, "timeZone" | "start" | "workingDays" | "holidays">;

/** One thing that is due, as a source reports it. `key` becomes the subject's source key. */
export type DueItem = {
  key: string;
  sourceType: string;
  sourceId: string;
  /** The record the job is found from (enquiry, opportunity, case, quote or project); null when there is none. */
  jobSource: JobLineageLink | null;
  projectId: string | null;
  caseId: string | null;
  partyId: string | null;
  ownerMembershipId: string | null;
  ccMembershipIds: string[];
  /** When it is due (or, for a waiting item, since when it waits). */
  dueAt: Date;
  title: string;
  context: string;
  /** /workspace/... for staff, /portal/... for a client. */
  href: string;
  /** The template snapshot (strings only). */
  variables: Record<string, string>;
};

export type ReminderActor = { userId: string; membershipId: string };

/** The subject an action or a delivery is about, as the engine stores it. */
export type ReminderSubjectRef = { id: string; kind: ReminderKind; sourceKey: string; sourceType: string; sourceId: string; partyId: string | null; caseId: string | null; projectId: string | null };

export type ClientDelivery = {
  subject: ReminderSubjectRef;
  stepId: string;
  channel: Extract<ReminderChannel, "whatsapp" | "email">;
  /** `rem:{stepId}:{recipient}:{channel}` */
  idempotencyKey: string;
  variables: Record<string, string>;
};
export type ClientDeliveryResult = { status: "queued" | "skipped" | "failed"; notificationId: string | null; reason: string | null };

/**
 * A source adapter (one per kind). `open` lists what is due now; `stillOpen` is the done predicate, re-checked
 * before every send and before My day shows an item. Subjects close only through `stillOpen`; "Mark done" runs the
 * module's own audited command (`complete`), never a flag on the subject.
 */
export interface ReminderSource {
  kind: ReminderKind;
  module: ReminderModule;
  audience: ReminderAudience;
  critical: boolean;
  /** "module": My day only, the module keeps its own notices. */
  notify: ReminderNotify;
  /** Who may see the item in My day (a permission code). */
  viewPermission: string;
  open(db: Db, workspaceId: string, options: { clock: Clock; now: Date; limit: number }): Promise<DueItem[]>;
  /** Of these source keys, the ones still open. */
  stillOpen(db: Db, workspaceId: string, keys: readonly string[]): Promise<Set<string>>;
  complete?: { label: string; run(db: Db, workspaceId: string, subject: ReminderSubjectRef, actor: ReminderActor): Promise<void> };
  reassign?: { permission: string; run(db: Db, workspaceId: string, subject: ReminderSubjectRef, toMembershipId: string, actor: ReminderActor): Promise<void> };
  /** Client kinds: send through the module's own client message (WhatsApp template, branded email). */
  deliverClient?(db: Db, workspaceId: string, delivery: ClientDelivery): Promise<ClientDeliveryResult>;
  template: { code: string };
}

/** Sources by kind; one per kind, each agreeing with the contract's audience, criticality, module and sender. */
export type ReminderSourceRegistry = ReadonlyMap<ReminderKind, ReminderSource>;

/** Nest injection token for the registered sources (sources/ fills it). */
export const REMINDER_SOURCES = Symbol("REMINDER_SOURCES");

export function createSourceRegistry(sources: readonly ReminderSource[]): ReminderSourceRegistry {
  const registry = new Map<ReminderKind, ReminderSource>();
  for (const source of sources) {
    if (registry.has(source.kind)) throw new Error(`Two reminder sources for ${source.kind}`);
    const info = REMINDER_KIND_INFO[source.kind];
    if (!info) throw new Error(`Unknown reminder kind ${source.kind}`);
    for (const field of ["module", "audience", "critical", "notify"] as const) {
      if (source[field] !== info[field]) throw new Error(`${source.kind}: ${field} is ${String(source[field])}, the contract says ${String(info[field])}`);
    }
    if (info.audience === "client" && info.notify === "engine" && !source.deliverClient) throw new Error(`${source.kind}: a client kind needs deliverClient`);
    registry.set(source.kind, source);
  }
  return registry;
}

// ---- Rules -------------------------------------------------------------------------------------------------------

export type ReminderRule = {
  kind: EngineReminderKind;
  enabled: boolean;
  offsets: number[];
  unit: ReminderUnit;
  workingDays: boolean;
  escalateAfter: number | null;
  chain: ReminderChainLink[];
  channels: ReminderChannel[];
  digest: boolean;
  quietHours: HoursWindow | null;
  /** 0 = no firm row, the contract default. */
  version: number;
};

export type ReminderRuleRow = Omit<ReminderRule, "kind">;

/** The rule in force: the firm's row, else the contract default. A critical kind is always on and never digested. */
export function effectiveRule(kind: EngineReminderKind, row: ReminderRuleRow | null | undefined): ReminderRule {
  const defaults = REMINDER_KIND_DEFAULTS[kind];
  const critical = REMINDER_KIND_INFO[kind].critical;
  const rule: ReminderRule = row
    ? { kind, ...row, offsets: [...row.offsets], chain: [...row.chain], channels: [...row.channels] }
    : { kind, enabled: true, offsets: [...defaults.offsets], unit: defaults.unit, workingDays: defaults.workingDays, escalateAfter: defaults.escalateAfter,
        chain: [...defaults.chain], channels: [...defaults.channels], digest: defaults.digest, quietHours: null, version: 0 };
  return critical ? { ...rule, enabled: true, digest: false } : rule;
}

// ---- Planning ----------------------------------------------------------------------------------------------------

export type PlannedStep = {
  stepKey: string;
  kind: "remind";
  level: 0;
  /** The offset in the rule's unit. */
  offset: number;
  fireAt: Date;
  /**
   * With `now`: a step already past that a later past step replaces (only the latest overdue one still fires, so a
   * subject first seen late doesn't send its whole history at once).
   */
  stale: boolean;
};

export type StepPlan = {
  /** The due revision these steps belong to. */
  revision: number;
  /** True when the steps are new: the first plan, or the due moment moved. */
  replanned: boolean;
  /** The revision whose planned steps are cancelled (the due moment moved), else null. */
  supersedes: number | null;
  steps: PlannedStep[];
};

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

/**
 * The working day `offset` working days from `date`: zero or negative counts back to a working day on or before the
 * date (a warning never lands after what it warns about), positive counts forward from the date.
 */
function workingDayFrom(date: string, offset: number, clock: Pick<ReminderClock, "workingDays" | "holidays">) {
  const { isWorking } = workdays({ workingDays: clock.workingDays, holidays: clock.holidays });
  let day = date;
  if (offset <= 0) {
    for (let guard = 0; !isWorking(day) && guard < 400; guard++) day = addDays(day, -1);
    for (let left = -offset, guard = 0; left > 0 && guard < 4000; guard++) { day = addDays(day, -1); if (isWorking(day)) left--; }
    return day;
  }
  for (let left = offset, guard = 0; left > 0 && guard < 4000; guard++) { day = addDays(day, 1); if (isWorking(day)) left--; }
  return day;
}

/**
 * The reminder steps of one due moment. Day offsets fire at the start of the working day (workspace zone) of the
 * due date plus the offset, counted in calendar days or, with `workingDays`, in working days that skip holidays.
 * Hour offsets fire exactly that many hours from the due moment. Keys are `r:<offset>`; escalation steps (`e:<level>`)
 * are planned lazily by the fire step. Pass the subject's previous due moment and revision: an unchanged due moment
 * keeps its revision (planning again is idempotent), a moved one gets the next revision and supersedes the last.
 */
export function planSteps(
  rule: Pick<ReminderRule, "offsets" | "unit" | "workingDays">,
  dueAt: Date,
  clock: ReminderClock,
  options: { previous?: { dueAt: Date | null; revision: number } | null; now?: Date } = {},
): StepPlan {
  if (Number.isNaN(dueAt.getTime())) throw new Error("planSteps needs a due moment");
  const previous = options.previous ?? null;
  const same = previous?.dueAt != null && previous.dueAt.getTime() === dueAt.getTime();
  const revision = previous ? (same ? previous.revision : previous.revision + 1) : 1;
  const offsets = [...new Set(rule.offsets.filter((offset) => Number.isInteger(offset)))].sort((left, right) => left - right);
  const steps: PlannedStep[] = offsets.map((offset) => {
    let fireAt: Date;
    if (rule.unit === "hour") fireAt = new Date(dueAt.getTime() + offset * 3_600_000);
    else {
      const dueDate = wallClock(dueAt.getTime(), clock.timeZone).date;
      const day = rule.workingDays ? workingDayFrom(dueDate, offset, clock) : addDays(dueDate, offset);
      fireAt = new Date(zonedInstant(day, minutesOf(clock.start), clock.timeZone, "compatible") ?? Date.parse(`${day}T00:00:00Z`));
    }
    return { stepKey: reminderStepKey.remind(offset), kind: "remind", level: 0, offset, fireAt, stale: false };
  });
  if (options.now) {
    const past = steps.filter((step) => step.fireAt.getTime() <= options.now!.getTime());
    for (const step of past.slice(0, -1)) step.stale = true;
  }
  return { revision, replanned: !same, supersedes: previous && !same ? previous.revision : null, steps };
}

// ---- Quiet hours, windows and zones ---------------------------------------------------------------------------------

/**
 * The first moment at or after `at` outside the quiet window (local HH:MM in `timeZone`; it may cross midnight) and,
 * when `workdays` is given, on a working day. Without a window (or start = end) only the working day matters.
 */
export function nextOpenWindow(
  at: Date,
  quiet: HoursWindow | null,
  timeZone: string,
  workdayCalendar?: Pick<ReminderClock, "workingDays" | "holidays">,
): Date {
  const from = quiet ? minutesOf(quiet.start) : 0;
  const to = quiet ? minutesOf(quiet.end) : 0;
  const hasQuiet = quiet !== null && from !== to;
  const isWorking = workdayCalendar ? workdays({ workingDays: workdayCalendar.workingDays, holidays: workdayCalendar.holidays }).isWorking : () => true;
  const instant = (date: string, minutes: number) => zonedInstant(date, minutes, timeZone, "compatible") ?? Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  let moment = at.getTime();
  for (let guard = 0; guard < 800; guard++) {
    const local = wallClock(moment, timeZone);
    if (!isWorking(local.date)) {
      // The next day, as soon as it opens (the end of the quiet hours, or midnight).
      const next = addDays(local.date, 1);
      moment = instant(next, hasQuiet && from > to ? to : 0);
      continue;
    }
    if (hasQuiet) {
      const inside = from < to ? local.minutes >= from && local.minutes < to : local.minutes >= from || local.minutes < to;
      if (inside) {
        const endDate = from > to && local.minutes >= from ? addDays(local.date, 1) : local.date;
        moment = instant(endDate, to);
        continue;
      }
    }
    return new Date(moment);
  }
  return new Date(moment);
}

/** A client window (when clients may be messaged) as the quiet hours around it. */
export const clientQuietWindow = (window: HoursWindow): HoursWindow => ({ start: window.end, end: window.start });

/** The local calendar day of an instant in a zone (YYYY-MM-DD). */
export const localDate = (at: Date, timeZone: string) => wallClock(at.getTime(), timeZone).date;

export function isTimeZone(value: string | null | undefined): value is string {
  if (!value || typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A recipient's zone: their own setting, else their phone's, else their profile's (`users.preferred_timezone`,
 * where 'UTC' is the unset default), else the workspace's. Invalid zones are passed over.
 */
export function resolveRecipientZone(person: string | null | undefined, device: string | null | undefined, userPreferred: string | null | undefined, workspace: string): string {
  if (isTimeZone(person)) return person;
  if (isTimeZone(device)) return device;
  if (userPreferred !== "UTC" && isTimeZone(userPreferred)) return userPreferred;
  return isTimeZone(workspace) ? workspace : "UTC";
}

// ---- The client cap -------------------------------------------------------------------------------------------------

export type CapCandidate = {
  partyId: string;
  /** CLIENT_REMINDER_PRIORITY: payment 1, decision 2, other 3. */
  priority: number;
  /** The client's local day (YYYY-MM-DD). */
  localDate: string;
  fireAt: Date;
  /** A stable tie-break (the step id). */
  key: string;
  /** Transactional notices (a quote issued, a receipt) are exempt: always sent, never counted. */
  transactional?: boolean;
};

export const clientDayKey = (partyId: string, date: string) => `${partyId}:${date}`;

/**
 * At most one reminder per party per local day: the highest priority (payment before decision before other) wins,
 * then the earliest, then the key; the rest are held. A party already reminded that day (`alreadySent`, keys from
 * clientDayKey) gets nothing more. Transactional notices pass and don't count.
 */
export function capPriority<T extends CapCandidate>(candidates: readonly T[], alreadySent: ReadonlySet<string> = new Set()): { send: T[]; held: T[] } {
  const send: T[] = [];
  const held: T[] = [];
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    if (candidate.transactional) { send.push(candidate); continue; }
    const key = clientDayKey(candidate.partyId, candidate.localDate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  for (const [key, group] of groups) {
    const ordered = [...group].sort((left, right) => left.priority - right.priority || left.fireAt.getTime() - right.fireAt.getTime() || left.key.localeCompare(right.key));
    if (alreadySent.has(key)) { held.push(...ordered); continue; }
    send.push(ordered[0]);
    held.push(...ordered.slice(1));
  }
  return { send, held };
}
