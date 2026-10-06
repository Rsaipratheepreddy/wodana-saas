import { Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CANVA_CONNECT, CanvaConnectNotConfigured, canvaLink, type CanvaConnect } from "./canva";
import { decodeEntities, readMeta } from "./product-extract";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "./safe-fetch";
import { parseFetchableUrl } from "./url-guard";

/** People who see design boards, concepts or the catalog may see a link's card. */
const VIEWERS = ["pre_projects.view", "catalog.view"];
const FRESH_MS = 7 * 24 * 3600 * 1000;
type Fetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;
type PreviewRow = { id: string; url: string; provider: "canva" | "web"; title: string | null; imageKey: string | null; imagePreviewKey: string | null; imageMime: string | null; status: "ok" | "unavailable"; fetchedAt: string; version: number };
const SELECT = `SELECT id, url, provider, title, image_key AS "imageKey", image_preview_key AS "imagePreviewKey", image_mime AS "imageMime", status, fetched_at AS "fetchedAt", version FROM link_previews`;

/**
 * Link cards for design boards and concepts (Canva share links first): title and thumbnail from Canva Connect when
 * it is configured, otherwise from the page's OpenGraph tags; the thumbnail is copied into our storage, never
 * hotlinked. A card is cached for a week; an unreadable page still gives a card with the link.
 */
@Injectable()
export class LinkPreviewService {
  private fetcher: Fetcher = safeFetch;
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly storage: BrandAssetStorageService,
    @Optional() @Inject(CANVA_CONNECT) private readonly canva: CanvaConnect = new CanvaConnectNotConfigured(),
  ) {}

  useFetcher(fetcher: Fetcher) { this.fetcher = fetcher; return this; }

  async preview(actor: RequestActor, workspaceId: string, raw: string) {
    let url: string;
    try { url = parseFetchableUrl(raw).url.toString(); } catch (error) { throw new UnprocessableEntityException(error instanceof Error ? error.message : "This link can't be shown."); }
    if (!url.startsWith("https://")) throw new UnprocessableEntityException("Use an https link.");
    const canva = canvaLink(url);
    const hash = createHash("sha256").update(url).digest("hex");
    const cached = await this.access.withAnyPermission(actor, workspaceId, VIEWERS, async (client, user) => ({ row: await this.row(client, workspaceId, hash), userId: user.userId }));
    if (cached.row && Date.now() - new Date(cached.row.fetchedAt).getTime() < FRESH_MS) return present(cached.row);

    let title: string | null = null, imageUrl: string | null = null;
    if (canva?.designId && this.canva.configured) {
      const meta = await this.canva.designMeta(workspaceId, cached.userId, canva.designId).catch(() => null);
      title = meta?.title ?? null; imageUrl = meta?.thumbnailUrl ?? null;
    }
    if (!title && !imageUrl) {
      try {
        const page = await this.fetcher(url, { maxBytes: 1024 * 1024, timeoutMs: 8_000, accept: "text/html" });
        const html = page.body.toString("utf8");
        const { meta, images } = readMeta(html);
        title = (meta["og:title"] ?? meta["twitter:title"] ?? decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")).replace(/\s+/g, " ").trim().slice(0, 300) || null;
        imageUrl = images[0] ? new URL(images[0], page.finalUrl).toString() : null;
      } catch { /* the card falls back to the link itself */ }
    }
    const id = cached.row?.id ?? randomUUID();
    let stored: { key: string; previewKey: string | null; mime: string } | null = null;
    if (imageUrl) {
      try {
        const image = await this.fetcher(imageUrl, { maxBytes: 5 * 1024 * 1024, timeoutMs: 8_000, accept: "image/*" });
        const prepared = await prepareReferenceUpload({ buffer: image.body, originalname: "thumbnail", mimetype: image.contentType, size: image.body.length });
        if (prepared.mimeType.startsWith("image/")) {
          const key = `link-previews/${workspaceId}/${id}/${prepared.digest.slice(0, 16)}`;
          await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
          if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
          stored = { key: `${key}/original`, previewKey: prepared.preview ? `${key}/preview.webp` : null, mime: prepared.mimeType };
        }
      } catch { /* no thumbnail */ }
    }
    return this.access.withAnyPermission(actor, workspaceId, VIEWERS, async (client, user) => {
      const status = title || stored ? "ok" : "unavailable";
      await client.query(
        `INSERT INTO link_previews (id, workspace_id, url, url_hash, provider, title, image_key, image_preview_key, image_mime, status, fetched_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
         ON CONFLICT (workspace_id, url_hash) DO UPDATE SET title = coalesce(EXCLUDED.title, link_previews.title), image_key = coalesce(EXCLUDED.image_key, link_previews.image_key),
           image_preview_key = CASE WHEN EXCLUDED.image_key IS NULL THEN link_previews.image_preview_key ELSE EXCLUDED.image_preview_key END,
           image_mime = coalesce(EXCLUDED.image_mime, link_previews.image_mime),
           status = CASE WHEN EXCLUDED.status = 'ok' OR link_previews.status = 'ok' THEN 'ok' ELSE 'unavailable' END, fetched_at = now(), version = link_previews.version + 1`,
        [id, workspaceId, url, hash, canva ? "canva" : "web", title, stored?.key ?? null, stored?.previewKey ?? null, stored?.mime ?? null, status, user.userId]);
      return present((await this.row(client, workspaceId, hash))!);
    });
  }

  image(actor: RequestActor, workspaceId: string, previewId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEWERS, async (client) => {
      const row = (await client.query<PreviewRow>(`${SELECT} WHERE workspace_id = $1 AND id = $2`, [workspaceId, previewId])).rows[0];
      const key = row?.imagePreviewKey ?? row?.imageKey;
      if (!row || !key) throw new NotFoundException("This link has no picture.");
      const stored = await this.storage.read(key).catch(() => { throw new NotFoundException("This picture could not be found in storage."); });
      return { body: stored.body, contentType: key === row.imagePreviewKey ? "image/webp" : row.imageMime ?? "application/octet-stream" };
    });
  }

  private async row(client: PoolClient, workspaceId: string, hash: string) {
    return (await client.query<PreviewRow>(`${SELECT} WHERE workspace_id = $1 AND url_hash = $2`, [workspaceId, hash])).rows[0] ?? null;
  }
}

const present = (row: PreviewRow) => ({ id: row.id, url: row.url, provider: row.provider, title: row.title, hasImage: Boolean(row.imageKey), status: row.status, host: new URL(row.url).hostname });
