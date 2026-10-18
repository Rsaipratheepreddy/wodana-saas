import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { proxyBrandImageCommand, UUID } from "@/lib/workspace/brand-image-proxy";

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const t = await getServerT();
  const { assetId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(assetId)) return NextResponse.json({ message: t("A valid upload is required.") }, { status: 400 });
  return proxyBrandImageCommand(`/workspaces/${workspaceId}/company-profile/login-background-uploads/${assetId}/complete`, { method: "POST" }, {
    expired: t("Your session has expired. Sign in again."),
    unavailable: t("Sign-in background uploads are unavailable."),
    failed: t("The sign-in background could not be activated."),
  });
}
