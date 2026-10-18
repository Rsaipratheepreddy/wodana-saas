import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const userId = "00000000-0000-4000-8000-000000000010";
const actor: RequestActor = { subject: "local:owner", provider: "local", email: "owner@example.com", displayName: "Owner" };

type Row = Record<string, unknown>;

/** The brand assets and login branding as the service sees them through its tenant transaction. */
function harness() {
  const assets = new Map<string, Row>();
  const branding: Row = { login_slug: "studio", logo_asset_id: null, login_background_asset_id: null };
  const audits: Array<{ action: string; values: unknown[] }> = [];
  const replaced: unknown[][] = [];
  const objects = new Map<string, Buffer>();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO workspace_brand_assets")) {
      const [id, ws, objectKey, filename, mime, size, , expires, purpose] = values;
      assets.set(String(id), { id, workspace_id: ws, object_key: objectKey, original_filename: filename, mime_type: mime, expected_byte_size: size,
        upload_expires_at: expires, purpose, status: "pending", variants: {}, updated_at: new Date("2026-10-15T08:00:00Z") });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SELECT * FROM workspace_brand_assets") && sql.includes("status = 'pending'")) {
      const row = assets.get(String(values[0]));
      return row && row.status === "pending" && row.purpose === values[2] ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("SELECT * FROM workspace_brand_assets") && sql.includes("status = 'active'")) {
      const row = assets.get(String(values[0]));
      return row?.status === "active" ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("SET status = 'replaced'")) { replaced.push(values); return { rowCount: 0, rows: [] }; }
    if (sql.includes("SET status = 'active'")) {
      const row = assets.get(String(values[4]))!;
      Object.assign(row, { status: "active", byte_size: values[0], width: values[1], height: values[2], variants: values[3] });
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes("UPDATE tenant_login_branding")) {
      const column = sql.includes("login_background_asset_id") ? "login_background_asset_id" : "logo_asset_id";
      branding[column] = sql.includes("= NULL") ? null : values[0];
      return { rowCount: 1, rows: [{ loginSlug: branding.login_slug }] };
    }
    if (sql.includes("FROM tenant_login_branding WHERE workspace_id")) return { rowCount: 1, rows: [{ assetId: branding.login_background_asset_id }] };
    if (sql.includes("INSERT INTO audit_events")) { audits.push({ action: String(values[4]), values }); return { rowCount: 1, rows: [] }; }
    return { rowCount: 0, rows: [] };
  });
  const client = { query };
  const access = { withAnyPermission: vi.fn(async (_actor, _id, _permissions, work) => work(client, { ...actor, userId })) };
  const storage = {
    usesObjectStorage: false,
    createUploadUrl: vi.fn(async () => null),
    writeLocal: vi.fn(async (key: string, body: Buffer) => { objects.set(key, body); }),
    put: vi.fn(async (key: string, body: Buffer) => { objects.set(key, body); }),
    confirmUpload: vi.fn(async () => undefined),
    read: vi.fn(async (key: string) => {
      const body = objects.get(key);
      if (!body) throw new Error("missing");
      return { body, byteSize: body.byteLength };
    }),
  };
  const database = {
    query: vi.fn(async (sql: string) => ({ rowCount: 1, rows: [{ workspaceId, assetId: sql.includes("login_background_asset_id") ? branding.login_background_asset_id : branding.logo_asset_id }] })),
    tenantTransaction: vi.fn(async (_workspace: string, _actor: string, work: (c: typeof client) => unknown) => work(client)),
  };
  const service = new WorkspacesService(database as never, {} as never, access as never, storage as never, {} as never);
  return { service, assets, branding, audits, replaced, objects, storage, access };
}

async function upload(h: ReturnType<typeof harness>, body: Buffer, mimeType = "image/jpeg") {
  const started = await h.service.initiateLoginBackgroundUpload(actor, workspaceId, { filename: "showroom.jpg", mimeType: mimeType as "image/jpeg", byteSize: body.byteLength });
  await h.service.uploadLoginBackgroundContent(actor, workspaceId, started.assetId, mimeType, body);
  return { started, completed: await h.service.completeLoginBackgroundUpload(actor, workspaceId, started.assetId) };
}

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 110, b: 96 } } }).jpeg({ quality: 80 }).toBuffer();

