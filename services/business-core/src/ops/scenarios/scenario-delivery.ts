import { randomUUID } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client, type PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { sweepWorkspace, type SweepResult } from "../../reminders/engine/sweep";
import { ReminderSourceRegistryService } from "../../reminders/sources/registry.service";

/**
 * No message leaves because a sandbox is seeded (`sandbox --seed/--scenarios`, ops-sandbox.ts). The sandbox's test
 * members sign in with real inboxes (an --email-pattern such as the owner's plus-addresses), and nothing in the CLI's
 * own process delivers: the API's dispatcher and the delivery worker pick up every pending notification row within
 * seconds, whoever wrote it. So, while the run lasts:
 *
 *  - every transaction the CLI opens marks, just before it commits, the email / WhatsApp / push / webhook
 *    notifications written for the run's organizations since the run started as suppressed (reason sandbox_seed),
 *    and their delivery wake-ups (notification.delivery_requested.v1 outbox rows) as handled, so the dispatcher and
 *    the worker never see them pending. In-app notices stay: they deliver nothing outside Wodana.
 *  - the run holds each organization's reminder sweep lock, so the API's reminder engine can't fire reminders on
 *    records that are still being made; at the end the run sweeps the organization itself (My day gets its items)
 *    and suppresses what that first sweep queues, before it lets the lock go. Later reminders (a step due in two days)
 *    behave as the product does.
 *  - the in-process mailer stays held back (ops-sandbox.ts), for what the CLI would send directly.
 *
 * After the run, everything external written for the organization during the run that is still waiting is
 * suppressed too, counted per channel and audited (sandbox.seed_deliveries_suppressed).
 */

export const SANDBOX_SEED = "sandbox_seed";
/** What a suppressed delivery wake-up records instead of being published. */
const OUTBOX_NOTE = `suppressed: ${SANDBOX_SEED} (never published)`;
const WAITING = ["pending", "scheduled", "processing"];
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const sweepLock = (workspaceId: string) => [`reminders_sweep:${workspaceId}`];

export type DeliveryCounts = {
  /** External notifications (not in-app) written for the organization during the run, by channel. */
  byChannel: Record<string, number>;
  total: number;
  /** Suppressed as they were written (in the transaction that wrote them). */
  suppressedDuringRun: number;
  /** Still waiting after the run, suppressed by the final sweep. */
  suppressedAfterRun: number;
  /** Already suppressed for another reason (a missing address, no consent…), left as they were. */
  otherwiseSuppressed: number;
  /** Delivered or handed to a provider before they could be held back (should be 0). */
  delivered: number;
  outboxHandled: number;
};

type TransactionFn = DatabaseService["transaction"];

/** Marks this transaction's (and the run's) waiting external notifications of one organization as suppressed. */
async function suppressWaiting(client: Pick<PoolClient, "query">, workspaceId: string, since: Date): Promise<{ notifications: number; outbox: number }> {
  const ids = (await client.query<{ id: string }>(
    `UPDATE notifications SET status = 'suppressed', suppressed_reason = $2, processing_started_at = NULL, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND channel <> 'in_app' AND status = ANY($3::notification_status[]) AND created_at >= $4
     RETURNING id`, [workspaceId, SANDBOX_SEED, WAITING, since])).rows.map((row) => row.id);
  if (!ids.length) return { notifications: 0, outbox: 0 };
  const outbox = await client.query(
    `UPDATE outbox_events SET status = 'published', published_at = now(), last_error = $3, claimed_at = NULL, claim_token = NULL
      WHERE workspace_id = $1 AND event_type = 'notification.delivery_requested.v1' AND status IN ('pending', 'failed') AND aggregate_id = ANY($2::uuid[])`,
    [workspaceId, ids, OUTBOX_NOTE]);
  return { notifications: ids.length, outbox: outbox.rowCount ?? 0 };
}

/** Runs `work` with the organization as the transaction's tenant, then puts the tenant the transaction had back. */
async function asTenant<T>(client: Pick<PoolClient, "query">, workspaceId: string, work: () => Promise<T>): Promise<T> {
  const previous = (await client.query<{ value: string | null }>(`SELECT current_setting('app.current_workspace_id', true) AS value`)).rows[0]?.value ?? "";
  if (previous !== workspaceId) await client.query(`SELECT set_config('app.current_workspace_id', $1, true)`, [workspaceId]);
  try { return await work(); } finally {
    if (previous !== workspaceId) await client.query(`SELECT set_config('app.current_workspace_id', $1, true)`, [previous]);
  }
}

export class DeliveryHold {
  private lockClient: Client | null = null;
  private original: TransactionFn | null = null;
  readonly since = new Date();

  private constructor(private readonly app: INestApplicationContext, private readonly workspaceIds: readonly string[], private readonly lockReminders: boolean) {}

  private get db() { return this.app.get(DatabaseService, { strict: false }); }

  /**
   * Starts holding deliveries for the organizations: every CLI transaction suppresses their external notifications
   * before it commits, and (with lockReminders) the reminder sweep of each is held by this run.
   */
  static async start(app: INestApplicationContext, workspaceIds: string[], options: { lockReminders: boolean }): Promise<DeliveryHold> {
    const hold = new DeliveryHold(app, [...new Set(workspaceIds)], options.lockReminders);
    hold.patch();
    if (options.lockReminders) await hold.lock();
    return hold;
  }

