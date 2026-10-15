import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { HttpException } from "@nestjs/common";
import { COMPANY_LOGO_MAX_BYTES, InitiateCompanyLogoUploadDto } from "../workspaces/dto/company-logo.dto";
import { InitiateLoginBackgroundUploadDto, LOGIN_BACKGROUND_MAX_BYTES } from "../workspaces/dto/login-background.dto";
import { BODY_FONTS, HEADING_FONTS, UpdateWorkspaceAppearanceDto } from "../workspaces/dto/update-workspace-appearance.dto";
import { UpdateWorkspaceDto } from "../workspaces/dto/update-workspace.dto";
import { WorkspacesService, type WorkspaceImagePurpose } from "../workspaces/workspaces.service";
import { OpsError, type OpsContext, type Report } from "./ops-context";

/**
 * `brand`: a workspace's brand from a brand.json, through the same commands Settings uses (permissions, validation,
 * version checks and audit, as the member): its display name, colours, fonts, logo and sign-in background. Every
 * field is optional; a field left out is left as it is, and null clears it. Files are uploaded through the brand
 * asset storage the app uses (local or object storage). A second run of the same file changes nothing.
 */

const KEYS = ["displayName", "primaryColor", "secondaryColor", "headingFont", "bodyFont", "logo", "loginBackground"] as const;
const HEX = /^#[0-9A-F]{6}$/;
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp"> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export type BrandSpec = {
  displayName?: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
  /** File paths as written in brand.json (relative to it); null removes the image. */
  logo?: string | null;
  loginBackground?: string | null;
};
export type BrandImage = { path: string; filename: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; body: Buffer; sha256: string };
export type BrandFile = Omit<BrandSpec, "logo" | "loginBackground"> & { logo?: BrandImage | null; loginBackground?: BrandImage | null };

/** brand.json's fields checked whole; every problem is listed at once. */
export function parseBrandSpec(raw: unknown): BrandSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OpsError("brand.json is a JSON object.");
  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  const unknown = Object.keys(input).filter((key) => !(KEYS as readonly string[]).includes(key));
  if (unknown.length) problems.push(`unknown fields: ${unknown.join(", ")} (allowed: ${KEYS.join(", ")})`);
  const spec: BrandSpec = {};
  if (input.displayName !== undefined) {
    const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (name.length < 2 || name.length > 160) problems.push("displayName is 2 to 160 characters");
    else spec.displayName = name;
  }
  for (const key of ["primaryColor", "secondaryColor"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null) { spec[key] = null; continue; }
    const hex = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!HEX.test(hex)) problems.push(`${key} is a six-digit hex colour such as #0B7F5D, or null`);
    else spec[key] = hex;
  }
  for (const [key, allowed] of [["headingFont", HEADING_FONTS], ["bodyFont", BODY_FONTS]] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null) { spec[key] = null; continue; }
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      problems.push(`${key} ${JSON.stringify(value)} is not an allowed font token (allowed: ${allowed.join(", ")}, or null)`);
    } else spec[key] = value;
  }
  for (const key of ["logo", "loginBackground"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null) { spec[key] = null; continue; }
    if (typeof value !== "string" || !value.trim()) { problems.push(`${key} is a file path (relative to brand.json), or null`); continue; }
    if (!IMAGE_TYPES[extname(value).toLowerCase()]) { problems.push(`${key} is a .png, .jpg or .webp file`); continue; }
    spec[key] = value.trim();
  }
  if (problems.length) throw new OpsError(`brand.json can't be used:\n  - ${problems.join("\n  - ")}`);
  if (!Object.keys(spec).length) throw new OpsError(`brand.json sets nothing; give one or more of ${KEYS.join(", ")}.`);
  return spec;
}

