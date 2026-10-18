import { DEFAULT_SWEEP_EMAIL_CAP, paceReminderEmails, type PaceResult } from "../delivery/email-pace";
import { runFallbacks, type FallbackResult } from "../delivery/fallback";
import { runDigests, type DigestResult } from "../digest/digest";
import { runHealthAlerts, type HealthAlertResult } from "../digest/health-alerts";
import { loadEngineContext } from "./context";
import type { Db, ReminderSourceRegistry } from "./engine";
import { fireSteps, type FireResult } from "./fire";
import { planSubjects, type PlanResult } from "./plan";
import { inSavepoint, messageOf } from "./savepoint";
import { emitRemindersChanged, scanSources, type ScanResult } from "./scan";
import { watchJourneys } from "../../jobs/journey-watch";

export type SweepOptions = {
  sources: ReminderSourceRegistry;
  /** The sweep's clock (a fake one in tests). */
  now?: Date;
  /** Ask the sources what is due (the timed sweep does it at most every five minutes per workspace). */
  scan?: boolean;
  limit?: number;
  digests?: boolean;
  health?: boolean;
  /** Emails this sweep may hand to delivery (REMINDERS_SWEEP_EMAIL_CAP); the rest carry over to the next minutes. */
  emailCap?: number;
  /** §0.3: look at a batch of jobs' steps and send the progress pushes (the timed sweep, with its scan). */
  journeys?: boolean;
};

export type SweepResult = {
  /** Another sweep of this workspace was running (it does the same work). */
  busy: boolean;
  scan: ScanResult | null;
  plan: PlanResult | null;
  fire: FireResult | null;
  fallback: FallbackResult | null;
  digest: DigestResult | null;
  health: HealthAlertResult | null;
  /** Emails carried over to the next sweeps by the email cap. */
  pace: PaceResult | null;
  /** §0.3: the jobs looked at for a changed step, and the progress pushes that queued. */
  journeys?: Awaited<ReturnType<typeof watchJourneys>> | null;
  errors: string[];
};

/**
 * One sweep of one workspace, inside the caller's tenant transaction (plan §6.24a "Sweep"): scan the sources, plan the
 * steps of what changed, fire what is due, fall back from failed client messages, send the digests that are due and
 * raise delivery alerts, then hold the emails past the sweep's email cap for the next sweeps. Only one sweep per workspace runs at a time (a transaction-level advisory lock); a second
 * returns busy, so two sweeps never send twice. Each phase runs in a savepoint: one failing never undoes the others.
 */
export async function sweepWorkspace(db: Db, workspaceId: string, options: SweepOptions): Promise<SweepResult> {
  const result: SweepResult = { busy: false, scan: null, plan: null, fire: null, fallback: null, digest: null, health: null, pace: null, errors: [] };
  const locked = (await db.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtextextended('reminders_sweep:' || $1::text, 0)) AS locked`, [workspaceId])).rows[0].locked;
  if (!locked) return { ...result, busy: true };
  const now = options.now ?? new Date();
  const ctx = await loadEngineContext(db, workspaceId, options.sources, now);
  const phase = async <T>(name: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await inSavepoint(db, work);
    } catch (error) {
      result.errors.push(`${name}: ${messageOf(error)}`);
      return null;
    }
  };
  if (options.scan !== false) result.scan = await phase("scan", () => scanSources(db, ctx, { limit: options.limit }));
  result.plan = await phase("plan", () => planSubjects(db, ctx, { limit: options.limit }));
  result.fire = await phase("fire", () => fireSteps(db, ctx, { limit: options.limit }));
  result.fallback = await phase("fallback", () => runFallbacks(db, ctx));
  if (options.digests !== false) result.digest = await phase("digest", () => runDigests(db, ctx));
  if (options.health !== false) result.health = await phase("health", () => runHealthAlerts(db, ctx));
  if (options.journeys && options.scan !== false) result.journeys = await phase("journeys", () => watchJourneys(db, workspaceId, { now }));
  // Last, as every phase above may queue emails: past the cap they move to the next minutes (a catch-up sweep).
  result.pace = await phase("pace", () => paceReminderEmails(db, ctx, options.emailCap ?? DEFAULT_SWEEP_EMAIL_CAP));
  for (const part of [result.scan, result.fire, result.fallback, result.digest]) if (part && "errors" in part) result.errors.push(...part.errors);
  const changed = (result.scan ? result.scan.opened + result.scan.changed + result.scan.closed : 0) + (result.fire ? result.fire.fired + result.fire.closed : 0);
  if (changed) await phase("live", () => emitRemindersChanged(db, workspaceId, now));
  return result;
}
