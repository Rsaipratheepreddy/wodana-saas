import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import sharp from "sharp";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { DatabaseService } from "../database/database.service";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import { COMPANY_LOGO_MAX_BYTES, COMPANY_LOGO_MIME_TYPES } from "./dto/company-logo.dto";
import { entityImageUrl, readLetterhead } from "./entity-letterhead";
import { WorkspaceAccessService } from "./workspace-access.service";

export const ENTITY_IMAGE_KINDS = ["logo", "letterhead"] as const;
export type EntityImageKind = (typeof ENTITY_IMAGE_KINDS)[number];
const WRITE = ["module.organization.edit", "legal_entities.manage"];
const PURPOSE: Record<EntityImageKind, string> = { logo: "entity_logo", letterhead: "entity_letterhead" };
const COLUMN: Record<EntityImageKind, string> = { logo: "logo_asset_id", letterhead: "letterhead_asset_id" };
/** What each image may be: a logo is roughly square or wide; a letterhead header is a wide band across the page. */
const SIZE: Record<EntityImageKind, { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number; document: { width: number; height: number } }> = {
  logo: { minWidth: 64, minHeight: 64, maxWidth: 4096, maxHeight: 4096, document: { width: 1024, height: 512 } },
  letterhead: { minWidth: 600, minHeight: 60, maxWidth: 8000, maxHeight: 3000, document: { width: 2480, height: 900 } },
};

type Asset = { id: string; objectKey: string; mimeType: string; expectedByteSize: number; uploadExpiresAt: Date; entityId: string; purpose: string };

/**
 * A business's logo and letterhead header (PLM-112), stored with the workspace's brand assets (the same
 * storage, upload and checks as the company logo) but marked as that business's, so they never replace
 * the workspace logo. An upload is started, sent (to object storage, or through Wodana), then completed:
 * the image is checked, a flattened PNG is made for documents, and the business points at it.
 */
