import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";

// Run only from a trusted operator environment against an already provisioned
// tenant. The client never receives this command or database credential.
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const sharp = require("sharp");
const [slug, primaryColor, secondaryColor, headingFont, bodyFont, wordmarkPath, monogramPath] = process.argv.slice(2);
assert.match(slug ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.match(primaryColor ?? "", /^#[0-9A-F]{6}$/);
assert.match(secondaryColor ?? "", /^#[0-9A-F]{6}$/);
assert.equal(headingFont, "alta", "Supported heading font is alta");
assert.equal(bodyFont, "montserrat", "Supported body font is montserrat");
assert.ok(wordmarkPath && monogramPath, "Wordmark and monogram PNGs are required");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");

const root = resolve(process.env.BRAND_ASSET_STORAGE_DIR ?? ".data/workspace-brand-assets");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const branding = await client.query(
    "SELECT workspace_id AS id, logo_asset_id AS previous_logo FROM tenant_login_branding WHERE login_slug = $1",
    [slug],
  );
  assert.equal(branding.rowCount, 1, `Tenant ${slug} was not found`);
  const workspaceId = branding.rows[0].id;
  const assetId = randomUUID();
  const [wordmark, monogram] = await Promise.all([readFile(wordmarkPath), readFile(monogramPath)]);
  assert.ok(wordmark.byteLength <= 5 * 1024 * 1024, "Wordmark exceeds 5 MB");
  assert.ok(monogram.byteLength <= 5 * 1024 * 1024, "Monogram exceeds 5 MB");
  const [wordmarkMeta, monogramMeta] = await Promise.all([
    sharp(wordmark, { failOn: "warning" }).metadata(),
    sharp(monogram, { failOn: "warning" }).metadata(),
  ]);
  for (const metadata of [wordmarkMeta, monogramMeta]) {
    assert.equal(metadata.format, "png", "Both logo files must be PNGs");
    assert.ok(metadata.width >= 64 && metadata.width <= 4096, "Logo width is outside 64–4096 px");
    assert.ok(metadata.height >= 64 && metadata.height <= 4096, "Logo height is outside 64–4096 px");
  }

  const prefix = `workspace-branding/${workspaceId}/${assetId}`;
  const objectKey = `${prefix}/source`;
  const variants = {
    display: `${prefix}/display.webp`,
    square: `${prefix}/square.webp`,
    document: `${prefix}/document.png`,
  };
  const pathFor = (key) => {
    const path = resolve(root, key);
    assert.ok(path.startsWith(`${root}${sep}`), "Logo path escaped storage root");
    return path;
  };
  const [display, square, document] = await Promise.all([
    sharp(wordmark).rotate().resize({ width: 1024, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer(),
    sharp(monogram).rotate().resize({ width: 512, height: 512, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).webp({ quality: 90 }).toBuffer(),
    sharp(wordmark).rotate().resize({ width: 1024, height: 512, fit: "contain", background: "#ffffff", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer(),
  ]);
  for (const [key, body] of [[objectKey, wordmark], [variants.display, display], [variants.square, square], [variants.document, document]]) {
    const target = pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx" });
  }

  await client.query("BEGIN");
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
  const workspace = await client.query("SELECT created_by FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
  assert.equal(workspace.rowCount, 1, "Workspace disappeared during branding");
  await client.query("SELECT set_config('app.current_actor_id', $1, true)", [workspace.rows[0].created_by]);
  await client.query(
    "UPDATE workspace_brand_assets SET status = 'replaced' WHERE workspace_id = $1 AND status = 'active'",
    [workspaceId],
  );
  await client.query(
    `INSERT INTO workspace_brand_assets
      (id,workspace_id,object_key,original_filename,mime_type,expected_byte_size,
       byte_size,width,height,variants,status,created_by,upload_expires_at,activated_at)
     VALUES ($1,$2,$3,$4,'image/png',$5,$5,$6,$7,$8,'active',$9,now(),now())`,
    [assetId, workspaceId, objectKey, "Palm Living - Logo.png", wordmark.byteLength,
      wordmarkMeta.width, wordmarkMeta.height, JSON.stringify(variants), workspace.rows[0].created_by],
  );
  await client.query(
    `UPDATE tenant_login_branding SET logo_asset_id = $1, logo_url = NULL, primary_color = $2,
       secondary_color = $3, heading_font = $4, body_font = $5, updated_at = now()
     WHERE workspace_id = $6`,
    [assetId, primaryColor, secondaryColor, headingFont, bodyFont, workspaceId],
  );
  await client.query("UPDATE workspaces SET version = version + 1, updated_at = now() WHERE id = $1", [workspaceId]);
  await client.query(
    `INSERT INTO audit_events
      (id,workspace_id,actor_user_id,source,action,entity_type,entity_id,before,after,correlation_id,occurred_at)
     VALUES ($1,$2,NULL,'internal','workspace.appearance_updated','workspace_branding',$2,$3,$4,$5,now())`,
    [randomUUID(), workspaceId, JSON.stringify({ logoAssetId: branding.rows[0].previous_logo }),
      JSON.stringify({ logoAssetId: assetId, primaryColor, secondaryColor, headingFont, bodyFont }), randomUUID()],
  );
  await client.query("COMMIT");
  process.stdout.write(JSON.stringify({
    slug, primaryColor, secondaryColor, headingFont, bodyFont,
    logoUrl: `/api/auth/tenant-logo/${slug}?v=${assetId}`,
  }) + "\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
