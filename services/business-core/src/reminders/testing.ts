import { zonedInstant } from "../booking/booking.domain";
import { createSourceRegistry, localDate, type Db, type ReminderSourceRegistry } from "./engine/engine";
import { sweepWorkspace } from "./engine/sweep";
import { BUILTIN_REMINDER_SOURCES } from "./sources/index";

/** The built-in sources, as the engine sweeps them (module commands are bound by Nest, not needed in a sweep). */
export const builtinReminderSources = (): ReminderSourceRegistry => createSourceRegistry(BUILTIN_REMINDER_SOURCES);

/** Noon today (or `days` from today) in a zone: a moment when every day's reminders are due and nobody's quiet hours apply. */
export function middayIn(timeZone: string, days = 0, now = new Date()) {
  const day = new Date(Date.parse(`${localDate(now, timeZone)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return new Date(zonedInstant(day, 12 * 60, timeZone, "compatible") ?? now.getTime());
}

/**
 * One reminder sweep of a workspace with the built-in sources (for module tests): asks the sources what is due, plans
 * and sends what is due at `now` (noon in the workspace's zone by default). Inside the caller's transaction.
 */
export function runReminderSweep(db: Db, workspaceId: string, options: { now?: Date; timeZone?: string } = {}) {
  return sweepWorkspace(db, workspaceId, { sources: builtinReminderSources(), now: options.now ?? middayIn(options.timeZone ?? "Asia/Dubai"), scan: true, digests: false, health: false });
}
