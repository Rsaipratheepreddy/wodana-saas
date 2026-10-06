import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { BrandAssetStorageService } from "./brand-asset-storage.service";

const BATCH = 100;
const MAX_ATTEMPTS = 5;
const MAX_BATCHES_PER_PASS = 50;

/**
 * Deletes the storage objects of records removed by `workspace_clear_records()`. The clear queues exactly the
 * object keys of the rows it deleted (inside the workspace's own prefix, not used by anything kept); this worker
 * removes them from S3 or local storage. It lists the workspaces with pending keys through a SECURITY DEFINER
 * function, then works inside each workspace's own tenant transaction. Deleting an absent object succeeds, so a
 * retry is harmless.
 */
@Injectable()
export class WorkspaceObjectCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceObjectCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: BrandAssetStorageService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>("WORKSPACE_OBJECT_CLEANUP_ENABLED", "true") === "false") return;
    this.timer = setInterval(() => this.schedule(), 60_000);
    this.timer.unref();
    setTimeout(() => this.schedule(), 5_000).unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private schedule() {
    if (this.running) return;
    this.running = this.drain()
      .catch((error) => this.logger.error(`Object cleanup failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { this.running = undefined; });
  }

  /** One pass over every workspace with pending keys. Returns how many objects were deleted and how many failed. */
  async drain(): Promise<{ deleted: number; failed: number }> {
    const workspaces = await this.database.query<{ workspaceId: string }>(
      `SELECT workspace_id AS "workspaceId" FROM workspace_object_cleanup_workspaces()`,
    );
    let deleted = 0;
    let failed = 0;
    for (const { workspaceId } of workspaces.rows) {
      // Batches of BATCH keys, each in its own transaction, until the workspace's queue is empty (bounded per pass).
      for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch += 1) {
        const result = await this.drainBatch(workspaceId);
        deleted += result.deleted;
        failed += result.failed;
        if (result.claimed < BATCH) break;
      }
    }
    return { deleted, failed };
  }

  private async drainBatch(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      const pending = await client.query<{ objectKey: string; attempts: number }>(
        `SELECT object_key AS "objectKey", attempts FROM workspace_object_cleanup_queue
          WHERE workspace_id = $1 AND status = 'pending'
          ORDER BY created_at, object_key LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
        [workspaceId],
      );
      let deleted = 0;
      let failed = 0;
      for (const { objectKey, attempts } of pending.rows) {
        try {
          await this.storage.remove(objectKey);
          await client.query(
            `UPDATE workspace_object_cleanup_queue SET status = 'deleted', attempts = attempts + 1, last_error = NULL, completed_at = now()
              WHERE workspace_id = $1 AND object_key = $2`, [workspaceId, objectKey],
          );
          deleted += 1;
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
          await client.query(
            `UPDATE workspace_object_cleanup_queue SET attempts = attempts + 1, last_error = $3,
                    status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
                    completed_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END
              WHERE workspace_id = $1 AND object_key = $2`, [workspaceId, objectKey, message],
          );
          if (attempts + 1 >= MAX_ATTEMPTS) failed += 1;
        }
      }
      return { claimed: pending.rows.length, deleted, failed };
    });
  }
}
