import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";
import { sweepEmailCap } from "../delivery/email-pace";
import { ReminderSourceRegistryService } from "../sources/registry.service";
import { sweepWorkspace, type SweepResult } from "./sweep";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** The sweep runs every minute; the sources are asked what is due at most every five minutes per workspace. */
export const SWEEP_EVERY_MS = 60_000;
export const SCAN_EVERY_MS = 5 * 60_000;

/**
 * The reminder engine's timer (plan §6.24a "Sweep"): every 60 seconds (REMINDERS_SWEEP_ENABLED), each active workspace
 * (listed through the SECURITY DEFINER `list_reminder_engine_workspaces()`) is swept in its own tenant transaction.
 * One workspace failing never stops the others. `runNow` sweeps one workspace on demand (the internal endpoint). Each
 * sweep hands at most REMINDERS_SWEEP_EMAIL_CAP emails per workspace to delivery (default 20); the rest carry over.
 */
@Injectable()
export class RemindersEngineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemindersEngineService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;
  private readonly scannedAt = new Map<string, number>();

  constructor(private readonly db: DatabaseService, private readonly config: ConfigService, private readonly sources: ReminderSourceRegistryService) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>("REMINDERS_SWEEP_ENABLED", "true") === "false") return;
    this.timer = setInterval(() => this.schedule(), SWEEP_EVERY_MS);
    this.timer.unref();
    setTimeout(() => this.schedule(), 15_000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private schedule() {
    if (this.running) return;
    this.running = this.sweepAll()
      .catch((error) => this.logger.error(`Reminder sweep failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { this.running = undefined; });
  }

  /** One timed pass over every active workspace. */
  async sweepAll(now = new Date()) {
    const workspaces = (await this.db.query<{ workspaceId: string }>(`SELECT workspace_id AS "workspaceId" FROM list_reminder_engine_workspaces()`)).rows;
    const totals = { workspaces: workspaces.length, busy: 0, failed: 0, sent: 0, held: 0, escalated: 0, closed: 0 };
    for (const { workspaceId } of workspaces) {
      const scan = now.getTime() - (this.scannedAt.get(workspaceId) ?? 0) >= SCAN_EVERY_MS;
      try {
        const result = await this.sweep(workspaceId, { scan, now });
        if (result.busy) totals.busy += 1;
        totals.sent += result.fire?.sent ?? 0;
        totals.held += result.fire?.held ?? 0;
        totals.escalated += result.fire?.escalated ?? 0;
        totals.closed += (result.scan?.closed ?? 0) + (result.fire?.closed ?? 0);
      } catch (error) {
        totals.failed += 1;
        this.logger.error(`Reminder sweep of ${workspaceId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return totals;
  }

  /** Sweeps one workspace now, asking the sources what is due. */
  runNow(workspaceId: string, now = new Date()): Promise<SweepResult> {
    return this.sweep(workspaceId, { scan: true, now });
  }

  private async sweep(workspaceId: string, options: { scan: boolean; now: Date }) {
    const result = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
      sweepWorkspace(client, workspaceId, { sources: this.sources.registry(), scan: options.scan, now: options.now, emailCap: sweepEmailCap(this.config), journeys: true }));
    if (result.pace?.carried) this.logger.log(`Reminder sweep of ${workspaceId}: ${result.pace.carried} emails carried to the next sweeps (email cap)`);
    if (options.scan && !result.busy && result.scan) this.scannedAt.set(workspaceId, options.now.getTime());
    if (result.errors.length) this.logger.warn(`Reminder sweep of ${workspaceId}: ${result.errors.slice(0, 5).join("; ")}`);
    return result;
  }
}
