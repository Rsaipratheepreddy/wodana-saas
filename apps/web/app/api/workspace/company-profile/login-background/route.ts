import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { proxyBrandImageCommand, UUID } from "@/lib/workspace/brand-image-proxy";

export async function DELETE(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return NextResponse.json({ message: t("A valid workspace is required.") }, { status: 400 });
  return proxyBrandImageCommand(`/workspaces/${workspaceId}/company-profile/login-background`, { method: "DELETE" }, {
    expired: t("Your session has expired. Sign in again."),
    unavailable: t("The company profile service is unavailable."),
    failed: t("The sign-in background could not be removed."),
  });
}
