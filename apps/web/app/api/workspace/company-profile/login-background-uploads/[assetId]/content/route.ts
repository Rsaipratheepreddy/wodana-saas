import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { proxyBrandImageCommand, UUID } from "@/lib/workspace/brand-image-proxy";

export async function PUT(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const t = await getServerT();
  const { assetId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(assetId)) return NextResponse.json({ message: t("A valid upload is required.") }, { status: 400 });
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  const body = await request.arrayBuffer();
  return proxyBrandImageCommand(`/workspaces/${workspaceId}/company-profile/login-background-uploads/${assetId}/content`, {
    method: "POST",
    headers: { "content-type": contentType, "content-length": String(body.byteLength) },
    body,
  }, {
    expired: t("Your session has expired. Sign in again."),
    unavailable: t("Sign-in background uploads are unavailable."),
    failed: t("The sign-in background could not be uploaded."),
  });
}
