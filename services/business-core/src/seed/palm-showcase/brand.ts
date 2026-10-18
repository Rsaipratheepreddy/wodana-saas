import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { UpdateWorkspaceAppearanceDto } from "../../workspaces/dto/update-workspace-appearance.dto";
import { InitiateCompanyLogoUploadDto } from "../../workspaces/dto/company-logo.dto";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { actorOf, type Actor, type Core } from "./core";
import type { SeedData } from "./data";

type Detail = {
  workspace: { version: number };
  branding: { logoAssetId: string | null; primaryColor: string | null; secondaryColor: string | null; headingFont: string | null; bodyFont: string | null };
};

/**
 * The tenant's brand as clients and staff see it: the colours and fonts from the brand fixture, and the logo file
 * uploaded through the company-logo flow (a short-lived upload, its content, then verification). The logo is
 * uploaded once: a run whose workspace already has a logo keeps it (the file's digest is recorded on the run).
 */
export async function ensureBrand(core: Core, data: SeedData, workspaceId: string, owner: Actor) {
  const actor = actorOf(owner);
  const workspaces = core.get(WorkspacesService);
  const brand = data.brand;
  if (!brand) { core.report.notes.push("No brand fixture; the appearance was not set."); return; }
  const detail = (await workspaces.get(actor, workspaceId)) as unknown as Detail;
  const desired = { primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor, headingFont: brand.headingFont.token, bodyFont: brand.bodyFont.token };
  await core.ensure("brand appearance", "brand colours and fonts", async () => (["primaryColor", "secondaryColor", "headingFont", "bodyFont"] as const)
    .every((key) => (detail.branding[key] ?? null) === (desired[key] ?? null)),
  async () => workspaces.updateAppearance(actor, workspaceId, await core.validated(UpdateWorkspaceAppearanceDto, { workspaceVersion: detail.workspace.version, ...desired })));

  const logoPath = data.brandLogoPath;
  if (!logoPath || !existsSync(logoPath)) { core.report.record("brand logo", "pending", `logo file not found (${logoPath ?? "no path"})`); return; }
  if (detail.branding.logoAssetId) { core.report.record("brand logo", "reused"); return; }
  if (!core.commit) { core.report.record("brand logo", "pending", "would be uploaded"); return; }
  const body = readFileSync(logoPath);
  const mimeType = logoPath.endsWith(".jpg") || logoPath.endsWith(".jpeg") ? "image/jpeg" : logoPath.endsWith(".webp") ? "image/webp" : "image/png";
  const upload = (await workspaces.initiateCompanyLogoUpload(actor, workspaceId, await core.validated(InitiateCompanyLogoUploadDto,
    { filename: logoPath.split("/").pop() ?? "logo.png", mimeType, byteSize: body.length }))) as { assetId: string; uploadMode: string; uploadUrl: string | null; uploadHeaders: Record<string, string> };
  if (upload.uploadMode === "signed" && upload.uploadUrl) {
    // Object storage: the content goes to the signed address, as the browser would send it.
    const response = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.uploadHeaders, body });
    if (!response.ok) throw new Error(`Logo upload to object storage failed: ${response.status}`);
  } else {
    await workspaces.uploadCompanyLogoContent(actor, workspaceId, upload.assetId, mimeType, body);
  }
  await workspaces.completeCompanyLogoUpload(actor, workspaceId, upload.assetId);
  core.report.record("brand logo", "created");
  core.report.notes.push(`Logo uploaded from ${logoPath} (sha256 ${createHash("sha256").update(body).digest("hex").slice(0, 12)}).`);
}
