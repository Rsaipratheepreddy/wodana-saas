import { type Db, enabledBooksSettings, postJournal, type PendingEvent } from "../ledger/ledger";
import { recordIssue, resolveIssue } from "./issues";
import { POSTING_ADAPTERS } from "./rules";
import { isIssue, type RuleAdapter } from "./support";

/** At most this many events per workspace per sweep; the rest wait for the next one. */
export const SWEEP_LIMIT = 500;

export type SweepResult = {
  /** Another sweep of this workspace was running (it posts the same events). */
  busy: boolean;
  posted: number;
  existing: number;
  skipped: number;
  issues: number;
  failed: number;
  errors: string[];
};

export type SweepOptions = {
  limit?: number;
  /** Labour reads every project's costs, so the timed sweep runs it less often (default on). */
  labour?: boolean;
  adapters?: ReadonlyArray<RuleAdapter<PendingEvent>>;
};

/**
 * One sweep of one workspace, inside the caller's tenant transaction: each rule's events without a journal, oldest
 * first, are built and posted with `postJournal` (idempotent on the source key); what can't post yet is recorded as
 * an issue. Only one sweep per workspace runs at a time (a transaction-level advisory lock); a second returns busy.
 * Each event runs in its own savepoint, so one bad record never stops the others.
 */
export async function sweepWorkspace(db: Db, workspaceId: string, options: SweepOptions = {}): Promise<SweepResult> {
  const result: SweepResult = { busy: false, posted: 0, existing: 0, skipped: 0, issues: 0, failed: 0, errors: [] };
  const locked = (await db.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtextextended('books_sweep:' || $1::text, 0)) AS locked`, [workspaceId])).rows[0].locked;
  if (!locked) return { ...result, busy: true };
  const settings = await enabledBooksSettings(db, workspaceId);
  if (!settings.length) return result;
  let budget = options.limit ?? SWEEP_LIMIT;
  for (const adapter of options.adapters ?? POSTING_ADAPTERS) {
    if (budget <= 0) break;
    if (adapter.sourceType === "labour" && options.labour === false) continue;
    let events: PendingEvent[];
    try {
      events = await inSavepoint(db, () => adapter.pending(db, workspaceId, settings, budget));
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${adapter.rule}: ${message(error)}`);
      continue;
    }
    for (const event of events) {
      if (budget <= 0) break;
      budget -= 1;
      try {
        await inSavepoint(db, () => postEvent(db, workspaceId, adapter, event, result));
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${adapter.rule} ${event.sourceType}/${event.sourceId}/${event.sourceEvent}: ${message(error)}`);
      }
    }
  }
  return result;
}

/** Builds and posts one event, recording or resolving its issue. */
async function postEvent(db: Db, workspaceId: string, adapter: RuleAdapter<PendingEvent>, event: PendingEvent, result: SweepResult) {
  const built = await adapter.build(db, workspaceId, event);
  if (isIssue(built)) {
    await recordIssue(db, workspaceId, event, built.issue, built.detail);
    result.issues += 1;
    return;
  }
  const outcome = await postJournal(db, workspaceId, built);
  if (outcome.status === "issue") {
    await recordIssue(db, workspaceId, { ...event, legalEntityId: event.legalEntityId ?? built.legalEntityId }, outcome.code, outcome.detail);
    result.issues += 1;
    return;
  }
  result[outcome.status === "skipped" ? "skipped" : outcome.status] += 1;
  await resolveIssue(db, workspaceId, event);
}

let savepoints = 0;
async function inSavepoint<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const name = `books_sweep_${(savepoints = (savepoints + 1) % 1_000_000)}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const value = await work();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);
