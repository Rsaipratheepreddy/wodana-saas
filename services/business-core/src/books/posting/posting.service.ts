import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { BOOKS_PERMISSIONS } from "../books-contract";
import { listIssues, retryIssue } from "./issues";
import { type SweepResult, sweepWorkspace } from "./sweep";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const SWEEP_EVERY_MS = 30_000;
/** Labour reads every project's costs: the timed sweep includes it at most this often per workspace. */
const LABOUR_EVERY_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The posting sweep (plan §6.21b): every 30 seconds, each workspace with the Ledger on (listed through the SECURITY
 * DEFINER `list_books_workspaces()`) is swept in its own tenant transaction. `runSweepNow` sweeps one workspace on
 * demand, before the Ledger is read.
 */
@Injectable()
export class BooksPostingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BooksPostingService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;
  private readonly labourAt = new Map<string, number>();

  constructor(private readonly db: DatabaseService, private readonly access: WorkspaceAccessService, private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>("BOOKS_SWEEP_ENABLED", "true") === "false") return;
    this.timer = setInterval(() => this.schedule(), SWEEP_EVERY_MS);
    this.timer.unref();
    setTimeout(() => this.schedule(), 10_000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private schedule() {
    if (this.running) return;
    this.running = this.sweepAll()
      .catch((error) => this.logger.error(`Ledger sweep failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { this.running = undefined; });
  }

  /** One timed pass over every workspace with the Ledger on. */
  async sweepAll() {
    const workspaces = (await this.db.query<{ workspaceId: string }>(`SELECT workspace_id AS "workspaceId" FROM list_books_workspaces()`)).rows;
    for (const { workspaceId } of workspaces) {
      const labour = Date.now() - (this.labourAt.get(workspaceId) ?? 0) >= LABOUR_EVERY_MS;
      try {
        const result = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => sweepWorkspace(client, workspaceId, { labour }));
        if (labour && !result.busy) this.labourAt.set(workspaceId, Date.now());
        this.report(workspaceId, result);
      } catch (error) {
        this.logger.error(`Ledger sweep of ${workspaceId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Sweeps one workspace now (labour included); reports call it before they read. */
  async runSweepNow(workspaceId: string): Promise<SweepResult> {
    const result = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => sweepWorkspace(client, workspaceId, { labour: true }));
    if (!result.busy) this.labourAt.set(workspaceId, Date.now());
    this.report(workspaceId, result);
    return result;
  }

  /** The events that couldn't post yet. */
  async issues(actor: RequestActor, workspaceId: string) {
    const canRetry = await this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.view, (client, user) =>
      this.access.hasPermission(client, workspaceId, user.userId, BOOKS_PERMISSIONS.manage));
    await this.runSweepNow(workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.view, async (client) => ({ issues: await listIssues(client, workspaceId), canRetry }));
  }

  /** Tries an issue's event again now. */
  async retry(actor: RequestActor, workspaceId: string, issueId: string) {
    if (!UUID.test(issueId)) throw new NotFoundException("Issue not found.");
    await this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.manage, async (client) => {
      if (!(await retryIssue(client, workspaceId, issueId))) throw new NotFoundException("Issue not found.");
    });
    await this.runSweepNow(workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_PERMISSIONS.manage, async (client) => ({ issues: await listIssues(client, workspaceId), canRetry: true }));
  }

  private report(workspaceId: string, result: SweepResult) {
    for (const error of result.errors) this.logger.error(`Ledger posting in ${workspaceId}: ${error}`);
  }
}
