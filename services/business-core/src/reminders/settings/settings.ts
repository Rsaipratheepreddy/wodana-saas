import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import {
  ENGINE_REMINDER_KINDS, REMINDER_CHAIN_LINKS, REMINDER_CHANNELS, REMINDER_KIND_INFO, REMINDER_RULE_LIMITS, REMINDER_UNITS,
  type EngineReminderKind, type HoursWindow, type ReminderAudience, type ReminderChainLink, type ReminderChannel, type ReminderModule, type ReminderUnit,
} from "../reminders-contract";
import { isTimeZone, type ReminderRule } from "../engine/engine";
import type { ReminderSettings } from "../engine/context";

// Structural copies of the settings shapes in packages/contracts/src/reminders.ts.
export type ReminderRuleDto = {
  kind: EngineReminderKind; module: ReminderModule; audience: ReminderAudience; critical: boolean; enabled: boolean; offsets: number[]; unit: ReminderUnit;
  workingDays: boolean; escalateAfter: number | null; chain: ReminderChainLink[]; channels: ReminderChannel[]; digest: boolean; quietHours: HoursWindow | null;
  isDefault: boolean; version: number;
};
export type ReminderRuleInput = Omit<ReminderRuleDto, "kind" | "module" | "audience" | "critical" | "isDefault">;
export type ReminderSettingsDto = Omit<ReminderSettings, never>;
export type NotificationPersonSettingsDto = { digestEnabled: boolean; digestTime: string | null; quietHours: HoursWindow | null; timeZone: string | null; version: number };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STAFF_CHANNELS: readonly ReminderChannel[] = ["in_app", "push", "email"];
const CLIENT_CHANNELS: readonly ReminderChannel[] = ["whatsapp", "email"];

export const isEngineKind = (value: string): value is EngineReminderKind => (ENGINE_REMINDER_KINDS as readonly string[]).includes(value);

export function ruleDto(rule: ReminderRule): ReminderRuleDto {
  const info = REMINDER_KIND_INFO[rule.kind];
  return { kind: rule.kind, module: info.module, audience: info.audience, critical: info.critical, enabled: rule.enabled, offsets: [...rule.offsets], unit: rule.unit,
    workingDays: rule.workingDays, escalateAfter: rule.escalateAfter, chain: [...rule.chain], channels: [...rule.channels], digest: rule.digest,
    quietHours: rule.quietHours, isDefault: rule.version === 0, version: rule.version };
}

function time(value: unknown, label: string): string {
  if (typeof value !== "string" || !HHMM.test(value)) throw new BadRequestException(`${label} must be a time (HH:MM).`);
  return value;
}

function window(value: unknown, label: string, ordered: boolean): HoursWindow | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new BadRequestException(`${label} is not valid.`);
  const start = time((value as HoursWindow).start, `${label} start`);
  const end = time((value as HoursWindow).end, `${label} end`);
  if (start === end) throw new BadRequestException(`${label} needs a start and an end that differ.`);
  if (ordered && start > end) throw new BadRequestException(`${label} must end after it starts.`);
  return { start, end };
}

/**
 * A rule as the firm may set it (the database checks the same bounds): 1 to 6 ascending offsets within ±90 days or
 * ±720 hours, escalation after 1 to 6 reminders or never, a chain of at most 3 distinct links, the channels the kind's
 * audience uses (staff: in-app, push, email; clients: WhatsApp, email). A critical kind is always on, in the app,
 * and never only in the digest.
 */