/** brand.json read and checked, with its images read (paths relative to the JSON file), before anything connects. */
export async function readBrandFile(path: string): Promise<BrandFile> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { throw new OpsError(`No brand file at ${path}.`); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new OpsError(`${path} is not valid JSON.`); }
  const spec = parseBrandSpec(raw);
  const image = async (key: "logo" | "loginBackground", maxBytes: number): Promise<BrandImage | null | undefined> => {
    const relative = spec[key];
    if (relative === undefined || relative === null) return relative;
    const file = resolve(dirname(path), relative);
    let body: Buffer;
    try { body = await readFile(file); } catch { throw new OpsError(`${key}: no file at ${file}.`); }
    if (!body.byteLength) throw new OpsError(`${key}: ${file} is empty.`);
    if (body.byteLength > maxBytes) throw new OpsError(`${key}: ${file} is ${(body.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${maxBytes / 1024 / 1024} MB.`);
    return { path: file, filename: basename(file), mimeType: IMAGE_TYPES[extname(file).toLowerCase()], body, sha256: createHash("sha256").update(body).digest("hex") };
  };
  const { logo: _logo, loginBackground: _background, ...fields } = spec;
  const brand: BrandFile = { ...fields };
  const logo = await image("logo", COMPANY_LOGO_MAX_BYTES);
  if (logo !== undefined) brand.logo = logo;
  const loginBackground = await image("loginBackground", LOGIN_BACKGROUND_MAX_BYTES);
  if (loginBackground !== undefined) brand.loginBackground = loginBackground;
  return brand;
}

type Detail = {
  workspace: { name: string; version: number };
  branding: { primaryColor: string | null; secondaryColor: string | null; headingFont: string | null; bodyFont: string | null };
};
type ActiveImage = { id: string; filename: string; byteSize: number | null; sha256: string | null };

const shown = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "(none)" : value);
const sizeOf = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function runBrand(ctx: OpsContext, brand: BrandFile, report: Report) {
  const workspaces = ctx.get(WorkspacesService);
  const id = ctx.workspace.id;
  const detail = await workspaces.get(ctx.actor, id) as unknown as Detail;
  let version = detail.workspace.version;
  const part = async (label: string, work: () => Promise<void>) => {
    try { await work(); } catch (error) {
      const message = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : (error as Error).message;
      report.add("brand", "failed", label, message.slice(0, 300));
    }
  };
  const change = async (label: string, detailText: string, run: () => Promise<void>) => {
    if (!ctx.apply) { report.add("brand", "would change", label, detailText); return; }
    await run();
    report.add("brand", "changed", label, detailText);
  };

  if (brand.displayName !== undefined) await part("display name", async () => {
    const loginName = (await ctx.read((client) => client.query<{ displayName: string }>(
      `SELECT display_name AS "displayName" FROM tenant_login_branding WHERE workspace_id = $1`, [id]))).rows[0]?.displayName ?? null;
    if (detail.workspace.name === brand.displayName && loginName === brand.displayName) { report.add("brand", "unchanged", "display name", brand.displayName); return; }
    await change("display name", `${shown(loginName ?? detail.workspace.name)} → ${brand.displayName}`, async () => {
      const updated = await workspaces.updateWorkspace(ctx.actor, id, await ctx.validated(UpdateWorkspaceDto, { version, name: brand.displayName }));
      version = Number(updated.version);
    });
  });

  const appearanceKeys = (["primaryColor", "secondaryColor", "headingFont", "bodyFont"] as const).filter((key) => brand[key] !== undefined);
  if (appearanceKeys.length) await part("appearance", async () => {
    const labels = { primaryColor: "primary colour", secondaryColor: "secondary colour", headingFont: "heading font", bodyFont: "body font" };
    const differing = appearanceKeys.filter((key) => (detail.branding[key] ?? null) !== (brand[key] ?? null));
    for (const key of appearanceKeys.filter((entry) => !differing.includes(entry))) report.add("brand", "unchanged", labels[key], shown(brand[key]));
    if (!differing.length) return;
    if (!ctx.apply) { for (const key of differing) report.add("brand", "would change", labels[key], `${shown(detail.branding[key])} → ${shown(brand[key])}`); return; }
    // One appearance command, as Settings saves it: the fields brand.json leaves out stay as they are.
    const updated = await workspaces.updateAppearance(ctx.actor, id, await ctx.validated(UpdateWorkspaceAppearanceDto, {
      workspaceVersion: version,
      primaryColor: brand.primaryColor !== undefined ? brand.primaryColor : detail.branding.primaryColor,
      ...Object.fromEntries((["secondaryColor", "headingFont", "bodyFont"] as const).filter((key) => brand[key] !== undefined).map((key) => [key, brand[key]])),
    }));
    version = Number(updated.workspace.version);
    for (const key of differing) report.add("brand", "changed", labels[key], `${shown(detail.branding[key])} → ${shown(brand[key])}`);
  });

  for (const [key, purpose, label] of [["logo", "workspace_logo", "logo"], ["loginBackground", "login_background", "sign-in background"]] as const) {
    const wanted = brand[key];
    if (wanted === undefined) continue;
    await part(label, async () => {
      const active = await activeImage(ctx, purpose);
      if (wanted === null) {
        if (!active) { report.add("brand", "unchanged", label, "(none)"); return; }
        await change(label, `${active.filename} → removed`, async () => {
          if (purpose === "workspace_logo") await workspaces.removeCompanyLogo(ctx.actor, id);
          else await workspaces.removeLoginBackground(ctx.actor, id);
        });
        return;
      }
      // The same file: by the content hash the storage recorded, else (older uploads) by its size and name.
      const same = active && (active.sha256 ? active.sha256 === wanted.sha256 : active.byteSize === wanted.body.byteLength && active.filename === wanted.filename);
      if (same) { report.add("brand", "unchanged", label, wanted.filename); return; }
      await change(label, `${active ? `${active.filename} → ` : ""}${wanted.filename} (${sizeOf(wanted.body.byteLength)})`, async () => {
        await uploadImage(ctx, workspaces, purpose, wanted);
      });
    });
  }
}