@Injectable()
export class EntityImagesService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly database: DatabaseService,
    private readonly storage: BrandAssetStorageService,
  ) {}

  start(actor: RequestActor, workspaceId: string, entityId: string, kind: string, input: Record<string, unknown>) {
    const imageKind = kindOf(kind);
    const filename = typeof input.filename === "string" ? input.filename.trim().slice(0, 255) : "";
    const mimeType = String(input.mimeType ?? "");
    const byteSize = Number(input.byteSize);
    if (!filename) throw new BadRequestException("Choose an image.");
    if (!(COMPANY_LOGO_MIME_TYPES as readonly string[]).includes(mimeType)) throw new BadRequestException("Choose a PNG, JPEG or WebP image.");
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > COMPANY_LOGO_MAX_BYTES) throw new BadRequestException("The image must be 5 MB or smaller.");
    return this.access.withAnyPermission(actor, workspaceId, WRITE, async (client, user) => {
      await this.entity(client, workspaceId, entityId);
      const assetId = randomUUID();
      const objectKey = `workspace-branding/${workspaceId}/entities/${entityId}/${assetId}/source`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await client.query(
        `INSERT INTO workspace_brand_assets (id, workspace_id, object_key, original_filename, mime_type, expected_byte_size, created_by, upload_expires_at, purpose, legal_entity_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [assetId, workspaceId, objectKey, filename, mimeType, byteSize, user.userId, expiresAt, PURPOSE[imageKind], entityId]);
      const uploadUrl = await this.storage.createUploadUrl(objectKey, mimeType, byteSize);
      return { assetId, expiresAt, uploadMode: uploadUrl ? "signed" : "application", uploadUrl, uploadHeaders: { "content-type": mimeType } };
    });
  }

  /** The image's bytes, through Wodana, when there is no object storage. */
  content(actor: RequestActor, workspaceId: string, entityId: string, kind: string, assetId: string, contentType: string, body: Buffer) {
    const imageKind = kindOf(kind);
    if (this.storage.usesObjectStorage) throw new BadRequestException("Use the signed object-storage URL for this upload");
    return this.access.withAnyPermission(actor, workspaceId, WRITE, async (client) => {
      const asset = await this.pending(client, workspaceId, entityId, imageKind, assetId);
      if (contentType !== asset.mimeType) throw new BadRequestException("The image type changed during the upload.");
      if (body.byteLength !== asset.expectedByteSize || body.byteLength > COMPANY_LOGO_MAX_BYTES) throw new BadRequestException("The image size changed during the upload.");
      await this.storage.writeLocal(asset.objectKey, body);
      return { uploaded: true };
    });
  }

  /** Checks the uploaded image, makes its document variant and sets it as the business's logo or letterhead. */
  complete(actor: RequestActor, workspaceId: string, entityId: string, kind: string, assetId: string) {
    const imageKind = kindOf(kind);
    return this.access.withAnyPermission(actor, workspaceId, WRITE, async (client, user) => {
      const asset = await this.pending(client, workspaceId, entityId, imageKind, assetId);
      const stored = await this.storage.read(asset.objectKey).catch(() => null);
      if (!stored) throw new BadRequestException("Upload the image before completing it.");
      if (stored.byteSize !== asset.expectedByteSize || stored.byteSize > COMPANY_LOGO_MAX_BYTES) throw new BadRequestException("The uploaded image doesn't match the chosen file.");
      await this.storage.confirmUpload(asset.objectKey, stored.body, asset.mimeType);
      const metadata = await sharp(stored.body, { failOn: "warning" }).metadata().catch(() => null);
      const detected = metadata?.format === "jpeg" ? "image/jpeg" : metadata?.format === "png" ? "image/png" : metadata?.format === "webp" ? "image/webp" : null;
      if (!metadata?.width || !metadata.height || detected !== asset.mimeType) throw new BadRequestException("The file isn't a PNG, JPEG or WebP image.");
      const size = SIZE[imageKind];
      if (metadata.width < size.minWidth || metadata.height < size.minHeight)
        throw new BadRequestException(`The image must be at least ${size.minWidth} by ${size.minHeight} pixels.`);
      if (metadata.width > size.maxWidth || metadata.height > size.maxHeight)
        throw new BadRequestException(`The image must be at most ${size.maxWidth} by ${size.maxHeight} pixels.`);
      const documentKey = asset.objectKey.replace(/\/source$/, "/document.png");
      const document = await sharp(stored.body).rotate().resize({ ...size.document, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer();
      await this.storage.put(documentKey, document, "image/png");
      const entity = await this.entity(client, workspaceId, entityId, true);
      const previous = imageKind === "logo" ? entity.logoAssetId : entity.letterheadAssetId;
      if (previous) await client.query(`UPDATE workspace_brand_assets SET status = 'replaced' WHERE workspace_id = $1 AND id = $2`, [workspaceId, previous]);
      const activated = await client.query(
        `UPDATE workspace_brand_assets SET status = 'active', byte_size = $1, width = $2, height = $3, variants = $4, activated_at = now()
          WHERE id = $5 AND workspace_id = $6 AND status = 'pending'`,
        [stored.byteSize, metadata.width, metadata.height, { document: documentKey }, assetId, workspaceId]);
      if (!activated.rowCount) throw new ConflictException("The upload changed. Try again.");
      await client.query(`UPDATE legal_entities SET ${COLUMN[imageKind]} = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entityId, assetId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `legal_entity.${imageKind}_updated`, entityType: "legal_entity", entityId,
        before: { assetId: previous }, after: { assetId, mimeType: asset.mimeType, byteSize: stored.byteSize, width: metadata.width, height: metadata.height } });
      return { kind: imageKind, assetId, url: entityImageUrl(workspaceId, assetId), version: entity.version + 1 };
    });
  }

  /** Removes a business's logo or letterhead header; its documents then use the workspace brand. */
  remove(actor: RequestActor, workspaceId: string, entityId: string, kind: string) {
    const imageKind = kindOf(kind);
    return this.access.withAnyPermission(actor, workspaceId, WRITE, async (client, user) => {
      const entity = await this.entity(client, workspaceId, entityId, true);
      const previous = imageKind === "logo" ? entity.logoAssetId : entity.letterheadAssetId;
      if (!previous) return { kind: imageKind, assetId: null, url: null, version: entity.version };
      await client.query(`UPDATE workspace_brand_assets SET status = 'replaced' WHERE workspace_id = $1 AND id = $2`, [workspaceId, previous]);
      await client.query(`UPDATE legal_entities SET ${COLUMN[imageKind]} = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entityId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `legal_entity.${imageKind}_removed`, entityType: "legal_entity", entityId, before: { assetId: previous }, after: { assetId: null } });
      return { kind: imageKind, assetId: null, url: null, version: entity.version + 1 };
    });
  }

  /** What a business's documents print (any member may read it: it's on the documents they print). */
  letterhead(actor: RequestActor, workspaceId: string, entityId: string) {
    return this.access.asMember(actor, workspaceId, async (client) => {
      const letterhead = await readLetterhead(client, workspaceId, entityId);
      if (!letterhead) throw new NotFoundException("Business not found.");
      return letterhead;
    });
  }

  /** A business's image as documents print it. Public by its (unguessable) id, like the workspace logo; a replaced one stays readable for documents issued with it. */
  async read(workspaceId: string, assetId: string) {
    return this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      const asset = (await client.query<{ key: string | null; updatedAt: Date }>(
        `SELECT variants->>'document' AS key, updated_at AS "updatedAt" FROM workspace_brand_assets
          WHERE workspace_id = $1 AND id = $2 AND status IN ('active', 'replaced') AND purpose IN ('entity_logo', 'entity_letterhead')`, [workspaceId, assetId])).rows[0];
      if (!asset?.key) throw new NotFoundException("Image not found.");
      const stored = await this.storage.read(asset.key).catch(() => null);
      if (!stored) throw new NotFoundException("Image not found.");
      return { body: stored.body, contentType: "image/png", etag: asset.updatedAt.getTime().toString(36) };
    });
  }

  private async entity(client: PoolClient, workspaceId: string, entityId: string, lock = false) {
    const row = (await client.query<{ logoAssetId: string | null; letterheadAssetId: string | null; version: number }>(
      `SELECT logo_asset_id AS "logoAssetId", letterhead_asset_id AS "letterheadAssetId", version FROM legal_entities
        WHERE workspace_id = $1 AND id = $2 AND status = 'active' ${lock ? "FOR UPDATE" : ""}`, [workspaceId, entityId])).rows[0];
    if (!row) throw new NotFoundException("Business not found.");
    return row;
  }

  private async pending(client: PoolClient, workspaceId: string, entityId: string, kind: EntityImageKind, assetId: string): Promise<Asset> {
    const asset = (await client.query<Asset>(
      `SELECT id, object_key AS "objectKey", mime_type AS "mimeType", expected_byte_size AS "expectedByteSize", upload_expires_at AS "uploadExpiresAt",
              legal_entity_id AS "entityId", purpose
         FROM workspace_brand_assets WHERE workspace_id = $1 AND id = $2 AND status = 'pending' AND legal_entity_id = $3 AND purpose = $4`,
      [workspaceId, assetId, entityId, PURPOSE[kind]])).rows[0];
    if (!asset) throw new NotFoundException("The upload wasn't found.");
    if (asset.uploadExpiresAt.getTime() <= Date.now()) {
      await client.query(`UPDATE workspace_brand_assets SET status = 'failed' WHERE workspace_id = $1 AND id = $2`, [workspaceId, assetId]);
      throw new GoneException("The upload expired. Choose the image again.");
    }
    return asset;
  }
}

function kindOf(value: string): EntityImageKind {
  if (!(ENTITY_IMAGE_KINDS as readonly string[]).includes(value)) throw new NotFoundException("Unknown image.");
  return value as EntityImageKind;
}