export function validateRule(kind: EngineReminderKind, input: ReminderRuleInput): Omit<ReminderRule, "version" | "kind"> {
  const info = REMINDER_KIND_INFO[kind];
  if (typeof input.enabled !== "boolean") throw new BadRequestException("Say whether the reminder is on.");
  if (info.critical && !input.enabled) throw new UnprocessableEntityException("This reminder is critical and always on.");
  const unit = input.unit;
  if (!(REMINDER_UNITS as readonly string[]).includes(unit)) throw new BadRequestException("The unit is days or hours.");
  if (!Array.isArray(input.offsets) || !input.offsets.length) throw new BadRequestException("Choose when the reminders go.");
  const offsets = [...new Set(input.offsets.map(Number))].sort((left, right) => left - right);
  if (offsets.length > REMINDER_RULE_LIMITS.maxOffsets) throw new UnprocessableEntityException(`Choose at most ${REMINDER_RULE_LIMITS.maxOffsets} reminders.`);
  const range = REMINDER_RULE_LIMITS.offsetRange[unit];
  if (offsets.some((offset) => !Number.isInteger(offset) || Math.abs(offset) > range)) throw new UnprocessableEntityException(`Each reminder is a whole number of ${unit === "day" ? "days" : "hours"}, up to ${range} either side.`);
  const escalateAfter = input.escalateAfter === null || input.escalateAfter === undefined ? null : Number(input.escalateAfter);
  if (escalateAfter !== null && (!Number.isInteger(escalateAfter) || escalateAfter < 1 || escalateAfter > REMINDER_RULE_LIMITS.maxEscalateAfter)) {
    throw new UnprocessableEntityException(`Escalate after 1 to ${REMINDER_RULE_LIMITS.maxEscalateAfter} reminders, or never.`);
  }
  if (!Array.isArray(input.chain)) throw new BadRequestException("The escalation chain is a list.");
  if (input.chain.some((link) => !(REMINDER_CHAIN_LINKS as readonly string[]).includes(link))) throw new BadRequestException("Unknown escalation link.");
  const chain = [...new Set(input.chain)];
  if (chain.length !== input.chain.length) throw new UnprocessableEntityException("Each person in the chain appears once.");
  if (chain.length > REMINDER_RULE_LIMITS.maxChain) throw new UnprocessableEntityException(`The chain has at most ${REMINDER_RULE_LIMITS.maxChain} steps.`);
  if (!Array.isArray(input.channels) || !input.channels.length) throw new UnprocessableEntityException("Choose at least one channel.");
  if (input.channels.some((channel) => !(REMINDER_CHANNELS as readonly string[]).includes(channel))) throw new BadRequestException("Unknown channel.");
  const allowed = info.audience === "client" ? CLIENT_CHANNELS : STAFF_CHANNELS;
  const channels = REMINDER_CHANNELS.filter((channel) => input.channels.includes(channel));
  if (channels.some((channel) => !allowed.includes(channel))) throw new UnprocessableEntityException(info.audience === "client" ? "Clients are reminded on WhatsApp or by email." : "The team is reminded in the app, on the phone or by email.");
  if (info.critical && info.audience === "staff" && !channels.includes("in_app")) throw new UnprocessableEntityException("A critical reminder always shows in the app.");
  if (typeof input.workingDays !== "boolean" || typeof input.digest !== "boolean") throw new BadRequestException("Working days and digest are on or off.");
  if (info.critical && input.digest) throw new UnprocessableEntityException("A critical reminder is never only in the digest.");
  if (info.audience === "client" && input.digest) throw new UnprocessableEntityException("Clients don't get a digest.");
  return { enabled: input.enabled, offsets, unit, workingDays: input.workingDays, escalateAfter, chain, channels, digest: input.digest, quietHours: window(input.quietHours, "Quiet hours", false) };
}

export function validateSettings(input: ReminderSettingsDto): Omit<ReminderSettings, "version"> {
  const quietStart = time(input.quietStart, "Quiet hours start");
  const quietEnd = time(input.quietEnd, "Quiet hours end");
  const digestTime = time(input.digestTime, "Digest time");
  if (typeof input.criticalBreaksQuiet !== "boolean") throw new BadRequestException("Say whether critical reminders break quiet hours.");
  return { quietStart, quietEnd, digestTime, clientWindow: window(input.clientWindow, "The client window", true), criticalBreaksQuiet: input.criticalBreaksQuiet };
}

export function validatePersonSettings(input: NotificationPersonSettingsDto): Omit<NotificationPersonSettingsDto, "version"> {
  if (typeof input.digestEnabled !== "boolean") throw new BadRequestException("Say whether you want the daily digest.");
  const digestTime = input.digestTime === null || input.digestTime === undefined ? null : time(input.digestTime, "Digest time");
  const timeZone = input.timeZone === null || input.timeZone === undefined || input.timeZone === "" ? null : input.timeZone;
  if (timeZone !== null && (!isTimeZone(timeZone) || !/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(timeZone))) throw new BadRequestException("Choose a time zone from the list.");
  return { digestEnabled: input.digestEnabled, digestTime, quietHours: window(input.quietHours, "Quiet hours", false), timeZone };
}
