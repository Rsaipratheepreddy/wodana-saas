import { workspaceClock, type Clock } from "../../team-calendars/workspace-clock";
import {
  ENGINE_REMINDER_KINDS, REMINDER_SETTINGS_DEFAULTS,
  type EngineReminderKind, type HoursWindow, type ReminderChainLink, type ReminderChannel, type ReminderUnit,
} from "../reminders-contract";
import { effectiveRule, localDate, type Db, type ReminderRule, type ReminderRuleRow, type ReminderSourceRegistry } from "./engine";

/** The firm's reminder settings (reminder_settings; no row = the contract defaults). */
export type ReminderSettings = {
  quietStart: string;
  quietEnd: string;
  digestTime: string;
  clientWindow: HoursWindow | null;
  criticalBreaksQuiet: boolean;
  /** 0 = no firm row. */
  version: number;
};

/** Everything one sweep of one workspace needs, read once. `now` is the sweep's clock (a fake one in tests). */
export type EngineContext = {
  workspaceId: string;
  now: Date;
  clock: Clock;
  settings: ReminderSettings;
  rules: Map<EngineReminderKind, ReminderRule>;
  sources: ReminderSourceRegistry;
};

const time = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value.slice(0, 5) : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
};

export async function readReminderSettings(db: Db, workspaceId: string): Promise<ReminderSettings> {
  const row = (await db.query<{ quietStart: string; quietEnd: string; digestTime: string; windowStart: string | null; windowEnd: string | null; criticalBreaksQuiet: boolean; version: number }>(
    `SELECT quiet_start::text AS "quietStart", quiet_end::text AS "quietEnd", digest_time::text AS "digestTime",
            client_window_start::text AS "windowStart", client_window_end::text AS "windowEnd",
            critical_breaks_quiet AS "criticalBreaksQuiet", version
       FROM reminder_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  if (!row) return { ...REMINDER_SETTINGS_DEFAULTS, clientWindow: null, version: 0 };
  return {
    quietStart: time(row.quietStart, REMINDER_SETTINGS_DEFAULTS.quietStart),
    quietEnd: time(row.quietEnd, REMINDER_SETTINGS_DEFAULTS.quietEnd),
    digestTime: time(row.digestTime, REMINDER_SETTINGS_DEFAULTS.digestTime),
    clientWindow: row.windowStart && row.windowEnd ? { start: time(row.windowStart, "09:00"), end: time(row.windowEnd, "18:00") } : null,
    criticalBreaksQuiet: row.criticalBreaksQuiet,
    version: Number(row.version),
  };
}

type RuleRow = { kind: EngineReminderKind; enabled: boolean; offsets: number[]; unit: ReminderUnit; workingDays: boolean; escalateAfter: number | null;
  chain: ReminderChainLink[]; channels: ReminderChannel[]; digest: boolean; quietHours: HoursWindow | null; version: number };

/** The rule in force for every engine kind: the firm's row, else the contract default. */
export async function readRules(db: Db, workspaceId: string): Promise<Map<EngineReminderKind, ReminderRule>> {
  const rows = (await db.query<RuleRow>(
    `SELECT kind, enabled, offsets, unit, working_days AS "workingDays", escalate_after AS "escalateAfter", chain, channels, digest,
            quiet_hours AS "quietHours", version
       FROM reminder_rules WHERE workspace_id = $1`, [workspaceId])).rows;
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const rules = new Map<EngineReminderKind, ReminderRule>();
  for (const kind of ENGINE_REMINDER_KINDS) {
    const row = byKind.get(kind);
    const stored: ReminderRuleRow | null = row ? {
      enabled: row.enabled, offsets: row.offsets.map(Number), unit: row.unit, workingDays: row.workingDays,
      escalateAfter: row.escalateAfter === null ? null : Number(row.escalateAfter), chain: row.chain, channels: row.channels, digest: row.digest,
      quietHours: row.quietHours && typeof row.quietHours === "object" ? { start: time(row.quietHours.start, "20:00"), end: time(row.quietHours.end, "08:00") } : null,
      version: Number(row.version),
    } : null;
    rules.set(kind, effectiveRule(kind, stored));
  }
  return rules;
}

/** The workspace's clock (its work calendar, else its region pack) with today taken from the sweep's `now`. */
export async function readClock(db: Db, workspaceId: string, now: Date): Promise<Clock> {
  const clock = await workspaceClock(db, workspaceId);
  return { ...clock, today: localDate(now, clock.timeZone) };
}

export async function loadEngineContext(db: Db, workspaceId: string, sources: ReminderSourceRegistry, now: Date): Promise<EngineContext> {
  // One query at a time: the sweep runs on one transaction's client.
  const clock = await readClock(db, workspaceId, now);
  const settings = await readReminderSettings(db, workspaceId);
  const rules = await readRules(db, workspaceId);
  return { workspaceId, now, clock, settings, rules, sources };
}
