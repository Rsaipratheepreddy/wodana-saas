import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { GridSettingsInputError, gridSettingsRequestHash, managePermissionFor, normalizeHiddenColumns } from "./grid-settings.domain";

export type GridDefault = { gridKey: string; hiddenColumns: string[]; version: number; canManage: boolean; updatedAt: string | null };
export type SaveGridDefaultInput = { hiddenColumns: unknown; version: number; requestId: string };

type SettingsRow = { version: number; lastRequestId: string | null; lastRequestHash: string | null; updatedAt: Date | string | null };

/** A list's workspace default (plan §0.7 R14): the columns that start hidden for everyone in the workspace. */
@Injectable()
export class GridSettingsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Any member reads a list's default; `canManage` says whether they may change it for everyone. */
  async get(actor: RequestActor, workspaceId: string, gridKey: string): Promise<GridDefault> {
    const permission = this.permission(gridKey);
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await this.load(client, workspaceId, gridKey);
      return { ...current, canManage: await this.access.hasPermission(client, workspaceId, user.userId, permission) };
    });
  }

  /** Replace a list's hidden columns for everyone. Version-checked; a replayed request returns the saved result. */
  async save(actor: RequestActor, workspaceId: string, gridKey: string, input: SaveGridDefaultInput): Promise<GridDefault & { replayed?: true }> {
    const permission = this.permission(gridKey);
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      let hiddenColumns: string[];
      try { hiddenColumns = normalizeHiddenColumns(input.hiddenColumns); } catch (error) {
        if (error instanceof GridSettingsInputError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      const requestHash = gridSettingsRequestHash(gridKey, hiddenColumns, input.version);
      // One save per list at a time, so two people saving together cannot both pass the version check.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:grid-settings:${gridKey}`]);
      const row = (await client.query<SettingsRow>(
        `SELECT version, last_request_id AS "lastRequestId", last_request_hash AS "lastRequestHash", updated_at AS "updatedAt"
           FROM workspace_grid_settings WHERE workspace_id = $1 AND grid_key = $2 FOR UPDATE`, [workspaceId, gridKey])).rows[0];
      if (row && row.lastRequestId === input.requestId) {
        if (row.lastRequestHash !== requestHash) throw new ConflictException("This request was already used for a different change");
        return { ...(await this.load(client, workspaceId, gridKey)), canManage: true, replayed: true };
      }
      if ((row?.version ?? 0) !== input.version) throw new ConflictException("This list's default changed. Reload and try again");
      const before = row ? await this.hidden(client, workspaceId, gridKey) : [];
      if (row) {
        await client.query(`UPDATE workspace_grid_settings SET version = version + 1, last_request_id = $3, last_request_hash = $4, updated_by = $5
          WHERE workspace_id = $1 AND grid_key = $2`, [workspaceId, gridKey, input.requestId, requestHash, user.userId]);
        await client.query(`DELETE FROM workspace_grid_hidden_columns WHERE workspace_id = $1 AND grid_key = $2`, [workspaceId, gridKey]);
      } else {
        await client.query(`INSERT INTO workspace_grid_settings (workspace_id, grid_key, last_request_id, last_request_hash, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $5)`, [workspaceId, gridKey, input.requestId, requestHash, user.userId]);
      }
      if (hiddenColumns.length) {
        await client.query(`INSERT INTO workspace_grid_hidden_columns (workspace_id, grid_key, column_id) SELECT $1, $2, unnest($3::text[])`,
          [workspaceId, gridKey, hiddenColumns]);
      }
      const after = await this.load(client, workspaceId, gridKey);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "workspace.grid_default_changed.v1", entityType: "workspace_grid_settings", entityId: workspaceId,
        before: { gridKey, hiddenColumns: before, version: row?.version ?? 0 }, after: { gridKey, hiddenColumns: after.hiddenColumns, version: after.version },
      });
      return { ...after, canManage: true };
    });
  }

  private permission(gridKey: string) {
    const permission = managePermissionFor(gridKey);
    if (!permission) throw new NotFoundException("This list has no workspace default");
    return permission;
  }

  private async load(client: PoolClient, workspaceId: string, gridKey: string) {
    const row = (await client.query<SettingsRow>(`SELECT version, updated_at AS "updatedAt" FROM workspace_grid_settings WHERE workspace_id = $1 AND grid_key = $2`,
      [workspaceId, gridKey])).rows[0];
    const updatedAt = row?.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    return { gridKey, hiddenColumns: row ? await this.hidden(client, workspaceId, gridKey) : [], version: row?.version ?? 0, updatedAt };
  }

  private async hidden(client: PoolClient, workspaceId: string, gridKey: string) {
    return (await client.query<{ columnId: string }>(`SELECT column_id AS "columnId" FROM workspace_grid_hidden_columns WHERE workspace_id = $1 AND grid_key = $2 ORDER BY column_id`,
      [workspaceId, gridKey])).rows.map((item) => item.columnId);
  }
}