  private patch() {
    const db = this.db as DatabaseService & { transaction: TransactionFn };
    const original = db.transaction;
    this.original = original;
    const hold = this;
    db.transaction = function heldTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
      return original.call(db, async (client: PoolClient) => {
        const result = await work(client);
        for (const workspaceId of hold.workspaceIds) {
          await asTenant(client, workspaceId, () => suppressWaiting(client, workspaceId, hold.since));
        }
        return result;
      }) as Promise<T>;
    } as TransactionFn;
  }

  /** A connection of its own that holds each organization's reminder sweep lock (the API's sweep then skips them). */
  private async lock() {
    const config = this.app.get(ConfigService, { strict: false });
    const client = new Client({ connectionString: config.get<string>("DATABASE_URL"), application_name: "wodana-ops-sandbox-hold",
      ssl: config.get<string>("DATABASE_SSL", "false") === "true" ? { rejectUnauthorized: true } : undefined });
    await client.connect();
    this.lockClient = client;
    for (const workspaceId of this.workspaceIds) await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, sweepLock(workspaceId));
  }

  /**
   * The organization's first reminder sweep, on the connection that holds its lock (so nobody else sweeps it first):
   * the sources are asked what is due (My day gets its items) and what that sweep queues is suppressed in the same
   * transaction. Null when the lock isn't held (a dry run).
   */
  async sweepReminders(workspaceId: string): Promise<SweepResult | null> {
    const client = this.lockClient;
    if (!client) return null;
    const sources = this.app.get(ReminderSourceRegistryService, { strict: false }).registry();
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true), set_config('app.command_via', 'operator_cli', true)`,
        [workspaceId, SERVICE_ACTOR_ID]);
      const result = await sweepWorkspace(client, workspaceId, { sources, scan: true, health: false });
      await suppressWaiting(client, workspaceId, this.since);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stops holding: what is still waiting from the run is suppressed and everything external written during the run is
   * counted per channel and audited, then the transaction patch and the sweep locks go.
   */
  async finish(apply: boolean): Promise<Map<string, DeliveryCounts>> {
    const counts = new Map<string, DeliveryCounts>();
    try {
      for (const workspaceId of this.workspaceIds) {
        // Through the original transaction: this is the hold's own write, not a seeded one.
        const run = (this.original ?? this.db.transaction) as TransactionFn;
        const result = await (run.call(this.db, async (client: PoolClient): Promise<DeliveryCounts> => {
          await client.query(`SELECT set_config('app.current_workspace_id', $1, true)`, [workspaceId]);
          const after = apply ? await suppressWaiting(client, workspaceId, this.since) : { notifications: 0, outbox: 0 };
          const rows = (await client.query<{ channel: string; status: string; reason: string | null; count: number }>(
            `SELECT channel, status::text AS status, suppressed_reason AS reason, count(*)::int AS count FROM notifications
              WHERE workspace_id = $1 AND channel <> 'in_app' AND created_at >= $2 GROUP BY 1, 2, 3`, [workspaceId, this.since])).rows;
          const outbox = (await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id = $1 AND event_type = 'notification.delivery_requested.v1' AND created_at >= $2 AND last_error = $3`,
            [workspaceId, this.since, OUTBOX_NOTE])).rows[0]?.count ?? 0;
          const byChannel: Record<string, number> = {};
          let total = 0, held = 0, otherwise = 0, delivered = 0;
          for (const row of rows) {
            byChannel[row.channel] = (byChannel[row.channel] ?? 0) + row.count;
            total += row.count;
            if (row.status === "suppressed" && row.reason === SANDBOX_SEED) held += row.count;
            else if (["suppressed", "cancelled", "failed"].includes(row.status)) otherwise += row.count;
            else if (!WAITING.includes(row.status)) delivered += row.count;
          }
          const tally: DeliveryCounts = { byChannel, total, suppressedAfterRun: after.notifications, suppressedDuringRun: Math.max(0, held - after.notifications),
            otherwiseSuppressed: otherwise, delivered, outboxHandled: outbox };
          if (apply && (held || after.notifications)) {
            await client.query(
              `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
               VALUES ($1, NULL, 'internal', 'sandbox.seed_deliveries_suppressed', 'workspace', $1, '{}'::jsonb, $2::jsonb, $3)`,
              [workspaceId, JSON.stringify({ reason: SANDBOX_SEED, since: this.since.toISOString(), ...tally }), randomUUID()]);
          }
          return tally;
        }) as Promise<DeliveryCounts>);
        counts.set(workspaceId, result);
      }
    } finally {
      await this.release();
    }
    return counts;
  }

  /** Lets go of the patch and the locks (also after a failed run). */
  async release() {
    if (this.original) {
      delete (this.db as unknown as { transaction?: unknown }).transaction;
      this.original = null;
    }
    const client = this.lockClient;
    this.lockClient = null;
    if (client) {
      for (const workspaceId of this.workspaceIds) await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, sweepLock(workspaceId)).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

/** One line for the report: what the run wrote for outside delivery and that none of it goes out. */
export function describeDeliveries(counts: DeliveryCounts): string {
  const channels = Object.entries(counts.byChannel).sort(([a], [b]) => a.localeCompare(b)).map(([channel, count]) => `${count} ${channel}`).join(", ");
  if (!counts.total) return "nothing was written for email, WhatsApp or push";
  const held = counts.suppressedDuringRun + counts.suppressedAfterRun;
  return `${channels} written during the run: ${held} suppressed (${SANDBOX_SEED}${counts.suppressedAfterRun ? `, ${counts.suppressedAfterRun} after the run` : ""})`
    + `${counts.otherwiseSuppressed ? `, ${counts.otherwiseSuppressed} already suppressed for another reason` : ""}; ${counts.delivered} sent`;
}
