import { BadRequestException, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

type ImageRow = { id: string; itemId: string; name: string; mimeType: string; objectKey: string; previewKey: string | null; sha256: string; sortOrder: number };
const SELECT = `SELECT id, item_id AS "itemId", original_name AS name, mime_type AS "mimeType", object_key AS "objectKey", preview_key AS "previewKey", sha256, sort_order AS "sortOrder" FROM catalog_item_images`;

/** Pictures of catalog items: the first one is the item's picture in quotes, the gallery and the catalog. */
@Injectable()
export class CatalogItemImagesService {
  constructor(private readonly access: WorkspaceAccessService, private readonly storage: BrandAssetStorageService) {}

  list(actor: RequestActor, workspaceId: string, itemId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["catalog.view", "pre_projects.view"], async (client) => ({
      images: (await client.query<ImageRow>(`${SELECT} WHERE workspace_id = $1 AND item_id = $2 ORDER BY sort_order, created_at`, [workspaceId, itemId])).rows.map(present),
    }));
  }

  async upload(actor: RequestActor, workspaceId: string, itemId: string, imageId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose an image (JPG, PNG or WebP).");
    return this.access.withPermission(actor, workspaceId, "catalog.manage", async (client, user) =>
      storeImage(client, this.storage, { workspaceId, itemId, imageId, userId: user.userId, name: prepared.name, mimeType: prepared.mimeType, body: prepared.body, preview: prepared.preview ?? null, sha256: prepared.digest }));
  }

  remove(actor: RequestActor, workspaceId: string, imageId: string) {
    return this.access.withPermission(actor, workspaceId, "catalog.manage", async (client, user) => {
      const row = (await client.query<ImageRow>(`${SELECT} WHERE workspace_id = $1 AND id = $2`, [workspaceId, imageId])).rows[0];
      if (!row) return { removed: false };
      await client.query(`DELETE FROM catalog_item_images WHERE workspace_id = $1 AND id = $2`, [workspaceId, imageId]);
      await client.query(`UPDATE commercial_quote_lines SET catalog_image_id = NULL WHERE workspace_id = $1 AND catalog_image_id = $2`, [workspaceId, imageId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.image_removed.v1", entityType: "catalog_item", entityId: row.itemId, after: { imageId } });
      return { removed: true };
    });
  }

  read(actor: RequestActor, workspaceId: string, imageId: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, ["catalog.view", "pre_projects.view"], async (client) => {
      const row = (await client.query<ImageRow>(`${SELECT} WHERE workspace_id = $1 AND id = $2`, [workspaceId, imageId])).rows[0];
      if (!row) throw new NotFoundException("Image not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => { throw new NotFoundException("This image could not be found in storage."); });
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType, name: row.name };
    });
  }
}

/** Saves an image for a catalog item (the same id again is accepted once). Used by uploads and by "add to catalog" from a quote. */
export async function storeImage(client: PoolClient, storage: BrandAssetStorageService, input: { workspaceId: string; itemId: string; imageId: string; userId: string; name: string; mimeType: string; body: Buffer; preview: Buffer | null; sha256: string }) {
  if (!(await client.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [input.workspaceId, input.itemId])).rowCount) throw new NotFoundException("Catalog item not found.");
  const existing = (await client.query<ImageRow>(`${SELECT} WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, input.imageId])).rows[0];
  if (existing) {
    if (existing.itemId !== input.itemId || existing.sha256 !== input.sha256) throw new ConflictException("This upload id belongs to another image.");
    return present(existing);
  }
  const count = Number((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM catalog_item_images WHERE workspace_id = $1 AND item_id = $2`, [input.workspaceId, input.itemId])).rows[0].n);
  if (count >= 12) throw new BadRequestException("An item can have up to 12 images.");
  const key = `catalog-items/${input.workspaceId}/${input.itemId}/${input.imageId}`;
  const objectKey = `${key}/original`, previewKey = input.preview ? `${key}/preview.webp` : null;
  await storage.put(objectKey, input.body, input.mimeType);
  if (input.preview && previewKey) await storage.put(previewKey, input.preview, "image/webp");
  const row = (await client.query<ImageRow>(
    `INSERT INTO catalog_item_images (id, workspace_id, item_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, item_id AS "itemId", original_name AS name, mime_type AS "mimeType", object_key AS "objectKey", preview_key AS "previewKey", sha256, sort_order AS "sortOrder"`,
    [input.imageId, input.workspaceId, input.itemId, input.name, input.mimeType, input.body.length, objectKey, previewKey, input.sha256, count, input.userId])).rows[0];
  await recordAudit(client, { workspaceId: input.workspaceId, actorUserId: input.userId, action: "catalog.image_added.v1", entityType: "catalog_item", entityId: input.itemId, after: { imageId: input.imageId } });
  return present(row);
}

const present = (row: ImageRow) => ({ id: row.id, itemId: row.itemId, name: row.name, mimeType: row.mimeType, hasPreview: Boolean(row.previewKey), sortOrder: row.sortOrder });

@ApiTags("catalog-images")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/catalog-images")
export class CatalogItemImagesController {
  constructor(private readonly images: CatalogItemImagesService) {}

  @Get("items/:itemId")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("itemId", ParseUUIDPipe) itemId: string) { return this.images.list(actor, workspaceId, itemId); }

  @Post("items/:itemId/:imageId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("itemId", ParseUUIDPipe) itemId: string, @Param("imageId", ParseUUIDPipe) imageId: string, @UploadedFile() file: ReferenceUpload) {
    return this.images.upload(actor, workspaceId, itemId, imageId, file);
  }

  @Delete(":imageId")
  remove(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("imageId", ParseUUIDPipe) imageId: string) { return this.images.remove(actor, workspaceId, imageId); }

  @Get(":imageId")
  async content(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("imageId", ParseUUIDPipe) imageId: string, @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.images.read(actor, workspaceId, imageId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    return new StreamableFile(file.body, { type: file.contentType, disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}` });
  }
}
