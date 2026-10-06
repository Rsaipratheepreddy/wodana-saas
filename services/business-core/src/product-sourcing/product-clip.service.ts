import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { AiCreditRefusal } from "../ai-gateway/ai-credits";
import { AiGatewayService, AiUnavailableError } from "../ai-gateway/ai-gateway.service";
import { aiModelFor, aiProviderName } from "../ai-gateway/ai-provider";
import { storeImage } from "../catalog-core/catalog-item-images";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { AI_FIELDS, CLIP_FIELDS, CLIP_SYSTEM, clipPrompt, dimensionUnit, extractProduct, pageText, priceNumber, sizeNumber, validateClip, type ClipField, type Extraction, type Proposal } from "./product-extract";
import { FetchFailedError, safeFetch, type SafeFetchOptions, type SafeFetchResult } from "./safe-fetch";
import { BlockedUrlError, parseFetchableUrl } from "./url-guard";

const VIEW = "catalog.view";
const MANAGE = "catalog.manage";
const COST_PERMISSIONS = ["commercial.costs.view", "supplier_offers.view"];
const PAGE_LIMIT = { maxBytes: 3 * 1024 * 1024, timeoutMs: 10_000, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" };
const IMAGE_LIMIT = { maxBytes: 8 * 1024 * 1024, timeoutMs: 8_000, accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" };
const SIZE_FIELDS = ["width", "depth", "height", "diagonal_depth"] as const;
type Fetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;
type AiStatus = "used" | "not_needed" | "off" | "failed";

type ClipRow = { id: string; catalogId: string; sourceUrl: string; finalUrl: string; host: string; pageTitle: string | null; aiStatus: AiStatus; aiModel: string | null;
  status: "review" | "saved" | "discarded"; catalogItemId: string | null; savedAt: string | null; fetchedAt: string; version: number };
type FieldRow = { field: ClipField; proposedValue: string | null; source: string; confidence: string | null; evidence: string | null; model: string | null; decision: string; finalValue: string | null; confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null };
type ImageRow = { id: string; position: number; sourceUrl: string; objectKey: string; previewKey: string | null; mimeType: string; byteSize: number; sha256: string };

const CLIP_SELECT = `SELECT id, catalog_id AS "catalogId", source_url AS "sourceUrl", final_url AS "finalUrl", host, page_title AS "pageTitle", ai_status AS "aiStatus", ai_model AS "aiModel",
  status, catalog_item_id AS "catalogItemId", saved_at AS "savedAt", fetched_at AS "fetchedAt", version FROM product_clips`;

/** The text of a fetched page in its declared charset (UTF-8 unless the page says otherwise). */
function decodePage(body: Buffer, contentType: string) {
  const declared = contentType.match(/charset=([\w-]+)/i)?.[1] ?? body.subarray(0, 2048).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try { return new TextDecoder(declared.toLowerCase()).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}

/**
 * Product clipper (plan §0.7 R4): a supplier product link becomes a catalog item. The page is read safely on the
 * server, its own data first and AI only for gaps (each AI field quoted from the page), pictures are copied into our
 * storage, and a person reviews every field before the catalog's own create-item command saves it.
 */
@Injectable()
export class ProductClipService {
  private fetcher: Fetcher = safeFetch;
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiGatewayService,
    private readonly storage: BrandAssetStorageService,
    private readonly catalogs: CatalogV2Service,
  ) {}

  /** Tests replace the network. */
  useFetcher(fetcher: Fetcher) { this.fetcher = fetcher; return this; }

  async read(actor: RequestActor, workspaceId: string, input: { clipId: string; catalogId: string; url: string }) {
    let target: URL;
    try { target = parseFetchableUrl(input.url).url; } catch (error) { throw new UnprocessableEntityException(error instanceof Error ? error.message : "This link can't be read."); }
    // Replays of the same read return what was read; the catalog must exist and the person must manage it.
    const existing = await this.access.withPermission(actor, workspaceId, MANAGE, async (client) => {
      if (!(await client.query(`SELECT 1 FROM catalogs WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, input.catalogId])).rowCount) throw new NotFoundException("Catalog not found");
      return this.clipRow(client, workspaceId, input.clipId);
    });
    if (existing) {
      if (existing.sourceUrl !== target.toString()) throw new ConflictException("This read was for another link. Start again.");
      return this.get(actor, workspaceId, input.clipId);
    }

    let page: SafeFetchResult;
    try { page = await this.fetcher(target.toString(), PAGE_LIMIT); }
    catch (error) { throw new UnprocessableEntityException(error instanceof BlockedUrlError || error instanceof FetchFailedError ? error.message : "The page could not be read."); }
    if (!/html|xml/.test(page.contentType) && !/^\s*</.test(page.body.subarray(0, 64).toString("latin1"))) throw new UnprocessableEntityException("This link is not a web page.");
    const html = decodePage(page.body, page.contentType);
    const extraction = extractProduct(html, page.finalUrl);
    const { aiStatus, aiModel } = await this.fillWithAi(actor, workspaceId, extraction, html);
    const images = await this.copyImages(workspaceId, input.clipId, extraction.images);

    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      // Two tabs reading the same clip at once: the second keeps the first one's result.
      const inserted = await client.query(
        `INSERT INTO product_clips (id, workspace_id, catalog_id, source_url, final_url, host, page_title, page_snapshot, ai_status, ai_model, fetched_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now(), $11) ON CONFLICT (id) DO NOTHING`,
        [input.clipId, workspaceId, input.catalogId, target.toString(), page.finalUrl.slice(0, 2000), new URL(page.finalUrl).hostname.slice(0, 255), extraction.title,
          JSON.stringify(extraction.snapshot), aiStatus, aiModel, user.userId]);
      if (inserted.rowCount) {
        for (const [field, proposal] of Object.entries(extraction.fields) as Array<[ClipField, Proposal]>) {
          await client.query(
            `INSERT INTO product_clip_fields (workspace_id, clip_id, field, proposed_value, source, confidence, evidence, model) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [workspaceId, input.clipId, field, proposal.value.slice(0, 4000), proposal.source, proposal.confidence.toFixed(2), proposal.evidence?.slice(0, 500) ?? null, proposal.model ?? null]);
        }
        for (const [position, image] of images.entries()) {
          await client.query(
            `INSERT INTO product_clip_images (id, workspace_id, clip_id, position, source_url, object_key, preview_key, mime_type, byte_size, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [image.id, workspaceId, input.clipId, position, image.sourceUrl.slice(0, 2000), image.objectKey, image.previewKey, image.mimeType, image.byteSize, image.sha256]);
        }
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.product_clip_read.v1", entityType: "product_clip", entityId: input.clipId,
          after: { url: target.toString(), host: new URL(page.finalUrl).hostname, fields: Object.fromEntries(Object.entries(extraction.fields).map(([field, proposal]) => [field, proposal.source])), images: images.length, aiStatus, aiModel } });
      }
      return this.present(client, workspaceId, input.clipId);
    });
  }

  get(actor: RequestActor, workspaceId: string, clipId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client) => this.present(client, workspaceId, clipId));
  }

  /** Saves the reviewed clip as a catalog item through the catalog's create command; a replay returns the same item. */
  save(actor: RequestActor, workspaceId: string, clipId: string, input: { version: number; code: string; itemType: "product" | "material" | "ready_made"; unitCode: string; categoryId?: string | null; values: Record<string, string | null>; imageIds: string[]; vendorId?: string | null }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const clip = await this.clipRow(client, workspaceId, clipId, true);
      if (!clip) throw new NotFoundException("This product link was not read yet.");
      if (clip.status === "saved" && input.version === clip.version - 1) return { ...(await this.present(client, workspaceId, clipId)), itemId: clip.catalogItemId };
      if (clip.status !== "review") throw new ConflictException(clip.status === "saved" ? "This product is already in the catalog." : "This product link was discarded.");
      if (input.version !== clip.version) throw new ConflictException("This product changed; reload and try again.");
      const values = this.cleanValues(input.values);
      if (!values.name) throw new UnprocessableEntityException("Enter a name");
      const fields = await this.fields(client, workspaceId, clipId);

      const { description, attributeValues } = await this.attributeValues(client, workspaceId, clip.catalogId, input.categoryId ?? null, values);
      const itemId = await this.catalogs.insertItem(client, workspaceId, clip.catalogId,
        { code: input.code, name: values.name, itemType: input.itemType, unitCode: input.unitCode, categoryId: input.categoryId ?? null, description, values: attributeValues }, user.userId);

      const unit = values.dimension_unit ? dimensionUnit(values.dimension_unit) : null;
      if (SIZE_FIELDS.some((field) => values[field])) {
        if (!unit) throw new UnprocessableEntityException("Choose the unit of the size");
        await client.query(
          `INSERT INTO catalog_item_dimensions (workspace_id, item_id, width, depth, height, diagonal_depth, unit, source, clip_id, updated_by) VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, 'clipper', $8, $9)`,
          [workspaceId, itemId, values.width, values.depth, values.height, values.diagonal_depth, unit, clipId, user.userId]);
      }

      // Pictures were copied from the page at read time; the chosen ones become the item's own (same ids, so a replay is a no-op).
      const images = (await client.query<ImageRow>(`SELECT id, position, source_url AS "sourceUrl", object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType", byte_size AS "byteSize", sha256 FROM product_clip_images WHERE workspace_id = $1 AND clip_id = $2`, [workspaceId, clipId])).rows;
      for (const imageId of input.imageIds) {
        const image = images.find((entry) => entry.id === imageId);
        if (!image) throw new UnprocessableEntityException("Choose pictures from this page only");
        const body = (await this.storage.read(image.objectKey)).body;
        const preview = image.previewKey ? (await this.storage.read(image.previewKey)).body : null;
        await storeImage(client, this.storage, { workspaceId, itemId, imageId: image.id, userId: user.userId, name: `${values.name.slice(0, 200)}.${image.mimeType.split("/")[1] ?? "img"}`, mimeType: image.mimeType, body, preview, sha256: image.sha256 });
      }

      if (input.vendorId) {
        if (!(await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.vendorId])).rowCount) throw new NotFoundException("Supplier not found");
        // The page's price is kept as the supplier's cost only for people who may see costs.
        const costs = (await Promise.all(COST_PERMISSIONS.map((code) => this.access.hasPermission(client, workspaceId, user.userId, code)))).some(Boolean);
        const cost = costs && values.price && values.currency ? values.price : null;
        await client.query(
          `INSERT INTO catalog_supplier_links (workspace_id, item_id, vendor_id, vendor_sku, cost, currency, lead_time_days, preferred, product_url) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, true, $8)`,
          [workspaceId, itemId, input.vendorId, values.sku?.slice(0, 120) ?? null, cost, cost ? values.currency : null, values.lead_time_days ? Number(values.lead_time_days) : null, clip.finalUrl]);
      }

      // Provenance (§0.7 C3): what each field was proposed as, by what, and what the person kept.
      const decisions: Record<string, string> = {};
      for (const field of CLIP_FIELDS) {
        const proposal = fields.find((row) => row.field === field);
        const final = values[field] ?? null;
        if (proposal) {
          const decision = !final ? "rejected" : final === proposal.proposedValue ? "accepted" : "edited";
          decisions[field] = decision;
          await client.query(`UPDATE product_clip_fields SET decision = $4, final_value = $5, confirmed_by = $6, confirmed_at = now() WHERE workspace_id = $1 AND clip_id = $2 AND field = $3`,
            [workspaceId, clipId, field, decision, final, user.userId]);
        } else if (final) {
          decisions[field] = "added";
          await client.query(`INSERT INTO product_clip_fields (workspace_id, clip_id, field, source, decision, final_value, confirmed_by, confirmed_at) VALUES ($1, $2, $3, 'person', 'added', $4, $5, now())`,
            [workspaceId, clipId, field, final, user.userId]);
        }
      }
      await client.query(`UPDATE product_clips SET status = 'saved', catalog_item_id = $3, saved_by = $4, saved_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, clipId, itemId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.product_clip_saved.v1", entityType: "product_clip", entityId: clipId,
        after: { itemId, url: clip.finalUrl, decisions, sources: Object.fromEntries(fields.map((row) => [row.field, { source: row.source, confidence: row.confidence, model: row.model }])), images: input.imageIds.length, vendorId: input.vendorId ?? null } });
      return { ...(await this.present(client, workspaceId, clipId)), itemId };
    });
  }

  discard(actor: RequestActor, workspaceId: string, clipId: string, version: number) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const clip = await this.clipRow(client, workspaceId, clipId, true);
      if (!clip) throw new NotFoundException("This product link was not read yet.");
      if (clip.status === "discarded") return this.present(client, workspaceId, clipId);
      if (clip.status !== "review") throw new ConflictException("This product is already in the catalog.");
      if (version !== clip.version) throw new ConflictException("This product changed; reload and try again.");
      await client.query(`UPDATE product_clips SET status = 'discarded', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, clipId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.product_clip_discarded.v1", entityType: "product_clip", entityId: clipId, after: { url: clip.sourceUrl } });
      return this.present(client, workspaceId, clipId);
    });
  }

  image(actor: RequestActor, workspaceId: string, clipId: string, imageId: string, preview: boolean) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType" FROM product_clip_images WHERE workspace_id = $1 AND clip_id = $2 AND id = $3`, [workspaceId, clipId, imageId])).rows[0];
      if (!row) throw new NotFoundException("Image not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => { throw new NotFoundException("This image could not be found in storage."); });
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

  /** Where a catalog item came from (the supplier page and each field's provenance) and its size. */
  itemSource(actor: RequestActor, workspaceId: string, itemId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const size = (await client.query(
        `SELECT width::text AS width, depth::text AS depth, height::text AS height, diagonal_depth::text AS "diagonalDepth", unit, source, version FROM catalog_item_dimensions WHERE workspace_id = $1 AND item_id = $2`,
        [workspaceId, itemId])).rows[0] ?? null;
      const clip = (await client.query<{ id: string }>(`SELECT id FROM product_clips WHERE workspace_id = $1 AND catalog_item_id = $2 ORDER BY saved_at DESC LIMIT 1`, [workspaceId, itemId])).rows[0];
      const unitSystem = (await client.query<{ unitSystem: string }>(`SELECT unit_system::text AS "unitSystem" FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.unitSystem;
      return { size, defaultUnit: unitSystem === "imperial" ? "in" : "cm", source: clip ? await this.present(client, workspaceId, clip.id) : null };
    });
  }

  /** Sets an item's outside size (version-checked; version 0 creates it). */
  saveDimensions(actor: RequestActor, workspaceId: string, itemId: string, input: { version: number; width?: string | null; depth?: string | null; height?: string | null; diagonalDepth?: string | null; unit: string }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      if (!(await client.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, itemId])).rowCount) throw new NotFoundException("Item not found");
      const current = (await client.query<{ version: number; width: string | null; depth: string | null; height: string | null; diagonalDepth: string | null; unit: string }>(
        `SELECT version, width::text AS width, depth::text AS depth, height::text AS height, diagonal_depth::text AS "diagonalDepth", unit FROM catalog_item_dimensions WHERE workspace_id = $1 AND item_id = $2 FOR UPDATE`,
        [workspaceId, itemId])).rows[0];
      if ((current?.version ?? 0) !== input.version) throw new ConflictException("This size changed; reload and try again.");
      const unit = dimensionUnit(input.unit);
      if (!unit) throw new UnprocessableEntityException("Choose a unit");
      const next = { width: sizeNumber(input.width ?? ""), depth: sizeNumber(input.depth ?? ""), height: sizeNumber(input.height ?? ""), diagonalDepth: sizeNumber(input.diagonalDepth ?? ""), unit };
      await client.query(
        `INSERT INTO catalog_item_dimensions (workspace_id, item_id, width, depth, height, diagonal_depth, unit, source, updated_by) VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, 'person', $8)
         ON CONFLICT (workspace_id, item_id) DO UPDATE SET width = EXCLUDED.width, depth = EXCLUDED.depth, height = EXCLUDED.height, diagonal_depth = EXCLUDED.diagonal_depth, unit = EXCLUDED.unit,
           source = 'person', clip_id = NULL, updated_by = EXCLUDED.updated_by, updated_at = now(), version = catalog_item_dimensions.version + 1`,
        [workspaceId, itemId, next.width, next.depth, next.height, next.diagonalDepth, unit, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.item_size_saved.v1", entityType: "catalog_item", entityId: itemId, before: current ?? null, after: next });
      return { ...next, source: "person", version: input.version + 1 };
    });
  }

  // ---------- helpers ----------

  private async fillWithAi(actor: RequestActor, workspaceId: string, extraction: Extraction, html: string): Promise<{ aiStatus: AiStatus; aiModel: string | null }> {
    const missing = AI_FIELDS.filter((field) => !extraction.fields[field]);
    if (!missing.length) return { aiStatus: "not_needed", aiModel: null };
    const provider = aiProviderName();
    if (!provider || !this.ai.configured) return { aiStatus: "off", aiModel: null };
    const model = aiModelFor(provider);
    const text = pageText(html, 10_000);
    const known = Object.fromEntries(Object.entries(extraction.fields).map(([field, proposal]) => [field, proposal!.value]));
    try {
      const filled = await this.ai.run(actor, workspaceId, {
        feature: "catalog.product_clip", system: CLIP_SYSTEM, prompt: clipPrompt(text, missing, known), maxTokens: 1500,
        validate: (value) => validateClip(value, missing, text, model),
      });
      for (const [field, proposal] of Object.entries(filled) as Array<[ClipField, Proposal]>) if (!extraction.fields[field]) extraction.fields[field] = proposal;
      return { aiStatus: "used", aiModel: model };
    } catch (error) {
      // AI off, not allowed for this person, or out of credits: the page's own data is still offered.
      if (error instanceof AiUnavailableError || error instanceof ForbiddenException || error instanceof AiCreditRefusal) return { aiStatus: "off", aiModel: null };
      return { aiStatus: "failed", aiModel: null };
    }
  }

  /** Copies up to six pictures into storage (each re-checked as a real image); a picture that fails is skipped. */
  private async copyImages(workspaceId: string, clipId: string, urls: string[]) {
    const out: Array<{ id: string; sourceUrl: string; objectKey: string; previewKey: string | null; mimeType: string; byteSize: number; sha256: string }> = [];
    for (const url of urls) {
      try {
        const fetched = await this.fetcher(url, IMAGE_LIMIT);
        const prepared = await prepareReferenceUpload({ buffer: fetched.body, originalname: "image", mimetype: fetched.contentType, size: fetched.body.length });
        if (!prepared.mimeType.startsWith("image/") || out.some((image) => image.sha256 === prepared.digest)) continue;
        const id = randomUUID();
        const key = `product-clips/${workspaceId}/${clipId}/${id}`;
        await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        out.push({ id, sourceUrl: url, objectKey: `${key}/original`, previewKey: prepared.preview ? `${key}/preview.webp` : null, mimeType: prepared.mimeType, byteSize: prepared.body.length, sha256: prepared.digest });
      } catch { /* an unreadable picture is left out */ }
    }
    return out;
  }

  private cleanValues(raw: Record<string, string | null>) {
    const out: Partial<Record<ClipField, string>> = {};
    for (const field of CLIP_FIELDS) {
      const value = typeof raw?.[field] === "string" ? raw[field]!.replace(/\s+/g, " ").trim() : "";
      if (!value) continue;
      if (SIZE_FIELDS.includes(field as (typeof SIZE_FIELDS)[number])) { const size = sizeNumber(value); if (!size) throw new UnprocessableEntityException("Enter sizes as positive numbers"); out[field] = size; }
      else if (field === "price") { const price = priceNumber(value); if (!price) throw new UnprocessableEntityException("Enter the price as a number"); out[field] = price; }
      else if (field === "currency") { if (!/^[A-Za-z]{3}$/.test(value)) throw new UnprocessableEntityException("Choose a currency"); out[field] = value.toUpperCase(); }
      else if (field === "dimension_unit") { const unit = dimensionUnit(value); if (!unit) throw new UnprocessableEntityException("Choose the unit of the size"); out[field] = unit; }
      else if (field === "lead_time_days") { const days = Number(value); if (!Number.isInteger(days) || days < 0 || days > 730) throw new UnprocessableEntityException("Enter the lead time in days"); out[field] = String(days); }
      else out[field] = value.slice(0, field === "description" ? 4000 : 200);
    }
    return out;
  }

  /** Finish, material and colour go to the catalog's attributes with those codes; otherwise into the description. */
  private async attributeValues(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string | null, values: Partial<Record<ClipField, string>>) {
    const attributes = (await client.query<{ code: string }>(
      `SELECT code FROM catalog_attributes WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' AND value_type = 'text' AND (category_id IS NULL OR category_id = $3)
         AND code IN ('finish', 'material', 'colour', 'color', 'brand')`, [workspaceId, catalogId, categoryId])).rows.map((row) => row.code);
    const attributeValues: Record<string, string> = {};
    const lines: string[] = [];
    for (const [field, label] of [["brand", "Brand"], ["finish", "Finish"], ["material", "Material"], ["colour", "Colour"]] as const) {
      const value = values[field];
      if (!value) continue;
      const code = attributes.find((entry) => entry === field || (field === "colour" && entry === "color"));
      if (code) attributeValues[code] = value; else lines.push(`${label}: ${value}`);
    }
    const description = [values.description, ...lines].filter(Boolean).join("\n").slice(0, 4000) || null;
    return { description, attributeValues };
  }

  private async clipRow(client: PoolClient, workspaceId: string, clipId: string, lock = false) {
    return (await client.query<ClipRow>(`${CLIP_SELECT} WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, clipId])).rows[0] ?? null;
  }

  private async fields(client: PoolClient, workspaceId: string, clipId: string) {
    return (await client.query<FieldRow>(
      `SELECT field.field, field.proposed_value AS "proposedValue", field.source, field.confidence::text AS confidence, field.evidence, field.model, field.decision, field.final_value AS "finalValue",
              field.confirmed_by AS "confirmedBy", person.display_name AS "confirmedByName", field.confirmed_at AS "confirmedAt"
         FROM product_clip_fields field LEFT JOIN users person ON person.id = field.confirmed_by
        WHERE field.workspace_id = $1 AND field.clip_id = $2`, [workspaceId, clipId])).rows;
  }

  private async present(client: PoolClient, workspaceId: string, clipId: string) {
    const clip = await this.clipRow(client, workspaceId, clipId);
    if (!clip) throw new NotFoundException("This product link was not read yet.");
    const fields = await this.fields(client, workspaceId, clipId);
    const images = (await client.query<{ id: string; position: number; hasPreview: boolean }>(
      `SELECT id, position, preview_key IS NOT NULL AS "hasPreview" FROM product_clip_images WHERE workspace_id = $1 AND clip_id = $2 ORDER BY position`, [workspaceId, clipId])).rows;
    const unitSystem = (await client.query<{ unitSystem: string; currency: string }>(`SELECT unit_system::text AS "unitSystem", default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
    return {
      ...clip,
      fetchedAt: new Date(clip.fetchedAt).toISOString(), savedAt: clip.savedAt ? new Date(clip.savedAt).toISOString() : null,
      fields: CLIP_FIELDS.map((field) => fields.find((row) => row.field === field)).filter(Boolean).map((row) => ({
        ...row!, confidence: row!.confidence === null ? null : Number(row!.confidence), confirmedAt: row!.confirmedAt ? new Date(row!.confirmedAt).toISOString() : null,
      })),
      images,
      defaults: { unit: unitSystem?.unitSystem === "imperial" ? "in" : "cm", currency: unitSystem?.currency ?? null },
    };
  }
}
