import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { canonicalHash } from "../crm/shared/crm-types";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CATALOG_COLUMNS, catalogRows, parseReadinessSettings, readCatalogFacts, readReadinessSettings, ReadinessSettingsError } from "./item-readiness";

const VIEW = "catalog.view";
const MANAGE = "catalog.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Catalogue readiness: what each item still needs (picture, size, price, drawing, materials, trades and hours), and the firm's settings for it. */
@Injectable()
export class ItemReadinessService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** One catalogue's items (a category and below, or a search) with their readiness, the columns shown and the settings. */
  catalog(actor: RequestActor, workspaceId: string, catalogId: string, query: { categoryId?: string; search?: string }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      if (!(await client.query(`SELECT 1 FROM catalogs WHERE workspace_id = $1 AND id = $2`, [workspaceId, catalogId])).rowCount) throw new NotFoundException("Catalog not found");
      if (query.categoryId && !UUID.test(query.categoryId)) throw new UnprocessableEntityException("Choose a category");
      const settings = await readReadinessSettings(client, workspaceId);
      const rows = catalogRows(await readCatalogFacts(client, workspaceId, { catalogId, categoryId: query.categoryId ?? null, search: (query.search ?? "").slice(0, 200), limit: 2000 }), settings);
      return { columns: CATALOG_COLUMNS.filter((column) => settings.columns.includes(column)), rows, settings,
        canManage: await this.access.hasPermission(client, workspaceId, user.userId, MANAGE) };
    });
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => readReadinessSettings(client, workspaceId));
  }

  /** Saves the settings for the whole workspace. Version-checked; a replayed request returns the saved result; audited. */
  saveSettings(actor: RequestActor, workspaceId: string, input: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      let next: ReturnType<typeof parseReadinessSettings>;
      try { next = parseReadinessSettings(input); } catch (error) {
        if (error instanceof ReadinessSettingsError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      const requestId = typeof input.requestId === "string" && UUID.test(input.requestId) ? input.requestId : null;
      if (!requestId) throw new UnprocessableEntityException("A request id is required");
      if (!Number.isInteger(input.version) || Number(input.version) < 0) throw new UnprocessableEntityException("A version is required");
      const hash = canonicalHash({ ...next, version: input.version });
      const row = (await client.query<{ version: number; lastRequestId: string | null; lastRequestHash: string | null }>(
        `SELECT version, last_request_id AS "lastRequestId", last_request_hash AS "lastRequestHash" FROM workspace_readiness_settings WHERE workspace_id = $1 FOR UPDATE`,
        [workspaceId])).rows[0];
      if (row && row.lastRequestId === requestId) {
        if (row.lastRequestHash !== hash) throw new ConflictException("This request was already used for a different change");
        return readReadinessSettings(client, workspaceId);
      }
      if ((row?.version ?? 0) !== input.version) throw new ConflictException("The readiness settings changed. Reload and try again");
      const before = await readReadinessSettings(client, workspaceId);
      if (row) {
        await client.query(
          `UPDATE workspace_readiness_settings SET columns = $2, material_attributes = $3, labour_attributes = $4, version = version + 1,
                  last_request_id = $5, last_request_hash = $6, updated_by = $7, updated_at = now() WHERE workspace_id = $1`,
          [workspaceId, next.columns, next.materialAttributes, next.labourAttributes, requestId, hash, user.userId]);
      } else {
        // Two first saves at once: the second finds the row and fails its version check.
        await client.query(
          `INSERT INTO workspace_readiness_settings (workspace_id, columns, material_attributes, labour_attributes, last_request_id, last_request_hash, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id) DO NOTHING`,
          [workspaceId, next.columns, next.materialAttributes, next.labourAttributes, requestId, hash, user.userId]);
        const mine = (await client.query<{ lastRequestId: string }>(`SELECT last_request_id AS "lastRequestId" FROM workspace_readiness_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
        if (mine?.lastRequestId !== requestId) throw new ConflictException("The readiness settings changed. Reload and try again");
      }
      const after = await readReadinessSettings(client, workspaceId);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "catalog.readiness_settings_saved.v1", entityType: "workspace_readiness_settings", entityId: workspaceId,
        before: { columns: before.columns, materialAttributes: before.materialAttributes, labourAttributes: before.labourAttributes, version: before.version },
        after: { columns: after.columns, materialAttributes: after.materialAttributes, labourAttributes: after.labourAttributes, version: after.version },
      });
      return after;
    });
  }
}