describe("WorkspacesService sign-in background", () => {
  it("starts a short-lived upload marked as the sign-in background, with the organization settings permission", async () => {
    const h = harness();
    const started = await h.service.initiateLoginBackgroundUpload(actor, workspaceId, { filename: "showroom.jpg", mimeType: "image/jpeg", byteSize: 2_000_000 });
    expect(started).toMatchObject({ uploadMode: "application", uploadUrl: null, uploadHeaders: { "content-type": "image/jpeg" } });
    expect(h.assets.get(started.assetId)).toMatchObject({ purpose: "login_background", status: "pending", expected_byte_size: 2_000_000,
      object_key: `workspace-branding/${workspaceId}/${started.assetId}/source` });
    expect(h.access.withAnyPermission).toHaveBeenCalledWith(actor, workspaceId, ["module.organization.edit", "workspace.settings.manage"], expect.any(Function));
  });

  it("refuses a file over 10 MB before anything is recorded", async () => {
    const h = harness();
    await expect(h.service.initiateLoginBackgroundUpload(actor, workspaceId, { filename: "huge.png", mimeType: "image/png", byteSize: 10 * 1024 * 1024 + 1 }))
      .rejects.toThrow("Sign-in background must be 10 MB or smaller");
    expect(h.assets.size).toBe(0);
  });

  it("activates the photo with a cover image of at most 2400 px, sets it on the login branding and audits it", async () => {
    const h = harness();
    const { started, completed } = await upload(h, await photo(3600, 2000));
    expect(completed).toEqual({ assetId: started.assetId, loginBackgroundUrl: `/api/auth/tenant-background/studio?v=${started.assetId}`, updatedAt: expect.any(Date) });
    const asset = h.assets.get(started.assetId)!;
    expect(asset).toMatchObject({ status: "active", width: 3600, height: 2000, variants: { cover: `workspace-branding/${workspaceId}/${started.assetId}/cover.webp` } });
    const cover = await sharp(h.objects.get((asset.variants as Record<string, string>).cover)!).metadata();
    expect(cover).toMatchObject({ format: "webp", width: 2400, height: 1333 });
    expect(h.branding).toMatchObject({ login_background_asset_id: started.assetId, logo_asset_id: null });
    // Only an earlier sign-in background is replaced, never the logo.
    expect(h.replaced).toEqual([[workspaceId, started.assetId, "login_background"]]);
    expect(h.audits.map((audit) => audit.action)).toEqual(["workspace.login_background_updated"]);
  });

  it("keeps a smaller photo at its own size", async () => {
    const h = harness();
    const { started } = await upload(h, await photo(1600, 900));
    const cover = await sharp(h.objects.get(`workspace-branding/${workspaceId}/${started.assetId}/cover.webp`)!).metadata();
    expect(cover).toMatchObject({ width: 1600, height: 900 });
  });

  it("refuses an image too small to cover the sign-in screen, and a file that is not the image it claims", async () => {
    const h = harness();
    await expect(upload(h, await photo(1000, 800))).rejects.toThrow("Sign-in background must be at least 1200 by 600 pixels");
    await expect(upload(h, await photo(1600, 900), "image/png")).rejects.toThrow("The uploaded file is not a valid supported sign-in background image");
    expect(h.branding.login_background_asset_id).toBeNull();
  });

  it("does not complete a logo upload as a sign-in background", async () => {
    const h = harness();
    const body = await photo(1600, 900);
    const logo = await h.service.initiateCompanyLogoUpload(actor, workspaceId, { filename: "logo.jpg", mimeType: "image/jpeg", byteSize: body.byteLength });
    await expect(h.service.completeLoginBackgroundUpload(actor, workspaceId, logo.assetId)).rejects.toThrow("Pending sign-in background upload was not found");
  });

  it("serves the cover image publicly by login slug, and nothing once it is removed", async () => {
    const h = harness();
    const { started } = await upload(h, await photo(1600, 900));
    const served = await h.service.readPublicLoginBackground("Studio");
    expect(served.contentType).toBe("image/webp");
    expect((await sharp(served.body).metadata()).width).toBe(1600);
    await expect(h.service.removeLoginBackground(actor, workspaceId)).resolves.toEqual({ removed: true });
    expect(h.branding.login_background_asset_id).toBeNull();
    expect(h.audits.at(-1)).toMatchObject({ action: "workspace.login_background_removed" });
    expect(h.replaced.at(-1)).toEqual([started.assetId, workspaceId]);
    await expect(h.service.readPublicLoginBackground("studio")).rejects.toThrow("Sign-in background was not found");
  });
});
