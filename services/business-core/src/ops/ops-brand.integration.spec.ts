import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). `brand` on an existing workspace with a
// brand.json, its logo and its sign-in background: a dry run writes nothing, --apply brands the workspace through the
// app's commands (audited as the member, via the operator CLI) with the files in the brand storage, and a second run of
// the same file changes nothing.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const run = promisify(execFile);
const fixtures = resolve(__dirname, "fixtures");

type Result = { code: number; output: string };
type Line = { section: string; status: string; label: string; detail?: string };
type Json = { counts: Record<string, number>; lines: Line[] };

integration("operator CLI brand: a workspace's name, colours, fonts, logo and sign-in background (real Postgres)", () => {
  let pool: Pool;
  const workspaceId = randomUUID(), owner = randomUUID();
  const slug = `brand-${workspaceId.slice(0, 8)}`;
  const ownerEmail = `owner-${owner.slice(0, 8)}@example.test`;
  const dir = mkdtempSync(join(tmpdir(), "ops-brand-it-"));
  const storage = join(dir, "storage");
  let dry: Result, apply: Result, again: Result;
  let afterDry: Awaited<ReturnType<typeof state>>;

  async function cli(runs: string[][]): Promise<Result[]> {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c role=wodana_app");
    const { stdout } = await run(process.execPath, [resolve(fixtures, "run-ops-cli.cjs"), JSON.stringify(runs)], {
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AUTH_MODE: "development", REDIS_URL: "", OBJECT_STORAGE_BUCKET: "",
        BRAND_ASSET_STORAGE_DIR: storage },
      maxBuffer: 20 * 1024 * 1024, timeout: 280_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf("@@RESULT@@") + "@@RESULT@@".length)) as Result[];
  }
  const json = (result: Result) => JSON.parse(result.output) as Json;
  const state = async () => (await pool.query<{
    name: string; version: number; displayName: string; primaryColor: string | null; secondaryColor: string | null; headingFont: string | null; bodyFont: string | null;
    logo: string | null; background: string | null; assets: number; audits: string[];
  }>(`SELECT workspace.name, workspace.version, branding.display_name AS "displayName", branding.primary_color AS "primaryColor",
            branding.secondary_color AS "secondaryColor", branding.heading_font AS "headingFont", branding.body_font AS "bodyFont",
            branding.logo_asset_id::text AS logo, branding.login_background_asset_id::text AS background,
            (SELECT count(*)::int FROM workspace_brand_assets asset WHERE asset.workspace_id = workspace.id) AS assets,
            ARRAY(SELECT action FROM audit_events audit WHERE audit.workspace_id = workspace.id AND audit.via = 'operator_cli' ORDER BY action) AS audits
       FROM workspaces workspace JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
    await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 20, g: 90, b: 70, alpha: 1 } } }).png().toFile(join(dir, "logo.png"));
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 160, g: 140, b: 120 } } }).jpeg().toFile(join(dir, "sign-in.jpg"));
    writeFileSync(join(dir, "brand.json"), JSON.stringify({
      displayName: "La'espace Interiors", primaryColor: "#0b7f5d", secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat",
      logo: "logo.png", loginBackground: "sign-in.jpg",
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olive Owner')", [owner, ownerEmail]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_locale,default_timezone,created_by) VALUES($1,'Brand Studio',$2,'AED','en-US','UTC',$3)", [workspaceId, slug, owner]);
      const membership = randomUUID(), admin = randomUUID();
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, owner]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'administrator','Administrator',true)", [admin, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions", [workspaceId, admin]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, admin]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name) VALUES($1,$2,'Brand Studio')", [workspaceId, slug]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const common = ["brand", "--workspace", slug, "--as", ownerEmail, "--file", join(dir, "brand.json"), "--json"];
    [dry] = await cli([common]);
    afterDry = await state();
    [apply, again] = await cli([[...common, "--apply"], [...common, "--apply"]]);
  }, 600_000);
  afterAll(async () => {
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("previews every change without writing anything", () => {
    expect(dry.code, dry.output).toBe(0);
    expect(json(dry).lines).toEqual([
      { section: "brand", status: "would change", label: "display name", detail: "Brand Studio → La'espace Interiors" },
      { section: "brand", status: "would change", label: "primary colour", detail: "(none) → #0B7F5D" },
      { section: "brand", status: "would change", label: "secondary colour", detail: "(none) → #000000" },
      { section: "brand", status: "would change", label: "heading font", detail: "(none) → alta" },
      { section: "brand", status: "would change", label: "body font", detail: "(none) → montserrat" },
      { section: "brand", status: "would change", label: "logo", detail: expect.stringMatching(/^logo\.png \(\d+ KB\)$/) },
      { section: "brand", status: "would change", label: "sign-in background", detail: expect.stringMatching(/^sign-in\.jpg \(\d+ KB\)$/) },
    ]);
    expect(afterDry).toMatchObject({ name: "Brand Studio", displayName: "Brand Studio", primaryColor: null, logo: null, background: null, assets: 0, audits: [] });
  });

  it("brands the workspace through the app's commands, audited as the member", async () => {
    expect(apply.code, apply.output).toBe(0);
    expect(json(apply).counts).toEqual({ changed: 7 });
    const after = await state();
    expect(after).toMatchObject({ name: "La'espace Interiors", displayName: "La'espace Interiors", primaryColor: "#0B7F5D", secondaryColor: "#000000",
      headingFont: "alta", bodyFont: "montserrat", logo: expect.any(String), background: expect.any(String), assets: 2 });
    expect(after.audits).toEqual(["workspace.appearance_updated", "workspace.login_background_updated", "workspace.logo_updated", "workspace.updated"]);
    // The files are in the brand storage, with their variants, as the browser's upload leaves them.
    const assets = (await pool.query<{ purpose: string; status: string; width: number; variants: Record<string, string> }>(
      "SELECT purpose, status, width, variants FROM workspace_brand_assets WHERE workspace_id = $1 ORDER BY purpose", [workspaceId])).rows;
    expect(assets).toEqual([
      { purpose: "login_background", status: "active", width: 1600, variants: { cover: expect.stringMatching(/cover\.webp$/) } },
      { purpose: "workspace_logo", status: "active", width: 400, variants: { display: expect.any(String), square: expect.any(String), document: expect.any(String) } },
    ]);
    const cover = await sharp(join(storage, assets[0].variants.cover)).metadata();
    expect(cover).toMatchObject({ format: "webp", width: 1600, height: 900 });
  });

  it("changes nothing on a second run of the same file", async () => {
    expect(again.code, again.output).toBe(0);
    expect(json(again).counts).toEqual({ unchanged: 7 });
    expect(json(again).lines.find((line) => line.label === "sign-in background")).toMatchObject({ status: "unchanged", detail: "sign-in.jpg" });
    expect((await state()).assets).toBe(2);
  });
});
