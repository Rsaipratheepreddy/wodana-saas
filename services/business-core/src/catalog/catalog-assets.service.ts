import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import {
  prepareReferenceUpload,
  REFERENCE_MAX_BYTES,
  type ReferenceUpload,
} from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type {
  CatalogAssetUploadQueryDto,
  UpdateCatalogAssetDto,
} from "./catalog.dto";

export const CATALOG_ASSET_MAX_BYTES = REFERENCE_MAX_BYTES;

type AssetRow = {
  id: string;
  catalogRecordId: string;
  role: "primary_image" | "gallery_image" | "technical_drawing";
  name: string;
  mimeType: string;
  byteSize: number;
  objectKey: string;
  previewKey: string | null;
  sha256: string;
  altText: string | null;
  sortOrder: number;
  status: "active" | "archived";
  archivedReason: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const supportedRecordKinds = [
  "work",
  "variant",
  "material",
  "finish",
  "service",
  "sku",
  "hardware",
  "consumable",
  "custom",
];
const assetSelect = `SELECT id,catalog_record_id AS "catalogRecordId",role,original_name AS name,
  mime_type AS "mimeType",byte_size AS "byteSize",object_key AS "objectKey",preview_key AS "previewKey",
  sha256,alt_text AS "altText",sort_order AS "sortOrder",status,archived_reason AS "archivedReason",
  archived_at AS "archivedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"
  FROM workspace_catalog_assets WHERE workspace_id=$1`;

const present = (row: AssetRow) => ({
  id: row.id,
  catalogRecordId: row.catalogRecordId,
  role: row.role,
  name: row.name,
  mimeType: row.mimeType,
  byteSize: row.byteSize,
  hasPreview: Boolean(row.previewKey),
  altText: row.altText,
  sortOrder: row.sortOrder,
  status: row.status,
  archivedReason: row.archivedReason,
  archivedAt: row.archivedAt,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

@Injectable()
export class CatalogAssetsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly storage: BrandAssetStorageService,
    private readonly events: CrmEventsService,
  ) {}

  list(
    actor: RequestActor,
    workspaceId: string,
    recordId: string,
    includeArchived = false,
  ) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "catalog.view",
      async (client) => {
        await this.assertRecord(client, workspaceId, recordId);
        const rows = (
          await client.query<AssetRow>(
            `${assetSelect} AND catalog_record_id=$2${includeArchived ? "" : " AND status='active'"}
             ORDER BY CASE role WHEN 'primary_image' THEN 0 WHEN 'gallery_image' THEN 1 ELSE 2 END,sort_order,created_at,id`,
            [workspaceId, recordId],
          )
        ).rows;
        return { items: rows.map(present) };
      },
    );
  }

  async upload(
    actor: RequestActor,
    workspaceId: string,
    recordId: string,
    assetId: string,
    input: CatalogAssetUploadQueryDto,
    file?: ReferenceUpload,
  ) {
    const prepared = await prepareReferenceUpload(file);
    if (input.role !== "technical_drawing" && prepared.mimeType === "application/pdf")
      throw new BadRequestException("PDF files can only be saved as technical drawings.");
    const altText = input.altText?.trim() || null;
    const sortOrder = input.sortOrder ?? 0;
    const written: string[] = [];
    try {
      return await this.access.withPermissions(
        actor,
        workspaceId,
        ["catalog.view", "catalog.manage"],
        async (client, user) => {
          await this.lock(client, workspaceId, recordId);
          await this.assertRecord(client, workspaceId, recordId, true);
          const existing = (
            await client.query<AssetRow>(`${assetSelect} AND id=$2`, [
              workspaceId,
              assetId,
            ])
          ).rows[0];
          if (existing) {
            if (
              existing.catalogRecordId !== recordId ||
              existing.sha256 !== prepared.digest ||
              existing.role !== input.role ||
              existing.altText !== altText ||
              existing.sortOrder !== sortOrder ||
              existing.status !== "active"
            )
              throw new ConflictException(
                "This upload identifier belongs to another catalog file or metadata selection.",
              );
            return present(existing);
          }
          const counts = await client.query<{ active: number; total: number }>(
            `SELECT count(*) FILTER(WHERE status='active')::int AS active,count(*)::int AS total
             FROM workspace_catalog_assets WHERE workspace_id=$1 AND catalog_record_id=$2`,
            [workspaceId, recordId],
          );
          if ((counts.rows[0]?.active ?? 0) >= 100)
            throw new BadRequestException(
              "This catalog record has reached its file limit. Archive an unused file before adding another.",
            );
          if ((counts.rows[0]?.total ?? 0) >= 500)
            throw new BadRequestException(
              "This catalog record has reached its retained file-history limit.",
            );
          await this.assertPrimaryAvailable(
            client,
            workspaceId,
            recordId,
            assetId,
            input.role,
          );
          const key = `catalog/${workspaceId}/${recordId}/${assetId}`;
          const objectKey = `${key}/original`;
          const previewKey = prepared.preview ? `${key}/preview.webp` : null;
          await this.storage.put(objectKey, prepared.body, prepared.mimeType);
          written.push(objectKey);
          if (prepared.preview && previewKey) {
            await this.storage.put(previewKey, prepared.preview, "image/webp");
            written.push(previewKey);
          }
          const saved = (
            await client.query<AssetRow>(
              `INSERT INTO workspace_catalog_assets(
                workspace_id,id,catalog_record_id,role,original_name,mime_type,byte_size,
                object_key,preview_key,sha256,alt_text,sort_order,created_by,updated_by
              ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
              RETURNING id,catalog_record_id AS "catalogRecordId",role,original_name AS name,
                mime_type AS "mimeType",byte_size AS "byteSize",object_key AS "objectKey",preview_key AS "previewKey",
                sha256,alt_text AS "altText",sort_order AS "sortOrder",status,archived_reason AS "archivedReason",
                archived_at AS "archivedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"`,
              [
                workspaceId,
                assetId,
                recordId,
                input.role,
                prepared.name,
                prepared.mimeType,
                prepared.body.length,
                objectKey,
                previewKey,
                prepared.digest,
                altText,
                sortOrder,
                user.userId,
              ],
            )
          ).rows[0];
          await this.events.record(client, {
            workspaceId,
            actorUserId: user.userId,
            source: "user",
            action: "catalog.asset.uploaded.v1",
            entityType: "catalog_asset",
            entityId: assetId,
            after: present(saved),
          });
          return present(saved);
        },
      );
    } catch (error) {
      await Promise.allSettled(written.map((key) => this.storage.remove(key)));
      throw error;
    }
  }

  read(
    actor: RequestActor,
    workspaceId: string,
    recordId: string,
    assetId: string,
    preview: boolean,
  ) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "catalog.view",
      async (client) => {
        const row = (
          await client.query<AssetRow>(
            `${assetSelect} AND id=$2 AND catalog_record_id=$3 AND status='active'`,
            [workspaceId, assetId, recordId],
          )
        ).rows[0];
        if (!row) throw new NotFoundException("Catalog file not found.");
        if (preview && !row.previewKey)
          throw new NotFoundException("Preview not available.");
        const stored = await this.storage
          .read(preview ? row.previewKey! : row.objectKey)
          .catch(() => {
            throw new NotFoundException("This catalog file could not be found in storage.");
          });
        return {
          body: stored.body,
          contentType: preview ? "image/webp" : row.mimeType,
          name: row.name,
          preview,
        };
      },
    );
  }

  update(
    actor: RequestActor,
    workspaceId: string,
    recordId: string,
    assetId: string,
    input: UpdateCatalogAssetDto,
  ) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["catalog.view", "catalog.manage"],
      async (client, user) => {
        await this.lock(client, workspaceId, recordId);
        await this.assertRecord(client, workspaceId, recordId, true);
        const current = (
          await client.query<AssetRow>(
            `${assetSelect} AND id=$2 AND catalog_record_id=$3`,
            [workspaceId, assetId, recordId],
          )
        ).rows[0];
        if (!current) throw new NotFoundException("Catalog file not found.");
        const role = input.role ?? current.role;
        const altText =
          input.altText === undefined ? current.altText : input.altText.trim() || null;
        const sortOrder = input.sortOrder ?? current.sortOrder;
        const archived = input.archived ?? current.status === "archived";
        if (current.mimeType === "application/pdf" && role !== "technical_drawing")
          throw new BadRequestException("PDF files can only be saved as technical drawings.");
        if (
          current.status === "active" &&
          input.archived === true &&
          !input.archivedReason?.trim()
        )
          throw new BadRequestException("Add a reason for archiving this catalog file.");
        const requestedMatches =
          role === current.role &&
          altText === current.altText &&
          sortOrder === current.sortOrder &&
          archived === (current.status === "archived");
        if (current.version !== input.version) {
          if (current.version === input.version + 1 && requestedMatches)
            return present(current);
          throw new ConflictException(
            "This catalog file changed. Refresh it before saving again.",
          );
        }
        if (requestedMatches) return present(current);
        if (current.status === "archived" && input.archived !== false)
          throw new ConflictException("Restore this file before editing its metadata.");
        await this.assertPrimaryAvailable(
          client,
          workspaceId,
          recordId,
          assetId,
          archived ? "gallery_image" : role,
        );
        const archivedReason = archived
          ? current.archivedReason ?? input.archivedReason!.trim()
          : null;
        const saved = (
          await client.query<AssetRow>(
            `UPDATE workspace_catalog_assets SET role=$4,alt_text=$5,sort_order=$6,status=$7,
               archived_reason=$8,archived_at=CASE WHEN $7='archived' THEN COALESCE(archived_at,now()) ELSE NULL END,
               archived_by=CASE WHEN $7='archived' THEN COALESCE(archived_by,$9) ELSE NULL END,
               version=version+1,updated_by=$9,updated_at=now()
             WHERE workspace_id=$1 AND id=$2 AND catalog_record_id=$3
             RETURNING id,catalog_record_id AS "catalogRecordId",role,original_name AS name,
               mime_type AS "mimeType",byte_size AS "byteSize",object_key AS "objectKey",preview_key AS "previewKey",
               sha256,alt_text AS "altText",sort_order AS "sortOrder",status,archived_reason AS "archivedReason",
               archived_at AS "archivedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"`,
            [
              workspaceId,
              assetId,
              recordId,
              role,
              altText,
              sortOrder,
              archived ? "archived" : "active",
              archivedReason,
              user.userId,
            ],
          )
        ).rows[0];
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action:
            current.status !== saved.status
              ? saved.status === "archived"
                ? "catalog.asset.archived.v1"
                : "catalog.asset.restored.v1"
              : "catalog.asset.updated.v1",
          entityType: "catalog_asset",
          entityId: assetId,
          before: present(current),
          after: present(saved),
        });
        return present(saved);
      },
    );
  }

  private async assertRecord(
    client: PoolClient,
    workspaceId: string,
    recordId: string,
    forUpload = false,
  ) {
    const result = await client.query<{ kind: string; archived: boolean }>(
      `SELECT kind,archived FROM workspace_catalog_records WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, recordId],
    );
    const record = result.rows[0];
    if (!record || !supportedRecordKinds.includes(record.kind))
      throw new NotFoundException("Catalog item not found.");
    if (forUpload && record.archived)
      throw new ConflictException("Restore this catalog item before changing its files.");
    return record;
  }

  private async assertPrimaryAvailable(
    client: PoolClient,
    workspaceId: string,
    recordId: string,
    assetId: string,
    role: string,
  ) {
    if (role !== "primary_image") return;
    const primary = await client.query(
      `SELECT 1 FROM workspace_catalog_assets
       WHERE workspace_id=$1 AND catalog_record_id=$2 AND id<>$3
         AND role='primary_image' AND status='active'`,
      [workspaceId, recordId, assetId],
    );
    if (primary.rowCount)
      throw new ConflictException(
        "This catalog item already has a primary image. Change or archive it first.",
      );
  }

  private lock(client: PoolClient, workspaceId: string, recordId: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `catalog-assets:${workspaceId}:${recordId}`,
    ]);
  }
}
