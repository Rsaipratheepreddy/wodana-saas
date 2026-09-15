import "reflect-metadata";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CatalogAssetsService } from "./catalog-assets.service";

const actor = { subject: "test", provider: "development" } as RequestActor;
const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const recordId = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const assetId = "cccccccc-cccc-4ccc-accc-cccccccccccc";

const row = (changes: Record<string, unknown> = {}) => ({
  id: assetId,
  catalogRecordId: recordId,
  role: "gallery_image",
  name: "chair.png",
  mimeType: "image/png",
  byteSize: 100,
  objectKey: `catalog/${workspaceId}/${recordId}/${assetId}/original`,
  previewKey: `catalog/${workspaceId}/${recordId}/${assetId}/preview.webp`,
  sha256: "a".repeat(64),
  altText: null,
  sortOrder: 0,
  status: "active",
  archivedReason: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...changes,
});

function setup(query: ReturnType<typeof vi.fn>) {
  const withPermissions = vi.fn(async (_actor, _workspace, _permissions, work) =>
    work({ query }, { userId: "user" }),
  );
  const withPermission = vi.fn(async (_actor, _workspace, _permission, work) =>
    work({ query }, { userId: "user" }),
  );
  const storage = {
    put: vi.fn(async () => undefined),
    read: vi.fn(async () => ({ body: Buffer.from("file"), byteSize: 4 })),
    remove: vi.fn(async () => undefined),
  };
  const events = { record: vi.fn(async () => undefined) };
  return {
    service: new CatalogAssetsService(
      { withPermissions, withPermission } as unknown as WorkspaceAccessService,
      storage as unknown as BrandAssetStorageService,
      events as unknown as CrmEventsService,
    ),
    storage,
    events,
  };
}

describe("catalog assets", () => {
  it("stores a verified image and preview with an idempotent catalog identity", async () => {
    const image = await sharp({
      create: { width: 12, height: 8, channels: 3, background: "#845ec2" },
    }).png().toBuffer();
    const digest = (await import("node:crypto")).createHash("sha256").update(image).digest("hex");
    const saved = row({ sha256: digest, byteSize: image.length });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT kind,archived")) return { rows: [{ kind: "work", archived: false }], rowCount: 1 };
      if (sql.includes("count(*) FILTER")) return { rows: [{ active: 0, total: 0 }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO workspace_catalog_assets")) return { rows: [saved], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const { service, storage, events } = setup(query);
    await expect(service.upload(actor, workspaceId, recordId, assetId, { role: "gallery_image" }, { buffer: image, originalname: "chair.png", mimetype: "image/png", size: image.length })).resolves.toMatchObject({ id: assetId, hasPreview: true });
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(events.record).toHaveBeenCalledOnce();
  });

  it("does not allow a PDF to masquerade as a product image", async () => {
    const query = vi.fn();
    const { service, storage } = setup(query);
    const pdf = Buffer.from("%PDF-1.7\n%%EOF");
    await expect(service.upload(actor, workspaceId, recordId, assetId, { role: "primary_image" }, { buffer: pdf, originalname: "drawing.pdf", mimetype: "application/pdf", size: pdf.length })).rejects.toThrow("technical drawings");
    expect(query).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("replays the exact same upload without rewriting storage or audit history", async () => {
    const image = await sharp({
      create: { width: 9, height: 9, channels: 3, background: "#123456" },
    }).png().toBuffer();
    const digest = (await import("node:crypto")).createHash("sha256").update(image).digest("hex");
    const current = row({ sha256: digest, byteSize: image.length });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT kind,archived")) return { rows: [{ kind: "work", archived: false }], rowCount: 1 };
      if (sql.includes("FROM workspace_catalog_assets") && sql.includes("AND id=$2")) return { rows: [current], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const { service, storage, events } = setup(query);
    await expect(service.upload(actor, workspaceId, recordId, assetId, { role: "gallery_image" }, { buffer: image, originalname: "chair.png", mimetype: "image/png", size: image.length })).resolves.toMatchObject({ id: assetId, version: 1 });
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("keeps one unambiguous active primary image", async () => {
    const image = await sharp({
      create: { width: 6, height: 6, channels: 3, background: "#abcdef" },
    }).png().toBuffer();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT kind,archived")) return { rows: [{ kind: "work", archived: false }], rowCount: 1 };
      if (sql.includes("count(*) FILTER")) return { rows: [{ active: 1, total: 1 }], rowCount: 1 };
      if (sql.includes("role='primary_image'")) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const { service, storage } = setup(query);
    await expect(service.upload(actor, workspaceId, recordId, assetId, { role: "primary_image" }, { buffer: image, originalname: "new.png", mimetype: "image/png", size: image.length })).rejects.toThrow("already has a primary image");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("cleans up only files written by a failed new upload", async () => {
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#eeeeee" },
    }).png().toBuffer();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT kind,archived")) return { rows: [{ kind: "work", archived: false }], rowCount: 1 };
      if (sql.includes("count(*) FILTER")) return { rows: [{ active: 0, total: 0 }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO workspace_catalog_assets")) throw new Error("database unavailable");
      return { rows: [], rowCount: 0 };
    });
    const { service, storage } = setup(query);
    await expect(service.upload(actor, workspaceId, recordId, assetId, { role: "technical_drawing" }, { buffer: image, originalname: "detail.png", mimetype: "image/png", size: image.length })).rejects.toThrow("database unavailable");
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });

  it("requires a reason before archiving and refuses stale metadata edits", async () => {
    const current = row();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT kind,archived")) return { rows: [{ kind: "work", archived: false }], rowCount: 1 };
      if (sql.includes("FROM workspace_catalog_assets") && sql.includes("catalog_record_id=$3")) return { rows: [current], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const { service } = setup(query);
    await expect(service.update(actor, workspaceId, recordId, assetId, { version: 1, archived: true })).rejects.toThrow("reason");
    await expect(service.update(actor, workspaceId, recordId, assetId, { version: 0, altText: "New chair" })).rejects.toThrow("changed");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false);
  });
});
