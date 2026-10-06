import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { resolveTenantRegistry } from "../control-plane/tenant-registry";
import { DatabaseService } from "../database/database.service";
import type { WorkspaceTableDisposition } from "./workspace-clear-records.classification";

export type ClearRecordsRow = { tableName: string; disposition: WorkspaceTableDisposition; rowCount: string | number; runId: string | null };

export type ClearRecordsResult = {
  workspaceId: string;
  slug: string;
  dryRun: boolean;
  runId: string | null;
  rows: number;
  objectKeys: number;
  tables: Array<{ table: string; disposition: WorkspaceTableDisposition; rows: number }>;
};

/** Shapes the per-table counts returned by `workspace_clear_records()`; tables with nothing to clear are left out. */
export function summarizeClearRecords(workspaceId: string, slug: string, dryRun: boolean, rows: ClearRecordsRow[]): ClearRecordsResult {
  const objectKeys = Number(rows.find((row) => row.tableName === "object storage keys")?.rowCount ?? 0);
  const tables = rows
    .filter((row) => row.tableName !== "object storage keys")
    .map((row) => ({ table: row.tableName, disposition: row.disposition, rows: Number(row.rowCount) }))
    .filter((row) => row.rows > 0)
    .sort((left, right) => left.table.localeCompare(right.table));
  return {
    workspaceId,
    slug,
    dryRun,
    runId: rows[0]?.runId ?? null,
    rows: tables.reduce((total, row) => total + row.rows, 0),
    objectKeys,
    tables,
  };
}

/** Maps the SQL function's refusals to HTTP errors without echoing database internals. */
export function clearRecordsError(error: unknown): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === "22023") return new BadRequestException("The confirmation does not match the workspace slug");
  if (code === "P0002") return new NotFoundException("Workspace not found");
  if (code === "55000") return new ConflictException((error as Error).message);
  return error instanceof Error ? error : new Error(String(error));
}

/** Runs the go-live reset inside the caller's transaction (which must belong to the same workspace). */
export async function runWorkspaceClearRecords(
  client: Pick<PoolClient, "query">, workspaceId: string, confirmSlug: string, dryRun: boolean,
): Promise<ClearRecordsResult> {
  try {
    const result = await client.query<ClearRecordsRow>(
      `SELECT table_name AS "tableName", disposition, row_count AS "rowCount", run_id AS "runId"
         FROM workspace_clear_records($1::uuid, $2::text, $3::boolean)`,
      [workspaceId, confirmSlug, dryRun],
    );
    return summarizeClearRecords(workspaceId, confirmSlug, dryRun, result.rows);
  } catch (error) {
    throw clearRecordsError(error);
  }
}

@Injectable()
export class WorkspaceClearRecordsService {
  constructor(private readonly database: DatabaseService) {}

  /** Operator-only: clears a tenant's records and keeps its configuration. A dry run only counts. */
  async clear(externalTenantId: string, input: { confirmSlug: string; dryRun?: boolean }, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, externalTenantId);
    const dryRun = input.dryRun !== false;
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, (client) =>
      runWorkspaceClearRecords(client, registry.workspaceId, input.confirmSlug, dryRun));
  }
}