async function activeImage(ctx: OpsContext, purpose: WorkspaceImagePurpose): Promise<ActiveImage | null> {
  const column = purpose === "workspace_logo" ? "logo_asset_id" : "login_background_asset_id";
  return (await ctx.read((client) => client.query<ActiveImage>(
    `SELECT asset.id, asset.original_filename AS filename, asset.byte_size AS "byteSize", stored.sha256
       FROM tenant_login_branding branding
       JOIN workspace_brand_assets asset ON asset.id = branding.${column} AND asset.workspace_id = branding.workspace_id AND asset.status = 'active'
       LEFT JOIN workspace_stored_objects stored ON stored.workspace_id = asset.workspace_id AND stored.object_key = asset.object_key
        AND stored.status = 'active' AND stored.removed_at IS NULL
      WHERE branding.workspace_id = $1`, [ctx.workspace.id]))).rows[0] ?? null;
}

/** The browser's three steps, with the content written to the brand storage on the server instead of a browser PUT. */
async function uploadImage(ctx: OpsContext, workspaces: WorkspacesService, purpose: WorkspaceImagePurpose, image: BrandImage) {
  const input = { filename: image.filename, mimeType: image.mimeType, byteSize: image.body.byteLength };
  const started = purpose === "workspace_logo"
    ? await workspaces.initiateCompanyLogoUpload(ctx.actor, ctx.workspace.id, await ctx.validated(InitiateCompanyLogoUploadDto, input))
    : await workspaces.initiateLoginBackgroundUpload(ctx.actor, ctx.workspace.id, await ctx.validated(InitiateLoginBackgroundUploadDto, input));
  await workspaces.storeWorkspaceImageContent(ctx.actor, ctx.workspace.id, purpose, started.assetId, image.mimeType, image.body);
  if (purpose === "workspace_logo") await workspaces.completeCompanyLogoUpload(ctx.actor, ctx.workspace.id, started.assetId);
  else await workspaces.completeLoginBackgroundUpload(ctx.actor, ctx.workspace.id, started.assetId);
}
